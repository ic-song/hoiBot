import assert from "node:assert/strict";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { describe, it } from "node:test";
import { registerAdminRoutes } from "../src/admin/routes.js";
import type { AdminSession } from "../src/admin/auth-service.js";
import { CurrencyService } from "../src/currency/currency-service.js";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { syntheticAdminPlayer } from "./fixtures/admin-web-shell.js";

type State = {
  accounts: Array<{ playerId: string; code: string; balance: string; version: bigint }>;
  operations: Array<{ id: bigint; scope: string; key: string; resultJson: string | null; sourceCode: string }>;
  ledger: Array<{ operationId: bigint; playerId: string; code: string; delta: string; balance: string }>;
  audits: Array<{ id: bigint; actionCode: string; reason: string }>;
  outboxes: Array<{ id: bigint; providerCode: string; destinationId: string; messageType: string }>;
  nextId: bigint;
};

// 실제 CurrencyService SQL 계약을 transaction 단위로 재현하는 합성 DB입니다.
class RewardCurrencyDatabase implements DatabaseClient {
  state: State = {
    accounts: [{ playerId: syntheticAdminPlayer.playerId, code: "diamond", balance: "350", version: 4n }],
    operations: [], ledger: [], audits: [], outboxes: [], nextId: 1000n
  };
  failNextAudit = false;
  failNextOutbox = false;

  async ping() {}
  async verifyRollback() { return true; }
  async close() {}
  async query<T>(): Promise<T> { throw new Error("unexpected root query"); }
  async execute(): Promise<DatabaseWriteResult> { throw new Error("unexpected root execute"); }

  // 성공한 draft만 확정해 audit/outbox 실패 시 전체 변경을 폐기합니다.
  async withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    const draft = structuredClone(this.state);
    const result = await work(this.transaction(draft));
    this.state = draft;
    return result;
  }

  // CurrencyService.adjust와 TransactionalOperationRunner가 사용하는 SQL만 처리합니다.
  private transaction(draft: State): DatabaseTransaction {
    return {
      query: async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
        if (sql.includes("SELECT result_json FROM operations")) {
          const operation = draft.operations.find((candidate) => candidate.scope === String(values[0]) && candidate.key === String(values[1]));
          return (operation === undefined ? [] : [{ result_json: operation.resultJson }]) as T;
        }
        if (sql.includes("SELECT code FROM currency_definitions")) {
          return (values[0] === "diamond" || values[0] === "point" ? [{ code: values[0] }] : []) as T;
        }
        if (sql.includes("SELECT balance, version FROM currency_accounts")) {
          const account = draft.accounts.find((candidate) => candidate.playerId === String(values[0]) && candidate.code === String(values[1]));
          return (account === undefined ? [] : [{ balance: account.balance, version: account.version }]) as T;
        }
        throw new Error(`unexpected transaction query: ${sql}`);
      },
      execute: async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
        if (sql.includes("INSERT INTO operations")) {
          const id = draft.nextId++;
          draft.operations.push({ id, scope: String(values[1]), key: String(values[2]), resultJson: null, sourceCode: String(values[5]) });
          return { affectedRows: 1n, insertId: id };
        }
        if (sql.includes("INSERT IGNORE INTO currency_accounts")) {
          const exists = draft.accounts.some((candidate) => candidate.playerId === String(values[0]) && candidate.code === String(values[1]));
          if (!exists) draft.accounts.push({ playerId: String(values[0]), code: String(values[1]), balance: "0", version: 0n });
          return { affectedRows: exists ? 0n : 1n, insertId: 0n };
        }
        if (sql.includes("UPDATE currency_accounts SET balance = ?, version = ?")) {
          const account = draft.accounts.find((candidate) => candidate.playerId === String(values[2]) && candidate.code === String(values[3]));
          if (account === undefined || account.version !== BigInt(String(values[4]))) return { affectedRows: 0n, insertId: 0n };
          account.balance = String(values[0]); account.version = BigInt(String(values[1]));
          return { affectedRows: 1n, insertId: 0n };
        }
        if (sql.includes("INSERT INTO currency_ledger")) {
          draft.ledger.push({ operationId: BigInt(String(values[0])), playerId: String(values[1]), code: String(values[2]), delta: String(values[3]), balance: String(values[4]) });
          return { affectedRows: 1n, insertId: draft.nextId++ };
        }
        if (sql.includes("INSERT INTO command_audit")) {
          if (this.failNextAudit) { this.failNextAudit = false; throw new Error("synthetic command_audit failure"); }
          const id = draft.nextId++;
          draft.audits.push({ id, actionCode: String(values[5]), reason: String(values[6]) });
          return { affectedRows: 1n, insertId: id };
        }
        if (sql.includes("INSERT INTO outbox_messages")) {
          if (this.failNextOutbox) { this.failNextOutbox = false; throw new Error("synthetic outbox failure"); }
          const id = draft.nextId++;
          draft.outboxes.push({ id, providerCode: "internal", destinationId: String(values[1]), messageType: String(values[2]) });
          return { affectedRows: 1n, insertId: id };
        }
        if (sql.includes("UPDATE operations SET status = 'completed'")) {
          const operation = draft.operations.find((candidate) => candidate.id === BigInt(String(values[1])));
          if (operation !== undefined) operation.resultJson = String(values[0]);
          return { affectedRows: operation === undefined ? 0n : 1n, insertId: 0n };
        }
        throw new Error(`unexpected transaction execute: ${sql}`);
      }
    };
  }
}

