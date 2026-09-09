import assert from "node:assert/strict";
import { describe, it } from "node:test";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { registerAdminPackageCatalogWebRoutes, type AdminPackageCatalogWebRouteDependencies } from "../src/admin/package-catalog-web-routes.js";
import { PackageCatalogCommandError } from "../src/package/package-catalog-admin-command.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { syntheticPackageCatalogAdminSession, syntheticPackageCatalogMutationHeaders, syntheticPackageCatalogSnapshot } from "./fixtures/admin-package-catalog-web-consumer.js";

type CatalogProvider = AdminPackageCatalogWebRouteDependencies["catalog"];

// 운영 DB 없이 REST 인증·직렬화·adapter 전달 계약을 검증할 앱을 구성합니다.
async function buildApp(input: { permissions?: string[]; catalog?: Partial<CatalogProvider> } = {}) {
  const authCalls: Array<{ sessionToken: string; csrfToken?: string }> = [];
  const requests: Parameters<CatalogProvider["mutate"]>[0][] = [];
  const session = { ...syntheticPackageCatalogAdminSession, permissions: input.permissions ?? syntheticPackageCatalogAdminSession.permissions };
  const catalog: CatalogProvider = { mutate: input.catalog?.mutate ?? (async (request) => {
    requests.push(request);
    return { replayed: false, catalogVersion: request.expectedCatalogVersion + 1n, packageId: request.mutation.action === "ADD" ? "PKG-CUSTOM-9007199254740994" : request.mutation.packageId, message: "처리되었습니다." };
  }) };
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.setErrorHandler(async (error, request, reply) => {
    const applicationError = error instanceof ApplicationError;
    return reply.code(applicationError ? error.statusCode : 500).send({ ok: false, error: { code: applicationError ? error.code : "INTERNAL_SERVER_ERROR", message: applicationError ? error.message : "서버 오류" }, requestId: request.id });
  });
  await registerAdminPackageCatalogWebRoutes(app, {
    auth: { authenticate: async (sessionToken, csrfToken) => { authCalls.push({ sessionToken, csrfToken }); return session; } },
    snapshot: { readSnapshot: async () => syntheticPackageCatalogSnapshot },
    catalog,
  });
  return { app, authCalls, requests };
}

const commonBody = { expectedCatalogVersion: "9007199254740993", reason: "Lease2368 합성 검증", confirmed: true };

