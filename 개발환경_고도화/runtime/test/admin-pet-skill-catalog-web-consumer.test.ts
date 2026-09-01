import assert from "node:assert/strict";
import { describe, it } from "node:test";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import {
  registerAdminPetSkillCatalogWebRoutes,
  type AdminPetSkillCatalogWebRouteDependencies,
} from "../src/admin/pet-skill-catalog-web-routes.js";
import type { ConfigurationMutationResult } from "../src/configuration/configuration-catalog.js";
import { PET_SKILL_CATALOG_SET_CODE, type PetSkillCatalogInput, type PetSkillCatalogSnapshot } from "../src/pet/pet-skill-catalog.js";
import { ApplicationError } from "../src/shared/application-error.js";

type Catalog = AdminPetSkillCatalogWebRouteDependencies["catalog"];
const sourceHash = "a".repeat(64);
const input: PetSkillCatalogInput = {
  catalogVersion: "synthetic-pet-skill-web-v1",
  definitions: [
    { code: "pet_skill_ten_won", name: "십원", grade: "B", rate: 1, sourceKey: "skill_001", sourceHash, effect: "십원 효과", active: true, sourceIndex: 0 },
    { code: "pet_skill_salvation", name: "구원", grade: "B", rate: 1, sourceKey: "skill_002", sourceHash, effect: "구원 효과", active: true, sourceIndex: 1 },
    { code: "pet_skill_musou_myth", name: "무쌍신화", grade: "B", rate: 0.5, sourceKey: "skill_003", sourceHash, effect: "개인 공격 횟수 증가", active: true, fixedRate: true, sourceIndex: 2 },
    { code: "pet_skill_musou_ghost", name: "무쌍귀신", grade: "B", sourceKey: "skill_004", sourceHash, effect: "개인 공격 횟수 증가", active: true, openable: false, sourceIndex: 3 },
  ],
  compatibilityGroups: [{ code: "musou_myth_ghost", displayOrder: 1, active: true, members: ["pet_skill_musou_myth", "pet_skill_musou_ghost"] }],
  drawPolicy: { gradeWeightTotals: { B: 20 } },
};
const snapshot: PetSkillCatalogSnapshot = {
  setCode: PET_SKILL_CATALOG_SET_CODE,
  version: "9007199254740995",
  status: "active",
  catalogVersion: input.catalogVersion,
  definitions: input.definitions.map((entry, index) => ({ ...entry, drawWeight: index < 2 ? 9.75 : index === 2 ? 0.5 : 0, actualRate: index < 2 ? 48.75 : index === 2 ? 2.5 : 0, effectIdentity: String(index).repeat(64) })),
  compatibilityGroups: input.compatibilityGroups,
  drawPolicy: input.drawPolicy,
  contentHash: "b".repeat(64),
};
const headers = { cookie: "hoibot_admin_session=pet-skill-session", "x-csrf-token": "pet-skill-csrf", "idempotency-key": "pet-skill-operation" };

function result(action: ConfigurationMutationResult["action"], replayed = false): ConfigurationMutationResult {
  return { action, setCode: PET_SKILL_CATALOG_SET_CODE, beforeVersion: snapshot.version, version: "9007199254740996", targetVersion: null, snapshot: null, operationId: "51", auditId: "52", outboxId: "53", replayed };
}

// 운영 DB 없이 typed 펫스킬 REST 경계와 provider 전달값을 검증할 앱을 구성합니다.
async function buildApp(overrides: { roleCodes?: string[]; catalog?: Partial<Catalog> } = {}) {
  const calls: Array<{ method: string; input: unknown }> = [];
  const catalog: Catalog = {
    readCurrent: overrides.catalog?.readCurrent ?? (async () => snapshot),
    readVersion: overrides.catalog?.readVersion ?? (async (version) => { calls.push({ method: "readVersion", input: version }); return snapshot; }),
    createDraft: overrides.catalog?.createDraft ?? (async (request) => { calls.push({ method: "createDraft", input: request }); return result("draft"); }),
    publish: overrides.catalog?.publish ?? (async (request) => { calls.push({ method: "publish", input: request }); return result("publish", true); }),
    rollback: overrides.catalog?.rollback ?? (async (request) => { calls.push({ method: "rollback", input: request }); return result("rollback"); }),
    retire: overrides.catalog?.retire ?? (async (request) => { calls.push({ method: "retire", input: request }); return result("retire"); }),
    discardDraft: overrides.catalog?.discardDraft ?? (async (request) => { calls.push({ method: "discardDraft", input: request }); return result("discard"); }),
  };
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.setErrorHandler(async (error, request, reply) => {
    const known = error instanceof ApplicationError;
    return reply.code(known ? error.statusCode : 500).send({ ok: false, error: { code: known ? error.code : "INTERNAL_SERVER_ERROR", message: known ? error.message : "서버 오류" }, requestId: request.id });
  });
  await registerAdminPetSkillCatalogWebRoutes(app, {
    auth: { authenticate: async () => ({ sessionId: "1", operatorId: "9007199254740997", loginId: "synthetic", displayName: "합성 관리자", roleCodes: overrides.roleCodes ?? ["manager"], permissions: [], csrfToken: "pet-skill-csrf", expiresAt: new Date().toISOString() }) },
    catalog,
  });
  return { app, calls };
}

