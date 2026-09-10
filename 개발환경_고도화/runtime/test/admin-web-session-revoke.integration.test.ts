import assert from "node:assert/strict";
import { describe, it } from "node:test";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { AdminManagementService } from "../src/admin/management-service.js";
import { registerAdminRoutes } from "../src/admin/routes.js";
import { registerAdminWebShellRoutes } from "../src/admin/web-shell.js";
import type { AdminSession } from "../src/admin/auth-service.js";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { syntheticAdminPlayer } from "./fixtures/admin-web-shell.js";

type Operation = { id: bigint; scope: string; key: string; resultJson?: string };
type State = {
  players: Set<string>;
  linkedAccounts: Map<string, bigint[]>;
  activeSessions: Map<string, number>;
  operations: Operation[];
  audits: Array<{ id: bigint; actionCode: string; reason: string; summary: Record<string, unknown> }>;
  statuses: { player: string; account: string };
  restrictions: number;
  outbox: number;
  nextId: bigint;
};

class SessionRevokeDatabase implements DatabaseClient {
  state: State = {
    players: new Set(["40001", "9007199254740993", "9007199254740994", "9007199254740995"]),
    linkedAccounts: new Map([["40001", [100n]], ["9007199254740993", [101n]], ["9007199254740995", [102n]]]),
    activeSessions: new Map([["40001", 2], ["9007199254740993", 3], ["9007199254740995", 0]]),
    operations: [], audits: [], statuses: { player: "active", account: "active" }, restrictions: 0, outbox: 0, nextId: 5000n
  };
  failNextAudit = false;
  failNextOperationComplete = false;
  dml: string[] = [];
  private serial: Promise<void> = Promise.resolve();

  async ping() {}
  async verifyRollback() { return true; }
  async close() {}
  async query<T>(sql: string): Promise<T> {
    if (sql.includes("FROM player_restrictions WHERE player_id")) return [] as T;
    throw new Error(`unexpected direct query: ${sql}`);
  }
  async execute(sql: string): Promise<DatabaseWriteResult> {
    if (sql.includes("UPDATE player_restrictions SET status = 'expired'")) return { affectedRows: 0n, insertId: 0n };
    throw new Error(`unexpected direct execute: ${sql}`);
  }

  async withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const prior = this.serial;
    this.serial = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    try {
      const draft = structuredClone(this.state);
      const dmlStart = this.dml.length;
      try {
        const result = await work(this.transaction(draft));
        this.state = draft;
        return result;
      } catch (error) {
        this.dml.length = dmlStart;
        throw error;
      }
    } finally {
      release();
    }
  }

  private transaction(draft: State): DatabaseTransaction {
    return {
      query: async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
        if (sql.includes("SELECT result_json FROM operations")) {
          const found = draft.operations.find((row) => row.scope === values[0] && row.key === values[1]);
          return (found?.resultJson === undefined ? [] : [{ result_json: found.resultJson }]) as T;
        }
        if (sql.includes("SELECT id FROM players")) {
          const playerId = String(values[0]);
          return (draft.players.has(playerId) ? [{ id: BigInt(playerId) }] : []) as T;
        }
        if (sql.includes("SELECT id FROM user_accounts")) {
          return (draft.linkedAccounts.get(String(values[0])) ?? []).map((id) => ({ id })) as T;
        }
        throw new Error(`unexpected query: ${sql}`);
      },
      execute: async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
        if (sql.includes("INSERT INTO operations")) {
          this.dml.push("operations.insert");
          const id = draft.nextId++;
          draft.operations.push({ id, scope: String(values[1]), key: String(values[2]) });
          return { affectedRows: 1n, insertId: id };
        }
        if (sql.includes("UPDATE user_sessions session")) {
          this.dml.push("user_sessions.update");
          const playerId = String(values[0]);
          const count = draft.activeSessions.get(playerId) ?? 0;
          draft.activeSessions.set(playerId, 0);
          return { affectedRows: BigInt(count), insertId: 0n };
        }
        if (sql.includes("INSERT INTO command_audit")) {
          if (this.failNextAudit) { this.failNextAudit = false; throw new Error("forced audit failure"); }
          this.dml.push("command_audit.insert");
          const id = draft.nextId++;
          draft.audits.push({ id, actionCode: String(values[4]), reason: String(values[5]), summary: JSON.parse(String(values[6])) });
          return { affectedRows: 1n, insertId: id };
        }
        if (sql.includes("UPDATE operations SET status = 'completed'")) {
          if (this.failNextOperationComplete) { this.failNextOperationComplete = false; throw new Error("forced operation complete failure"); }
          this.dml.push("operations.complete");
          const operation = draft.operations.find((row) => row.id === BigInt(String(values[1])));
          if (operation !== undefined) operation.resultJson = String(values[0]);
          return { affectedRows: operation === undefined ? 0n : 1n, insertId: 0n };
        }
        throw new Error(`unexpected execute: ${sql}`);
      }
    };
  }
}

