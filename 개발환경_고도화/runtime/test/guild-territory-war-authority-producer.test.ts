import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { GuildTerritoryAttackService } from "../src/guild/guild-territory-attack-service.js";
import { GuildTerritoryWarFinishService } from "../src/guild/guild-territory-war-finish-service.js";

function rollbackDatabase(query: DatabaseTransaction["query"], writes: { value: number }, rolledBack: { value: boolean }): DatabaseClient {
  const transaction: DatabaseTransaction = {
    query,
    execute: async (): Promise<DatabaseWriteResult> => { writes.value += 1; return { affectedRows: 1n, insertId: 99n }; }
  };
  return {
    ...transaction,
    ping: async () => undefined,
    verifyRollback: async () => true,
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => {
      try { return await work(transaction); }
      catch (error) { rolledBack.value = true; throw error; }
    },
    close: async () => undefined
  };
}

describe("guild territory authority producer rollback", () => {
  it("rolls back finish after a contradictory scoped war is locked", async () => {
    const writes = { value: 0 }, rolledBack = { value: false };
    const database = rollbackDatabase(async <T>(sql: string) => {
      if (sql.includes("FROM operations")) return [] as T;
      if (sql.includes("guild_territory_start_scopes")) return [{ war_id: 1n }] as T;
      if (sql.includes("FROM guild_territory_wars")) return [{ id: 1n, war_key: "synthetic", active: 1, lifecycle_state: "READY", start_operation_id: null, started_at: null, version: 1n }] as T;
      if (sql.includes("guild_territory_finish_runs")) return [] as T;
      throw new Error(`Unexpected query: ${sql}`);
    }, writes, rolledBack);

    await assert.rejects(() => new GuildTerritoryWarFinishService(database).finish({ eventId: "finish-1", channelId: "room", trigger: "auto" }), /활성 상태/);
    assert.equal(writes.value, 1);
    assert.equal(rolledBack.value, true);
  });

  it("rolls back attack without DML when the scoped war is contradictory", async () => {
    const writes = { value: 0 }, rolledBack = { value: false };
    const database = rollbackDatabase(async <T>(sql: string) => {
      if (sql.includes("SELECT result_json FROM operations")) return [] as T;
      if (sql.includes("guild_territory_attack_policy_versions")) return [{
        policy_version: 1n, status: "ACTIVE", personal_attack_limit: 30, max_owned_territories: 3,
        wrong_turn_penalty: 1, dimension_eliminate_bps: 0, dimension_player_penalty: 0,
        dimension_attack_penalty: 0, remember_success_bps: 0, turn_fund: 0n,
        max_owned_fund_multiplier: 1, defense_ticket_item_code: "defense", defense_ticket_bps: 0,
        attack_ticket_item_code: "attack", attack_ticket_bps: 0, contribution_medal_item_code: "medal",
        contribution_medal_bps: 0, contribution_medal_quantity: 1n, evidence_label: "synthetic",
        rift_event_base_bps: 0, instability_bps_per_point: 0, normal_rift_base_bps: 0,
        rift_bias_bps_per_point: 0, rift_evidence_label: "synthetic"
      }] as T;
      if (sql.includes("FROM external_identities identity")) return [{ player_id: 11n, guild_id: 22n, display_name: "합성" }] as T;
      if (sql.includes("guild_territory_start_scopes")) return [{ war_id: 1n }] as T;
      if (sql.includes("FROM guild_territory_wars")) return [{ id: 1n, war_key: "synthetic", active: 0, lifecycle_state: "ACTIVE_READY", start_ready: 1, current_turn_no: 1n, instability_adjust: "0", rift_bias: "0", rift_event_count: 0n, rift_event_history_json: [], version: 1n }] as T;
      throw new Error(`Unexpected query: ${sql}`);
    }, writes, rolledBack);

    await assert.rejects(() => new GuildTerritoryAttackService(database).attack({ eventId: "attack-1", externalUserId: "user", channelId: "room", targetNo: 1 }), /활성 상태/);
    assert.equal(writes.value, 0);
    assert.equal(rolledBack.value, true);
  });
});
