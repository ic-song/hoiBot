import assert from "node:assert/strict";
import { describe, it } from "node:test";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import {
  registerAdminConfigurationCatalogWebRoutes,
  type AdminConfigurationCatalogWebRouteDependencies,
} from "../src/admin/configuration-catalog-web-routes.js";
import type { ConfigurationMutationResult, ConfigurationSnapshot } from "../src/configuration/configuration-catalog.js";
import { ApplicationError } from "../src/shared/application-error.js";

type Catalog = AdminConfigurationCatalogWebRouteDependencies["catalog"];

const source = { file: "main.js", path: "GLOBAL_CONFIG.petMusou.limits.baseAttacks", hash: "a".repeat(64) };
const validation = { min: "1", max: "10", step: "1" };
const definition = { setCode: "pet.musou.rules", label: "펫무쌍 규칙", keys: [{ key: "base_attacks", label: "기본 공격 횟수", type: "integer" as const, required: true, editable: true, validation, source }] };
const snapshot: ConfigurationSnapshot = { id: "9007199254740993", setCode: definition.setCode, version: "9007199254740995", status: "active", values: [{ key: "base_attacks", type: "integer", value: "4", validation, source }], contentHash: "b".repeat(64) };
const headers = { cookie: "hoibot_admin_session=synthetic-session", "x-csrf-token": "synthetic-csrf", "idempotency-key": "synthetic-config-operation" };

function result(action: ConfigurationMutationResult["action"], replayed = false): ConfigurationMutationResult {
  return { action, setCode: definition.setCode, beforeVersion: snapshot.version, version: "9007199254740996", targetVersion: null, snapshot, operationId: "41", auditId: "42", outboxId: "43", replayed };
}

// 운영 DB 없이 관리자 REST 경계와 provider 전달값을 검증할 앱을 구성합니다.
async function buildApp(input: { roleCodes?: string[]; catalog?: Partial<Catalog> } = {}) {
  const calls: Array<{ method: string; input: unknown }> = [];
  const catalog: Catalog = {
    listManagedSets: input.catalog?.listManagedSets ?? (() => [definition]),
    readCurrent: input.catalog?.readCurrent ?? (async (setCode) => { calls.push({ method: "readCurrent", input: setCode }); return snapshot; }),
    readVersion: input.catalog?.readVersion ?? (async (setCode, version) => { calls.push({ method: "readVersion", input: { setCode, version } }); return snapshot; }),
    createDraft: input.catalog?.createDraft ?? (async (request) => { calls.push({ method: "createDraft", input: request }); return result("draft"); }),
    publish: input.catalog?.publish ?? (async (request) => { calls.push({ method: "publish", input: request }); return result("publish", true); }),
    rollback: input.catalog?.rollback ?? (async (request) => { calls.push({ method: "rollback", input: request }); return result("rollback"); }),
    retire: input.catalog?.retire ?? (async (request) => { calls.push({ method: "retire", input: request }); return result("retire"); }),
    discardDraft: input.catalog?.discardDraft ?? (async (request) => { calls.push({ method: "discardDraft", input: request }); return result("discard"); }),
  };
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.setErrorHandler(async (error, request, reply) => {
    const known = error instanceof ApplicationError;
    return reply.code(known ? error.statusCode : 500).send({ ok: false, error: { code: known ? error.code : "INTERNAL_SERVER_ERROR", message: known ? error.message : "서버 오류" }, requestId: request.id });
  });
  await registerAdminConfigurationCatalogWebRoutes(app, {
    auth: { authenticate: async () => ({ sessionId: "1", operatorId: "9007199254740997", loginId: "synthetic", displayName: "합성 관리자", roleCodes: input.roleCodes ?? ["manager"], permissions: [], csrfToken: "synthetic-csrf", expiresAt: new Date().toISOString() }) },
    catalog,
  });
  return { app, calls };
}

const common = { expectedActiveVersion: snapshot.version, reason: "설정 카탈로그 합성 검증", confirmed: true };