const adminSession: AdminSession = {
  sessionId: "80", operatorId: "81", loginId: "root.operator", displayName: "총괄 운영자",
  roleCodes: ["super_admin"], permissions: ["player.read", "account.session.revoke"]
};

async function buildIntegrationApp(database: SessionRevokeDatabase, browserPreview = false) {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await registerAdminRoutes(app, {
    auth: {
      async login() {
        return { ...adminSession, sessionToken: "integration-admin", csrfToken: "integration-csrf" };
      },
      async authenticate(token: string, csrf?: string) {
        if (token !== "integration-admin") throw new ApplicationError("ADMIN_AUTH_REQUIRED", "관리자 로그인이 필요합니다.", 401);
        if (csrf !== undefined && csrf !== "integration-csrf") throw new ApplicationError("CSRF_TOKEN_INVALID", "CSRF 토큰이 올바르지 않습니다.", 403);
        return adminSession;
      }
    },
    management: new AdminManagementService(database), profiles: {
      async list() { return [syntheticAdminPlayer]; },
      async count() { return 1; },
      async findByPlayerId(playerId: string) { return playerId === syntheticAdminPlayer.playerId ? { ...syntheticAdminPlayer, restrictions: [] } : null; }
    }, changePlayerServer: {}, directory: {}, moderationIncidents: {},
    retainedEventContents: {}, inspectIrisKakaoDatabase: async () => ({}), secureCookies: false
  } as never);
  app.setErrorHandler(async (error, request, reply) => {
    const statusCode = error instanceof ApplicationError ? error.statusCode : 500;
    return reply.code(statusCode).send({ ok: false, error: { code: error instanceof ApplicationError ? error.code : "INTERNAL_ERROR", message: error instanceof Error ? error.message : "테스트 오류" }, requestId: request.id });
  });
  if (browserPreview) {
    await registerAdminWebShellRoutes(app);
    app.get<{ Params: { playerId: string } }>("/api/v1/admin/players/:playerId/account-links", async (request, reply) => {
      if (request.params.playerId !== syntheticAdminPlayer.playerId) return reply.code(404).send({ error: { message: "회원을 찾을 수 없습니다." } });
      return { accountLinks: [{
        playerId: request.params.playerId, playerRole: "REPRESENTATIVE", linkStatus: "ACTIVE", portalAccountStatus: "ACTIVE",
        maskedLoginId: "s********r", platformCode: "KAKAO", contextType: "ROOM", selectionStatus: "ACTIVE", maskedExternalUserKey: "u********1"
      }] };
    });
  }
  return app;
}

// 실제 service→route→shell→browser 흐름을 독립 브라우저에서 재현할 preview를 엽니다.
export async function startSessionRevokeBrowserPreview(port = 3312) {
  const database = new SessionRevokeDatabase();
  const app = await buildIntegrationApp(database, true);
  await app.listen({ host: "127.0.0.1", port });
  return { app, database };
}

