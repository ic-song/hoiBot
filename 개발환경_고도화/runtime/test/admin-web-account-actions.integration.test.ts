import assert from "node:assert/strict";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { describe, it } from "node:test";
import { registerAdminRoutes } from "../src/admin/routes.js";
import { AdminManagementService } from "../src/admin/management-service.js";
import type { AdminSession } from "../src/admin/auth-service.js";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { syntheticAdminPlayer } from "./fixtures/admin-web-shell.js";

type RestrictionRow = {
  id: bigint;
  playerId: bigint;
  restrictionType: string;
  status: string;
  reason: string;
  startsAt: Date;
  endsAt: Date | null;
};

type OperationRow = { id: bigint; scope: string; key: string; resultJson?: string };
type IntegrationState = {
  restrictions: RestrictionRow[];
  operations: OperationRow[];
  audits: Array<{ id: bigint; actionCode: string; reason: string }>;
  accountStatus: "active" | "suspended";
  activeSessions: number;
  nextId: bigint;
};

// 기존 서비스 SQL 계약을 트랜잭션 단위로 재현하는 합성 DB를 구성합니다.
class AccountActionDatabase implements DatabaseClient {
  state: IntegrationState = { restrictions: [], operations: [], audits: [], accountStatus: "active", activeSessions: 2, nextId: 1000n };
  failNextAudit = false;

  async ping() {}
  async verifyRollback() { return true; }
  async close() {}

  // 읽기 전용 회원 상세 API가 사용하는 제재 목록을 반환합니다.
  async query<T>(sql: string, values: readonly unknown[] = []): Promise<T> {
    if (sql.includes("FROM player_restrictions WHERE player_id = ? ORDER BY id DESC")) {
      const playerId = BigInt(String(values[0]));
      return this.state.restrictions.filter((row) => row.playerId === playerId).sort((left, right) => Number(right.id - left.id)).map((row) => ({
        id: row.id, restriction_type: row.restrictionType, status: row.status, reason: row.reason, starts_at: row.startsAt, ends_at: row.endsAt
      })) as T;
    }
    throw new Error(`unexpected integration query: ${sql}`);
  }

  // 목록 조회의 기존 만료 상태 갱신 계약을 합성 상태에 적용합니다.
  async execute(sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> {
    if (sql.includes("UPDATE player_restrictions SET status = 'expired'")) {
      const playerId = BigInt(String(values[0]));
      let affectedRows = 0n;
      for (const row of this.state.restrictions) {
        if (row.playerId === playerId && row.status === "active" && row.endsAt !== null && row.endsAt <= new Date()) {
          row.status = "expired";
          affectedRows++;
        }
      }
      return { affectedRows, insertId: 0n };
    }
    throw new Error(`unexpected integration execute: ${sql}`);
  }

  // 실패 시 draft를 폐기해 command_audit 포함 전체 변경을 롤백합니다.
  async withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    const draft = structuredClone(this.state);
    const transaction = this.transaction(draft);
    const result = await work(transaction);
    this.state = draft;
    return result;
  }