const common = { expectedActiveVersion: snapshot.version, reason: "펫스킬 웹 카탈로그 합성 검증", confirmed: true };

describe("admin pet skill catalog web consumer", () => {
  it("returns stable identities, effects, compatibility and draw projection without number coercion", async () => {
    const { app } = await buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/admin/pet-skill-catalog", headers: { cookie: headers.cookie } });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().catalog.version, snapshot.version);
      assert.deepEqual(response.json().catalog.definitions.slice(0, 2).map((entry: { name: string }) => entry.name), ["십원", "구원"]);
      assert.deepEqual(response.json().catalog.compatibilityGroups[0].members, ["pet_skill_musou_myth", "pet_skill_musou_ghost"]);
    } finally { await app.close(); }
  });

  it("fails closed below manager and for a missing version", async () => {
    const denied = await buildApp({ roleCodes: ["viewer"] });
    try {
      const response = await denied.app.inject({ method: "GET", url: "/api/v1/admin/pet-skill-catalog", headers: { cookie: headers.cookie } });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().error.code, "PET_SKILL_CATALOG_ADMIN_REQUIRED");
    } finally { await denied.app.close(); }
    const missing = await buildApp({ catalog: { readVersion: async () => null } });
    try {
      const response = await missing.app.inject({ method: "GET", url: "/api/v1/admin/pet-skill-catalog/versions/9", headers: { cookie: headers.cookie } });
      assert.equal(response.statusCode, 404);
    } finally { await missing.app.close(); }
  });

  it("requires CSRF, idempotency and decimal-string caller versions", async () => {
    const { app } = await buildApp();
    const payload = { ...common, catalog: input };
    try {
      const noCsrf = await app.inject({ method: "POST", url: "/api/v1/admin/pet-skill-catalog/drafts", headers: { cookie: headers.cookie, "idempotency-key": headers["idempotency-key"] }, payload });
      assert.equal(noCsrf.statusCode, 403);
      const noKey = await app.inject({ method: "POST", url: "/api/v1/admin/pet-skill-catalog/drafts", headers: { cookie: headers.cookie, "x-csrf-token": headers["x-csrf-token"] }, payload });
      assert.equal(noKey.statusCode, 422);
      const numberVersion = await app.inject({ method: "POST", url: "/api/v1/admin/pet-skill-catalog/drafts", headers, payload: { ...payload, expectedActiveVersion: 9007199254740995 } });
      assert.equal(numberVersion.statusCode, 422);
      assert.equal(numberVersion.json().error.code, "PET_SKILL_CATALOG_VERSION_INVALID");
    } finally { await app.close(); }
  });

  it("passes the complete catalog and all lifecycle actions to the existing provider", async () => {
    const { app, calls } = await buildApp();
    try {
      const responses = await Promise.all([
        app.inject({ method: "POST", url: "/api/v1/admin/pet-skill-catalog/drafts", headers: { ...headers, "idempotency-key": "draft" }, payload: { ...common, baseVersion: snapshot.version, catalog: input } }),
        app.inject({ method: "POST", url: "/api/v1/admin/pet-skill-catalog/drafts/9007199254740996/publish", headers: { ...headers, "idempotency-key": "publish" }, payload: common }),
        app.inject({ method: "POST", url: "/api/v1/admin/pet-skill-catalog/rollback", headers: { ...headers, "idempotency-key": "rollback" }, payload: { ...common, targetVersion: "9007199254740994" } }),
        app.inject({ method: "POST", url: "/api/v1/admin/pet-skill-catalog/retire", headers: { ...headers, "idempotency-key": "retire" }, payload: common }),
        app.inject({ method: "DELETE", url: "/api/v1/admin/pet-skill-catalog/drafts/9007199254740996", headers: { ...headers, "idempotency-key": "discard" }, payload: { reason: common.reason, confirmed: true } }),
      ]);
      assert.deepEqual(responses.map((response) => response.statusCode), [201, 200, 200, 200, 200]);
      assert.deepEqual(calls.map((call) => call.method), ["createDraft", "publish", "rollback", "retire", "discardDraft"]);
      const draft = calls[0]?.input as { expectedActiveVersion: string; catalog: PetSkillCatalogInput };
      assert.equal(draft.expectedActiveVersion, snapshot.version);
      assert.equal(draft.catalog.definitions[0]?.code, "pet_skill_ten_won");
      assert.equal(responses[1]?.json().result.replayed, true);
    } finally { await app.close(); }
  });
});
