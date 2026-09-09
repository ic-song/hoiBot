import assert from "node:assert/strict";
import { describe, it } from "node:test";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { ADMIN_BALANCE_PERMISSION, registerAdminBalanceWebRoutes, type AdminBalanceWebRouteDependencies } from "../src/admin/admin-balance-web-routes.js";
import type { AdminBalanceMutationPreviewInput } from "../src/admin/admin-balance-mutation-provider.js";
import { ApplicationError } from "../src/shared/application-error.js";

const session = {
  sessionId: "9001", operatorId: "7001", loginId: "shadow.balance", displayName: "합성 수치 운영자",
  roleCodes: ["manager"], permissions: [ADMIN_BALANCE_PERMISSION, "audit.read", "monitoring.read"],
};

const projection = {
  domains: [
    { domain: "home_badge" as const, label: "홈뱃지 조건", version: "9007199254740993", source: "badge:hash", values: [
      { domain: "home_badge" as const, key: "home_badge.visit.criteria.totalVisits", group: "home_badge.visit", sumGroup: null, label: "방문왕 · 누적 방문", value: "100", unit: "회", min: "0", max: "9007199254740991", step: "1", version: "9007199254740993", editable: true, source: "badge:hash" },
    ] },
    { domain: "home_furniture" as const, label: "가구 뽑기", version: "14", source: "furniture:hash", values: [
      { domain: "home_furniture" as const, key: "home_furniture.grade.1.probability", group: "home_furniture.grade.1", sumGroup: "home_furniture.grade.probability", label: "일반 등급 확률", value: "70", unit: "%", min: "0", max: "100", step: "0.01", version: "14", editable: true, source: "furniture:hash" },
    ] },
  ],
};

type Mutation = AdminBalanceWebRouteDependencies["mutation"];

