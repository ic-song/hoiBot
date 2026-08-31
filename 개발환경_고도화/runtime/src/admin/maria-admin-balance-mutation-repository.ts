import { createHash } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import type { PendantUpgradePolicyCatalog, PendantUpgradeLevelPolicy } from "../pet/pendant-policy-catalog.js";
import {
  AdminBalanceReadModelProvider,
  projectHomeBadgeBalance,
  projectHomeFurnitureBalance,
  projectPendantBalance,
  type AdminBalanceDomain,
  type AdminBalanceDomainProjection,
  type FurnitureBandRow,
  type FurnitureCatalogRow,
  type HomeBadgeDefinitionRow,
  type HomeBadgeVersionRow,
} from "./admin-balance-read-model.js";
import type { AdminBalanceActivationInput, AdminBalanceMutationRepository, AdminBalanceValueChangeInput } from "./admin-balance-mutation-provider.js";

interface PendantHeaderRow {
  id: bigint;
  policy_code: string;
  policy_version: number;
  publish_state: "PUBLISHED" | "RETIRED";
  source_hash: string;
}

interface PendantLevelRow {
  target_level: number;
  success_rate: string;
  charm_increment: bigint;
  explore_increment: string;
  point_cost: bigint;
  stone_cost: bigint;
}

function transactionClient(transaction: DatabaseTransaction): DatabaseClient {
  return {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: transaction.query,
    execute: transaction.execute,
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined,
  };
}

function hashRevision(source: string, input: AdminBalanceActivationInput): string {
  return createHash("sha256").update(source).update("\0").update(JSON.stringify({
    mode: input.mode,
    currentVersion: input.currentVersion,
    targetVersion: input.targetVersion,
    changes: input.changes,
    operationId: input.operationId.toString(),
  })).digest("hex");
}

function percentageWeight(value: string, scale: bigint): bigint {
  const [whole, fraction = ""] = value.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole!) * denominator + BigInt(fraction || "0");
  const weighted = numerator * scale;
  const divisor = 100n * denominator;
  if (weighted % divisor !== 0n) throw new Error("HOME_FURNITURE_RATE_PRECISION_INVALID");
  return weighted / divisor;
}

function pendantPolicy(header: PendantHeaderRow, rows: readonly PendantLevelRow[]): PendantUpgradePolicyCatalog {
  const levels: PendantUpgradeLevelPolicy[] = rows.map((row) => ({
    targetLevel: Number(row.target_level),
    successRate: row.success_rate,
    charmIncrement: BigInt(row.charm_increment),
    exploreIncrement: row.explore_increment,
    pointCost: BigInt(row.point_cost),
    stoneCost: BigInt(row.stone_cost),
  }));
  return {
    policyCode: header.policy_code,
    policyVersion: Number(header.policy_version),
    publishState: "PUBLISHED",
    sourceHash: header.source_hash,
    levels,
  };
}

export class MariaAdminBalanceMutationRepository implements AdminBalanceMutationRepository {
  public constructor(private readonly database: DatabaseClient) {}

  // 현재 활성 header를 잠근 뒤 같은 version의 canonical projection을 읽습니다.
  public async readCurrent(domain: AdminBalanceDomain, transaction?: DatabaseTransaction): Promise<AdminBalanceDomainProjection> {
    if (transaction === undefined) {
      const projection = await new AdminBalanceReadModelProvider(this.database).read();
      const selected = projection.domains.find((entry) => entry.domain === domain);
      if (selected === undefined) throw new Error(`BALANCE_DOMAIN_MISSING:${domain}`);
      return selected;
    }
    const version = await this.lockCurrentVersion(transaction, domain);
    const projection = await this.readVersion(domain, version, transaction);
    if (projection === undefined) throw new Error(`BALANCE_DOMAIN_VERSION_MISSING:${domain}:${version}`);
    return projection;
  }

