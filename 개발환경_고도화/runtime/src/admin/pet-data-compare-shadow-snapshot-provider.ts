import { createHash } from "node:crypto";

import type { AppWiringReadParticipant } from "../dispatch/app-wiring-operation-provider.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";

export interface PetDataCompareShadowCounts {
  readonly legacyPlayerCount: string;
  readonly legacyPetCount: string;
  readonly canonicalPlayerCount: string;
  readonly canonicalOwnedPetCount: string;
}

export interface PetDataCompareShadowDeltas {
  readonly canonicalMinusLegacyPlayerCount: string;
  readonly canonicalMinusLegacyPetCount: string;
}

export interface PetDataCompareShadowPreview {
  readonly authorized: boolean;
  readonly resultFingerprint: string;
  readonly counts: PetDataCompareShadowCounts;
  readonly deltas: PetDataCompareShadowDeltas;
  readonly summary: Readonly<Record<string, string | boolean>>;
}

export interface PetDataCompareShadowEvaluator {
  preview(database: AppWiringReadParticipant, event: NormalizedIrisEvent): Promise<PetDataCompareShadowPreview>;
}

const ZERO_COUNTS: PetDataCompareShadowCounts = Object.freeze({
  legacyPlayerCount: "0",
  legacyPetCount: "0",
  canonicalPlayerCount: "0",
  canonicalOwnedPetCount: "0",
});

const ZERO_DELTAS: PetDataCompareShadowDeltas = Object.freeze({
  canonicalMinusLegacyPlayerCount: "0",
  canonicalMinusLegacyPetCount: "0",
});

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("PET_DATA_COMPARE_SHADOW_NON_FINITE_NUMBER");
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new Error("PET_DATA_COMPARE_SHADOW_VALUE_INVALID");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function decimalCount(value: unknown, label: string): string {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`PET_DATA_COMPARE_SHADOW_COUNT_INVALID:${label}`);
  }
  const text = typeof value === "bigint" ? value.toString() : typeof value === "number" || typeof value === "string" ? String(value) : "";
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error(`PET_DATA_COMPARE_SHADOW_COUNT_INVALID:${label}`);
  return BigInt(text).toString();
}

function delta(canonical: string, legacy: string): string {
  return (BigInt(canonical) - BigInt(legacy)).toString();
}

// member.json의 모든 회원/현재 펫 행과 같은 import cohort만 비교합니다.
// canonical player는 LEGACY_JSON source로, 보유 펫도 그 player cohort에 JOIN한 현재 상태 `owned`로 제한해
// 이후 추가되는 비레거시 회원의 펫이나 consumed/removed 상태가 parity를 왜곡하지 않게 합니다.
export class MariaPetDataCompareShadowEvaluator implements PetDataCompareShadowEvaluator {
  async preview(database: AppWiringReadParticipant, event: NormalizedIrisEvent): Promise<PetDataCompareShadowPreview> {
    if (event.userId === undefined) throw new Error("PET_DATA_COMPARE_SHADOW_EVENT_INVALID");
    const authority = (await database.query<Array<{ operator_id: bigint | string }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code='super_admin' AND role.active=TRUE
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
       ORDER BY mapping.operator_id LIMIT 1`,
      [event.userId],
    ))[0];

    if (authority === undefined) {
      const projection = { authorized: false, reasonCode: "ADMIN_PET_DATA_COMPARE_FORBIDDEN" };
      return Object.freeze({
        authorized: false,
        resultFingerprint: sha256(projection),
        counts: ZERO_COUNTS,
        deltas: ZERO_DELTAS,
        summary: Object.freeze({ authorized: false }),
      });
    }

    const row = (await database.query<Array<{
      legacy_player_count: bigint | number | string;
      legacy_pet_count: bigint | number | string;
      canonical_player_count: bigint | number | string;
      canonical_owned_pet_count: bigint | number | string;
    }>>(
      `SELECT
         (SELECT COUNT(*) FROM player_profiles) legacy_player_count,
         (SELECT COUNT(*) FROM player_pets) legacy_pet_count,
         (SELECT COUNT(*) FROM canonical_players WHERE source_system='LEGACY_JSON') canonical_player_count,
         (SELECT COUNT(*) FROM canonical_owned_pet_instances owned_pet
          JOIN canonical_players player ON player.player_id=owned_pet.player_id
          WHERE owned_pet.ownership_status='owned' AND player.source_system='LEGACY_JSON') canonical_owned_pet_count`,
    ))[0];
    if (row === undefined) throw new Error("PET_DATA_COMPARE_SHADOW_COUNTS_MISSING");

    const counts = Object.freeze({
      legacyPlayerCount: decimalCount(row.legacy_player_count, "legacy_player_count"),
      legacyPetCount: decimalCount(row.legacy_pet_count, "legacy_pet_count"),
      canonicalPlayerCount: decimalCount(row.canonical_player_count, "canonical_player_count"),
      canonicalOwnedPetCount: decimalCount(row.canonical_owned_pet_count, "canonical_owned_pet_count"),
    });
    const deltas = Object.freeze({
      canonicalMinusLegacyPlayerCount: delta(counts.canonicalPlayerCount, counts.legacyPlayerCount),
      canonicalMinusLegacyPetCount: delta(counts.canonicalOwnedPetCount, counts.legacyPetCount),
    });
    const projection = {
      authorized: true,
      cohort: {
        canonicalOwnedPets: "ownership_status=owned AND player.source_system=LEGACY_JSON",
        canonicalPlayers: "source_system=LEGACY_JSON",
        legacyPets: "all player_pets rows",
        legacyPlayers: "all player_profiles rows",
      },
      counts,
      deltas,
    };
    return Object.freeze({
      authorized: true,
      resultFingerprint: sha256(projection),
      counts,
      deltas,
      summary: Object.freeze({ authorized: true, ...counts, ...deltas }),
    });
  }
}
