import assert from "node:assert/strict";
import { describe, it } from "node:test";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { argon2id, hash } from "argon2";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import type { ProfileRepository } from "../src/player/profile.js";
import { registerUserAuthRoutes } from "../src/user-auth/routes.js";
import type { RequestRateLimiter } from "../src/user-auth/request-rate-limiter.js";
import { RequestRateLimiter as LiveRequestRateLimiter } from "../src/user-auth/request-rate-limiter.js";
import { UserAuthService } from "../src/user-auth/user-auth-service.js";

interface RecoveryRow {
  id: bigint;
  password_hash: string;
  status: string;
  request_id: bigint;
  deletion_expired: number;
  account_locked: number;
}

// 계정 복구 SQL 순서와 affectedRows 분기를 기록하는 합성 DB를 생성합니다.
function createRecoveryDatabase(
  row: RecoveryRow | undefined,
  affectedRows: bigint[] = [1n, 1n, 1n],
  authorityLockPresent = true
) {
  const sql: string[] = [];
  const writes = [...affectedRows];
  const transactionState = { committed: false, rolledBack: false, committedWrites: [] as string[] };
  let pendingWrites: string[] = [];
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      if (statement.includes("canonical_account_authority_global_locks")) {
        return (authorityLockPresent ? [{ lock_key: "ACCOUNT_AUTHORITY" }] : []) as T;
      }
      if (statement.includes("FROM user_accounts account_row")) {
        return (row === undefined ? [] : [row]) as T;
      }
      throw new Error(`Unexpected query: ${statement}`);
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement);
      pendingWrites.push(statement);
      return { affectedRows: writes.shift() ?? 1n, insertId: 0n };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async () => { throw new Error("Recovery lookup must stay inside the transaction."); },
    execute: async () => { throw new Error("Recovery writes must stay inside the transaction."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => {
      try {
        const result = await work(transaction);
        transactionState.committed = true;
        transactionState.committedWrites = [...pendingWrites];
        pendingWrites = [];
        return result;
      } catch (error) {
        transactionState.rolledBack = true;
        pendingWrites = [];
        throw error;
      }
    },
    close: async () => undefined
  };
  return { database, sql, transactionState };
}

async function makeRecoveryRow(overrides: Partial<RecoveryRow> = {}): Promise<RecoveryRow> {
  return {
    id: 11n,
    password_hash: await hash("password1", { type: argon2id }),
    status: "deletion_grace",
    request_id: 22n,
    deletion_expired: 0,
    account_locked: 0,
    ...overrides
  };
}

describe("account deletion recovery provider", () => {
  it("serializes with cleanup and restores only a live grace-period request", async () => {
    const scripted = createRecoveryDatabase(await makeRecoveryRow());
    const result = await new UserAuthService(scripted.database, "test-pepper").recoverDeletion("hoibot01", "password1");

    assert.deepEqual(result, { requestId: "22", status: "recovered" });
    assert.ok(scripted.sql[0]?.includes("ACCOUNT_AUTHORITY"));
    assert.ok(scripted.sql[1]?.includes("FOR UPDATE"));
    assert.ok(scripted.sql.some((statement) => statement.includes("scheduled_delete_at > UTC_TIMESTAMP(3)")));
    assert.ok(scripted.sql.some((statement) => statement.includes("status = 'deletion_grace' AND deleted_at IS NULL")));
  });

  it("rejects an expired request without activating the account", async () => {
    const scripted = createRecoveryDatabase(await makeRecoveryRow({ deletion_expired: 1 }));
    await assert.rejects(
      new UserAuthService(scripted.database, "test-pepper").recoverDeletion("hoibot01", "password1"),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error
        && error.code === "DELETION_REQUEST_NOT_RECOVERABLE"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("SET status = 'active'")), false);
    assert.equal(scripted.sql.some((statement) => statement.includes("SET status = 'recovered'")), false);
  });

  it("commits a failed credential count before returning the generic error", async () => {
    const scripted = createRecoveryDatabase(await makeRecoveryRow());
    await assert.rejects(
      new UserAuthService(scripted.database, "test-pepper").recoverDeletion("hoibot01", "wrongpass1"),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error
        && error.code === "INVALID_CREDENTIALS"
    );
    assert.ok(scripted.sql.some((statement) => statement.includes("failed_login_count = failed_login_count + 1")));
    assert.equal(scripted.sql.some((statement) => statement.includes("SET status = 'recovered'")), false);
  });

  it("fails closed when the grace-period update loses a race", async () => {
    const scripted = createRecoveryDatabase(await makeRecoveryRow(), [1n, 0n]);
    await assert.rejects(
      new UserAuthService(scripted.database, "test-pepper").recoverDeletion("hoibot01", "password1"),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error
        && error.code === "DELETION_REQUEST_NOT_RECOVERABLE"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("SET status = 'active'")), false);
  });

  it("rolls back the recovered request when account activation loses a race", async () => {
    const scripted = createRecoveryDatabase(await makeRecoveryRow(), [1n, 1n, 0n]);
    await assert.rejects(
      new UserAuthService(scripted.database, "test-pepper").recoverDeletion("hoibot01", "password1"),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error
        && error.code === "DELETION_REQUEST_NOT_RECOVERABLE"
    );
    assert.equal(scripted.transactionState.committed, false);
    assert.equal(scripted.transactionState.rolledBack, true);
    assert.deepEqual(scripted.transactionState.committedWrites, []);
    assert.ok(scripted.sql.some((statement) => statement.includes("SET status = 'recovered'")));
    assert.ok(scripted.sql.some((statement) => statement.includes("SET status = 'active'")));
  });

  it("returns the locked-account boundary without attempting recovery writes", async () => {
    const scripted = createRecoveryDatabase(await makeRecoveryRow({ account_locked: 1 }));
    await assert.rejects(
      new UserAuthService(scripted.database, "test-pepper").recoverDeletion("hoibot01", "password1"),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error
        && error.code === "ACCOUNT_TEMPORARILY_LOCKED" && "statusCode" in error && error.statusCode === 423
    );
    assert.equal(scripted.transactionState.committed, true);
    assert.equal(scripted.transactionState.committedWrites.length, 0);
  });

  it("fails closed when the account authority lock seed is unavailable", async () => {
    const scripted = createRecoveryDatabase(await makeRecoveryRow(), [1n, 1n, 1n], false);
    await assert.rejects(
      new UserAuthService(scripted.database, "test-pepper").recoverDeletion("hoibot01", "password1"),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error
        && error.code === "ACCOUNT_AUTHORITY_UNAVAILABLE" && "statusCode" in error && error.statusCode === 503
    );
    assert.equal(scripted.transactionState.rolledBack, true);
    assert.equal(scripted.sql.some((statement) => statement.includes("FROM user_accounts account_row")), false);
  });
});

