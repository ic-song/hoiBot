import type { DatabaseClient } from "../database.js";
import { MariaPendantPolicyCatalogRepository } from "../pet/maria-pendant-policy-catalog-repository.js";
import { PendantPolicyCatalogReadProvider, type PendantUpgradePolicyCatalog } from "../pet/pendant-policy-catalog.js";

export type AdminBalanceDomain = "home_badge" | "home_furniture" | "pendant";

export interface AdminBalanceValueProjection {
  domain: AdminBalanceDomain;
  key: string;
  group: string;
  sumGroup: string | null;
  label: string;
  value: string;
  unit: string;
  min: string | null;
  max: string | null;
  step: string;
  version: string;
  editable: boolean;
  source: string;
}

export interface AdminBalanceDomainProjection {
  domain: AdminBalanceDomain;
  label: string;
  version: string;
  source: string;
  values: readonly AdminBalanceValueProjection[];
}

export interface AdminBalanceReadProjection {
  domains: readonly AdminBalanceDomainProjection[];
}

export interface HomeBadgeVersionRow {
  id: bigint;
  version_key: string;
  content_hash: string;
}

export interface HomeBadgeDefinitionRow {
  badge_code: string;
  emoji_value: string;
  display_name: string;
  criteria_json: string | Record<string, unknown> | null;
}

export interface FurnitureCatalogRow {
  id: bigint;
  version_code: string;
  source_path: string;
  source_sha256: string;
  rate_scale: bigint | string;
}

export interface FurnitureBandRow {
  grade_ordinal: bigint | number;
  grade_display_name: string;
  weight_scaled: bigint | string;
  entry_count: bigint | number;
}

const BADGE_METRICS: Readonly<Record<string, { label: string; unit: string }>> = {
  followers: { label: "팔로워", unit: "명" },
  mutual: { label: "맞팔", unit: "명" },
  receivedComments: { label: "받은 댓글", unit: "회" },
  receivedHomeLikes: { label: "받은 좋아홈", unit: "회" },
  receivedReactions: { label: "받은 마음", unit: "회" },
  totalVisits: { label: "누적 방문", unit: "회" },
  feedActiveDays: { label: "피드 활동", unit: "일" },
};

function parseCriteria(value: HomeBadgeDefinitionRow["criteria_json"]): Record<string, unknown> {
  if (value === null) return {};
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("HOME_BADGE_CRITERIA_INVALID");
  }
  return parsed as Record<string, unknown>;
}

export function exactBalanceDecimal(numerator: bigint, denominator: bigint): string {
  if (denominator <= 0n || numerator < 0n) throw new Error("BALANCE_DECIMAL_RANGE_INVALID");
  const whole = numerator / denominator;
  let remainder = numerator % denominator;
  if (remainder === 0n) return whole.toString();
  let fraction = "";
  for (let index = 0; remainder !== 0n && index < 18; index += 1) {
    remainder *= 10n;
    fraction += (remainder / denominator).toString();
    remainder %= denominator;
  }
  if (remainder !== 0n) throw new Error("BALANCE_DECIMAL_NON_TERMINATING");
  return `${whole}.${fraction}`;
}

function projection(input: Omit<AdminBalanceValueProjection, "sumGroup"> & { sumGroup?: string | null }): AdminBalanceValueProjection {
  return { ...input, sumGroup: input.sumGroup ?? null };
}

export function projectHomeBadgeBalance(
  version: HomeBadgeVersionRow,
  definitions: readonly HomeBadgeDefinitionRow[],
): AdminBalanceDomainProjection {
  const source = `home_badge_definition_versions:${version.version_key}:${version.content_hash}`;
  const values: AdminBalanceValueProjection[] = [];
  for (const definition of definitions) {
    const criteria = parseCriteria(definition.criteria_json);
    for (const [metric, rawValue] of Object.entries(criteria)) {
      const metadata = BADGE_METRICS[metric];
      if (metadata === undefined) throw new Error(`HOME_BADGE_CRITERIA_UNSUPPORTED:${metric}`);
      if (typeof rawValue !== "number" || !Number.isSafeInteger(rawValue) || rawValue < 0) {
        throw new Error(`HOME_BADGE_CRITERIA_VALUE_INVALID:${definition.badge_code}:${metric}`);
      }
      values.push(projection({
        domain: "home_badge",
        key: `home_badge.${definition.badge_code}.criteria.${metric}`,
        group: `home_badge.${definition.badge_code}`,
        label: `${definition.emoji_value} ${definition.display_name} · ${metadata.label}`,
        value: rawValue.toString(),
        unit: metadata.unit,
        min: "0",
        max: "9007199254740991",
        step: "1",
        version: version.id.toString(),
        editable: true,
        source,
      }));
    }
  }
  return { domain: "home_badge", label: "홈뱃지 조건", version: version.id.toString(), source, values };
}

