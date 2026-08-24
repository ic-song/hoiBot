import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { parsePackageCatalogAdminCommand } from "../src/package/package-catalog-admin-command.js";
import { PackageCatalogAdminService } from "../src/package/package-catalog-admin-service.js";
import { MariaPackageCatalogAdminRepository } from "../src/package/mariadb-package-catalog-admin.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
const operatorId = "900000010";
const deniedOperatorId = "900000011";
let database: DatabaseClient;
let service: PackageCatalogAdminService;
let addedCatalogVersion: bigint;

async function execute(message: string, requestKey: string, expectedCatalogVersion?: bigint) {
  await database.execute(
    `INSERT INTO event_inbox
     (event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at)
     VALUES (?,'iris',?,'message','test','incoming',REPEAT('a',64),'parsed','processing',UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE event_id=VALUES(event_id)`,
    [requestKey, requestKey],
  );
  const command = parsePackageCatalogAdminCommand(message);
  assert.ok(command);
  return service.execute({ command, requestKey, actorOperatorId: operatorId, expectedCatalogVersion, replyDestinationId: "990000000000090" });
}

(configured ? describe : describe.skip)("package catalog admin MariaDB integration", () => {
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
       VALUES (?, 'package_admin', '패키지관리자', 'synthetic-not-for-login', 'active'),
              (?, 'package_denied', '권한없는관리자', 'synthetic-not-for-login', 'active')
       ON DUPLICATE KEY UPDATE status='active'`,
      [operatorId, deniedOperatorId],
    );
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES ('package_catalog_admin','패키지 카탈로그 관리자',1) ON DUPLICATE KEY UPDATE active=1");
    const roles = await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='package_catalog_admin'");
    const roleId = roles[0]!.id;
    await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES (?,'package.catalog.manage') ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code)", [roleId]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?) ON DUPLICATE KEY UPDATE role_id=VALUES(role_id)", [operatorId, roleId]);
    await database.execute(
      "INSERT INTO package_item_definitions(item_id,item_type,item_name,stackable,metadata_json,enabled,row_version) VALUES ('ITEM-SYNTH-REWARD','ITEM','합성보상',1,'{}',1,1) ON DUPLICATE KEY UPDATE enabled=1",
    );
    await database.execute(
      "INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES ('ITEM-SYNTH-REWARD','합성보상','ITEM',1,'{}',1,1) ON DUPLICATE KEY UPDATE active=1",
    );
    service = new PackageCatalogAdminService(new MariaPackageCatalogAdminRepository(database));
  });

  after(async () => {
    try {
      await database.close();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("commits add with catalog, reward, audit and outbox in one operation", async () => {
    const before = await new MariaPackageCatalogAdminRepository(database).readSnapshot();
    const beforeAudit = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM command_audit WHERE action_code='PACKAGE_CATALOG_ADD'");
    const result = await execute("/패키지추가 합성 관리자 패키지 | 합성 설명 | item:합성보상:2", "catalog-admin-add");
    addedCatalogVersion = before.catalogVersion + 1n;
    assert.equal(result.catalogVersion, addedCatalogVersion);
    assert.match(result.packageId, /^PKG-CUSTOM-/);
    const rows = await database.query<Array<{ package_count: bigint; reward_count: bigint; audit_count: bigint; outbox_count: bigint }>>(
      `SELECT
       (SELECT COUNT(*) FROM package_catalog WHERE package_id=?) AS package_count,
       (SELECT COUNT(*) FROM package_reward_rules WHERE package_id=?) AS reward_count,
       (SELECT COUNT(*) FROM command_audit WHERE action_code='PACKAGE_CATALOG_ADD') AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages WHERE destination_id='990000000000090') AS outbox_count`,
      [result.packageId, result.packageId],
    );
    assert.deepEqual(rows[0], { package_count: 1n, reward_count: 1n, audit_count: beforeAudit[0]!.count + 1n, outbox_count: 1n });
  });

  it("replays the same request without another version, audit or outbox", async () => {
    const replay = await execute("/패키지추가 합성 관리자 패키지 | 합성 설명 | item:합성보상:2", "catalog-admin-add");
    assert.equal(replay.replayed, true);
    assert.equal(replay.catalogVersion, addedCatalogVersion);
    const counts = await database.query<Array<{ mutations: bigint; outbox: bigint }>>(
      `SELECT
       (SELECT COUNT(*) FROM package_catalog_mutations WHERE request_key='catalog-admin-add') AS mutations,
       (SELECT COUNT(*) FROM outbox_messages WHERE destination_id='990000000000090') AS outbox`,
    );
    assert.deepEqual(counts[0], { mutations: 1n, outbox: 1n });
  });

  it("replaces rewards, tombstones removal and compacts projection order", async () => {
    const snapshot = await new MariaPackageCatalogAdminRepository(database).readSnapshot();
    const listNumber = snapshot.entries.findIndex((entry) => entry.displayName === "합성 관리자 패키지") + 1;
    assert.ok(listNumber > 0);
    const edited = await execute(`/패키지수정 ${listNumber} | item:합성보상:3`, "catalog-admin-edit");
    assert.equal(edited.catalogVersion, addedCatalogVersion + 1n);
    const removed = await execute(`/패키지리스트제거 ${listNumber}`, "catalog-admin-remove");
    assert.equal(removed.catalogVersion, addedCatalogVersion + 2n);
    const rows = await database.query<Array<{ enabled: number; deleted: number; reward_quantity: bigint }>>(
      `SELECT catalog.enabled,catalog.deleted_at IS NOT NULL AS deleted,
              (SELECT quantity FROM package_reward_rules WHERE package_id=catalog.package_id LIMIT 1) AS reward_quantity
       FROM package_catalog catalog WHERE package_id=?`,
      [removed.packageId],
    );
    assert.deepEqual(rows[0], { enabled: 0, deleted: 1, reward_quantity: 3n });
    const after = await new MariaPackageCatalogAdminRepository(database).readSnapshot();
    assert.equal(after.entries.some((entry) => entry.packageId === removed.packageId), false);
    assert.deepEqual(after.entries.map((entry) => entry.displayOrder), after.entries.map((_, index) => index + 1));
  });

  it("enables an existing package and increments the locked head version", async () => {
    const snapshot = await new MariaPackageCatalogAdminRepository(database).readSnapshot();
    const disabledIndex = snapshot.entries.findIndex((entry) => !entry.active);
    assert.ok(disabledIndex >= 0);
    const result = await execute(`/패키지활성 ${disabledIndex + 1}`, "catalog-admin-enable");
    assert.equal(result.catalogVersion, addedCatalogVersion + 3n);
    const rows = await database.query<Array<{ enabled: number }>>("SELECT enabled FROM package_catalog WHERE package_id=?", [result.packageId]);
    assert.equal(rows[0]?.enabled, 1);
  });

  it("rejects stale version, missing permission and invalid reward without partial writes", async () => {
    const before = await database.query<Array<{ version: bigint; operations: bigint }>>(
      "SELECT version,(SELECT COUNT(*) FROM operations) AS operations FROM package_catalog_heads WHERE catalog_key='PACKAGE_CATALOG'",
    );
    await assert.rejects(() => execute("/패키지활성 1", "catalog-admin-stale", before[0]!.version - 1n), /먼저 변경/);
    const command = parsePackageCatalogAdminCommand("/패키지활성 1");
    assert.ok(command);
    await assert.rejects(() => service.execute({ command, requestKey: "catalog-admin-denied", actorOperatorId: deniedOperatorId }), /권한/);
    await assert.rejects(() => execute("/패키지추가 실패 패키지 | 설명 | item:없는보상:1", "catalog-admin-rollback"), /보상 아이템/);
    const after = await database.query<Array<{ version: bigint; operations: bigint; failed_package: bigint }>>(
      `SELECT version,(SELECT COUNT(*) FROM operations) AS operations,
       (SELECT COUNT(*) FROM package_catalog WHERE display_name='실패 패키지') AS failed_package
       FROM package_catalog_heads WHERE catalog_key='PACKAGE_CATALOG'`,
    );
    assert.equal(after[0]?.version, before[0]?.version);
    assert.equal(after[0]?.operations, before[0]?.operations);
    assert.equal(after[0]?.failed_package, 0n);
  });
});
