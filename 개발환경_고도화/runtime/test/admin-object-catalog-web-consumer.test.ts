import assert from "node:assert/strict";
import { describe, it } from "node:test";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { registerAdminObjectCatalogWebRoutes, type AdminObjectCatalogWebRouteDependencies } from "../src/admin/object-catalog-web-routes.js";
import { ObjectCatalogError } from "../src/catalog/object-catalog.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { syntheticObjectCatalogAdminSession, syntheticObjectCatalogMutationHeaders, syntheticObjectCatalogObject } from "./fixtures/admin-object-catalog-web-consumer.js";

type CatalogProvider = AdminObjectCatalogWebRouteDependencies["catalog"];

async function buildApp(input: { roleCodes?: string[]; catalog?: Partial<CatalogProvider>; readerError?: Error } = {}) {
  const authCalls: Array<{ sessionToken: string; csrfToken?: string }> = [];
  const registerCalls: Parameters<CatalogProvider["register"]>[0][] = [];
  const updateCalls: Parameters<CatalogProvider["update"]>[0][] = [];
  const activeCalls: Parameters<CatalogProvider["setActive"]>[0][] = [];
  const session = { ...syntheticObjectCatalogAdminSession, roleCodes: input.roleCodes ?? syntheticObjectCatalogAdminSession.roleCodes };
  const result = (status: "registered" | "updated" | "activated" | "deactivated") => ({ status, replayed: false, object: syntheticObjectCatalogObject, operationId: "501", auditId: "601" });
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.setErrorHandler(async (error, request, reply) => {
    const applicationError = error instanceof ApplicationError;
    return reply.code(applicationError ? error.statusCode : 500).send({ ok: false, error: { code: applicationError ? error.code : "INTERNAL_SERVER_ERROR", message: applicationError ? error.message : "서버 오류" }, requestId: request.id });
  });
  await registerAdminObjectCatalogWebRoutes(app, {
    auth: { authenticate: async (sessionToken, csrfToken) => { authCalls.push({ sessionToken, csrfToken }); return session; } },
    reader: { getByKey: async () => { if (input.readerError) throw input.readerError; return syntheticObjectCatalogObject; } },
    catalog: {
      register: input.catalog?.register ?? (async (request) => { registerCalls.push(request); return result("registered"); }),
      update: input.catalog?.update ?? (async (request) => { updateCalls.push(request); return result("updated"); }),
      setActive: input.catalog?.setActive ?? (async (request) => { activeCalls.push(request); return result(request.active ? "activated" : "deactivated"); }),
    },
  });
  return { app, authCalls, registerCalls, updateCalls, activeCalls };
}

const common = { reason: "Lease2374 합성 검증", confirmed: true };

