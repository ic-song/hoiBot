import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import type { PackageCatalogWizardDraft } from "../src/package/package-catalog-add-wizard.js";
import { MariaDbPackageCatalogAddWizardRepository } from "../src/package/mariadb-package-catalog-add-wizard.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
const operatorId = "900000212";
let database: DatabaseClient;

function connect(): DatabaseClient {
  return createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
}

(configured ? describe : describe.skip)("package catalog add wizard recovery and concurrency", () => {
  before(async () => {
    database = connect();
    await database.execute(
      `INSERT INTO admin_operators(id,login_id,display_name,password_hash,status)
       VALUES (?, 'package_wizard_recovery', '패키지마법사복구관리자', 'synthetic-not-for-login', 'active')
       ON DUPLICATE KEY UPDATE status='active'`,
      [operatorId],
    );
  });

  after(async () => {
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("accepts only one transition for the same session version", async () => {
    const repository = new MariaDbPackageCatalogAddWizardRepository(database);
    await repository.start({ operatorId, requestKey: "wizard-race-start", now: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    const active = await repository.readActive(operatorId, new Date());
    assert.ok(active);
    const draftA: PackageCatalogWizardDraft = { ...active.draft, step: "DESC", name: "경쟁 입력 A" };
    const draftB: PackageCatalogWizardDraft = { ...active.draft, step: "DESC", name: "경쟁 입력 B" };
    const outcomes = await Promise.allSettled([
      repository.transition({ operatorId, requestKey: "wizard-race-a", expectedVersion: active.version, draft: draftA, message: "A" }),
      repository.transition({ operatorId, requestKey: "wizard-race-b", expectedVersion: active.version, draft: draftB, message: "B" }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
    const saved = await repository.readActive(operatorId, new Date());
    assert.ok(saved?.draft.name === "경쟁 입력 A" || saved?.draft.name === "경쟁 입력 B");
    assert.equal(saved?.version, active.version + 1n);
  });

  it("restores the exact active draft after the database client restarts", async () => {
    const before = await new MariaDbPackageCatalogAddWizardRepository(database).readActive(operatorId, new Date());
    assert.ok(before);
    await database.close();
    database = connect();
    const restored = await new MariaDbPackageCatalogAddWizardRepository(database).readActive(operatorId, new Date());
    assert.equal(restored?.sessionId, before.sessionId);
    assert.equal(restored?.version, before.version);
    assert.deepEqual(restored?.draft, before.draft);
  });
});
