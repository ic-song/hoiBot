import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import type { AdminSession } from "../src/admin/auth-service.js";
import { AdminManagementService } from "../src/admin/management-service.js";
import { registerAdminRoutes } from "../src/admin/routes.js";
import type { DatabaseClient } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";

const superAdmin: AdminSession = {
  sessionId: "71", operatorId: "72", loginId: "root.operator", displayName: "총괄 운영자",
  roleCodes: ["super_admin"], permissions: ["player.read", "account.session.revoke"]
};

async function buildRouteApp(session: AdminSession = superAdmin) {
  const calls: Array<Record<string, unknown>> = [];
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await registerAdminRoutes(app, {
    auth: {
      async authenticate(token: string, csrf?: string) {
        if (token !== "admin-cookie") throw new ApplicationError("ADMIN_AUTH_REQUIRED", "관리자 로그인이 필요합니다.", 401);
        if (csrf !== "admin-csrf") throw new ApplicationError("CSRF_TOKEN_INVALID", "CSRF 토큰이 올바르지 않습니다.", 403);
        return session;
      }
    },
    management: {
      async revokePlayerSessions(input: Record<string, unknown>) {
        calls.push(input);
        return { playerId: input.playerId, revokedSessionCount: 2, replayed: false, auditId: "9901" };
      }
    },
    profiles: {}, changePlayerServer: {}, directory: {}, moderationIncidents: {}, retainedEventContents: {},
    inspectIrisKakaoDatabase: async () => ({}), secureCookies: false
  } as never);
  app.setErrorHandler(async (error, request, reply) => {
    const statusCode = error instanceof ApplicationError ? error.statusCode : 500;
    return reply.code(statusCode).send({ ok: false, error: { code: error instanceof ApplicationError ? error.code : "INTERNAL_ERROR", message: error instanceof Error ? error.message : "테스트 오류" }, requestId: request.id });
  });
  return { app, calls };
}

const headers = {
  cookie: "hoibot_admin_session=admin-cookie",
  "x-csrf-token": "admin-csrf",
  "idempotency-key": "session-revoke-1"
};

