import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import {
  AccountSwitchCommandService,
  isAccountSwitchCommandCandidate
} from "../src/account-platform/account-switch-command-service.js";

interface QueryCall {
  sql: string;
  values: readonly unknown[];
}

// 계정변경 어댑터가 사용하는 조회·transaction 순서를 기록하는 합성 DB입니다.
function createAccountSwitchDatabase(): { database: DatabaseClient; queries: QueryCall[]; writes: QueryCall[] } {
  const queries: QueryCall[] = [];
  const writes: QueryCall[] = [];
  const writeResult: DatabaseWriteResult = { affectedRows: 1n, insertId: 1n };
  const query = async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
    queries.push({ sql, values });
    if (sql.includes("canonical_account_authority_global_locks")) return [{ lock_key: "ACCOUNT_AUTHORITY" }] as T;
    if (sql.includes("JOIN account_platform_active_player_selections selection")) {
      return [{ portal_account_id: "portal01", active_player_id: 101n, platform_context_membership_id: "member01", selection_version: 4n }] as T;
    }
    if (sql.includes("operation_kind='SWITCH_ACTIVE_PLAYER'")) return [] as T;
    if (sql.includes("legacy_user_account_id")) {
      return [{ platform_context_membership_id: "member01", portal_account_id: "portal01", legacy_user_account_id: 11n }] as T;
    }
    if (sql.includes("FROM portal_game_account_links link")) {
      return [{ portal_game_account_link_id: "link0002", player_id: 202n }] as T;
    }
    if (sql.includes("SELECT active_player_selection_id,selection_version")) {
      return [{ active_player_selection_id: "select01", selection_version: 4n }] as T;
    }
    throw new Error(`UNEXPECTED_QUERY:${sql}`);
  };
  const execute = async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
    writes.push({ sql, values });
    return writeResult;
  };
  const transaction: DatabaseTransaction = { query, execute };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query,
    execute,
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
  return { database, queries, writes };
}

describe("account switch command service", () => {
  it("accepts only an exact command prefix with a nonblank selector", () => {
    assert.equal(isAccountSwitchCommandCandidate("/계정변경 부계 여"), true);
    for (const message of [undefined, "/계정변경", "/계정변경 ", " /계정변경 부계 여", "/계정변경\n부계 여"]) {
      assert.equal(isAccountSwitchCommandCandidate(message), false, String(message));
    }
  });

  it("pins the current room selection version and changes only that Kakao context", async () => {
    const scripted = createAccountSwitchDatabase();
    const result = await new AccountSwitchCommandService(scripted.database).handleKakao({
      eventId: "iris:switch-1",
      externalUserId: "kakao-user-1",
      channelId: "kakao-room-a",
      message: "/계정변경 부계 여"
    });

    assert.deepEqual(
      { playerId: result.playerId, selectionVersion: result.selectionVersion, replayed: result.replayed },
      { playerId: "202", selectionVersion: 5, replayed: false }
    );
    const selectionWrite = scripted.writes.find((call) => call.sql.includes("UPDATE account_platform_active_player_selections"));
    assert.deepEqual(selectionWrite?.values.slice(0, 3), ["link0002", 202n, 5]);
    const locatorQueries = scripted.queries.filter((call) => call.sql.includes("identity_row.platform_code=?"));
    assert.equal(locatorQueries.length, 2);
    for (const call of locatorQueries) {
      assert.deepEqual(call.values.slice(0, 5), ["KAKAO", "kakao-room-a", "kakao-user-1", "ROOM", "kakao-room-a"]);
    }
  });

  it("requires prior authentication in the invoking room", async () => {
    const scripted = createAccountSwitchDatabase();
    scripted.database.query = async <T>() => [] as T;
    await assert.rejects(
      () => new AccountSwitchCommandService(scripted.database).handleKakao({
        eventId: "iris:switch-unlinked",
        externalUserId: "kakao-user-2",
        channelId: "kakao-room-b",
        message: "/계정변경 대표 남"
      }),
      /먼저 계정 인증/
    );
  });
});