  public async readVersion(domain: AdminBalanceDomain, version: string, transaction?: DatabaseTransaction): Promise<AdminBalanceDomainProjection | undefined> {
    const database = transaction === undefined ? this.database : transactionClient(transaction);
    if (domain === "home_badge") {
      const header = (await database.query<HomeBadgeVersionRow[]>(
        "SELECT id,version_key,content_hash FROM home_badge_definition_versions WHERE id=? LIMIT 1",
        [version],
      ))[0];
      if (header === undefined) return undefined;
      const rows = await database.query<HomeBadgeDefinitionRow[]>(
        "SELECT badge_code,emoji_value,display_name,criteria_json FROM home_badge_definitions WHERE definition_version_id=? ORDER BY ordinal",
        [version],
      );
      return projectHomeBadgeBalance(header, rows);
    }
    if (domain === "home_furniture") {
      const header = (await database.query<FurnitureCatalogRow[]>(
        "SELECT id,version_code,source_path,source_sha256,rate_scale FROM home_furniture_draw_catalog_versions WHERE id=? LIMIT 1",
        [version],
      ))[0];
      if (header === undefined) return undefined;
      const rows = await database.query<FurnitureBandRow[]>(
        "SELECT grade_ordinal,grade_display_name,weight_scaled,entry_count FROM home_furniture_draw_grade_bands WHERE catalog_version_id=? ORDER BY grade_ordinal",
        [version],
      );
      return projectHomeFurnitureBalance(header, rows);
    }
    const header = (await database.query<PendantHeaderRow[]>(
      `SELECT id,policy_code,policy_version,publish_state,source_hash FROM pendant_upgrade_policy_versions
       WHERE policy_code='PENDANT_ENHANCE_LEGACY' AND policy_version=? LIMIT 1`,
      [version],
    ))[0];
    if (header === undefined) return undefined;
    const rows = await database.query<PendantLevelRow[]>(
      `SELECT target_level,CAST(success_rate AS CHAR) success_rate,charm_increment,
              CAST(explore_increment AS CHAR) explore_increment,point_cost,stone_cost
       FROM pendant_upgrade_policy_levels WHERE policy_id=? ORDER BY target_level`,
      [header.id],
    );
    return projectPendantBalance(pendantPolicy(header, rows));
  }

  public async activate(transaction: DatabaseTransaction, input: AdminBalanceActivationInput): Promise<AdminBalanceDomainProjection> {
    const version = input.domain === "home_badge"
      ? await this.activateHomeBadge(transaction, input)
      : input.domain === "home_furniture"
        ? await this.activateHomeFurniture(transaction, input)
        : await this.activatePendant(transaction, input);
    const projection = await this.readVersion(input.domain, version, transaction);
    if (projection === undefined) throw new Error(`BALANCE_ACTIVATION_MISSING:${input.domain}:${version}`);
    return projection;
  }

  private async lockCurrentVersion(transaction: DatabaseTransaction, domain: AdminBalanceDomain): Promise<string> {
    if (domain === "home_badge") {
      const row = (await transaction.query<Array<{ id: bigint }>>(
        "SELECT id FROM home_badge_definition_versions WHERE status='shadow' AND effective_at<=UTC_TIMESTAMP(3) ORDER BY effective_at DESC,id DESC LIMIT 1 FOR UPDATE",
      ))[0];
      if (row === undefined) throw new Error("HOME_BADGE_DEFINITION_MISSING");
      return row.id.toString();
    }
    if (domain === "home_furniture") {
      const row = (await transaction.query<Array<{ id: bigint }>>(
        "SELECT id FROM home_furniture_draw_catalog_versions WHERE active=TRUE ORDER BY id DESC LIMIT 1 FOR UPDATE",
      ))[0];
      if (row === undefined) throw new Error("HOME_FURNITURE_CATALOG_MISSING");
      return row.id.toString();
    }
    const row = (await transaction.query<Array<{ policy_version: number }>>(
      "SELECT policy_version FROM pendant_upgrade_policy_versions WHERE policy_code='PENDANT_ENHANCE_LEGACY' AND publish_state='PUBLISHED' ORDER BY policy_version DESC LIMIT 1 FOR UPDATE",
    ))[0];
    if (row === undefined) throw new Error("PENDANT_POLICY_NOT_FOUND:PENDANT_ENHANCE_LEGACY");
    return String(row.policy_version);
  }

  private sourceVersion(input: AdminBalanceActivationInput): string {
    return input.mode === "rollback" ? input.targetVersion! : input.currentVersion;
  }

