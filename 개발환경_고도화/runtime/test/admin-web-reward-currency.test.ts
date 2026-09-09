import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ADMIN_WEB_CLIENT } from "../src/admin/web-shell-assets.js";
import { syntheticAdminPlayer } from "./fixtures/admin-web-shell.js";
import { buildSyntheticAdminWebShellApp } from "./support/admin-web-shell-preview.js";

const headers = {
  "x-csrf-token": "synthetic-csrf-token",
  "idempotency-key": "synthetic-currency-adjust-001"
};

describe("admin web reward currency consumer", () => {
  it("freezes the versioned CurrencyService.adjust web contract", () => {
    assert.match(ADMIN_WEB_CLIENT, /game\.currency\.change/);
    assert.match(ADMIN_WEB_CLIENT, /currencyAccounts/);
    assert.match(ADMIN_WEB_CLIENT, /expectedVersion/);
    assert.match(ADMIN_WEB_CLIENT, /delta: delta/);
    assert.match(ADMIN_WEB_CLIENT, /\/currencies\//);
    assert.match(ADMIN_WEB_CLIENT, /\/adjustments/);
    assert.match(ADMIN_WEB_CLIENT, /원장·감사·내부 outbox/);
    assert.ok(ADMIN_WEB_CLIENT.includes('/^(?:0|[1-9]\\d*)(?:\\.\\d{1,3})?$/.test(amount)'));
    assert.doesNotMatch(ADMIN_WEB_CLIENT, /generic.*grant/i);
  });

  it("covers add, subtract, replay, conflict, insufficient balance, permission, csrf, and rollback", async () => {
    const app = await buildSyntheticAdminWebShellApp();
    try {
      await app.inject({ method: "POST", url: "/api/v1/admin/sessions", payload: { loginId: "shadow.manager", password: "synthetic" } });
      const path = `/api/v1/admin/players/${syntheticAdminPlayer.playerId}/currencies/diamond/adjustments`;

      const missingCsrf = await app.inject({ method: "POST", url: path, headers: { "idempotency-key": "currency-missing-csrf" }, payload: { delta: "1", expectedVersion: "4", reason: "CSRF 검증", confirmed: true } });
      assert.equal(missingCsrf.statusCode, 403);

      const denied = await app.inject({ method: "POST", url: path, headers: { ...headers, "x-synthetic-permission": "deny", "idempotency-key": "currency-denied" }, payload: { delta: "1", expectedVersion: "4", reason: "권한 검증", confirmed: true } });
      assert.equal(denied.statusCode, 403);

      const zero = await app.inject({ method: "POST", url: path, headers: { ...headers, "idempotency-key": "currency-zero" }, payload: { delta: "0", expectedVersion: "4", reason: "0 검증", confirmed: true } });
      assert.equal(zero.statusCode, 422);

      const stale = await app.inject({ method: "POST", url: path, headers: { ...headers, "idempotency-key": "currency-stale" }, payload: { delta: "10", expectedVersion: "3", reason: "충돌 검증", confirmed: true } });
      assert.equal(stale.statusCode, 409);

      const insufficient = await app.inject({ method: "POST", url: path, headers: { ...headers, "idempotency-key": "currency-insufficient" }, payload: { delta: "-351", expectedVersion: "4", reason: "잔액 검증", confirmed: true } });
      assert.equal(insufficient.statusCode, 409);

      for (const failureHeader of ["x-synthetic-audit-failure", "x-synthetic-outbox-failure"] as const) {
        const before = await app.inject({ method: "GET", url: `/api/v1/admin/players/${syntheticAdminPlayer.playerId}` });
        const failed = await app.inject({ method: "POST", url: path, headers: { ...headers, "idempotency-key": `currency-${failureHeader}`, [failureHeader]: "true" }, payload: { delta: "10", expectedVersion: "4", reason: "트랜잭션 롤백", confirmed: true } });
        const after = await app.inject({ method: "GET", url: `/api/v1/admin/players/${syntheticAdminPlayer.playerId}` });
        assert.equal(failed.statusCode, 500);
        assert.deepEqual(after.json().player.currencyAccounts, before.json().player.currencyAccounts);
      }

      const request = { method: "POST" as const, url: path, headers: { ...headers, "idempotency-key": "currency-replay" }, payload: { delta: "50", expectedVersion: "4", reason: "합성 다이아 증가", confirmed: true } };
      const added = await app.inject(request);
      const replayed = await app.inject(request);
      assert.equal(added.statusCode, 200);
      assert.deepEqual(replayed.json(), { ...added.json(), requestId: "synthetic-replay" });
      assert.equal(added.json().balance, "400");
      assert.equal(added.json().version, "5");

      const subtracted = await app.inject({ method: "POST", url: path, headers: { ...headers, "idempotency-key": "currency-subtract" }, payload: { delta: "-25", expectedVersion: "5", reason: "합성 다이아 차감", confirmed: true } });
      assert.equal(subtracted.statusCode, 200);
      assert.equal(subtracted.json().balance, "375");
      assert.equal(subtracted.json().version, "6");

      const detail = await app.inject({ method: "GET", url: `/api/v1/admin/players/${syntheticAdminPlayer.playerId}` });
      assert.deepEqual(detail.json().player.currencyAccounts[0], { code: "diamond", balance: "375", version: "6" });
      assert.equal(detail.json().player.currencies.diamond, "375");

      const missing = await app.inject({ method: "POST", url: "/api/v1/admin/players/999999/currencies/diamond/adjustments", headers: { ...headers, "idempotency-key": "currency-player-missing" }, payload: { delta: "1", expectedVersion: "0", reason: "대상 검증", confirmed: true } });
      assert.equal(missing.statusCode, 404);
    } finally {
      await app.close();
    }
  });
});