describe("admin object catalog web consumer", () => {
  it("reads one exact objectKey and preserves decimal strings", async () => {
    const { app, authCalls } = await buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/admin/object-catalog/objects/" + syntheticObjectCatalogObject.objectKey, headers: { cookie: syntheticObjectCatalogMutationHeaders.cookie } });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json().object, syntheticObjectCatalogObject);
      assert.equal(response.json().object.definitionId, "18446744073709551615");
      assert.equal(response.json().object.version, "9007199254740993");
      assert.deepEqual(authCalls, [{ sessionToken: "synthetic-session-token", csrfToken: undefined }]);
      assert.equal((await app.inject({ method: "GET", url: "/api/v1/admin/object-catalog/objects", headers: { cookie: syntheticObjectCatalogMutationHeaders.cookie } })).statusCode, 404);
    } finally { await app.close(); }
  });

  it("allows only current manager or super_admin roles", async () => {
    const { app } = await buildApp({ roleCodes: ["operations_reader"] });
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/admin/object-catalog/objects/currency.denied", headers: { cookie: syntheticObjectCatalogMutationHeaders.cookie } });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().error.code, "OBJECT_CATALOG_ADMIN_REQUIRED");
    } finally { await app.close(); }
  });

  it("requires CSRF, Idempotency-Key, reason, confirmation and decimal-string expectedVersion", async () => {
    const { app } = await buildApp();
    const body = { ...common, objectType: "CURRENCY", expectedVersion: syntheticObjectCatalogObject.version, active: false };
    try {
      assert.equal((await app.inject({ method: "POST", url: "/api/v1/admin/object-catalog/objects/test/active", headers: { cookie: syntheticObjectCatalogMutationHeaders.cookie, "idempotency-key": "required" }, payload: body })).statusCode, 403);
      assert.equal((await app.inject({ method: "POST", url: "/api/v1/admin/object-catalog/objects/test/active", headers: { cookie: syntheticObjectCatalogMutationHeaders.cookie, "x-csrf-token": "synthetic-csrf-token" }, payload: body })).statusCode, 422);
      const numeric = await app.inject({ method: "POST", url: "/api/v1/admin/object-catalog/objects/test/active", headers: syntheticObjectCatalogMutationHeaders, payload: { ...body, expectedVersion: 9007199254740993 } });
      assert.equal(numeric.statusCode, 422);
      assert.equal(numeric.json().error.code, "OBJECT_CATALOG_VERSION_INVALID");
    } finally { await app.close(); }
  });

  it("maps REGISTER to the existing provider with fixed source and canonical binding", async () => {
    const { app, registerCalls } = await buildApp();
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/object-catalog/objects", headers: syntheticObjectCatalogMutationHeaders, payload: { ...common, objectKey: syntheticObjectCatalogObject.objectKey, objectType: "CURRENCY", displayName: "합성 크레딧", active: true, metadata: { fixture: true }, sourceBindings: [{ system: "RUNTIME_DB", table: "currency_definitions", key: "lease2374_credit" }] } });
      assert.equal(response.statusCode, 201);
      assert.equal(registerCalls[0]?.source, "admin-object-web");
      assert.equal(registerCalls[0]?.operatorId, syntheticObjectCatalogAdminSession.operatorId);
      assert.deepEqual(registerCalls[0]?.sourceBindings, [{ system: "RUNTIME_DB", table: "currency_definitions", key: "lease2374_credit" }]);
    } finally { await app.close(); }
  });

  it("maps UPDATE while preserving current active state and stable objectKey", async () => {
    const { app, updateCalls } = await buildApp();
    try {
      const response = await app.inject({ method: "PATCH", url: "/api/v1/admin/object-catalog/objects/" + syntheticObjectCatalogObject.objectKey, headers: syntheticObjectCatalogMutationHeaders, payload: { ...common, objectType: "CURRENCY", expectedVersion: syntheticObjectCatalogObject.version, displayName: "수정 크레딧", metadata: { fixture: "updated" } } });
      assert.equal(response.statusCode, 200);
      assert.equal(updateCalls[0]?.objectKey, syntheticObjectCatalogObject.objectKey);
      assert.equal(updateCalls[0]?.expectedVersion, "9007199254740993");
      assert.equal(updateCalls[0]?.active, true);
      assert.equal(updateCalls[0]?.sourceBindings, undefined);
    } finally { await app.close(); }
  });

  it("maps SET_ACTIVE and preserves provider replay", async () => {
    const { app, activeCalls } = await buildApp({ catalog: { setActive: async (request) => ({ status: "deactivated", replayed: true, object: { ...syntheticObjectCatalogObject, active: false, version: "9007199254740994" }, operationId: "502", auditId: "602" }) } });
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/object-catalog/objects/" + syntheticObjectCatalogObject.objectKey + "/active", headers: syntheticObjectCatalogMutationHeaders, payload: { ...common, objectType: "CURRENCY", expectedVersion: syntheticObjectCatalogObject.version, active: false } });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().result.replayed, true);
      assert.equal(activeCalls.length, 0);
    } finally { await app.close(); }
  });

  it("normalizes exact lookup not-found and carries provider 409 errors unchanged", async () => {
    const missing = await buildApp({ readerError: new ObjectCatalogError("OBJECT_NOT_FOUND", "object_key를 찾을 수 없습니다.") });
    try {
      const response = await missing.app.inject({ method: "GET", url: "/api/v1/admin/object-catalog/objects/currency.missing", headers: { cookie: syntheticObjectCatalogMutationHeaders.cookie } });
      assert.equal(response.statusCode, 404);
      assert.equal(response.json().error.code, "OBJECT_NOT_FOUND");
    } finally { await missing.app.close(); }
    const conflict = await buildApp({ catalog: { update: async () => { throw new ApplicationError("OBJECT_VERSION_CONFLICT", "object version이 변경되었습니다.", 409); } } });
    try {
      const response = await conflict.app.inject({ method: "PATCH", url: "/api/v1/admin/object-catalog/objects/currency.conflict", headers: syntheticObjectCatalogMutationHeaders, payload: { ...common, objectType: "CURRENCY", expectedVersion: "1", displayName: "충돌", metadata: {} } });
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().error.code, "OBJECT_VERSION_CONFLICT");
    } finally { await conflict.app.close(); }
  });
});
