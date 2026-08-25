import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import {
  calculateMiniPetExpRanks,
  formatMiniPetExpRank,
  isMiniPetExpRankCommand,
  MiniPetExpRankService
} from "../src/pet/mini-pet-exp-rank-service.js";

const row = (playerId: bigint, displayName: string, petId: bigint | null, experience: bigint | null, equipped: number | null) => ({
  player_id: playerId, display_name: displayName, owned_mini_pet_id: petId, battle_experience: experience, equipped
});

describe("mini pet experience rank", () => {
  it("accepts only the exact public rank command", () => {
    assert.equal(isMiniPetExpRankCommand("/미니펫종합순위"), true);
    for (const command of ["/미니펫종합순위 1", "/미니펫종합순위 해줘", "/미니펫종합순위 "]) {
      assert.equal(isMiniPetExpRankCommand(command), false);
    }
  });

  it("adds one equipped pet and the five strongest bag pets without shared ranks", () => {
    const ranks = calculateMiniPetExpRanks([
      row(1n, "가람", 1n, 100n, 1),
      row(1n, "가람", 2n, 70n, 0), row(1n, "가람", 3n, 60n, 0), row(1n, "가람", 4n, 50n, 0),
      row(1n, "가람", 5n, 40n, 0), row(1n, "가람", 6n, 30n, 0), row(1n, "가람", 7n, 999n, 0),
      row(2n, "나래", 8n, 350n, 1), row(3n, "다온", null, null, null)
    ]);
    assert.deepEqual(ranks.map((entry) => [entry.rank, entry.displayName, entry.totalExperience]), [
      [1, "가람", "1319"], [2, "나래", "350"]
    ]);
    assert.equal(ranks[0]?.bagTopFiveExperience, "1219");
  });

  it("uses Korean display-name order for equal totals and limits output to ten", () => {
    const tied = calculateMiniPetExpRanks([
      row(1n, "하늘", 1n, 10n, 1), row(2n, "가람", 2n, 10n, 1)
    ]);
    assert.deepEqual(tied.map((entry) => [entry.rank, entry.displayName]), [[1, "가람"], [2, "하늘"]]);
    const eleven = Array.from({ length: 11 }, (_, index) => ({
      rank: index + 1, playerId: String(index + 1), displayName: `회원${index + 1}`,
      equippedExperience: "1", bagTopFiveExperience: "0", totalExperience: String(11 - index)
    }));
    const output = formatMiniPetExpRank(eleven);
    assert.match(output, /10위 회원10/);
    assert.doesNotMatch(output, /회원11/);
    assert.equal((output.match(/​/g) ?? []).length, 500);
  });

  it("replaces only leaderboard snapshot rows and never mutates mini pet inventory", async () => {
    const sql: string[] = [];
    const transaction: DatabaseTransaction = {
      query: async <T>(statement: string) => {
        sql.push(statement);
        return [row(1n, "가람", 1n, 100n, 1)] as T;
      },
      execute: async (statement: string): Promise<DatabaseWriteResult> => {
        sql.push(statement);
        return { affectedRows: 1n, insertId: 9n };
      }
    };
    const database = {
      withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction)
    } as DatabaseClient;
    const result = await new MiniPetExpRankService(database).execute();
    assert.equal(result.entries[0]?.totalExperience, "100");
    assert.ok(sql.some((statement) => statement.includes("INSERT INTO leaderboards")));
    assert.ok(sql.some((statement) => statement.includes("INSERT INTO leaderboard_entries")));
    assert.equal(sql.some((statement) => /UPDATE\s+owned_mini_pets/i.test(statement)), false);
    assert.equal(sql.some((statement) => /DELETE\s+FROM\s+owned_mini_pets/i.test(statement)), false);
  });
});
