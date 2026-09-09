import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { validateLoginId, validateUserPassword, readKakaoVerificationCode } from "../src/user-auth/policy.js";
import { UserAuthService } from "../src/user-auth/user-auth-service.js";
import { hashVerificationCode } from "../src/user-auth/user-auth-service.js";
import { RequestRateLimiter } from "../src/user-auth/request-rate-limiter.js";
import { ProviderVerificationService } from "../src/user-auth/provider-verification-service.js";
import { AccountCleanupService } from "../src/user-auth/account-cleanup-service.js";
import { argon2id, hash } from "argon2";

// 사용자 인증 Service의 SQL과 트랜잭션 경계를 기록하는 테스트 DB를 생성합니다.
function createScriptedDatabase(queryResults: unknown[]) {
  const queries = [...queryResults];
  const sql: string[] = [];
  let insertId = 0n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      if (queries.length === 0) throw new Error(`Unexpected query: ${statement}`);
      return queries.shift() as T;
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement);
      insertId += 1n;
      return { affectedRows: 1n, insertId };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      if (queries.length === 0) throw new Error(`Unexpected query: ${statement}`);
      return queries.shift() as T;
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement);
      return { affectedRows: 1n, insertId: 0n };
    },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
  return { database, sql };
}

describe("site user authentication", () => {
  it("accepts only the fixed login ID and password rules", () => {
    assert.equal(validateLoginId("hoibot01"), "hoibot01");
    assert.equal(validateUserPassword("password1"), "password1");
    assert.throws(() => validateLoginId("HoiBot01"), /로그인 ID/);
    assert.throws(() => validateLoginId("short"), /로그인 ID/);
    assert.throws(() => validateUserPassword("onlyletters"), /비밀번호/);
    assert.throws(() => validateUserPassword("12345678"), /비밀번호/);
  });

  it("recognizes only the exact KakaoTalk verification command", () => {
    assert.equal(readKakaoVerificationCode("/인증 ABCD2345"), "ABCD2345");
    assert.equal(readKakaoVerificationCode("/인증 abcd2345"), "ABCD2345");
    assert.equal(readKakaoVerificationCode("/인증 ABCD2345 해줘"), null);
    assert.equal(readKakaoVerificationCode(" /인증 ABCD2345"), null);
    assert.equal(readKakaoVerificationCode("/인증 ABCD-234"), null);
    assert.equal(readKakaoVerificationCode("/인증 ABCD2301"), null);
  });

  it("creates a pending site account, consent history, and one-time code without a player", async () => {
    const scripted = createScriptedDatabase([[], [], [{ id: 1n, status: "pending_kakao_link" }]]);
    const result = await new UserAuthService(scripted.database, "test-verification-pepper").signup({
      loginId: "hoibot01",
      password: "password1",
      systemAccountName: "호이 남",
      acceptTerms: true,
      legacyPlayerId: ""
    });

    assert.equal(result.status, "pending_kakao_link");
    assert.equal(result.systemAccountName, "호이 남");
    assert.equal(result.gameAccountPurpose, "NEW_GAME_ACCOUNT");
    assert.equal(result.legacyPlayerId, null);
    assert.match(result.verificationCode, /^[A-Z2-9]{8}$/);
    assert.ok(scripted.sql.some((statement) => statement.includes("INSERT INTO user_accounts")));
    assert.ok(scripted.sql.some((statement) => statement.includes("INSERT INTO user_terms_acceptances")));
    assert.ok(scripted.sql.some((statement) => statement.includes("INSERT INTO user_verification_challenges")));
    assert.equal(scripted.sql.some((statement) => statement.includes("INSERT INTO players")), false);
  });

  it("issues a legacy-link challenge without creating a replacement player", async () => {
    const scripted = createScriptedDatabase([
      [], [], [{ id: 2n, status: "pending_kakao_link" }],
      [{ status: "active", current_display_name: "기존 남" }]
    ]);
    const result = await new UserAuthService(scripted.database, "test-verification-pepper").signup({
      loginId: "hoibot02", password: "password2", systemAccountName: "기존 남", acceptTerms: true,
      gameAccountPurpose: "LEGACY_GAME_ACCOUNT_LINK", legacyPlayerId: "42"
    });
    assert.equal(result.gameAccountPurpose, "LEGACY_GAME_ACCOUNT_LINK");
    assert.equal(result.legacyPlayerId, "42");
    assert.equal(scripted.sql.some((statement) => statement.includes("INSERT INTO players")), false);
    assert.ok(scripted.sql.some((statement) => statement.includes("FROM players player JOIN player_profiles")));
  });

  it("rejects a legacy signup without a numeric player_id before database work", async () => {
    const scripted = createScriptedDatabase([]);
    await assert.rejects(() => new UserAuthService(scripted.database, "test-verification-pepper").signup({
      loginId: "hoibot03", password: "password3", systemAccountName: "기존 남", acceptTerms: true,
      gameAccountPurpose: "LEGACY_GAME_ACCOUNT_LINK", legacyPlayerId: "not-a-player"
    }), /player_id/);
    assert.equal(scripted.sql.length, 0);
  });

  it("preserves the legacy player target when a pending signup code is reissued", async () => {
    const passwordHash = await hash("password4", { type: argon2id });
    const scripted = createScriptedDatabase([[
      {
        id: 4n, player_id: null, login_id: "hoibot04", password_hash: passwordHash,
        system_account_name: "기존 남", status: "pending_kakao_link", pending_expired: 0, account_locked: 0
      }
    ], [
      { purpose_code: "LEGACY_GAME_ACCOUNT_LINK", target_player_id: 42n }
    ], [
      { id: 4n, status: "pending_kakao_link" }
    ], [
      { status: "active", current_display_name: "기존 남" }
    ]]);
    const result = await new UserAuthService(scripted.database, "test-verification-pepper").reissueSignupCode("hoibot04", "password4");
    assert.equal(result.gameAccountPurpose, "LEGACY_GAME_ACCOUNT_LINK");
    assert.equal(result.legacyPlayerId, "42");
    assert.ok(scripted.sql.some((statement) => statement.includes("purpose_code='initial_link'")));
  });

  it("rejects signup before database work when required consent is missing", async () => {
    const scripted = createScriptedDatabase([]);
    await assert.rejects(
      new UserAuthService(scripted.database, "test-verification-pepper").signup({
        loginId: "hoibot02", password: "password2", systemAccountName: "테스 여",
        acceptTerms: false
      }),
      /이용약관/
    );
    assert.equal(scripted.sql.length, 0);
  });

  it("limits repeated authentication requests without retaining the raw scope", () => {
    let now = 1_000;
    const limiter = new RequestRateLimiter("test-rate-limit-secret", () => now);
    limiter.consume("signup", "example-network", { limit: 2, windowMs: 1_000 });
    limiter.consume("signup", "example-network", { limit: 2, windowMs: 1_000 });
    assert.throws(
      () => limiter.consume("signup", "example-network", { limit: 2, windowMs: 1_000 }),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "AUTH_RATE_LIMITED"
    );
    now = 2_001;
    assert.doesNotThrow(() => limiter.consume("signup", "example-network", { limit: 2, windowMs: 1_000 }));
  });

  it("persists a failed user login attempt for database-backed lockout", async () => {
    const passwordHash = await hash("password1", { type: argon2id });
    const sql: string[] = [];
    const database: DatabaseClient = {
      ping: async () => undefined,
      verifyRollback: async () => true,
      query: async <T>(statement: string): Promise<T> => {
        sql.push(statement);
        return [{
          id: 1n, player_id: 2n, login_id: "hoibot01", password_hash: passwordHash,
          system_account_name: "호이 남", status: "active", account_type: "normal", account_locked: 0,
          scheduled_delete_at: null
        }] as T;
      },
      execute: async (statement: string): Promise<DatabaseWriteResult> => {
        sql.push(statement);
        return { affectedRows: 1n, insertId: 0n };
      },
      withTransaction: async () => { throw new Error("Unexpected transaction."); },
      close: async () => undefined
    };
    await assert.rejects(
      new UserAuthService(database, "test-verification-pepper").login("hoibot01", "wrongpass1"),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "INVALID_CREDENTIALS"
    );
    assert.ok(sql.some((statement) => statement.includes("failed_login_count = failed_login_count + 1")));
  });

  it("includes the currently observed KakaoTalk nickname in mismatch guidance", async () => {
    const pepper = "test-verification-pepper";
    const code = "ABCD2345";
    const scripted = createScriptedDatabase([[
      { code_hash: hashVerificationCode(code, pepper), purpose_code: "NEW_GAME_ACCOUNT" }
    ], [
      {
        id: 1n, public_id: "challenge", user_account_id: 2n, target_player_id: null,
        expected_display_name: "테스 남", platform_code: "KAKAO", identity_scope_key: null,
        context_type: null, external_context_key: null, purpose_code: "NEW_GAME_ACCOUNT",
        code_hash: hashVerificationCode(code, pepper), failed_attempt_count: 0,
        status: "pending", challenge_expired: 0, consumed_request_key: null
      }
    ]]);
    await assert.rejects(
      new ProviderVerificationService(scripted.database, pepper).verifyInitialKakao({
        code, externalUserId: "kakao-test", displayName: "손 흔드는 스카피", channelId: "test-room"
      }),
      (error: unknown) => error instanceof Error
        && error.message === '"손 흔드는 스카피"님 카카오톡 닉네임을 "테스 남"(으)로 변경한 뒤 다시 인증해 주세요.'
    );
  });

  it("removes expired pending accounts and their temporary records", async () => {
    const sql: string[] = [];
    const transaction: DatabaseTransaction = {
      query: async <T>(statement: string): Promise<T> => {
        sql.push(statement);
        return [{ id: 7n }] as T;
      },
      execute: async (statement: string): Promise<DatabaseWriteResult> => {
        sql.push(statement);
        return { affectedRows: 1n, insertId: 0n };
      }
    };
    const database: DatabaseClient = {
      ping: async () => undefined,
      verifyRollback: async () => true,
      query: async <T>(statement: string): Promise<T> => {
        sql.push(statement);
        return [{ id: 7n }] as T;
      },
      execute: async () => ({ affectedRows: 0n, insertId: 0n }),
      withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
      close: async () => undefined
    };
    const result = await new AccountCleanupService(database).runExpiredPending();
    assert.deepEqual(result, { processed: 1, failed: 0 });
    assert.ok(sql.some((statement) => statement.includes("DELETE FROM user_verification_challenges")));
    assert.ok(sql.some((statement) => statement.includes("DELETE FROM user_accounts")));
  });
});
