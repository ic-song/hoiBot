import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { AccountPlatformChallengeService, hashAccountPlatformVerificationCode } from "../src/account-platform/account-platform-challenge-service.js";

// challenge service의 SQL 순서와 bind 값을 기록하는 합성 DB를 생성합니다.
function scriptedDatabase(queryResults: unknown[]) {
  const queued = [...queryResults];
  const statements: Array<{ sql: string; values: readonly unknown[] }> = [];
  const transaction: DatabaseTransaction = {
    query: async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
      statements.push({ sql, values });
      if (queued.length === 0) throw new Error(`Unexpected query: ${sql}`);
      return queued.shift() as T;
    },
    execute: async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
      statements.push({ sql, values });
      return { affectedRows: 1n, insertId: 1n };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined, verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected outer query"); },
    execute: async () => { throw new Error("Unexpected outer execute"); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
  return { database, statements };
}

describe("WBS746 context-bound verification challenges", () => {
  it("issues an unbound signup challenge so the Kakao room can be fixed at verification time", async () => {
    const scripted = scriptedDatabase([[{ id: 7n, status: "pending_kakao_link" }]]);
    const service = new AccountPlatformChallengeService(scripted.database, "test-account-platform-pepper", () => new Date("2026-09-04T07:00:00.000Z"));
    const result = await service.issue({ legacyUserAccountId: "7", purpose: "NEW_GAME_ACCOUNT", expectedDisplayName: "신규 남", platformCode: "KAKAO" });
    const insert = scripted.statements.find((entry) => entry.sql.includes("INSERT INTO user_verification_challenges"))!;
    assert.deepEqual(insert.values.slice(6, 9), [null, null, null]);
    assert.equal(result.purpose, "NEW_GAME_ACCOUNT");
    assert.equal(result.expiresAt, "2026-09-04T07:30:00.000Z");
  });

  it("issues a hashed legacy challenge bound to the preserved target player and Kakao room", async () => {
    const scripted = scriptedDatabase([[{ id: 7n, status: "active" }], [{ status: "active", current_display_name: "기존 남" }]]);
    const service = new AccountPlatformChallengeService(scripted.database, "test-account-platform-pepper", () => new Date("2026-09-04T07:00:00.000Z"));
    const result = await service.issue({ legacyUserAccountId: "7", purpose: "LEGACY_GAME_ACCOUNT_LINK", targetPlayerId: "42", expectedDisplayName: "기존 남", platformCode: "KAKAO", contextType: "ROOM", externalContextKey: "room-a" });
    assert.match(result.verificationCode, /^[A-Z2-9]{8}$/);
    const insert = scripted.statements.find((entry) => entry.sql.includes("INSERT INTO user_verification_challenges"))!;
    assert.equal(insert.values[2], "42"); assert.equal(insert.values[6], "room-a");
    assert.equal(insert.values.includes(result.verificationCode), false);
    assert.equal(insert.values.includes(hashAccountPlatformVerificationCode(result.verificationCode, "test-account-platform-pepper")), true);
  });

  it("marks an expired challenge before returning the expiry error", async () => {
    const code = "ABCD2345"; const pepper = "test-account-platform-pepper";
    const scripted = scriptedDatabase([[{
      id: 1n, public_id: "challenge", user_account_id: 7n, target_player_id: null, expected_display_name: "신규 남",
      platform_code: "KAKAO", identity_scope_key: "room-a", context_type: "ROOM", external_context_key: "room-a",
      purpose_code: "NEW_GAME_ACCOUNT", code_hash: hashAccountPlatformVerificationCode(code, pepper), failed_attempt_count: 0,
      status: "pending", challenge_expired: 1, consumed_request_key: null
    }]]);
    await assert.rejects(() => new AccountPlatformChallengeService(scripted.database, pepper).verify({ requestKey: "event-1", code, ...{ platformCode: "KAKAO", contextType: "ROOM", externalContextKey: "room-a", externalUserKey: "user-a" } as const, observedDisplayName: "신규 남", actor: "개발자" }), /만료/);
    assert.ok(scripted.statements.some((entry) => entry.sql.includes("SET status='expired'")));
  });

  it("binds an unbound challenge to the first verified Kakao room before account linking", async () => {
    const code = "ABCD2345"; const pepper = "test-account-platform-pepper";
    const database = scriptedDatabase([[
      {
        id: 1n, public_id: "challenge", user_account_id: 7n, target_player_id: null, expected_display_name: "기대 남",
        platform_code: "KAKAO", identity_scope_key: null, context_type: null, external_context_key: null,
        purpose_code: "NEW_GAME_ACCOUNT", code_hash: hashAccountPlatformVerificationCode(code, pepper), failed_attempt_count: 0,
        status: "pending", challenge_expired: 0, consumed_request_key: null
      }
    ]]);
    await assert.rejects(() => new AccountPlatformChallengeService(database.database, pepper).verify({
      requestKey: "event-1", code, platformCode: "KAKAO", contextType: "ROOM", externalContextKey: "room-first",
      externalUserKey: "user-a", observedDisplayName: "다름 남", actor: "사용자"
    }), /닉네임/);
    const binding = database.statements.find((entry) => entry.sql.includes("SET identity_scope_key=?"))!;
    assert.deepEqual(binding.values.slice(0, 3), ["room-first", "ROOM", "room-first"]);
  });

  it("increments only the matching-hint pending challenge for an invalid code", async () => {
    const pepper = "test-account-platform-pepper";
    const scripted = scriptedDatabase([[{
      id: 1n, code_hash: hashAccountPlatformVerificationCode("WXYZ2345", pepper), failed_attempt_count: 2, status: "pending"
    }]]);
    await assert.rejects(() => new AccountPlatformChallengeService(scripted.database, pepper).verify({ requestKey: "event-1", code: "WXYZ6789", ...{ platformCode: "KAKAO", contextType: "ROOM", externalContextKey: "room-a", externalUserKey: "user-a" } as const, observedDisplayName: "신규 남", actor: "개발자" }), /인증 코드/);
    const failure = scripted.statements.find((entry) => entry.sql.includes("failed_attempt_count=?"))!;
    assert.deepEqual(failure.values.slice(0, 3), [3, 3, 5]);
  });

  it("rejects a consumed code under a different request key without mutations", async () => {
    const code = "ABCD2345"; const pepper = "test-account-platform-pepper";
    const scripted = scriptedDatabase([[{
      id: 1n, public_id: "challenge", user_account_id: 7n, target_player_id: null, expected_display_name: "신규 남",
      platform_code: "KAKAO", identity_scope_key: "room-a", context_type: "ROOM", external_context_key: "room-a",
      purpose_code: "NEW_GAME_ACCOUNT", code_hash: hashAccountPlatformVerificationCode(code, pepper), failed_attempt_count: 0,
      status: "verified", challenge_expired: 0, consumed_request_key: "original-event"
    }]]);
    await assert.rejects(() => new AccountPlatformChallengeService(scripted.database, pepper).verify({ requestKey: "other-event", code, ...{ platformCode: "KAKAO", contextType: "ROOM", externalContextKey: "room-a", externalUserKey: "user-a" } as const, observedDisplayName: "신규 남", actor: "개발자" }), /이미 사용/);
    assert.equal(scripted.statements.filter((entry) => /^\s*(INSERT|UPDATE|DELETE)/i.test(entry.sql)).length, 0);
  });
});
