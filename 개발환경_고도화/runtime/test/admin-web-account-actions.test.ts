import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ADMIN_WEB_CLIENT, ADMIN_WEB_HTML } from "../src/admin/web-shell-assets.js";
import { syntheticAdminPlayer } from "./fixtures/admin-web-shell.js";
import { buildSyntheticAdminWebShellApp } from "./support/admin-web-shell-preview.js";

const mutationHeaders = {
  "x-csrf-token": "synthetic-csrf-token",
  "idempotency-key": "synthetic-account-action-001"
};

describe("admin web account actions", () => {
  it("freezes the permission, confirmation, csrf, idempotency, and notification-gap client contract", () => {
    assert.match(ADMIN_WEB_CLIENT, /account\.restrict/);
    assert.match(ADMIN_WEB_CLIENT, /"x-csrf-token"/);
    assert.match(ADMIN_WEB_CLIENT, /"idempotency-key"/);
    assert.match(ADMIN_WEB_CLIENT, /confirmed: true/);
    assert.match(ADMIN_WEB_CLIENT, /\/api\/v1\/admin\/players\/.*\/restrictions/);
    assert.match(ADMIN_WEB_CLIENT, /\/api\/v1\/admin\/restrictions\//);
    assert.match(ADMIN_WEB_CLIENT, /"PATCH"/);
    assert.match(ADMIN_WEB_HTML + ADMIN_WEB_CLIENT, /별도 알림은 발송하지 않습니다/);
  });

  it("covers temporary, permanent, revoke, not-found, replay, permission, csrf, and rollback scenarios", async () => {
    const app = await buildSyntheticAdminWebShellApp();
    try {
      const beforeLogin = await app.inject({ method: "GET", url: "/api/v1/admin/sessions/current" });
      assert.equal(beforeLogin.statusCode, 401);
      const login = await app.inject({ method: "POST", url: "/api/v1/admin/sessions", payload: { loginId: "shadow.manager", password: "synthetic" } });
      assert.equal(login.statusCode, 200);

      const missingCsrf = await app.inject({
        method: "POST", url: `/api/v1/admin/players/${syntheticAdminPlayer.playerId}/restrictions`,
        headers: { "idempotency-key": "missing-csrf" },
        payload: { restrictionType: "permanent_suspension", reason: "합성 CSRF 검증", confirmed: true }
      });
      assert.equal(missingCsrf.statusCode, 403);

      const denied = await app.inject({
        method: "POST", url: `/api/v1/admin/players/${syntheticAdminPlayer.playerId}/restrictions`,
        headers: { ...mutationHeaders, "x-synthetic-permission": "deny", "idempotency-key": "permission-denied" },
        payload: { restrictionType: "permanent_suspension", reason: "합성 권한 검증", confirmed: true }
      });
      assert.equal(denied.statusCode, 403);

      const tempWithoutEnd = await app.inject({
        method: "POST", url: `/api/v1/admin/players/${syntheticAdminPlayer.playerId}/restrictions`, headers: { ...mutationHeaders, "idempotency-key": "temp-no-end" },
        payload: { restrictionType: "temporary_suspension", reason: "합성 종료 시각 검증", confirmed: true }
      });
      assert.equal(tempWithoutEnd.statusCode, 422);

      const temporaryRequest = {
        method: "POST" as const, url: `/api/v1/admin/players/${syntheticAdminPlayer.playerId}/restrictions`, headers: { ...mutationHeaders, "idempotency-key": "temporary-replay" },
        payload: { restrictionType: "temporary_suspension", endsAt: "2026-09-30T00:00:00.000Z", reason: "합성 기간 정지", confirmed: true }
      };
      const temporary = await app.inject(temporaryRequest);
      const temporaryReplay = await app.inject(temporaryRequest);
      assert.equal(temporary.statusCode, 201);
      assert.equal(temporaryReplay.statusCode, 200);
      assert.equal(temporary.json().restrictionId, temporaryReplay.json().restrictionId);
      assert.equal(temporary.json().auditId, temporaryReplay.json().auditId);

      const permanent = await app.inject({
        method: "POST", url: `/api/v1/admin/players/${syntheticAdminPlayer.playerId}/restrictions`, headers: { ...mutationHeaders, "idempotency-key": "permanent" },
        payload: { restrictionType: "permanent_suspension", reason: "합성 영구 정지", confirmed: true }
      });
      assert.equal(permanent.statusCode, 201);
      assert.equal(permanent.json().endsAt, null);

      const missingRestriction = await app.inject({
        method: "PATCH", url: "/api/v1/admin/restrictions/999999", headers: { ...mutationHeaders, "idempotency-key": "missing-restriction" },
        payload: { status: "revoked", reason: "합성 not-found", confirmed: true }
      });
      assert.equal(missingRestriction.statusCode, 404);

      const revokeRequest = {
        method: "PATCH" as const, url: `/api/v1/admin/restrictions/${permanent.json().restrictionId}`, headers: { ...mutationHeaders, "idempotency-key": "revoke-replay" },
        payload: { status: "revoked", reason: "합성 제재 해제", confirmed: true }
      };
      const revoked = await app.inject(revokeRequest);
      const revokedReplay = await app.inject(revokeRequest);
      assert.equal(revoked.statusCode, 200);
      assert.equal(revokedReplay.statusCode, 200);
      assert.equal(revoked.json().auditId, revokedReplay.json().auditId);

      const beforeRollback = await app.inject({ method: "GET", url: `/api/v1/admin/players/${syntheticAdminPlayer.playerId}` });
      const rollback = await app.inject({
        method: "POST", url: `/api/v1/admin/players/${syntheticAdminPlayer.playerId}/restrictions`,
        headers: { ...mutationHeaders, "idempotency-key": "audit-rollback", "x-synthetic-audit-failure": "true" },
        payload: { restrictionType: "permanent_suspension", reason: "합성 롤백 대상", confirmed: true }
      });
      const afterRollback = await app.inject({ method: "GET", url: `/api/v1/admin/players/${syntheticAdminPlayer.playerId}` });
      assert.equal(rollback.statusCode, 500);
      assert.deepEqual(afterRollback.json().player.restrictions, beforeRollback.json().player.restrictions);
      assert.equal(afterRollback.json().player.restrictions.some((restriction: { reason: string }) => restriction.reason === "합성 롤백 대상"), false);
    } finally {
      await app.close();
    }
  });
});
