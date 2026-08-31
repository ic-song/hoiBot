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
    query: async () => { throw new Error("Unexpected non-transactional query."); },
    execute: async () => { throw new Error("Unexpected non-transactional execute."); },
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
    const scripted = createScriptedDatabase([[], []]);
    const result = await new UserAuthService(scripted.database, "test-verification-pepper").signup({
      loginId: "hoibot01",
      password: "password1",
      systemAccountName: "호이 남",
      acceptTerms: true
    });

    assert.equal(result.status, "pending_kakao_link");
    assert.equal(result.systemAccountName, "호이 남");
    assert.match(result.verificationCode, /^[A-Z2-9]{8}$/);
    assert.ok(scripted.sql.some((statement) => statement.includes("INSERT INTO user_accounts")));
    assert.ok(scripted.sql.some((statement) => statement.includes("INSERT INTO user_terms_acceptances")));
    assert.ok(scripted.sql.some((statement) => statement.includes("INSERT INTO user_verification_challenges")));
    assert.equal(scripted.sql.some((statement) => statement.includes("INSERT INTO players")), false);
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
      {
        id: 1n, user_account_id: 2n, code_hash: hashVerificationCode(code, pepper),
        failed_attempt_count: 0, challenge_expired: 0, account_status: "pending_kakao_link",
        pending_expired: 0, system_account_name: "테스 남"
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
