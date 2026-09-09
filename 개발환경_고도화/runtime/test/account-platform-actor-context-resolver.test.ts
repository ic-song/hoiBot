import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { AccountPlatformActorContextResolver } from "../src/account-platform/account-platform-actor-context-resolver.js";

type ModernRow = {
  portal_account_id: string;
  active_player_id: bigint;
  platform_context_membership_id: string;
  selection_version: bigint;
};

// 현대 selection과 legacy fallback 응답을 독립적으로 구성하는 합성 DB입니다.
function databaseFor(modern: ModernRow[], legacy: Array<{ player_id: bigint }>) {
  const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  const writeResult: DatabaseWriteResult = { affectedRows: 0n, insertId: 0n };
  const query = async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
    calls.push({ sql, values });
    if (sql.includes("JOIN account_platform_active_player_selections selection")) return modern as T;
    if (sql.includes("FROM external_identities identity_row")) return legacy as T;
    throw new Error(`UNEXPECTED_QUERY:${sql}`);
  };
  const transaction: DatabaseTransaction = {
    query,
    execute: async () => writeResult
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query,
    execute: transaction.execute,
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
  return { database, calls };
}

const kakao = {
  platformCode: "KAKAO" as const,
  contextType: "ROOM" as const,
  externalContextKey: "room-a",
  externalUserKey: "user-a"
};

describe("account platform actor context resolver", () => {
  it("returns the room-pinned player snapshot without consulting legacy identity", async () => {
    const scripted = databaseFor([{
      portal_account_id: "portal01",
      active_player_id: 202n,
      platform_context_membership_id: "member01",
      selection_version: 7n
    }], [{ player_id: 101n }]);
    const result = await new AccountPlatformActorContextResolver(scripted.database).resolve(kakao);
    assert.deepEqual(result, {
      playerId: "202",
      source: "ACCOUNT_PLATFORM_CONTEXT",
      portalAccountId: "portal01",
      platformContextMembershipId: "member01",
      selectionVersion: 7
    });
    assert.equal(scripted.calls.length, 1);
  });

  it("falls back only to an active legacy player without an active portal link", async () => {
    const scripted = databaseFor([], [{ player_id: 101n }]);
    const result = await new AccountPlatformActorContextResolver(scripted.database).resolve(kakao);
    assert.deepEqual(result, { playerId: "101", source: "LEGACY_EXTERNAL_IDENTITY" });
    const fallback = scripted.calls[1];
    assert.match(fallback!.sql, /link\.portal_game_account_link_id IS NULL/);
    assert.deepEqual(fallback!.values, ["kakao", "user-a"]);
  });

  it("does not bypass context authentication after the player enters a portal account", async () => {
    const scripted = databaseFor([], []);
    assert.equal(await new AccountPlatformActorContextResolver(scripted.database).resolve(kakao), null);
  });

  it("uses one Discord identity key while retaining the server locator for modern resolution", async () => {
    const scripted = databaseFor([], []);
    await new AccountPlatformActorContextResolver(scripted.database).resolve({
      platformCode: "DISCORD",
      contextType: "SERVER",
      externalContextKey: "server-a",
      externalUserKey: "discord-user"
    });
    assert.deepEqual(scripted.calls[0]!.values, ["DISCORD", "PLATFORM_ACCOUNT", "discord-user", "SERVER", "server-a"]);
    assert.deepEqual(scripted.calls[1]!.values, ["discord", "discord-user"]);
  });
});
