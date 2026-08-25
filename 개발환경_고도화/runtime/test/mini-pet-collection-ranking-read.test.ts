import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction } from "../src/database.js";
import {
  formatMiniPetCollectionRanking,
  isMiniPetCollectionRankingReadCommand,
  MiniPetCollectionRankingReadService
} from "../src/mini-pet/collection-ranking-read-service.js";

describe("mini-pet collection ranking read", () => {
  it("accepts only the exact no-argument command", () => {
    assert.equal(isMiniPetCollectionRankingReadCommand("/미니펫컬렉션순위"), true);
    assert.equal(isMiniPetCollectionRankingReadCommand("/미니펫컬렉션순위 "), false);
    assert.equal(isMiniPetCollectionRankingReadCommand("/미니펫컬렉션순위 1"), false);
  });

  it("keeps stage ordering and ordinal ranks while displaying completed stage", async () => {
    const writes: Array<{ sql: string; parameters?: unknown[] }> = [];
    const tx = {
      query: async <T>(sql: string): Promise<T> => {
        if (sql.includes("FROM mini_pet_collection_projections")) return [
          { player_id: 2n, current_display_name: "가람", stage: 4, completed_stage: 2 },
          { player_id: 1n, current_display_name: "나래", stage: 4, completed_stage: 3 }
        ] as T;
        return [{ id: 9n }] as T;
      },
      execute: async (sql: string, parameters?: unknown[]) => {
        writes.push({ sql, parameters });
        return { insertId: 1n, affectedRows: 1n };
      }
    } as DatabaseTransaction;
    const database = { withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(tx) } as DatabaseClient;
    const result = await new MiniPetCollectionRankingReadService(database).refresh();
    assert.deepEqual(result.map((entry) => [entry.rank, entry.displayName, entry.stage, entry.completedStage]), [
      [1, "가람", 4, 2], [2, "나래", 4, 3]
    ]);
    assert.equal(writes.filter((write) => write.sql.includes("INSERT INTO leaderboard_entries")).length, 2);
    assert.ok(writes.some((write) => write.sql.includes("DELETE FROM leaderboard_entries")));
  });

  it("formats top ten and leaves an empty snapshot readable", () => {
    assert.match(formatMiniPetCollectionRanking([]), /아직 순위 데이터가 없습니다/);
    const formatted = formatMiniPetCollectionRanking(Array.from({ length: 10 }, (_, index) => ({
      playerId: String(index + 1), displayName: `사용자${index + 1}`, stage: 8 - Math.floor(index / 2),
      completedStage: 7 - Math.floor(index / 2), rank: index + 1
    })));
    assert.match(formatted, /1위 사용자1 - 단계 8 \(완료 7\)/);
    assert.equal((formatted.match(/\u200b/g) ?? []).length, 500);
  });
});