  // AdminManagementService의 기존 제재 SQL만 처리하는 합성 transaction을 생성합니다.
  private transaction(draft: IntegrationState): DatabaseTransaction {
    return {
      query: async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
        if (sql.includes("SELECT result_json FROM operations")) {
          const prior = draft.operations.find((row) => row.scope === values[0] && row.key === values[1]);
          return (prior?.resultJson === undefined ? [] : [{ result_json: prior.resultJson }]) as T;
        }
        if (sql.includes("SELECT player_id FROM player_restrictions")) {
          const row = draft.restrictions.find((candidate) => candidate.id === BigInt(String(values[0])) && candidate.status === "active");
          return (row === undefined ? [] : [{ player_id: row.playerId }]) as T;
        }
        if (sql.includes("SELECT COUNT(*) AS count FROM player_restrictions")) {
          const playerId = BigInt(String(values[0]));
          const count = draft.restrictions.filter((row) => row.playerId === playerId && row.status === "active" && (row.endsAt === null || row.endsAt > new Date())).length;
          return [{ count: BigInt(count) }] as T;
        }
        throw new Error(`unexpected transaction query: ${sql}`);
      },
      execute: async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
        if (sql.includes("INSERT INTO operations")) {
          const id = draft.nextId++;
          draft.operations.push({ id, scope: String(values[1]), key: String(values[2]) });
          return { affectedRows: 1n, insertId: id };
        }
        if (sql.includes("INSERT INTO player_restrictions")) {
          const id = draft.nextId++;
          draft.restrictions.push({ id, playerId: BigInt(String(values[0])), restrictionType: String(values[1]), status: "active", reason: String(values[2]), startsAt: new Date(), endsAt: values[3] instanceof Date ? values[3] : null });
          return { affectedRows: 1n, insertId: id };
        }
        if (sql.includes("UPDATE user_accounts SET status = 'suspended'")) {
          draft.accountStatus = "suspended";
          return { affectedRows: 1n, insertId: 0n };
        }
        if (sql.includes("UPDATE user_sessions")) {
          draft.activeSessions = 0;
          return { affectedRows: 2n, insertId: 0n };
        }
        if (sql.includes("UPDATE player_restrictions SET status = 'revoked'")) {
          const row = draft.restrictions.find((candidate) => candidate.id === BigInt(String(values[2])));
          if (row !== undefined) row.status = "revoked";
          return { affectedRows: row === undefined ? 0n : 1n, insertId: 0n };
        }
        if (sql.includes("UPDATE user_accounts SET status = 'active'")) {
          draft.accountStatus = "active";
          return { affectedRows: 1n, insertId: 0n };
        }
        if (sql.includes("INSERT INTO command_audit")) {
          if (this.failNextAudit) {
            this.failNextAudit = false;
            throw new Error("synthetic command_audit failure");
          }
          const id = draft.nextId++;
          draft.audits.push({ id, actionCode: String(values[5]), reason: String(values[6]) });
          return { affectedRows: 1n, insertId: id };
        }
        if (sql.includes("UPDATE operations SET status = 'completed'")) {
          const operation = draft.operations.find((row) => row.id === BigInt(String(values[1])));
          if (operation !== undefined) operation.resultJson = String(values[0]);
          return { affectedRows: operation === undefined ? 0n : 1n, insertId: 0n };
        }
        throw new Error(`unexpected transaction execute: ${sql}`);
      }
    };
  }
}

// 실제 관리자 REST 라우트와 기존 ManagementService를 합성 DB에 연결합니다.
async function buildIntegrationApp(database: AccountActionDatabase, permission = true) {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const session: AdminSession = {
    sessionId: "9001", operatorId: "7001", loginId: "shadow.manager", displayName: "합성 운영자",
    roleCodes: ["operations_manager"], permissions: ["player.read", ...(permission ? ["account.restrict"] : [])]
  };
  const auth = {
    async authenticate(token: string, csrf?: string) {
      if (token !== "integration-session") throw new ApplicationError("AUTH_REQUIRED", "로그인이 필요합니다.", 401);
      if (csrf !== undefined && csrf !== "integration-csrf") throw new ApplicationError("CSRF_INVALID", "CSRF 토큰이 올바르지 않습니다.", 403);
      return session;
    }
  };
  const profiles = {
    async findByPlayerId(playerId: string) { return playerId === syntheticAdminPlayer.playerId ? syntheticAdminPlayer : null; }
  };
  await registerAdminRoutes(app, {
    auth, profiles, management: new AdminManagementService(database), secureCookies: false,
    changePlayerServer: {}, directory: {}, moderationIncidents: {}, retainedEventContents: {}, inspectIrisKakaoDatabase: async () => ({})
  } as never);
  app.setErrorHandler(async (error, request, reply) => {
    const statusCode = error instanceof ApplicationError ? error.statusCode : 500;
    const code = error instanceof ApplicationError ? error.code : "INTERNAL_ERROR";
    const message = error instanceof Error ? error.message : "통합 테스트 오류";
    return reply.code(statusCode).send({ ok: false, error: { code, message }, requestId: request.id });
  });
  return app;
}

const authHeaders = { cookie: "hoibot_admin_session=integration-session", "x-csrf-token": "integration-csrf" };

