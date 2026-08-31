import type { DatabaseClient } from "../database.js";

type Numeric = bigint | number | string;

interface VersionRow {
  id: bigint;
  version_code: string;
  source_fingerprint: string;
  definition_count: Numeric;
}

interface DefinitionRow {
  tier_code: string;
  display_name: string;
  tier_order: Numeric;
  regular_ticket_threshold: Numeric;
  advanced_ticket_threshold: Numeric;
  rank_emoji: string;
  pet_experience_delta: Numeric;
}

export interface TierDefinition {
  tierCode: string;
  displayName: string;
  tierOrder: number;
  regularTicketThreshold: bigint;
  advancedTicketThreshold: bigint;
  rankEmoji: string;
  petExperienceDelta: bigint;
}

export interface TierAuthoritySnapshot {
  versionId: bigint;
  versionCode: string;
  sourceFingerprint: string;
  definitions: readonly TierDefinition[];
}

// DB 숫자 형식을 손실 없는 bigint로 정규화합니다.
function integer(value: Numeric, field: string): bigint {
  const result = BigInt(value);
  if (result < 0n) throw new Error(`TIER_AUTHORITY_NEGATIVE_${field}`);
  return result;
}

// DB 행을 공용 티어 정의 계약으로 변환합니다.
function mapDefinition(row: DefinitionRow): TierDefinition {
  const order = Number(row.tier_order);
  if (!Number.isSafeInteger(order) || order < 0) throw new Error("TIER_AUTHORITY_ORDER_INVALID");
  return {
    tierCode: row.tier_code,
    displayName: row.display_name,
    tierOrder: order,
    regularTicketThreshold: integer(row.regular_ticket_threshold, "REGULAR_THRESHOLD"),
    advancedTicketThreshold: integer(row.advanced_ticket_threshold, "ADVANCED_THRESHOLD"),
    rankEmoji: row.rank_emoji,
    petExperienceDelta: integer(row.pet_experience_delta, "PET_EXPERIENCE_DELTA")
  };
}

// published 티어 41행의 identity, 순서와 임계값 단조성을 fail-closed 검증합니다.
export function validateTierDefinitions(definitions: readonly TierDefinition[], expectedCount = 41): void {
  if (definitions.length !== expectedCount) throw new Error(`TIER_AUTHORITY_COUNT_INVALID:${definitions.length}`);
  const codes = new Set<string>();
  const names = new Set<string>();
  for (let index = 0; index < definitions.length; index += 1) {
    const current = definitions[index]!;
    if (current.tierOrder !== index) throw new Error(`TIER_AUTHORITY_ORDER_GAP:${current.tierOrder}`);
    if (!/^tier_[0-9a-f]{16}$/.test(current.tierCode)) throw new Error(`TIER_AUTHORITY_CODE_INVALID:${current.tierCode}`);
    if (codes.has(current.tierCode) || names.has(current.displayName)) throw new Error("TIER_AUTHORITY_IDENTITY_DUPLICATE");
    codes.add(current.tierCode);
    names.add(current.displayName);
    if (index > 0) {
      const prior = definitions[index - 1]!;
      if (current.regularTicketThreshold < prior.regularTicketThreshold || current.advancedTicketThreshold < prior.advancedTicketThreshold) {
        throw new Error(`TIER_AUTHORITY_THRESHOLD_ORDER_INVALID:${current.tierCode}`);
      }
    }
  }
  const first = definitions[0]!;
  if (first.displayName !== "새싹" || first.regularTicketThreshold !== 0n || first.advancedTicketThreshold !== 0n) {
    throw new Error("TIER_AUTHORITY_BASE_TIER_INVALID");
  }
}

// 두 티켓 수량을 모두 충족하는 가장 높은 published 티어를 반환합니다.
export function resolveTierByTickets(definitions: readonly TierDefinition[], regularTickets: bigint, advancedTickets: bigint): TierDefinition {
  if (regularTickets < 0n || advancedTickets < 0n) throw new Error("TIER_AUTHORITY_TICKET_COUNT_NEGATIVE");
  for (let index = definitions.length - 1; index >= 0; index -= 1) {
    const definition = definitions[index]!;
    if (regularTickets >= definition.regularTicketThreshold && advancedTickets >= definition.advancedTicketThreshold) return definition;
  }
  throw new Error("TIER_AUTHORITY_BASE_TIER_REQUIRED");
}

// legacy 승급·강등 루프와 같은 방식으로 펫 경험치 증감 합계를 계산합니다.
export function calculateTierTransitionDelta(definitions: readonly TierDefinition[], fromTierCode: string, toTierCode: string): bigint {
  const from = definitions.findIndex((definition) => definition.tierCode === fromTierCode);
  const to = definitions.findIndex((definition) => definition.tierCode === toTierCode);
  if (from < 0 || to < 0) throw new Error("TIER_AUTHORITY_TRANSITION_TIER_REQUIRED");
  let delta = 0n;
  if (to > from) for (let index = from + 1; index <= to; index += 1) delta += definitions[index]!.petExperienceDelta;
  if (to < from) for (let index = from; index > to; index -= 1) delta -= definitions[index]!.petExperienceDelta;
  return delta;
}

// 현재 단일 published 버전과 41행 정의를 일관된 읽기 snapshot으로 제공합니다.
export class TierAuthorityProvider {
  public constructor(private readonly database: DatabaseClient) {}

  public async loadPublished(): Promise<TierAuthoritySnapshot> {
    return this.database.withTransaction(async (transaction) => {
      const versions = await transaction.query<VersionRow[]>(
        `SELECT version.id,version.version_code,version.source_fingerprint,version.definition_count
         FROM tier_definition_publications publication
         JOIN tier_definition_versions version ON version.id=publication.version_id AND version.status='PUBLISHED'
         WHERE publication.publication_key='ACTIVE' FOR UPDATE`
      );
      if (versions.length !== 1) throw new Error(`TIER_AUTHORITY_PUBLICATION_INVALID:${versions.length}`);
      const version = versions[0]!;
      if (Number(version.definition_count) !== 41) throw new Error(`TIER_AUTHORITY_DECLARED_COUNT_INVALID:${version.definition_count}`);
      const rows = await transaction.query<DefinitionRow[]>(
        `SELECT tier_code,display_name,tier_order,regular_ticket_threshold,advanced_ticket_threshold,rank_emoji,pet_experience_delta
         FROM tier_definitions WHERE version_id=? AND active=TRUE ORDER BY tier_order FOR UPDATE`,
        [version.id]
      );
      const definitions = rows.map(mapDefinition);
      validateTierDefinitions(definitions);
      return { versionId: BigInt(version.id), versionCode: version.version_code, sourceFingerprint: version.source_fingerprint, definitions };
    });
  }
}