describe("admin configuration catalog web consumer", () => {
  it("lists frozen definitions, source bindings and current decimal-string versions", async () => {
    const { app } = await buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/admin/configuration-catalog", headers: { cookie: headers.cookie } });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().sets[0].current.version, "9007199254740995");
      assert.equal(response.json().sets[0].keys[0].source.path, source.path);
    } finally { await app.close(); }
  });

  it("fails closed for roles below manager and for an unregistered version", async () => {
    const denied = await buildApp({ roleCodes: ["viewer"] });
    try {
      const response = await denied.app.inject({ method: "GET", url: "/api/v1/admin/configuration-catalog", headers: { cookie: headers.cookie } });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().error.code, "CONFIGURATION_CATALOG_ADMIN_REQUIRED");
    } finally { await denied.app.close(); }
    const missing = await buildApp({ catalog: { readVersion: async () => null } });
    try {
      const response = await missing.app.inject({ method: "GET", url: "/api/v1/admin/configuration-catalog/sets/pet.musou.rules/versions/8", headers: { cookie: headers.cookie } });
      assert.equal(response.statusCode, 404);
      assert.equal(response.json().error.code, "CONFIGURATION_VERSION_NOT_FOUND");
    } finally { await missing.app.close(); }
  });

  it("requires CSRF, idempotency, reason, confirmation and decimal-string versions", async () => {
    const { app } = await buildApp();
    const payload = { ...common, changes: [{ key: "base_attacks", value: "5" }] };
    try {
      const noCsrf = await app.inject({ method: "POST", url: "/api/v1/admin/configuration-catalog/sets/pet.musou.rules/drafts", headers: { cookie: headers.cookie, "idempotency-key": headers["idempotency-key"] }, payload });
      assert.equal(noCsrf.statusCode, 403);
      const noKey = await app.inject({ method: "POST", url: "/api/v1/admin/configuration-catalog/sets/pet.musou.rules/drafts", headers: { cookie: headers.cookie, "x-csrf-token": headers["x-csrf-token"] }, payload });
      assert.equal(noKey.statusCode, 422);
      const numberVersion = await app.inject({ method: "POST", url: "/api/v1/admin/configuration-catalog/sets/pet.musou.rules/drafts", headers, payload: { ...payload, expectedActiveVersion: 9007199254740995 } });
      assert.equal(numberVersion.statusCode, 422);
      assert.equal(numberVersion.json().error.code, "CONFIGURATION_VERSION_INVALID");
    } finally { await app.close(); }
  });

  it("maps draft, publish, rollback, retire and discard without number coercion", async () => {
    const { app, calls } = await buildApp();
    try {
      const base = "/api/v1/admin/configuration-catalog/sets/pet.musou.rules";
      const responses = await Promise.all([
        app.inject({ method: "POST", url: base + "/drafts", headers: { ...headers, "idempotency-key": "draft" }, payload: { ...common, baseVersion: snapshot.version, changes: [{ key: "base_attacks", value: "5" }] } }),
        app.inject({ method: "POST", url: base + "/drafts/9007199254740996/publish", headers: { ...headers, "idempotency-key": "publish" }, payload: common }),
        app.inject({ method: "POST", url: base + "/rollback", headers: { ...headers, "idempotency-key": "rollback" }, payload: { ...common, targetVersion: "9007199254740994" } }),
        app.inject({ method: "POST", url: base + "/retire", headers: { ...headers, "idempotency-key": "retire" }, payload: common }),
        app.inject({ method: "DELETE", url: base + "/drafts/9007199254740996", headers: { ...headers, "idempotency-key": "discard" }, payload: { reason: common.reason, confirmed: true } }),
      ]);
      assert.deepEqual(responses.map((response) => response.statusCode), [201, 200, 200, 200, 200]);
      assert.deepEqual(calls.map((call) => call.method), ["createDraft", "publish", "rollback", "retire", "discardDraft"]);
      assert.equal((calls[0]?.input as { expectedActiveVersion: string }).expectedActiveVersion, snapshot.version);
      assert.equal(responses[1]?.json().result.replayed, true);
    } finally { await app.close(); }
  });

  it("preserves an empty managed-set registry as a valid staged boundary", async () => {
    const { app } = await buildApp({ catalog: { listManagedSets: () => [] } });
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/admin/configuration-catalog", headers: { cookie: headers.cookie } });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json().sets, []);
    } finally { await app.close(); }
  });
});