describe("account deletion recovery routes", () => {
  it("clears the revoked session cookie and applies account/network recovery limits", async () => {
    const limiterCalls: Array<{ action: string; scope: string }> = [];
    const authCalls: string[] = [];
    const auth = {
      requestDeletion: async (token: string, csrf: string) => {
        authCalls.push(`delete:${token}:${csrf}`);
        return { requestId: "31", scheduledDeleteAt: "2026-10-09T00:00:00.000Z" };
      },
      recoverDeletion: async (loginId: string, password: string) => {
        authCalls.push(`recover:${loginId}:${password}`);
        return { requestId: "31", status: "recovered" as const };
      }
    } as unknown as UserAuthService;
    const profiles = {
      findByPlayerId: async () => null,
      findByExternalIdentity: async () => null,
      list: async () => [],
      count: async () => 0
    } satisfies ProfileRepository;
    const rateLimiter = {
      consume: (action: string, scope: string) => limiterCalls.push({ action, scope })
    } as unknown as RequestRateLimiter;
    const app = Fastify();
    await app.register(cookie);
    await registerUserAuthRoutes(app, { auth, profiles, rateLimiter, secureCookies: false });
    await app.ready();

    const deletion = await app.inject({
      method: "POST",
      url: "/api/v1/account-deletion-requests",
      headers: { cookie: "hoibot_user_session=session-token", "x-csrf-token": "csrf-token" },
      payload: { confirmed: true }
    });
    assert.equal(deletion.statusCode, 201);
    const deletionCookie = deletion.headers["set-cookie"];
    assert.match(Array.isArray(deletionCookie) ? deletionCookie.join("; ") : deletionCookie ?? "", /^hoibot_user_session=;/);
    assert.deepEqual(authCalls, ["delete:session-token:csrf-token"]);

    const recovery = await app.inject({
      method: "DELETE",
      url: "/api/v1/account-deletion-requests/current",
      payload: { loginId: "hoibot01", password: "password1" }
    });
    assert.equal(recovery.statusCode, 200);
    assert.deepEqual(limiterCalls.map((call) => call.action), ["account-recovery-account", "account-recovery-network"]);
    assert.equal(limiterCalls[0]?.scope, "hoibot01");
    assert.ok((limiterCalls[1]?.scope.length ?? 0) > 0);
    assert.deepEqual(authCalls, ["delete:session-token:csrf-token", "recover:hoibot01:password1"]);

    await app.close();
  });

  it("returns 429 after the real account recovery limit is exceeded", async () => {
    let recoveryCalls = 0;
    const auth = {
      requestDeletion: async () => ({ requestId: "31", scheduledDeleteAt: "2026-10-09T00:00:00.000Z" }),
      recoverDeletion: async () => {
        recoveryCalls += 1;
        return { requestId: "31", status: "recovered" as const };
      }
    } as unknown as UserAuthService;
    const profiles = {
      findByPlayerId: async () => null,
      findByExternalIdentity: async () => null,
      list: async () => [],
      count: async () => 0
    } satisfies ProfileRepository;
    const app = Fastify();
    await app.register(cookie);
    await registerUserAuthRoutes(app, {
      auth,
      profiles,
      rateLimiter: new LiveRequestRateLimiter("recovery-rate-limit-test"),
      secureCookies: false
    });
    await app.ready();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/account-deletion-requests/current",
        payload: { loginId: "hoibot01", password: "password1" }
      });
      assert.equal(response.statusCode, 200);
    }
    const limited = await app.inject({
      method: "DELETE",
      url: "/api/v1/account-deletion-requests/current",
      payload: { loginId: "hoibot01", password: "password1" }
    });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().code, "AUTH_RATE_LIMITED");
    assert.equal(recoveryCalls, 5);

    await app.close();
  });
});
