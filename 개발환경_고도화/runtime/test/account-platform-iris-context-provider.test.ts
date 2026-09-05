import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccountPlatformIrisContextProvider } from "../src/account-platform/account-platform-iris-context-provider.js";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import type { NormalizedIrisEvent } from "../src/integration/iris-normalizer.js";

interface QueryCall { sql: string; values: readonly unknown[]; }

// context provider의 snapshot 조회와 계정변경 transaction 순서를 기록합니다.
function createContextDatabase(modern = true): { database: DatabaseClient; queries: QueryCall[] } {
  const queries: QueryCall[] = [];
  const writeResult: DatabaseWriteResult = { affectedRows: 1n, insertId: 1n };
  const query = async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
    queries.push({ sql, values });
    if (sql.includes("canonical_account_authority_global_locks")) return [{ lock_key: "ACCOUNT_AUTHORITY" }] as T;
    if (sql.includes("JOIN account_platform_active_player_selections selection")) {
      return (modern ? [{ portal_account_id: "portal01", active_player_id: 101n, platform_context_membership_id: "member01", selection_version: 4n }] : []) as T;
    }
    if (sql.includes("FROM external_identities identity_row")) return [] as T;
    if (sql.includes("operation_kind='SWITCH_ACTIVE_PLAYER'")) return [] as T;
    if (sql.includes("legacy_user_account_id")) {
      return [{ platform_context_membership_id: "member01", portal_account_id: "portal01", legacy_user_account_id: 11n }] as T;
    }
    if (sql.includes("FROM portal_game_account_links link")) return [{ portal_game_account_link_id: "link0002", player_id: 202n }] as T;
    if (sql.includes("SELECT active_player_selection_id,selection_version")) {
      return [{ active_player_selection_id: "select01", selection_version: 4n }] as T;
    }
    throw new Error(`UNEXPECTED_QUERY:${sql}`);
  };
  const transaction: DatabaseTransaction = { query, execute: async () => writeResult };
  return {
    queries,
    database: {
      ping: async () => undefined,
      verifyRollback: async () => true,
      query,
      execute: transaction.execute,
      withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
      close: async () => undefined
    }
  };
}

// 실제 Iris normalizer 결과와 같은 최소 incoming event를 만듭니다.
function event(message: string, overrides: Partial<NormalizedIrisEvent> = {}): NormalizedIrisEvent {
  return {
    eventId: "iris:account-context-1", providerEventId: "account-context-1", providerCode: "iris",
    eventKind: "1", direction: "incoming", channelId: "room-a", userId: "user-a",
    displayNameSource: "iris_cache", displayNameTrust: "untrusted", message,
    eventCode: "message.text", eventCategory: "message", monitoringGroup: "text",
    eventMetadata: {}, payloadHash: "hash", ...overrides
  };
}

describe("account platform Iris context provider", () => {
  it("freezes one room-scoped actor snapshot for a normal command", async () => {
    const scripted = createContextDatabase();
    const context = await new AccountPlatformIrisContextProvider(scripted.database).prepareKakao(event("/가방"));
    assert.deepEqual(context?.actor, {
      playerId: "101", source: "ACCOUNT_PLATFORM_CONTEXT", portalAccountId: "portal01",
      platformContextMembershipId: "member01", selectionVersion: 4
    });
    assert.equal(Object.isFrozen(context), true);
    assert.equal(Object.isFrozen(context?.actor), true);
    assert.equal(scripted.queries.filter((call) => call.sql.includes("JOIN account_platform_active_player_selections selection")).length, 1);
    assert.equal(await new AccountPlatformIrisContextProvider(scripted.database).dispatchAccountSwitch(context!), null);
  });

  it("reuses the prepared selection version without a second snapshot lookup", async () => {
    const scripted = createContextDatabase();
    const provider = new AccountPlatformIrisContextProvider(scripted.database);
    const context = await provider.prepareKakao(event("/계정변경 202"));
    const result = await provider.dispatchAccountSwitch(context!);
    assert.deepEqual(
      { playerId: result?.playerId, selectionVersion: result?.selectionVersion, replayed: result?.replayed },
      { playerId: "202", selectionVersion: 5, replayed: false }
    );
    const locatorQueries = scripted.queries.filter((call) => call.sql.includes("identity_row.platform_code=?"));
    assert.equal(locatorQueries.length, 2);
  });

  it("requires a modern room context for account switching", async () => {
    const scripted = createContextDatabase(false);
    const provider = new AccountPlatformIrisContextProvider(scripted.database);
    const context = await provider.prepareKakao(event("/계정변경 202"));
    await assert.rejects(() => provider.dispatchAccountSwitch(context!), /먼저 계정 인증/);
  });

  it("rejects an incomplete modern snapshot before transaction work", async () => {
    const scripted = createContextDatabase();
    const provider = new AccountPlatformIrisContextProvider(scripted.database);
    await assert.rejects(() => provider.dispatchAccountSwitch({
      eventId: "iris:malformed", externalUserId: "user-a", channelId: "room-a", message: "/계정변경 202",
      actor: { playerId: "101", source: "ACCOUNT_PLATFORM_CONTEXT" }
    }), /활성 게임계정 정보를 확인할 수 없습니다/);
    assert.equal(scripted.queries.length, 0);
  });

  it("does not resolve outgoing or incomplete events", async () => {
    const scripted = createContextDatabase();
    const provider = new AccountPlatformIrisContextProvider(scripted.database);
    assert.equal(await provider.prepareKakao(event("/가방", { direction: "outgoing" })), null);
    assert.equal(await provider.prepareKakao(event("/가방", { channelId: undefined })), null);
    assert.equal(scripted.queries.length, 0);
  });
});