// 운영 DB 없이 세션·CSRF·typed provider 전달 계약을 검증할 앱을 구성합니다.
async function buildApp(input: { permissions?: string[]; mutation?: Partial<Mutation> } = {}) {
  const authCalls: Array<{ token: string; csrf?: string }> = [];
  const previews: AdminBalanceMutationPreviewInput[] = [];
  const applies: Parameters<Mutation["apply"]>[0][] = [];
  const rollbacks: Parameters<Mutation["rollback"]>[0][] = [];
  const mutation: Mutation = {
    preview: input.mutation?.preview ?? (async (request) => {
      previews.push(request);
      return { mode: request.mode, domain: request.domain, expectedVersion: request.expectedVersion, targetVersion: request.mode === "rollback" ? request.targetVersion : null, changes: [{ key: "synthetic", label: "합성 수치", before: "1", after: "2", unit: "%" }], confirmationToken: "sha256:synthetic" };
    }),
    apply: input.mutation?.apply ?? (async (request) => {
      applies.push(request);
      return { mode: "apply", domain: request.domain, beforeVersion: request.expectedVersion, version: "15", targetVersion: null, changes: [], operationId: "501", auditId: "601", outboxId: "701", replayed: false };
    }),
    rollback: input.mutation?.rollback ?? (async (request) => {
      rollbacks.push(request);
      return { mode: "rollback", domain: request.domain, beforeVersion: request.expectedVersion, version: "16", targetVersion: request.targetVersion, changes: [], operationId: "502", auditId: "602", outboxId: "702", replayed: true };
    }),
  };
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.setErrorHandler(async (error, request, reply) => {
    const known = error instanceof ApplicationError;
    return reply.code(known ? error.statusCode : 500).send({ ok: false, error: { code: known ? error.code : "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "서버 오류" }, requestId: request.id });
  });
  await registerAdminBalanceWebRoutes(app, {
    auth: { authenticate: async (token, csrf) => { authCalls.push({ token, csrf }); return { ...session, permissions: input.permissions ?? session.permissions }; } },
    reader: { read: async () => projection },
    mutation,
  });
  return { app, authCalls, previews, applies, rollbacks };
}

const headers = { cookie: "hoibot_admin_session=synthetic-session", "x-csrf-token": "synthetic-csrf", "idempotency-key": "lease2421-key" };

describe("admin balance web consumer", () => {
  it("reads exact decimal strings and applies domain, group and search filters", async () => {
    const { app, authCalls } = await buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/admin/balance?domain=home_badge&group=home_badge.visit&search=%EB%B0%A9%EB%AC%B8", headers: { cookie: headers.cookie } });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().domains.length, 1);
      assert.equal(response.json().domains[0].version, "9007199254740993");
      assert.equal(response.json().domains[0].values[0].value, "100");
      assert.deepEqual(response.json().relatedLinks, { audit: "/api/v1/admin/audit-entries", monitoring: "/api/v1/admin/monitoring-events" });
      assert.deepEqual(authCalls, [{ token: "synthetic-session", csrf: undefined }]);
    } finally { await app.close(); }
  });

  it("fails closed while the dedicated permission remains an unseeded dependency GAP", async () => {
    const { app } = await buildApp({ permissions: [] });
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/admin/balance", headers: { cookie: headers.cookie } });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().error.code, "FORBIDDEN");
    } finally { await app.close(); }
  });

  it("requires CSRF and maps typed apply preview without mutation", async () => {
    const { app, previews, applies } = await buildApp();
    const body = { mode: "apply", expectedVersion: "14", reason: "합성 확률 조정 검증", changes: [{ key: "home_furniture.grade.1.probability", value: "69.50" }] };
    try {
      assert.equal((await app.inject({ method: "POST", url: "/api/v1/admin/balance/home_furniture/preview", headers: { cookie: headers.cookie }, payload: body })).statusCode, 403);
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/balance/home_furniture/preview", headers: { cookie: headers.cookie, "x-csrf-token": headers["x-csrf-token"] }, payload: body });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().preview.confirmationToken, "sha256:synthetic");
      assert.equal(previews[0]?.operatorId, "7001");
      assert.equal(previews[0]?.mode, "apply");
      assert.equal(applies.length, 0);
    } finally { await app.close(); }
  });

  it("requires idempotency and confirmation before apply", async () => {
    const { app, applies } = await buildApp();
    const body = { expectedVersion: "14", reason: "합성 확률 조정 검증", changes: [{ key: "home_furniture.grade.1.probability", value: "69.50" }], confirmationToken: "sha256:synthetic", confirmed: true };
    try {
      const missing = await app.inject({ method: "POST", url: "/api/v1/admin/balance/home_furniture/apply", headers: { cookie: headers.cookie, "x-csrf-token": headers["x-csrf-token"] }, payload: body });
      assert.equal(missing.statusCode, 422);
      assert.equal(missing.json().error.code, "IDEMPOTENCY_KEY_REQUIRED");
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/balance/home_furniture/apply", headers, payload: body });
      assert.equal(response.statusCode, 200);
      assert.equal(applies[0]?.idempotencyKey, "lease2421-key");
      assert.equal(applies[0]?.confirmed, true);
    } finally { await app.close(); }
  });

  it("previews and executes rollback with a lossless target version", async () => {
    const { app, previews, rollbacks } = await buildApp();
    const common = { expectedVersion: "9007199254740993", targetVersion: "9007199254740991", reason: "이전 승인 수치로 안전 복구" };
    try {
      const preview = await app.inject({ method: "POST", url: "/api/v1/admin/balance/home_badge/preview", headers: { cookie: headers.cookie, "x-csrf-token": headers["x-csrf-token"] }, payload: { ...common, mode: "rollback" } });
      assert.equal(preview.statusCode, 200);
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/balance/home_badge/rollback", headers, payload: { ...common, confirmationToken: "sha256:synthetic", confirmed: true } });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().result.replayed, true);
      assert.equal(previews[0]?.mode === "rollback" ? previews[0].targetVersion : undefined, "9007199254740991");
      assert.equal(rollbacks[0]?.targetVersion, "9007199254740991");
    } finally { await app.close(); }
  });

  it("rejects unknown domains, numeric versions and malformed changes before provider calls", async () => {
    const { app, previews } = await buildApp();
    try {
      assert.equal((await app.inject({ method: "GET", url: "/api/v1/admin/balance?domain=wallet", headers: { cookie: headers.cookie } })).statusCode, 404);
      const numeric = await app.inject({ method: "POST", url: "/api/v1/admin/balance/pendant/preview", headers: { cookie: headers.cookie, "x-csrf-token": headers["x-csrf-token"] }, payload: { mode: "apply", expectedVersion: 15, reason: "합성 수치 검증", changes: [] } });
      assert.equal(numeric.statusCode, 422);
      const malformed = await app.inject({ method: "POST", url: "/api/v1/admin/balance/pendant/preview", headers: { cookie: headers.cookie, "x-csrf-token": headers["x-csrf-token"] }, payload: { mode: "apply", expectedVersion: "15", reason: "합성 수치 검증", changes: [{ key: "x", value: 1 }] } });
      assert.equal(malformed.statusCode, 422);
      assert.equal(previews.length, 0);
    } finally { await app.close(); }
  });
});