describe("admin user session revoke route and UI contract", () => {
  it("requires cookie, csrf, idempotency, reason, confirmation, permission, and super_admin", async () => {
    const { app, calls } = await buildRouteApp();
    try {
      const url = "/api/v1/admin/players/18446744073709551615/session-revocations";
      const payload = { reason: "보안 사고 대응", confirmed: true };
      assert.equal((await app.inject({ method: "POST", url, headers: { ...headers, cookie: "" }, payload })).statusCode, 401);
      assert.equal((await app.inject({ method: "POST", url, headers: { ...headers, "x-csrf-token": "wrong" }, payload })).statusCode, 403);
      assert.equal((await app.inject({ method: "POST", url, headers: { cookie: headers.cookie, "x-csrf-token": headers["x-csrf-token"] }, payload })).statusCode, 422);
      assert.equal((await app.inject({ method: "POST", url, headers, payload: { reason: "", confirmed: true } })).statusCode, 422);
      assert.equal((await app.inject({ method: "POST", url, headers, payload: { reason: "사유", confirmed: false } })).statusCode, 422);
      assert.equal(calls.length, 0);
    } finally {
      await app.close();
    }

    for (const session of [
      { ...superAdmin, permissions: [] },
      { ...superAdmin, roleCodes: ["manager"] }
    ]) {
      const denied = await buildRouteApp(session);
      try {
        const response = await denied.app.inject({ method: "POST", url: "/api/v1/admin/players/7/session-revocations", headers, payload: { reason: "권한 검증", confirmed: true } });
        assert.equal(response.statusCode, 403);
        assert.equal(denied.calls.length, 0);
      } finally {
        await denied.app.close();
      }
    }
  });

  it("preserves uint64 IDs and exposes only the approved response DTO", async () => {
    const { app, calls } = await buildRouteApp();
    try {
      for (const playerId of ["0", "01", "-1", "1.5", "18446744073709551616"]) {
        const invalid = await app.inject({ method: "POST", url: `/api/v1/admin/players/${playerId}/session-revocations`, headers, payload: { reason: "ID 검증", confirmed: true } });
        assert.equal(invalid.statusCode, 422);
      }
      const response = await app.inject({
        method: "POST", url: "/api/v1/admin/players/18446744073709551615/session-revocations", headers,
        payload: { reason: "  보안 사고 대응  ", confirmed: true }
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json().sessionRevocation, {
        playerId: "18446744073709551615", revokedSessionCount: 2, replayed: false, auditId: "9901"
      });
      assert.deepEqual(Object.keys(response.json()), ["sessionRevocation"]);
      assert.deepEqual(Object.keys(response.json().sessionRevocation).sort(), ["auditId", "playerId", "replayed", "revokedSessionCount"]);
      assert.doesNotMatch(response.body, /sessionId|token|portalAccountId|portalGameAccountLinkId|userAccountId|linkId/i);
      assert.deepEqual(calls[0], { operatorId: "72", idempotencyKey: "session-revoke-1", reason: "보안 사고 대응", playerId: "18446744073709551615" });
    } finally {
      await app.close();
    }
  });

  it("keeps migration grant super_admin-only and provides a narrow rollback", async () => {
    const [migration, rollback] = await Promise.all([
      readFile(new URL("../migrations/474_admin_user_session_revoke_rbac.sql", import.meta.url), "utf8"),
      readFile(new URL("../migrations/rollback/474_admin_user_session_revoke_rbac.rollback.sql", import.meta.url), "utf8")
    ]);
    assert.match(migration, /account\.session\.revoke/);
    assert.match(migration, /role\.code = 'super_admin'/);
    assert.doesNotMatch(migration, /role\.code = 'manager'|operations_manager/);
    assert.match(rollback, /DELETE role_permission/);
    assert.match(rollback, /DELETE FROM admin_permissions/);
    assert.doesNotMatch(rollback, /DROP TABLE|TRUNCATE/);
  });

  it("recovers a concurrent unique-key loser by replaying the winner without new DML", async () => {
    let operationReads = 0;
    const database: DatabaseClient = {
      async ping() {}, async verifyRollback() { return true; }, async close() {},
      async query<T>() { throw new Error("not used"); },
      async execute() { throw new Error("not used"); },
      async withTransaction<T>(work: (transaction: import("../src/database.js").DatabaseTransaction) => Promise<T>) {
        return work({
          async query<R>(sql: string) {
            if (!sql.includes("FROM operations")) throw new Error(`unexpected query: ${sql}`);
            operationReads += 1;
            return (operationReads === 1 ? [] : [{ result_json: JSON.stringify({ playerId: "7", revokedSessionCount: 4, replayed: false, auditId: "88" }) }]) as R;
          },
          async execute(sql: string) {
            if (!sql.includes("INSERT INTO operations")) throw new Error(`unexpected execute: ${sql}`);
            throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY", errno: 1062 });
          }
        });
      }
    };
    const result = await new AdminManagementService(database).revokePlayerSessions({
      playerId: "7", operatorId: "72", idempotencyKey: "raced", reason: "동시 요청"
    });
    assert.deepEqual(result, { playerId: "7", revokedSessionCount: 4, replayed: true, auditId: "88" });
    assert.equal(operationReads, 2);
  });

  it("ships a 44px, permission-gated, accessible member-detail action with retry-safe mutation input", async () => {
    const source = await readFile(new URL("../src/admin/web-shell-assets.ts", import.meta.url), "utf8");
    assert.match(source, /hasPermission\("account\.session\.revoke"\).*hasAnyRole\(\["super_admin"\]\)/s);
    assert.match(source, /id=\\"session-revoke-form\\"/);
    assert.match(source, /aria-live=\\"polite\\"/);
    assert.match(source, /data-action-error role=\\"alert\\"/);
    assert.match(source, /\.danger-button \{ min-height: 44px/);
    assert.match(source, /\/session-revocations.*"POST".*reason: reason, confirmed: true/s);
    assert.match(source, /syncSessionRevocationAvailability\(accountLinks\.length > 0\)/);
    assert.match(source, /연결 계정 상태를 확인하지 못해 세션 회수를 잠갔습니다/);
  });
});
