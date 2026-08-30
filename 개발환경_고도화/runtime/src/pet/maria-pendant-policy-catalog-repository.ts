import type { DatabaseClient } from "../database.js";
import type { PendantPolicyCatalogRepository, PendantUpgradePolicyCatalog, PendantUpgradeLevelPolicy } from "./pendant-policy-catalog.js";

interface HeaderRow { id: bigint; policy_code: string; policy_version: number; publish_state: "PUBLISHED"; source_hash: string }
interface LevelRow { target_level: number; success_rate: string; charm_increment: bigint; explore_increment: string; point_cost: bigint; stone_cost: bigint }

function mapLevel(row: LevelRow): PendantUpgradeLevelPolicy {
  return { targetLevel: Number(row.target_level), successRate: row.success_rate, charmIncrement: BigInt(row.charm_increment),
    exploreIncrement: row.explore_increment, pointCost: BigInt(row.point_cost), stoneCost: BigInt(row.stone_cost) };
}

export class MariaPendantPolicyCatalogRepository implements PendantPolicyCatalogRepository {
  public constructor(private readonly database: DatabaseClient) {}

  // 최신 published header와 그 version에 속한 level row를 stable level 순서로 읽습니다.
  public async findPublished(policyCode: string): Promise<PendantUpgradePolicyCatalog | undefined> {
    const headers = await this.database.query<HeaderRow[]>(
      `SELECT id,policy_code,policy_version,publish_state,source_hash
       FROM pendant_upgrade_policy_versions
       WHERE policy_code=? AND publish_state='PUBLISHED'
       ORDER BY policy_version DESC LIMIT 1`, [policyCode],
    );
    const header = headers[0];
    if (!header) return undefined;
    const rows = await this.database.query<LevelRow[]>(
      `SELECT target_level,CAST(success_rate AS CHAR) success_rate,charm_increment,
              CAST(explore_increment AS CHAR) explore_increment,point_cost,stone_cost
       FROM pendant_upgrade_policy_levels WHERE policy_id=? ORDER BY target_level`, [header.id],
    );
    return { policyCode: header.policy_code, policyVersion: Number(header.policy_version), publishState: header.publish_state,
      sourceHash: header.source_hash, levels: rows.map(mapLevel) };
  }
}