  private async activateHomeBadge(transaction: DatabaseTransaction, input: AdminBalanceActivationInput): Promise<string> {
    const sourceVersion = this.sourceVersion(input);
    const source = (await transaction.query<Array<{ version_key: string; content_hash: string }>>(
      "SELECT version_key,content_hash FROM home_badge_definition_versions WHERE id=? LIMIT 1 FOR UPDATE",
      [sourceVersion],
    ))[0];
    if (source === undefined) throw new Error("HOME_BADGE_ROLLBACK_SOURCE_MISSING");
    const maximum = (await transaction.query<Array<{ id: bigint }>>(
      "SELECT id FROM home_badge_definition_versions ORDER BY id DESC LIMIT 1 FOR UPDATE",
    ))[0];
    const nextId = (maximum?.id ?? 0n) + 1n;
    const revisionHash = hashRevision(source.content_hash, input);
    await transaction.execute(
      `INSERT INTO home_badge_definition_versions(id,version_key,content_hash,status,effective_at)
       VALUES (?,?,?,'draft',UTC_TIMESTAMP(3))`,
      [nextId, `admin-balance-${input.operationId}`, revisionHash],
    );
    await transaction.execute(
      `INSERT INTO home_badge_definitions(definition_version_id,ordinal,badge_code,source_code,grade_code,emoji_value,display_name,detail_text,criteria_json,required_badge_codes_json)
       SELECT ?,ordinal,badge_code,source_code,grade_code,emoji_value,display_name,detail_text,criteria_json,required_badge_codes_json
       FROM home_badge_definitions WHERE definition_version_id=? ORDER BY ordinal`,
      [nextId, sourceVersion],
    );
    if (input.mode === "apply") {
      for (const change of input.changes) {
        const match = /^home_badge\.([A-Za-z0-9_-]+)\.criteria\.([A-Za-z][A-Za-z0-9]*)$/.exec(change.key);
        if (match === null) throw new Error(`HOME_BADGE_CHANGE_KEY_INVALID:${change.key}`);
        const updated = await transaction.execute(
          "UPDATE home_badge_definitions SET criteria_json=JSON_SET(COALESCE(criteria_json,JSON_OBJECT()),?,CAST(? AS UNSIGNED)) WHERE definition_version_id=? AND badge_code=?",
          [`$.${match[2]}`, change.value, nextId, match[1]],
        );
        if (updated.affectedRows !== 1n) throw new Error(`HOME_BADGE_CHANGE_TARGET_MISSING:${change.key}`);
      }
    }
    const retired = await transaction.execute("UPDATE home_badge_definition_versions SET status='retired' WHERE id=? AND status='shadow'", [input.currentVersion]);
    if (retired.affectedRows !== 1n) throw new Error("HOME_BADGE_VERSION_CONFLICT");
    await transaction.execute("UPDATE home_badge_definition_versions SET status='shadow' WHERE id=? AND status='draft'", [nextId]);
    return nextId.toString();
  }

  private async activateHomeFurniture(transaction: DatabaseTransaction, input: AdminBalanceActivationInput): Promise<string> {
    const sourceVersion = this.sourceVersion(input);
    const source = (await transaction.query<Array<{ source_path: string; source_sha256: string; rate_scale: bigint }>>(
      "SELECT source_path,source_sha256,rate_scale FROM home_furniture_draw_catalog_versions WHERE id=? LIMIT 1 FOR UPDATE",
      [sourceVersion],
    ))[0];
    if (source === undefined) throw new Error("HOME_FURNITURE_ROLLBACK_SOURCE_MISSING");
    const revisionHash = hashRevision(source.source_sha256, input);
    const inserted = await transaction.execute(
      `INSERT INTO home_furniture_draw_catalog_versions(version_code,source_path,source_sha256,rate_scale,active)
       VALUES (?,?,?,?,FALSE)`,
      [`admin-balance-${input.operationId}`, source.source_path, revisionHash, source.rate_scale],
    );
    const nextId = inserted.insertId;
    await transaction.execute(
      `INSERT INTO home_furniture_draw_grade_bands(catalog_version_id,grade_ordinal,grade_display_name,weight_scaled,entry_count)
       SELECT ?,grade_ordinal,grade_display_name,weight_scaled,entry_count FROM home_furniture_draw_grade_bands WHERE catalog_version_id=? ORDER BY grade_ordinal`,
      [nextId, sourceVersion],
    );
    await transaction.execute(
      `INSERT INTO home_furniture_draw_entries(catalog_version_id,source_sequence,furniture_definition_id,grade_ordinal,within_grade_sequence,source_display_snapshot,source_rate_text)
       SELECT ?,source_sequence,furniture_definition_id,grade_ordinal,within_grade_sequence,source_display_snapshot,source_rate_text
       FROM home_furniture_draw_entries WHERE catalog_version_id=? ORDER BY source_sequence`,
      [nextId, sourceVersion],
    );
    if (input.mode === "apply") {
      for (const change of input.changes) {
        const match = /^home_furniture\.grade\.(\d+)\.probability$/.exec(change.key);
        if (match === null) throw new Error(`HOME_FURNITURE_CHANGE_KEY_INVALID:${change.key}`);
        const updated = await transaction.execute(
          "UPDATE home_furniture_draw_grade_bands SET weight_scaled=? WHERE catalog_version_id=? AND grade_ordinal=?",
          [percentageWeight(change.value, BigInt(source.rate_scale)), nextId, match[1]],
        );
        if (updated.affectedRows !== 1n) throw new Error(`HOME_FURNITURE_CHANGE_TARGET_MISSING:${change.key}`);
      }
    }
    const retired = await transaction.execute("UPDATE home_furniture_draw_catalog_versions SET active=FALSE WHERE id=? AND active=TRUE", [input.currentVersion]);
    if (retired.affectedRows !== 1n) throw new Error("HOME_FURNITURE_VERSION_CONFLICT");
    await transaction.execute("UPDATE home_furniture_draw_catalog_versions SET active=TRUE WHERE id=? AND active=FALSE", [nextId]);
    return nextId.toString();
  }

