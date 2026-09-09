import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../../src/database.js";
import type { PendantUpgradePolicyCatalog } from "../../src/pet/pendant-policy-catalog.js";

export interface AdminBalanceReadFixtureOptions {
  invalidBadgeCriteria?: boolean;
  furnitureScaleMismatch?: boolean;
}

export const ADMIN_BALANCE_PENDANT_POLICY: PendantUpgradePolicyCatalog = {
  policyCode: "PENDANT_ENHANCE_LEGACY",
  policyVersion: 1,
  publishState: "PUBLISHED",
  sourceHash: "36216a87775f725b7e5b8bb0b8f0f148c4648e6bcb7b5fb76259c61869d90a18",
  levels: Array.from({ length: 30 }, (_, index) => ({
    targetLevel: index + 1,
    successRate: index < 6 ? "100.000000" : "1.000000",
    charmIncrement: BigInt(index + 1) * 5_000n,
    exploreIncrement: `${index + 1}.000000`,
    pointCost: 1_000_000_000n,
    stoneCost: BigInt(index + 1),
  })),
};

// 세 승인 provider의 version과 수치 경계를 재현하는 비식별 synthetic DB를 만듭니다.
export function createAdminBalanceReadFixture(options: AdminBalanceReadFixtureOptions = {}): DatabaseClient {
  const query = async <T>(sql: string): Promise<T> => {
    if (sql.includes("FROM home_badge_definition_versions")) {
      return [{ id: 930000002n, version_key: "legacy-v2.400-exact-display-v1", content_hash: "badge-hash" }] as T;
    }
    if (sql.includes("FROM home_badge_definitions")) {
      return [
        { badge_code: "F01", emoji_value: "🌱", display_name: "첫인연", criteria_json: options.invalidBadgeCriteria ? '{"followers":1.5}' : '{"followers":1}' },
        { badge_code: "A01", emoji_value: "🪴", display_name: "펫홈 새내기", criteria_json: { followers: 10, receivedHomeLikes: 10 } },
        { badge_code: "S01", emoji_value: "🎂", display_name: "펫홈 1주년", criteria_json: null },
      ] as T;
    }
    if (sql.includes("FROM home_furniture_draw_catalog_versions")) {
      return [{ id: 337n, version_code: "legacy-home-furniture-v1", source_path: "data/petSweetHomeInfo.json", source_sha256: "furniture-hash", rate_scale: 100000n }] as T;
    }
    if (sql.includes("FROM home_furniture_draw_grade_bands")) {
      return [
        { grade_ordinal: 1, grade_display_name: "루비", weight_scaled: 99959n, entry_count: 600 },
        { grade_ordinal: 2, grade_display_name: "전설", weight_scaled: options.furnitureScaleMismatch ? 40n : 41n, entry_count: 231 },
      ] as T;
    }
    throw new Error(`UNEXPECTED_ADMIN_BALANCE_QUERY:${sql}`);
  };
  const execute = async (): Promise<DatabaseWriteResult> => { throw new Error("ADMIN_BALANCE_READ_ONLY"); };
  const transaction: DatabaseTransaction = { query, execute };
  return {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query,
    execute,
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined,
  };
}
