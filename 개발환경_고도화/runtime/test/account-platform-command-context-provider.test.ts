import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccountPlatformCommandContextProvider } from "../src/account-platform/account-platform-command-context-provider.js";
import type { DatabaseClient, DatabaseWriteResult } from "../src/database.js";

interface QueryCall { sql: string; values: readonly unknown[]; }

// 방·서버 locator별 활성 player를 반환하는 context provider fixture입니다.
function createDatabase(): { database: DatabaseClient; queries: QueryCall[] } {
  const queries: QueryCall[] = [];
  const writeResult: DatabaseWriteResult = { affectedRows: 0n, insertId: 0n };
  const query = async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
    queries.push({ sql, values });
    if (sql.includes("JOIN account_platform_active_player_selections selection")) {
      const contextKey = String(values[4]);
      return [{
        portal_account_id: "portal01",
        active_player_id: contextKey === "server-a" ? 101n : 202n,
        platform_context_membership_id: contextKey === "server-a" ? "member-a" : "member-b",
        selection_version: contextKey === "server-a" ? 3n : 7n
      }] as T;
    }
    throw new Error(`UNEXPECTED_QUERY:${sql}`);
  };
  return {
    queries,
    database: {
      ping: async () => undefined,
      verifyRollback: async () => true,
      query,
      execute: async () => writeResult,
      withTransaction: async () => { throw new Error("TRANSACTION_NOT_EXPECTED"); },
      close: async () => undefined
    }
  };
}

describe("account platform command context provider", () => {
  it("pins independent Discord server actors under one platform identity scope", async () => {
    const scripted = createDatabase();
    const provider = new AccountPlatformCommandContextProvider(scripted.database);
    const first = await provider.prepare({
      eventId: "discord:event-a", platformCode: "DISCORD", contextType: "SERVER",
      externalContextKey: "server-a", externalUserKey: "discord-user", message: "/가방"
    });
    const second = await provider.prepare({
      eventId: "discord:event-b", platformCode: "DISCORD", contextType: "SERVER",
      externalContextKey: "server-b", externalUserKey: "discord-user", message: "/가방"
    });

    assert.deepEqual(
      [first.actor?.playerId, first.actor?.selectionVersion, second.actor?.playerId, second.actor?.selectionVersion],
      ["101", 3, "202", 7]
    );
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.actor), true);
    assert.deepEqual(scripted.queries.map((call) => call.values), [
      ["DISCORD", "PLATFORM_ACCOUNT", "discord-user", "SERVER", "server-a"],
      ["DISCORD", "PLATFORM_ACCOUNT", "discord-user", "SERVER", "server-b"]
    ]);
  });
});
