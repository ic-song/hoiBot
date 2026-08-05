import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { readAuthorization, requirePermission, type AdminSession } from "../src/admin/auth-service.js";
import type { DatabaseClient } from "../src/database.js";

function authorizationDatabase(): DatabaseClient {
  return {
    async ping() {}, async verifyRollback() { return true; }, async close() {},
    async execute() { return { affectedRows: 0n, insertId: 0n }; },
    async withTransaction() { throw new Error("not used"); },
    async query<T>(sql: string) {
      if (sql.includes("SELECT role.code")) return [{ code: "manager" }] as T;
      if (sql.includes("SELECT DISTINCT permission.code")) return [{ code: "pass.read" }, { code: "player.read" }] as T;
      if (sql.includes("admin_operator_permission_overrides")) return [
        { permission_code: "player.read", effect: "deny" },
        { permission_code: "game.currency.change", effect: "allow" }
      ] as T;
      throw new Error(`unexpected query: ${sql}`);
    }
  };
}

describe("admin authorization", () => {
  it("applies deny before personal allow and role permissions", async () => {
    const authorization = await readAuthorization(authorizationDatabase(), "1");
    assert.deepEqual(authorization.roleCodes, ["manager"]);
    assert.deepEqual(authorization.permissions, ["game.currency.change", "pass.read"]);
  });

  it("rejects a permission removed by an override", () => {
    const session: AdminSession = { sessionId: "1", operatorId: "1", loginId: "manager", displayName: "매니저", roleCodes: ["manager"], permissions: ["pass.read"] };
    assert.throws(() => requirePermission(session, "player.read"), /권한/);
  });

  it("exposes noun-based REST session and administration resources only", async () => {
    const [adminRoutes, userRoutes] = await Promise.all([
      readFile(new URL("../src/admin/routes.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/user-auth/routes.ts", import.meta.url), "utf8")
    ]);
    assert.match(adminRoutes, /\/api\/v1\/admin\/sessions\/current/);
    assert.match(adminRoutes, /\/api\/v1\/admin\/players\/:playerId\/server-assignment/);
    assert.match(adminRoutes, /\/api\/v1\/admin\/external-identities\/:identityId\/player-assignment/);
    assert.doesNotMatch(adminRoutes, /\/auth\/login|\/approve|\/:playerId\/server["`]/);
    assert.match(userRoutes, /\/api\/v1\/sessions\/current/);
    assert.doesNotMatch(userRoutes, /\/auth\/login|\/auth\/session/);
  });
});
