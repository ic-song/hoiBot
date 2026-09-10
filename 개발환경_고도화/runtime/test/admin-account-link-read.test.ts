import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { AdminAccountLinkReadService, type AdminAccountLinkReadModel } from "../src/admin/admin-account-link-read-service.js";
import { registerAdminAccountLinkReadRoutes } from "../src/admin/admin-account-link-read-routes.js";
import type { AdminSession } from "../src/admin/auth-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

const allowedSession: AdminSession = {
  sessionId: "session01", operatorId: "operator01", loginId: "operator", displayName: "운영자",
  roleCodes: ["manager"], permissions: ["player.read"],
};

async function buildRouteApp(options: { session?: AdminSession; read?: (playerId: bigint) => Promise<AdminAccountLinkReadModel[]> } = {}) {
  const app = Fastify();
  await app.register(cookie);
  app.setErrorHandler(async (error: Error & { statusCode?: number; code?: string }, _request, reply) => {
    await reply.code(error.statusCode ?? 500).send({ ok: false, error: { code: error.code ?? "INTERNAL_SERVER_ERROR" } });
  });
  await registerAdminAccountLinkReadRoutes(app, {
    auth: { authenticate: async () => options.session ?? allowedSession },
    reader: { read: options.read ?? (async () => []) },
  });
  return app;
}

describe("admin account-link read", () => {
  it("requires existing player.read authorization before reading", async () => {
    let readCount = 0;
    const app = await buildRouteApp({ session: { ...allowedSession, permissions: [] }, read: async () => { readCount += 1; return []; } });
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/players/42/account-links" });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "FORBIDDEN");
    assert.equal(readCount, 0);
    await app.close();
  });

  it("validates uint64 player IDs and returns an empty successful list", async () => {
    const app = await buildRouteApp();
    const invalid = await app.inject({ method: "GET", url: "/api/v1/admin/players/42.5/account-links" });
    const overflow = await app.inject({ method: "GET", url: "/api/v1/admin/players/18446744073709551616/account-links" });
    const empty = await app.inject({ method: "GET", url: "/api/v1/admin/players/18446744073709551615/account-links" });
    assert.equal(invalid.statusCode, 422);
    assert.equal(overflow.statusCode, 422);
    assert.deepEqual(empty.json().accountLinks, []);
    assert.equal(empty.json().playerId, "18446744073709551615");
    await app.close();
  });

  it("preserves 404 for an absent player", async () => {
    const app = await buildRouteApp({ read: async () => { throw new ApplicationError("PLAYER_NOT_FOUND", "missing", 404); } });
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/players/99/account-links" });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "PLAYER_NOT_FOUND");
    await app.close();
  });

  it("masks account identifiers and performs no DML", async () => {
    const queries: string[] = [];
    const service = new AdminAccountLinkReadService({
      query: async <T>(sql: string) => {
        queries.push(sql);
        if (sql.includes("FROM players")) return [{ player_id: 9007199254740993n }] as T;
        return [{
          player_role: "REPRESENTATIVE",
          link_status: "ACTIVE", portal_account_status: "ACTIVE", login_id: "sensitive-login-id",
          platform_code: "KAKAO", context_type: "ROOM", selection_status: "ACTIVE",
          external_user_key: "sensitive-external-user-key",
        }] as T;
      },
    });
    const app = await buildRouteApp({ read: (playerId) => service.read(playerId) });
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/players/9007199254740993/account-links" });
    const body = response.body;
    assert.equal(response.statusCode, 200);
    assert.match(body, /s\*{8}d/);
    assert.doesNotMatch(body, /sensitive-login-id|sensitive-external-user-key|portal01|link0001|identity_scope_key|challenge|session/i);
    assert.deepEqual(response.json().accountLinks[0], {
      playerId: "9007199254740993",
      playerRole: "REPRESENTATIVE",
      linkStatus: "ACTIVE",
      portalAccountStatus: "ACTIVE",
      maskedLoginId: "s********d",
      platformCode: "KAKAO",
      contextType: "ROOM",
      selectionStatus: "ACTIVE",
      maskedExternalUserKey: "s********y",
    });
    assert.equal("portalAccountId" in response.json().accountLinks[0], false);
    assert.equal("portalGameAccountLinkId" in response.json().accountLinks[0], false);
    assert.equal("selectionVersion" in response.json().accountLinks[0], false);
    const accountLinkProjection = (queries[1] ?? "").split(/\sFROM\s/i)[0] ?? "";
    assert.doesNotMatch(accountLinkProjection, /portal\.portal_account_id|link\.portal_game_account_link_id|selection\.selection_version/i);
    assert.equal(queries.length, 2);
    assert.equal(queries.every((sql) => /^\s*SELECT\b/i.test(sql)), true);
    assert.equal(queries.join(" ").match(/\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP)\b/gi), null);
    await app.close();
  });
});
