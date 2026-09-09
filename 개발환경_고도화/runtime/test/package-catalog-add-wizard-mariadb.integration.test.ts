import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { PackageCatalogAddWizardService } from "../src/package/package-catalog-add-wizard-service.js";
import { MariaDbPackageCatalogAddWizardRepository } from "../src/package/mariadb-package-catalog-add-wizard.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
const operatorId = "900000210";
let database: DatabaseClient;
let service: PackageCatalogAddWizardService;

async function execute(requestKey: string, command: Parameters<PackageCatalogAddWizardService["execute"]>[0]["command"]) {
  return service.execute({ operatorId, requestKey, command });
}

(configured ? describe : describe.skip)("package catalog add wizard MariaDB integration", () => {
  before(async () => {
    database = createDatabaseClient({
      enabled: true,
      host: required("DATABASE_HOST"),
      port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"),
      name: required("DATABASE_NAME"),
      connectionLimit: 5,
      connectTimeoutMs: 5_000,
    });
    await database.execute(
      `INSERT INTO admin_operators(id,login_id,display_name,password_hash,status)
       VALUES (?, 'package_wizard_admin', '패키지마법사관리자', 'synthetic-not-for-login', 'active')
       ON DUPLICATE KEY UPDATE status='active'`,
      [operatorId],
    );
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES ('package_wizard_admin','패키지 마법사 관리자',1) ON DUPLICATE KEY UPDATE active=1");
    const roles = await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='package_wizard_admin'");
    await database.execute("INSERT IGNORE INTO admin_role_permissions(role_id,permission_code) VALUES (?,'package.catalog.manage')", [roles[0]!.id]);
    await database.execute("INSERT IGNORE INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operatorId, roles[0]!.id]);
    await database.execute(
      `INSERT INTO package_item_definitions(item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
       VALUES ('ITEM-WIZARD-SYNTH','STACK','마법사합성보상',1,'{}',1,1)
       ON DUPLICATE KEY UPDATE enabled=1`,
    );
    service = new PackageCatalogAddWizardService(new MariaDbPackageCatalogAddWizardRepository(database, "990000000000210"));
  });

  after(async () => {
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("persists a started session and restores it through a new service instance", async () => {
    const started = await execute("wizard-start", { kind: "START" });
    assert.equal(started.session?.draft.step, "NAME");
    await execute("wizard-name", { kind: "FLOW", text: "합성 단계 패키지" });
    service = new PackageCatalogAddWizardService(new MariaDbPackageCatalogAddWizardRepository(database, "990000000000210"));
    const status = await execute("wizard-status", { kind: "STATUS" });
    assert.match(status.message, /합성 단계 패키지/);
  });

  it("keeps an identical transition idempotent", async () => {
    const first = await execute("wizard-description", { kind: "FLOW", text: "DB 재시작 복구 설명" });
    const replay = await execute("wizard-description", { kind: "FLOW", text: "다른 설명" });
    assert.equal(first.session?.draft.description, "DB 재시작 복구 설명");
    assert.equal(replay.replayed, true);
    assert.equal(replay.session?.draft.description, "DB 재시작 복구 설명");
  });

  it("stores point and item rewards then commits through the catalog provider", async () => {
    await execute("wizard-point-choice", { kind: "FLOW", text: "포인트" });
    await execute("wizard-point-count", { kind: "FLOW", text: "2500" });
    await execute("wizard-item-choice", { kind: "FLOW", text: "아이템" });
    await execute("wizard-item-name", { kind: "FLOW", text: "마법사합성보상" });
    await execute("wizard-item-count", { kind: "FLOW", text: "3" });
    await execute("wizard-done", { kind: "FLOW", text: "완료" });
    const finalKey = "wizard-finalize";
    await database.execute(
      `INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at)
       VALUES (?,'iris',?,'message','test','incoming',REPEAT('c',64),'parsed','processing',UTC_TIMESTAMP(3))`,
      [finalKey, finalKey],
    );
    const result = await execute(finalKey, { kind: "FLOW", text: "등록" });
    assert.match(result.packageId ?? "", /^PKG-CUSTOM-/);
    const rows = await database.query<Array<{ reward_count: bigint; point_quantity: bigint; item_quantity: bigint; session_status: string }>>(
      `SELECT
       (SELECT COUNT(*) FROM package_reward_rules WHERE package_id=?) AS reward_count,
       (SELECT quantity FROM package_reward_rules WHERE package_id=? AND item_id='ITEM-RWD-011') AS point_quantity,
       (SELECT quantity FROM package_reward_rules WHERE package_id=? AND item_id='ITEM-WIZARD-SYNTH') AS item_quantity,
       (SELECT status FROM package_catalog_wizard_sessions WHERE operator_id=? AND flow_code='PACKAGE_CATALOG_ADD_WIZARD') AS session_status`,
      [result.packageId, result.packageId, result.packageId, operatorId],
    );
    assert.deepEqual(rows[0], { reward_count: 2n, point_quantity: 2500n, item_quantity: 3n, session_status: "COMMITTED" });
  });

  it("replays final registration without another package, mutation or outbox", async () => {
    const replay = await execute("wizard-finalize", { kind: "FLOW", text: "등록" });
    assert.equal(replay.replayed, true);
    const rows = await database.query<Array<{ result_count: bigint; mutation_count: bigint; outbox_count: bigint }>>(
      `SELECT
       (SELECT COUNT(*) FROM package_catalog_wizard_results WHERE request_key='wizard-finalize') AS result_count,
       (SELECT COUNT(*) FROM package_catalog_mutations WHERE request_key='wizard-finalize') AS mutation_count,
       (SELECT COUNT(*) FROM outbox_messages WHERE destination_id='990000000000210') AS outbox_count`,
    );
    assert.deepEqual(rows[0], { result_count: 1n, mutation_count: 1n, outbox_count: 1n });
  });

  it("cancels a new session without changing the catalog", async () => {
    const before = await database.query<Array<{ version: bigint }>>("SELECT version FROM package_catalog_heads WHERE catalog_key='PACKAGE_CATALOG'");
    await execute("wizard-restart", { kind: "START" });
    const cancelled = await execute("wizard-cancel", { kind: "CANCEL" });
    const after = await database.query<Array<{ version: bigint; status: string }>>(
      `SELECT head.version,
       (SELECT status FROM package_catalog_wizard_sessions WHERE operator_id=? AND flow_code='PACKAGE_CATALOG_ADD_WIZARD') AS status
       FROM package_catalog_heads head WHERE head.catalog_key='PACKAGE_CATALOG'`,
      [operatorId],
    );
    assert.match(cancelled.message, /취소/);
    assert.equal(after[0]?.version, before[0]?.version);
    assert.equal(after[0]?.status, "CANCELLED");
  });
});