const authHeaders = { cookie: "hoibot_admin_session=integration-admin", "x-csrf-token": "integration-csrf" };
const request = (playerId: string, key: string) => ({
  method: "POST" as const,
  url: `/api/v1/admin/players/${playerId}/session-revocations`,
  headers: { ...authHeaders, "idempotency-key": key },
  payload: { reason: `통합 세션 회수 ${key}`, confirmed: true }
});

describe("admin user session revoke service-route transaction", () => {
  it("revokes N sessions, replays one UPDATE/audit across restart, and leaks no identifiers", async () => {
    const database = new SessionRevokeDatabase();
    const firstApp = await buildIntegrationApp(database);
    const first = await firstApp.inject(request("9007199254740993", "same-key"));
    await firstApp.close();
    const restartedApp = await buildIntegrationApp(database);
    try {
      const replay = await restartedApp.inject(request("9007199254740993", "same-key"));
      assert.equal(first.statusCode, 200);
      assert.deepEqual(first.json().sessionRevocation, { playerId: "9007199254740993", revokedSessionCount: 3, replayed: false, auditId: "5001" });
      assert.deepEqual(replay.json().sessionRevocation, { playerId: "9007199254740993", revokedSessionCount: 3, replayed: true, auditId: "5001" });
      assert.equal(database.dml.filter((entry) => entry === "user_sessions.update").length, 1);
      assert.equal(database.state.audits.length, 1);
      assert.doesNotMatch(first.body + replay.body, /sessionId|token|userAccountId|portalAccount|linkId/i);
    } finally {
      await restartedApp.close();
    }
  });

  it("serializes different keys to N/0 and audits no-link/no-active outcomes", async () => {
    const database = new SessionRevokeDatabase();
    const app = await buildIntegrationApp(database);
    try {
      const [left, right] = await Promise.all([
        app.inject(request("9007199254740993", "different-a")),
        app.inject(request("9007199254740993", "different-b"))
      ]);
      assert.deepEqual([left.json().sessionRevocation.revokedSessionCount, right.json().sessionRevocation.revokedSessionCount], [3, 0]);
      const noLink = await app.inject(request("9007199254740994", "no-link"));
      const noActive = await app.inject(request("9007199254740995", "no-active"));
      assert.equal(noLink.json().sessionRevocation.revokedSessionCount, 0);
      assert.equal(noActive.json().sessionRevocation.revokedSessionCount, 0);
      assert.deepEqual(database.state.audits.map((audit) => audit.summary.outcome), ["none", "no_active_session", "no_linked_account", "no_active_session"]);
      assert.deepEqual(database.state.statuses, { player: "active", account: "active" });
      assert.equal(database.state.restrictions, 0);
      assert.equal(database.state.outbox, 0);
    } finally {
      await app.close();
    }
  });

  it("returns 404 without residue and rolls back session, audit, and operation failures", async () => {
    const database = new SessionRevokeDatabase();
    const app = await buildIntegrationApp(database);
    try {
      const missing = await app.inject(request("99", "missing"));
      assert.equal(missing.statusCode, 404);
      assert.equal(database.state.operations.length, 0);

      for (const failure of ["audit", "operation"] as const) {
        database.state.activeSessions.set("9007199254740993", 3);
        const before = structuredClone(database.state);
        if (failure === "audit") database.failNextAudit = true;
        else database.failNextOperationComplete = true;
        const response = await app.inject(request("9007199254740993", `fail-${failure}`));
        assert.equal(response.statusCode, 500);
        assert.deepEqual(database.state, before);
      }
    } finally {
      await app.close();
    }
  });

  it("limits DML to operations, user_sessions, and command_audit", async () => {
    const database = new SessionRevokeDatabase();
    const app = await buildIntegrationApp(database);
    try {
      await app.inject(request("9007199254740993", "boundary"));
      assert.deepEqual(database.dml, ["operations.insert", "user_sessions.update", "command_audit.insert", "operations.complete"]);
    } finally {
      await app.close();
    }
  });
});