  private async activatePendant(transaction: DatabaseTransaction, input: AdminBalanceActivationInput): Promise<string> {
    const sourceVersion = this.sourceVersion(input);
    const source = (await transaction.query<Array<{ id: bigint; source_hash: string }>>(
      "SELECT id,source_hash FROM pendant_upgrade_policy_versions WHERE policy_code='PENDANT_ENHANCE_LEGACY' AND policy_version=? LIMIT 1 FOR UPDATE",
      [sourceVersion],
    ))[0];
    if (source === undefined) throw new Error("PENDANT_ROLLBACK_SOURCE_MISSING");
    const maximum = (await transaction.query<Array<{ policy_version: number }>>(
      "SELECT policy_version FROM pendant_upgrade_policy_versions WHERE policy_code='PENDANT_ENHANCE_LEGACY' ORDER BY policy_version DESC LIMIT 1 FOR UPDATE",
    ))[0];
    const nextVersion = (maximum?.policy_version ?? 0) + 1;
    const revisionHash = hashRevision(source.source_hash, input);
    const inserted = await transaction.execute(
      `INSERT INTO pendant_upgrade_policy_versions(policy_code,policy_version,publish_state,source_hash,level_count,published_at)
       VALUES ('PENDANT_ENHANCE_LEGACY',?,'DRAFT',?,30,NULL)`,
      [nextVersion, revisionHash],
    );
    await transaction.execute(
      `INSERT INTO pendant_upgrade_policy_levels(policy_id,target_level,success_rate,charm_increment,explore_increment,point_cost,stone_cost)
       SELECT ?,target_level,success_rate,charm_increment,explore_increment,point_cost,stone_cost
       FROM pendant_upgrade_policy_levels WHERE policy_id=? ORDER BY target_level`,
      [inserted.insertId, source.id],
    );
    if (input.mode === "apply") {
      for (const change of input.changes) await this.updatePendantValue(transaction, inserted.insertId, change);
    }
    const retired = await transaction.execute(
      "UPDATE pendant_upgrade_policy_versions SET publish_state='RETIRED' WHERE policy_code='PENDANT_ENHANCE_LEGACY' AND policy_version=? AND publish_state='PUBLISHED'",
      [input.currentVersion],
    );
    if (retired.affectedRows !== 1n) throw new Error("PENDANT_VERSION_CONFLICT");
    await transaction.execute("UPDATE pendant_upgrade_policy_versions SET publish_state='PUBLISHED',published_at=UTC_TIMESTAMP(3) WHERE id=? AND publish_state='DRAFT'", [inserted.insertId]);
    return String(nextVersion);
  }

  private async updatePendantValue(transaction: DatabaseTransaction, policyId: bigint, change: AdminBalanceValueChangeInput): Promise<void> {
    const match = /^pendant\.level\.(\d+)\.(success_rate|charm_increment|explore_increment|point_cost|stone_cost)$/.exec(change.key);
    if (match === null) throw new Error(`PENDANT_CHANGE_KEY_INVALID:${change.key}`);
    const column = match[2]!;
    const statements: Record<string, string> = {
      success_rate: "UPDATE pendant_upgrade_policy_levels SET success_rate=? WHERE policy_id=? AND target_level=?",
      charm_increment: "UPDATE pendant_upgrade_policy_levels SET charm_increment=? WHERE policy_id=? AND target_level=?",
      explore_increment: "UPDATE pendant_upgrade_policy_levels SET explore_increment=? WHERE policy_id=? AND target_level=?",
      point_cost: "UPDATE pendant_upgrade_policy_levels SET point_cost=? WHERE policy_id=? AND target_level=?",
      stone_cost: "UPDATE pendant_upgrade_policy_levels SET stone_cost=? WHERE policy_id=? AND target_level=?",
    };
    const updated = await transaction.execute(statements[column]!, [change.value, policyId, match[1]]);
    if (updated.affectedRows !== 1n) throw new Error(`PENDANT_CHANGE_TARGET_MISSING:${change.key}`);
  }
}