describe("admin web account actions existing REST integration", () => {
  it("links GET detail, POST create, PATCH revoke, replay, audit, session revoke, and no-outbox GAP", async () => {
    const database = new AccountActionDatabase();
    const app = await buildIntegrationApp(database);
    try {
      const temporaryRequest = {
        method: "POST" as const, url: `/api/v1/admin/players/${syntheticAdminPlayer.playerId}/restrictions`,
        headers: { ...authHeaders, "idempotency-key": "integration-temporary" },
        payload: { restrictionType: "temporary_suspension", endsAt: "2026-12-31T00:00:00.000Z", reason: "통합 기간 정지", confirmed: true }
      };
      const temporary = await app.inject(temporaryRequest);
      const replay = await app.inject(temporaryRequest);
      assert.equal(temporary.statusCode, 201);
      assert.equal(replay.statusCode, 201);
      assert.equal(temporary.json().restrictionId, replay.json().restrictionId);
      assert.equal(temporary.json().auditId, replay.json().auditId);

      const permanent = await app.inject({
        method: "POST", url: `/api/v1/admin/players/${syntheticAdminPlayer.playerId}/restrictions`,
        headers: { ...authHeaders, "idempotency-key": "integration-permanent" },
        payload: { restrictionType: "permanent_suspension", reason: "통합 영구 정지", confirmed: true }
      });
      assert.equal(permanent.statusCode, 201);
      assert.equal(database.state.accountStatus, "suspended");
      assert.equal(database.state.activeSessions, 0);
      assert.equal(database.state.audits.length, 2);

      const detail = await app.inject({ method: "GET", url: `/api/v1/admin/players/${syntheticAdminPlayer.playerId}`, headers: { cookie: authHeaders.cookie } });
      assert.equal(detail.statusCode, 200);
      assert.equal(detail.json().player.restrictions.length, 2);

      const notFound = await app.inject({
        method: "PATCH", url: "/api/v1/admin/restrictions/999999", headers: { ...authHeaders, "idempotency-key": "integration-missing" },
        payload: { status: "revoked", reason: "통합 not-found", confirmed: true }
      });
      assert.equal(notFound.statusCode, 404);
      assert.equal(database.state.operations.some((row) => row.key === "integration-missing"), false);

      for (const restrictionId of [permanent.json().restrictionId, temporary.json().restrictionId]) {
        const revoked = await app.inject({
          method: "PATCH", url: `/api/v1/admin/restrictions/${restrictionId}`,
          headers: { ...authHeaders, "idempotency-key": `integration-revoke-${restrictionId}` },
          payload: { status: "revoked", reason: "통합 제재 해제", confirmed: true }
        });
        assert.equal(revoked.statusCode, 200);
      }
      assert.equal(database.state.accountStatus, "active");
      assert.equal(database.state.audits.length, 4);
      assert.equal("outboxes" in database.state, false);
    } finally {
      await app.close();
    }
  });

  it("enforces csrf and account.restrict and rolls back the whole transaction on command_audit failure", async () => {
    const database = new AccountActionDatabase();
    const app = await buildIntegrationApp(database);
    try {
      const before = structuredClone(database.state);
      database.failNextAudit = true;
      const failed = await app.inject({
        method: "POST", url: `/api/v1/admin/players/${syntheticAdminPlayer.playerId}/restrictions`,
        headers: { ...authHeaders, "idempotency-key": "integration-audit-failure" },
        payload: { restrictionType: "permanent_suspension", reason: "통합 감사 롤백", confirmed: true }
      });
      assert.equal(failed.statusCode, 500);
      assert.deepEqual(database.state, before);

      const csrf = await app.inject({
        method: "POST", url: `/api/v1/admin/players/${syntheticAdminPlayer.playerId}/restrictions`,
        headers: { cookie: authHeaders.cookie, "idempotency-key": "integration-csrf" },
        payload: { restrictionType: "permanent_suspension", reason: "통합 CSRF", confirmed: true }
      });
      assert.equal(csrf.statusCode, 403);
    } finally {
      await app.close();
    }

    const deniedApp = await buildIntegrationApp(new AccountActionDatabase(), false);
    try {
      const denied = await deniedApp.inject({
        method: "POST", url: `/api/v1/admin/players/${syntheticAdminPlayer.playerId}/restrictions`,
        headers: { ...authHeaders, "idempotency-key": "integration-denied" },
        payload: { restrictionType: "permanent_suspension", reason: "통합 권한", confirmed: true }
      });
      assert.equal(denied.statusCode, 403);
    } finally {
      await deniedApp.close();
    }
  });
});
