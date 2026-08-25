import assert from "node:assert/strict";
import { it } from "node:test";
import mariadb from "mariadb";
import type { DatabaseClient, DatabaseTransaction } from "../src/database.js";
import { MiniPetCollectionRankingReadService } from "../src/mini-pet/collection-ranking-read-service.js";

const enabled = process.env.HOIBOT_ISOLATED_MARIADB === "1";

it("replaces the collection ranking snapshot without mutating collection rows", { skip: !enabled }, async () => {
  const pool = mariadb.createPool({
    host: process.env.MARIADB_HOST!, port: Number(process.env.MARIADB_PORT),
    user: process.env.MARIADB_USER!, password: process.env.MARIADB_PASSWORD!,
    database: process.env.MARIADB_DATABASE!, connectionLimit: 2, bigIntAsNumber: false
  });
  const database = {
    async withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const transaction = {
          query: async <R>(sql: string, parameters?: unknown[]) => connection.query(sql, parameters) as Promise<R>,
          execute: async (sql: string, parameters?: unknown[]) => connection.query(sql, parameters) as never
        } as DatabaseTransaction;
        const result = await work(transaction);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  } as DatabaseClient;

  try {
    const connection = await pool.getConnection();
    try {
      await connection.query("INSERT INTO players (id) VALUES (1), (2)");
      await connection.query("INSERT INTO player_profiles (player_id, current_display_name) VALUES (1, '나래'), (2, '가람')");
      await connection.query("INSERT INTO mini_pet_definitions (id, code, display_name) VALUES (900001, 'collection-rank-pet', '순위펫')");
      await connection.query(`INSERT INTO mini_pet_collection_projections
        (player_id, mini_pet_definition_id, registered, stage, completed_stage)
        VALUES (1, 900001, TRUE, 4, 3), (2, 900001, TRUE, 4, 2)`);
    } finally {
      connection.release();
    }

    const service = new MiniPetCollectionRankingReadService(database);
    const first = await service.refresh();
    const second = await service.refresh();
    assert.deepEqual(first.map((entry) => [entry.rank, entry.displayName, entry.stage, entry.completedStage]), [
      [1, "가람", 4, 2], [2, "나래", 4, 3]
    ]);
    assert.deepEqual(second, first);

    const verification = await pool.getConnection();
    try {
      const snapshot = await verification.query<Array<{ rank_no: bigint; current_display_name: string; score: string }>>(
        `SELECT entry.rank_no, profile.current_display_name, entry.score
         FROM leaderboard_entries entry
         JOIN leaderboards board ON board.id = entry.leaderboard_id
         JOIN player_profiles profile ON profile.player_id = entry.player_id
         WHERE board.code = 'mini_pet_collection_stage' AND board.season_key = 'lifetime'
         ORDER BY entry.rank_no`
      );
      const source = await verification.query<Array<{ row_count: bigint; stage_sum: string }>>(
        "SELECT COUNT(*) row_count, SUM(stage) stage_sum FROM mini_pet_collection_projections"
      );
      assert.deepEqual(snapshot.map((row) => [Number(row.rank_no), row.current_display_name, String(row.score)]), [
        [1, "가람", "4.000"], [2, "나래", "4.000"]
      ]);
      assert.equal(Number(source[0]!.row_count), 2);
      assert.equal(String(source[0]!.stage_sum), "8");
    } finally {
      verification.release();
    }
  } finally {
    await pool.end();
  }
});
