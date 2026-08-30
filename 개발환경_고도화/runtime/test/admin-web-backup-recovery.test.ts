import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ADMIN_WEB_CLIENT, ADMIN_WEB_HTML } from "../src/admin/web-shell-assets.js";
import { buildRestoreConfirmationToken, DataRestoreService } from "../src/admin/data-restore-service.js";
import { ManagedBackupCommandService } from "../src/admin/managed-backup-command-service.js";
import { DataBackupService } from "../src/admin/data-backup-service.js";
import { buildSyntheticAdminWebShellApp } from "./support/admin-web-shell-preview.js";

const csrf = "synthetic-csrf-token";

async function login(app: Awaited<ReturnType<typeof buildSyntheticAdminWebShellApp>>) {
  const response = await app.inject({ method: "POST", url: "/api/v1/admin/sessions", payload: { loginId: "shadow.manager", password: "synthetic" } });
  assert.equal(response.statusCode, 200);
}

describe("admin web backup recovery", () => {
  it("freezes permission, route, dry-run, confirmation, and no-web-outbox contracts", () => {
    for (const value of ["managed_backup.execute", "data_backup.execute", "data_restore.execute", "/api/v1/admin/backups/managed", "/api/v1/admin/backups/dev-sync", "/api/v1/admin/restores/preview", "/api/v1/admin/restores"]) assert.match(ADMIN_WEB_CLIENT, new RegExp(value.replaceAll(".", "\\.")));
    assert.match(ADMIN_WEB_CLIENT, /confirmationToken/);
    assert.match(ADMIN_WEB_CLIENT, /dry-run/);
    assert.match(ADMIN_WEB_CLIENT, /"x-csrf-token"/);
    assert.match(ADMIN_WEB_CLIENT, /"idempotency-key"/);
    assert.match(ADMIN_WEB_HTML + ADMIN_WEB_CLIENT, /Iris outbox/);
  });

  it("executes immutable managed backup with validation, replay, and audit rollback", async () => {
    const app = await buildSyntheticAdminWebShellApp();
    try {
      await login(app);
      const missingCsrf = await app.inject({ method: "POST", url: "/api/v1/admin/backups/managed", headers: { "idempotency-key": "missing-csrf" }, payload: { reason: "합성", confirmed: true } });
      assert.equal(missingCsrf.statusCode, 403);
      const request = { method: "POST" as const, url: "/api/v1/admin/backups/managed", headers: { "x-csrf-token": csrf, "idempotency-key": "managed-replay" }, payload: { reason: "합성 manifest 백업", confirmed: true } };
      const first = await app.inject(request);
      const replay = await app.inject(request);
      assert.equal(first.statusCode, 201);
      assert.equal(replay.statusCode, 200);
      assert.equal(first.json().runId, replay.json().runId);
      assert.equal(first.json().sourceRevisionKey, replay.json().sourceRevisionKey);
      assert.equal(first.json().outboxId, null);
      const rollback = await app.inject({ ...request, headers: { ...request.headers, "idempotency-key": "managed-rollback", "x-synthetic-audit-failure": "true" } });
      assert.equal(rollback.statusCode, 500);
    } finally { await app.close(); }
  });

  it("keeps PROD to DEV sync behind its own permission and idempotency scope", async () => {
    const app = await buildSyntheticAdminWebShellApp();
    try {
      await login(app);
      const denied = await app.inject({ method: "POST", url: "/api/v1/admin/backups/dev-sync", headers: { "x-csrf-token": csrf, "idempotency-key": "denied", "x-synthetic-permission": "deny" }, payload: { reason: "합성 DEV 동기화", confirmed: true } });
      assert.equal(denied.statusCode, 403);
      const request = { method: "POST" as const, url: "/api/v1/admin/backups/dev-sync", headers: { "x-csrf-token": csrf, "idempotency-key": "dev-sync-replay" }, payload: { reason: "합성 DEV 동기화", confirmed: true } };
      const first = await app.inject(request);
      const replay = await app.inject(request);
      assert.equal(first.statusCode, 201);
      assert.equal(first.json().runId, replay.json().runId);
      assert.deepEqual(first.json().copiedFiles, ["member.json", "member_pet.json"]);
    } finally { await app.close(); }
  });

  it("previews restore source hash and current revision without mutation", async () => {
    const app = await buildSyntheticAdminWebShellApp();
    try {
      await login(app);
      const request = { method: "POST" as const, url: "/api/v1/admin/restores/preview", headers: { "x-csrf-token": csrf }, payload: { environment: "dev", target: "member", generation: 1 } };
      const first = await app.inject(request);
      const second = await app.inject(request);
      assert.equal(first.statusCode, 200);
      assert.equal(first.json().preview.available, true);
      assert.equal(first.json().preview.beforeRevision, second.json().preview.beforeRevision);
      assert.equal(first.json().preview.confirmationToken, second.json().preview.confirmationToken);
      const unavailable = await app.inject({ ...request, headers: { ...request.headers, "x-synthetic-backup-unavailable": "true" } });
      assert.equal(unavailable.json().preview.available, false);
    } finally { await app.close(); }
  });

  it("rejects stale restore and preserves snapshot, audit, rollback, and replay semantics", async () => {
    const app = await buildSyntheticAdminWebShellApp();
    try {
      await login(app);
      const preview = await app.inject({ method: "POST", url: "/api/v1/admin/restores/preview", headers: { "x-csrf-token": csrf }, payload: { environment: "dev", target: "member", generation: 1 } });
      const base = { method: "POST" as const, url: "/api/v1/admin/restores", payload: { environment: "dev", target: "member", generation: 1, reason: "합성 복구", confirmed: true } };
      const stale = await app.inject({ ...base, headers: { "x-csrf-token": csrf, "idempotency-key": "stale" }, payload: { ...base.payload, confirmationToken: "sha256:stale" } });
      assert.equal(stale.statusCode, 409);
      const rollback = await app.inject({ ...base, headers: { "x-csrf-token": csrf, "idempotency-key": "restore-rollback", "x-synthetic-snapshot-failure": "true" }, payload: { ...base.payload, confirmationToken: preview.json().preview.confirmationToken } });
      assert.equal(rollback.statusCode, 500);
      const afterRollback = await app.inject({ method: "POST", url: "/api/v1/admin/restores/preview", headers: { "x-csrf-token": csrf }, payload: { environment: "dev", target: "member", generation: 1 } });
      assert.equal(afterRollback.json().preview.beforeRevision, preview.json().preview.beforeRevision);
      const request = { ...base, headers: { "x-csrf-token": csrf, "idempotency-key": "restore-replay" }, payload: { ...base.payload, confirmationToken: preview.json().preview.confirmationToken } };
      const restored = await app.inject(request);
      const replay = await app.inject(request);
      assert.equal(restored.statusCode, 200);
      assert.equal(restored.json().snapshotId, replay.json().snapshotId);
      assert.equal(restored.json().auditId, replay.json().auditId);
      assert.equal(restored.json().afterRevision, "13");
      assert.equal(restored.json().outboxId, null);
    } finally { await app.close(); }
  });

  it("reuses the three existing services and produces deterministic restore tokens", () => {
    assert.equal(typeof ManagedBackupCommandService.prototype.backupForOperator, "function");
    assert.equal(typeof DataBackupService.prototype.backupForOperator, "function");
    assert.equal(typeof DataRestoreService.prototype.previewForOperator, "function");
    assert.equal(typeof DataRestoreService.prototype.restoreForOperator, "function");
    const input = { environment: "dev" as const, target: "member" as const, generation: 1 as const, sourceRevisionKey: "revision", sourceHash: "hash", beforeRevision: "12" };
    assert.equal(buildRestoreConfirmationToken(input), buildRestoreConfirmationToken(input));
    assert.notEqual(buildRestoreConfirmationToken(input), buildRestoreConfirmationToken({ ...input, beforeRevision: "13" }));
  });
});