export function projectHomeFurnitureBalance(
  catalog: FurnitureCatalogRow,
  bands: readonly FurnitureBandRow[],
): AdminBalanceDomainProjection {
  const scale = BigInt(catalog.rate_scale);
  const total = bands.reduce((sum, row) => sum + BigInt(row.weight_scaled), 0n);
  if (total !== scale) throw new Error(`HOME_FURNITURE_RATE_SCALE_MISMATCH:${total}:${scale}`);
  const source = `home_furniture_draw_catalog_versions:${catalog.source_path}:${catalog.source_sha256}`;
  const values = bands.flatMap((band): AdminBalanceValueProjection[] => {
    const ordinal = Number(band.grade_ordinal);
    const group = `home_furniture.grade.${ordinal}`;
    return [
      projection({
        domain: "home_furniture",
        key: `${group}.probability`,
        group,
        sumGroup: "home_furniture.grade.probability",
        label: `${band.grade_display_name} 등급 확률`,
        value: exactBalanceDecimal(BigInt(band.weight_scaled) * 100n, scale),
        unit: "%",
        min: "0",
        max: "100",
        step: exactBalanceDecimal(100n, scale),
        version: catalog.id.toString(),
        editable: true,
        source,
      }),
      projection({
        domain: "home_furniture",
        key: `${group}.entry_count`,
        group,
        label: `${band.grade_display_name} 등급 가구 수`,
        value: BigInt(band.entry_count).toString(),
        unit: "개",
        min: "0",
        max: null,
        step: "1",
        version: catalog.id.toString(),
        editable: false,
        source,
      }),
    ];
  });
  return { domain: "home_furniture", label: "가구 뽑기", version: catalog.id.toString(), source, values };
}

export function projectPendantBalance(policy: PendantUpgradePolicyCatalog): AdminBalanceDomainProjection {
  const version = policy.policyVersion.toString();
  const source = `pendant_upgrade_policy_versions:${policy.policyCode}:${policy.sourceHash}`;
  const values = policy.levels.flatMap((level): AdminBalanceValueProjection[] => {
    const group = `pendant.level.${level.targetLevel}`;
    const common = { domain: "pendant" as const, group, version, editable: true, source };
    return [
      projection({ ...common, key: `${group}.success_rate`, label: `+${level.targetLevel} 성공 확률`, value: level.successRate, unit: "%", min: "0", max: "100", step: "0.0001" }),
      projection({ ...common, key: `${group}.charm_increment`, label: `+${level.targetLevel} 매력 증가`, value: level.charmIncrement.toString(), unit: "💕", min: "0", max: "18446744073709551615", step: "1" }),
      projection({ ...common, key: `${group}.explore_increment`, label: `+${level.targetLevel} 탐험 증가`, value: level.exploreIncrement, unit: "탐험", min: "0", max: "99999.999", step: "0.001" }),
      projection({ ...common, key: `${group}.point_cost`, label: `+${level.targetLevel} 포인트 비용`, value: level.pointCost.toString(), unit: "포인트", min: "0", max: "18446744073709551615", step: "1" }),
      projection({ ...common, key: `${group}.stone_cost`, label: `+${level.targetLevel} 강화석 비용`, value: level.stoneCost.toString(), unit: "개", min: "0", max: "18446744073709551615", step: "1" }),
    ];
  });
  return { domain: "pendant", label: "펜던트 강화", version, source, values };
}

export class AdminBalanceReadModelProvider {
  public constructor(
    private readonly database: DatabaseClient,
    private readonly pendantProvider: PendantPolicyCatalogReadProvider = new PendantPolicyCatalogReadProvider(
      new MariaPendantPolicyCatalogRepository(database),
    ),
  ) {}

  // 승인된 세 versioned provider를 관리 웹용 읽기 projection으로 변환합니다.
  public async read(): Promise<AdminBalanceReadProjection> {
    const domains = await Promise.all([
      this.readHomeBadge(),
      this.readHomeFurniture(),
      this.readPendant(),
    ]);
    return { domains };
  }

  private async readHomeBadge(): Promise<AdminBalanceDomainProjection> {
    const version = (await this.database.query<HomeBadgeVersionRow[]>(
      `SELECT id,version_key,content_hash FROM home_badge_definition_versions
       WHERE status='shadow' AND effective_at<=UTC_TIMESTAMP(3)
       ORDER BY effective_at DESC,id DESC LIMIT 1`,
    ))[0];
    if (version === undefined) throw new Error("HOME_BADGE_DEFINITION_MISSING");
    const definitions = await this.database.query<HomeBadgeDefinitionRow[]>(
      `SELECT badge_code,emoji_value,display_name,criteria_json
       FROM home_badge_definitions WHERE definition_version_id=? ORDER BY ordinal`,
      [version.id],
    );
    return projectHomeBadgeBalance(version, definitions);
  }

  private async readHomeFurniture(): Promise<AdminBalanceDomainProjection> {
    const catalog = (await this.database.query<FurnitureCatalogRow[]>(
      `SELECT id,version_code,source_path,source_sha256,rate_scale
       FROM home_furniture_draw_catalog_versions WHERE active=TRUE ORDER BY id DESC LIMIT 1`,
    ))[0];
    if (catalog === undefined) throw new Error("HOME_FURNITURE_CATALOG_MISSING");
    const bands = await this.database.query<FurnitureBandRow[]>(
      `SELECT grade_ordinal,grade_display_name,weight_scaled,entry_count
       FROM home_furniture_draw_grade_bands WHERE catalog_version_id=? ORDER BY grade_ordinal`,
      [catalog.id],
    );
    return projectHomeFurnitureBalance(catalog, bands);
  }

  private async readPendant(): Promise<AdminBalanceDomainProjection> {
    const policy = await this.pendantProvider.readPublished();
    return projectPendantBalance(policy);
  }
}
