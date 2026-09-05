import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { resolveGuildTerritoryWarAuthority } from "../src/guild/guild-territory-war-authority.js";
import { GuildTerritoryWarStateStartService } from "../src/guild/guild-territory-war-state-start-service.js";

function transitionDatabase(active: number, lifecycle: string, statements: string[], rollback: { value: boolean }): DatabaseClient {
  const transaction: DatabaseTransaction = {
    query: async <T>(sql: string) => {
      statements.push(sql);
      if (sql.includes("guild_territory_start_scopes")) return [{ war_id: 1n }] as T;
      if (sql.includes("guild_territory_wars")) return [{ id: 1n, war_key: "synthetic", active, lifecycle_state: lifecycle, start_ready: 0, pending_start_token: null, opening_token: null, version: 1n }] as T;
      if (sql.includes("guild_territory_scheduled_transitions")) return [] as T;
      throw new Error(`Unexpected query: ${sql}`);
    },
    execute: async (): Promise<DatabaseWriteResult> => ({ affectedRows: 0n, insertId: 0n })
  };
  return {
    ...transaction,
    ping: async () => undefined,
    verifyRollback: async () => true,
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => {
      try { return await work(transaction); }
      catch (error) { rollback.value = true; throw error; }
    },
    close: async () => undefined
  };
}

describe("guild territory war single authority", () => {
  it("maps ready and pending to inactive and opening and ready-active to active", () => {
    assert.equal(resolveGuildTerritoryWarAuthority(false, "READY"), false);
    assert.equal(resolveGuildTerritoryWarAuthority(0, "PENDING_START"), false);
    assert.equal(resolveGuildTerritoryWarAuthority(true, "ACTIVE_OPENING"), true);
    assert.equal(resolveGuildTerritoryWarAuthority(1, "ACTIVE_READY"), true);
  });

  it("fails closed for every lifecycle and active contradiction", () => {
    for (const [active, lifecycle] of [[true, "READY"], [true, "PENDING_START"], [false, "ACTIVE_OPENING"], [false, "ACTIVE_READY"], [false, "UNKNOWN"], [2, "READY"]] as const) {
      assert.throws(() => resolveGuildTerritoryWarAuthority(active, lifecycle), /활성 상태/);
    }
  });

  it("locks the world scope, war, and due transition in one order", () => {
    const source = readFileSync(new URL("../src/guild/guild-territory-war-state-start-service.ts", import.meta.url), "utf8");
    const advance = source.slice(source.indexOf("private async advanceOne"), source.indexOf("private async findOperator"));
    const scopeLock = advance.indexOf("guild_territory_start_scopes WHERE scope_code=? FOR UPDATE");
    const warLock = advance.indexOf("guild_territory_wars WHERE id=? FOR UPDATE");
    const transitionLock = advance.indexOf("guild_territory_scheduled_transitions WHERE war_id=?");
    assert.ok(scopeLock >= 0 && scopeLock < warLock && warLock < transitionLock);
    assert.equal(advance.includes("castle_battle_seasons"), false);
  });

  it("restarts with the authoritative world row and performs no write when nothing is due", async () => {
    const statements: string[] = [], rollback = { value: false };
    const service = new GuildTerritoryWarStateStartService(transitionDatabase(0, "READY", statements, rollback));
    assert.deepEqual(await service.runDueTransitions(20, new Date("2026-09-05T00:00:00.000Z")), { processed: 0, skipped: 0 });
    assert.deepEqual(statements.map(sql => sql.includes("start_scopes") ? "scope" : sql.includes("scheduled_transitions") ? "transition" : "war"), ["scope", "war", "transition"]);
    assert.equal(rollback.value, false);
  });

  it("rolls back before selecting a transition when the authority row is contradictory", async () => {
    const statements: string[] = [], rollback = { value: false };
    const service = new GuildTerritoryWarStateStartService(transitionDatabase(1, "READY", statements, rollback));
    await assert.rejects(() => service.runDueTransitions(20, new Date("2026-09-05T00:00:00.000Z")), /활성 상태/);
    assert.equal(rollback.value, true);
    assert.equal(statements.some(sql => sql.includes("guild_territory_scheduled_transitions")), false);
  });
});