// 실제 REST route와 CurrencyService를 합성 DB에 연결합니다.
async function buildApp(database: RewardCurrencyDatabase, permission = true) {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const session: AdminSession = {
    sessionId: "9001", operatorId: "7001", loginId: "shadow.manager", displayName: "합성 운영자",
    roleCodes: ["super_admin"], permissions: ["player.read", ...(permission ? ["game.currency.change"] : [])]
  };
  const auth = {
    async authenticate(token: string, csrf?: string) {
      if (token !== "integration-session") throw new ApplicationError("AUTH_REQUIRED", "로그인이 필요합니다.", 401);
      if (csrf !== undefined && csrf !== "integration-csrf") throw new ApplicationError("CSRF_INVALID", "CSRF 토큰이 올바르지 않습니다.", 403);
      return session;
    }
  };
  const profiles = { async findByPlayerId(playerId: string) { return playerId === syntheticAdminPlayer.playerId ? syntheticAdminPlayer : null; } };
  await registerAdminRoutes(app, {
    auth, profiles, currency: new CurrencyService(database), secureCookies: false,
    management: { async listRestrictions() { return []; } }, changePlayerServer: {}, directory: {}, moderationIncidents: {}, retainedEventContents: {}, inspectIrisKakaoDatabase: async () => ({})
  } as never);
  app.setErrorHandler(async (error, request, reply) => {
    const statusCode = error instanceof ApplicationError ? error.statusCode : 500;
    const code = error instanceof ApplicationError ? error.code : "INTERNAL_ERROR";
    return reply.code(statusCode).send({ ok: false, error: { code, message: error instanceof Error ? error.message : "통합 테스트 오류" }, requestId: request.id });
  });
  return app;
}

const authHeaders = { cookie: "hoibot_admin_session=integration-session", "x-csrf-token": "integration-csrf" };

describe("admin web reward currency existing service integration", () => {
  it("links version read, adjust, ledger, audit, internal outbox, replay, and conflicts", async () => {
    const database = new RewardCurrencyDatabase();
    const app = await buildApp(database);
    try {
      const path = `/api/v1/admin/players/${syntheticAdminPlayer.playerId}/currencies/diamond/adjustments`;
      const request = { method: "POST" as const, url: path, headers: { ...authHeaders, "idempotency-key": "integration-currency-add" }, payload: { delta: "50", expectedVersion: "4", reason: "통합 재화 증가", confirmed: true } };
      const added = await app.inject(request);
      const replayed = await app.inject(request);
      assert.equal(added.statusCode, 200);
      assert.equal(replayed.statusCode, 200);
      assert.equal(added.json().balance, "400");
      assert.equal(added.json().auditId, replayed.json().auditId);
      assert.equal(database.state.accounts[0]?.version, 5n);
      assert.equal(database.state.ledger.length, 1);
      assert.equal(database.state.audits.length, 1);
      assert.equal(database.state.outboxes.length, 1);
      assert.equal(database.state.operations[0]?.sourceCode, "admin_api");
      assert.equal(database.state.outboxes[0]?.messageType, "currency.changed");

      const beforeConflict = structuredClone(database.state);
      const stale = await app.inject({ method: "POST", url: path, headers: { ...authHeaders, "idempotency-key": "integration-currency-stale" }, payload: { delta: "10", expectedVersion: "4", reason: "통합 version 충돌", confirmed: true } });
      assert.equal(stale.statusCode, 409);
      assert.deepEqual(database.state, beforeConflict);

      const insufficient = await app.inject({ method: "POST", url: path, headers: { ...authHeaders, "idempotency-key": "integration-currency-insufficient" }, payload: { delta: "-401", expectedVersion: "5", reason: "통합 잔액 부족", confirmed: true } });
      assert.equal(insufficient.statusCode, 409);
      assert.deepEqual(database.state, beforeConflict);

      const subtracted = await app.inject({ method: "POST", url: path, headers: { ...authHeaders, "idempotency-key": "integration-currency-subtract" }, payload: { delta: "-25", expectedVersion: "5", reason: "통합 재화 차감", confirmed: true } });
      assert.equal(subtracted.statusCode, 200);
      assert.equal(subtracted.json().balance, "375");
      assert.equal(subtracted.json().version, "6");
    } finally {
      await app.close();
    }
  });

  it("enforces csrf and permission and rolls back audit/outbox failures", async () => {
    const database = new RewardCurrencyDatabase();
    const app = await buildApp(database);
    const path = `/api/v1/admin/players/${syntheticAdminPlayer.playerId}/currencies/diamond/adjustments`;
    try {
      for (const failure of ["audit", "outbox"] as const) {
        const before = structuredClone(database.state);
        if (failure === "audit") database.failNextAudit = true; else database.failNextOutbox = true;
        const response = await app.inject({ method: "POST", url: path, headers: { ...authHeaders, "idempotency-key": `integration-${failure}-rollback` }, payload: { delta: "10", expectedVersion: "4", reason: `통합 ${failure} 롤백`, confirmed: true } });
        assert.equal(response.statusCode, 500);
        assert.deepEqual(database.state, before);
      }
      const csrf = await app.inject({ method: "POST", url: path, headers: { cookie: authHeaders.cookie, "idempotency-key": "integration-csrf" }, payload: { delta: "1", expectedVersion: "4", reason: "통합 CSRF", confirmed: true } });
      assert.equal(csrf.statusCode, 403);
    } finally {
      await app.close();
    }

    const denied = await buildApp(new RewardCurrencyDatabase(), false);
    try {
      const response = await denied.inject({ method: "POST", url: path, headers: { ...authHeaders, "idempotency-key": "integration-permission" }, payload: { delta: "1", expectedVersion: "4", reason: "통합 권한", confirmed: true } });
      assert.equal(response.statusCode, 403);
    } finally {
      await denied.close();
    }
  });
});