describe("admin package catalog web consumer", () => {
  it("serializes catalog and row bigint versions as lossless decimal strings", async () => {
    const { app, authCalls } = await buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/admin/package-catalog", headers: { cookie: syntheticPackageCatalogMutationHeaders.cookie } });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json().catalog, { catalogKey: "PACKAGE_CATALOG", catalogVersion: "9007199254740993", entries: [
        { packageId: "PKG-SYNTH-LEASE2368-ACTIVE", displayName: "합성 활성 패키지", displayOrder: 1, active: true, expectedVersion: "18446744073709551615" },
        { packageId: "PKG-SYNTH-LEASE2368-INACTIVE", displayName: "합성 비활성 패키지", displayOrder: 2, active: false, expectedVersion: "9007199254740995" },
      ] });
      assert.deepEqual(authCalls, [{ sessionToken: "synthetic-session-token", csrfToken: undefined }]);
    } finally { await app.close(); }
  });

  it("requires the current package.catalog.manage permission", async () => {
    const { app } = await buildApp({ permissions: [] });
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/admin/package-catalog", headers: { cookie: syntheticPackageCatalogMutationHeaders.cookie } });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().error.code, "FORBIDDEN");
    } finally { await app.close(); }
  });

  it("requires CSRF, Idempotency-Key, reason, confirmation and decimal-string catalog version", async () => {
    const { app } = await buildApp();
    const body = { ...commonBody, displayName: "신규", description: "설명", rewards: [{ rewardType: "POINT", assetCode: "POINT", quantity: "1" }] };
    try {
      const missingCsrf = await app.inject({ method: "POST", url: "/api/v1/admin/package-catalog/packages", headers: { cookie: syntheticPackageCatalogMutationHeaders.cookie, "idempotency-key": "required" }, payload: body });
      assert.equal(missingCsrf.statusCode, 403);
      assert.equal(missingCsrf.json().error.code, "CSRF_TOKEN_REQUIRED");
      const missingKey = await app.inject({ method: "POST", url: "/api/v1/admin/package-catalog/packages", headers: { cookie: syntheticPackageCatalogMutationHeaders.cookie, "x-csrf-token": "synthetic-csrf-token" }, payload: body });
      assert.equal(missingKey.statusCode, 422);
      assert.equal(missingKey.json().error.code, "IDEMPOTENCY_KEY_REQUIRED");
      const numericVersion = await app.inject({ method: "POST", url: "/api/v1/admin/package-catalog/packages", headers: syntheticPackageCatalogMutationHeaders, payload: { ...body, expectedCatalogVersion: 9007199254740993 } });
      assert.equal(numericVersion.statusCode, 422);
      assert.equal(numericVersion.json().error.code, "PACKAGE_CATALOG_VERSION_INVALID");
    } finally { await app.close(); }
  });

  it("passes ADD rewards as bigint with fixed source and returns 201", async () => {
    const { app, requests, authCalls } = await buildApp();
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/package-catalog/packages", headers: syntheticPackageCatalogMutationHeaders, payload: { ...commonBody, displayName: "신규 패키지", description: "합성 설명", rewards: [{ rewardType: "ITEM", assetCode: "ITEM-SYNTH", quantity: "123456789012345678901234567890" }] } });
      assert.equal(response.statusCode, 201);
      assert.equal(requests[0]?.sourceCode, "admin_web");
      assert.equal(requests[0]?.expectedCatalogVersion, 9007199254740993n);
      assert.equal(requests[0]?.mutation.action === "ADD" ? requests[0].mutation.rewards[0]?.quantity : undefined, 123456789012345678901234567890n);
      assert.deepEqual(authCalls[0], { sessionToken: "synthetic-session-token", csrfToken: "synthetic-csrf-token" });
    } finally { await app.close(); }
  });

  it("exposes only stable packageId reward EDIT from the adapter contract", async () => {
    const { app, requests } = await buildApp();
    const packageId = "PKG-SYNTH-LEASE2368-ACTIVE";
    try {
      const response = await app.inject({ method: "PATCH", url: "/api/v1/admin/package-catalog/packages/" + packageId, headers: syntheticPackageCatalogMutationHeaders, payload: { ...commonBody, rewards: [{ rewardType: "POINT", assetCode: "POINT", quantity: "9007199254740993" }] } });
      assert.equal(response.statusCode, 200);
      assert.equal(requests[0]?.mutation.action, "EDIT");
      assert.equal(requests[0]?.mutation.action === "EDIT" ? requests[0].mutation.packageId : undefined, packageId);
      assert.equal(requests[0]?.mutation.action === "EDIT" ? requests[0].mutation.rewards[0]?.quantity : undefined, 9007199254740993n);
    } finally { await app.close(); }
  });

  it("maps REMOVE and ENABLE exactly and preserves replay", async () => {
    const received: Parameters<CatalogProvider["mutate"]>[0][] = [];
    const { app } = await buildApp({ catalog: { mutate: async (request) => { received.push(request); return { replayed: request.mutation.action === "ENABLE", catalogVersion: request.expectedCatalogVersion + 1n, packageId: request.mutation.action === "ADD" ? "unused" : request.mutation.packageId, message: "처리되었습니다." }; } } });
    try {
      const removed = await app.inject({ method: "DELETE", url: "/api/v1/admin/package-catalog/packages/PKG-REMOVE", headers: syntheticPackageCatalogMutationHeaders, payload: commonBody });
      const enabled = await app.inject({ method: "POST", url: "/api/v1/admin/package-catalog/packages/PKG-INACTIVE/enable", headers: { ...syntheticPackageCatalogMutationHeaders, "idempotency-key": "lease2368-enable" }, payload: commonBody });
      assert.equal(removed.statusCode, 200);
      assert.equal(enabled.statusCode, 200);
      assert.deepEqual(received.map((request) => request.mutation.action), ["REMOVE", "ENABLE"]);
      assert.equal(enabled.json().result.replayed, true);
    } finally { await app.close(); }
  });

  it("normalizes provider conflicts as HTTP 409", async () => {
    const { app } = await buildApp({ catalog: { mutate: async () => { throw new PackageCatalogCommandError("PACKAGE_CATALOG_VERSION_CONFLICT", "패키지 목록이 먼저 변경되었습니다."); } } });
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/package-catalog/packages", headers: syntheticPackageCatalogMutationHeaders, payload: { ...commonBody, displayName: "충돌", description: "충돌", rewards: [{ rewardType: "POINT", assetCode: "POINT", quantity: "1" }] } });
      assert.equal(response.statusCode, 409);
      assert.deepEqual(response.json().error, { code: "PACKAGE_CATALOG_VERSION_CONFLICT", message: "패키지 목록이 먼저 변경되었습니다." });
    } finally { await app.close(); }
  });
});
