import assert from "node:assert/strict";
import { AdminPackageDeleteService } from "../src/admin/admin-package-delete-service.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const databaseName = required("DATABASE_NAME");
assert.match(databaseName, /^hoibot_admin_package_delete(?:_[a-z0-9_]+)?$/i, "격리 선물삭제 DB만 사용할 수 있습니다.");
const db = createDatabaseClient({
  enabled: true,
  host: required("DATABASE_HOST"),
  port: Number(required("DATABASE_PORT")),
  user: required("DATABASE_USER"),
  password: required("DATABASE_PASSWORD"),
  name: databaseName,
  connectionLimit: 8,
  connectTimeoutMs: 5000
});

const operatorPlayer = 997411001n;
const targetA = 997411002n;
const targetB = 997411003n;
const unauthorizedPlayer = 997411004n;
const operatorIdentity = 997412001n;
const unauthorizedIdentity = 997412002n;
const operatorExternal = "997413001";
const unauthorizedExternal = "997413002";
const operatorId = 997414001n;
const roleId = 997415001n;
const room = "고도화선물삭제방";

interface ItemRow { id: bigint; code: string }
interface ProbeState {
  targetStacks: bigint;
  targetQuantity: bigint;
  unrelatedQuantity: bigint;
  changes: bigint;
  ledgers: bigint;
  runs: bigint;
  executions: bigint;
  audits: bigint;
  outboxes: bigint;
}

async function seed(database: DatabaseClient): Promise<void> {
  await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES(?,'probe-package-delete','합성 선물삭제 관리자','synthetic','active')", [operatorId]);
  await database.execute("INSERT INTO admin_roles(id,code,display_name,active) VALUES(?,'probe-package-delete-role','합성 선물삭제 역할',1)", [roleId]);
  await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES(?,'game.inventory.free_support.delete')", [roleId]);
  await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES(?,?)", [operatorId, roleId]);
  await database.execute("INSERT INTO players(id,status,version) VALUES(?,'active',1),(?,'active',1),(?,'active',1),(?,'active',1)", [operatorPlayer, targetA, targetB, unauthorizedPlayer]);
  await database.execute(
    "INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES(?,?,'kakao',?,'합성 선물삭제 관리자','linked'),(?,?,'kakao',?,'일반 회원','linked')",
    [operatorIdentity, operatorPlayer, operatorExternal, unauthorizedIdentity, unauthorizedPlayer, unauthorizedExternal]
  );
  await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES(?,?)", [operatorId, operatorIdentity]);
  await database.execute(
    "INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES('ITEM-PROBE-UNRELATED','프로브 무관 아이템','PACKAGE_ITEM',TRUE,JSON_OBJECT('probe',TRUE),TRUE,1)"
  );
  const items = await database.query<ItemRow[]>(
    "SELECT id,code FROM item_definitions WHERE code IN('ITEM-FREE-HOI-SUPPORT-01','ITEM-FREE-HOI-SUPPORT-02','ITEM-FREE-HOI-SUPPORT-10','ITEM-PROBE-UNRELATED') ORDER BY code"
  );
  const byCode = new Map(items.map((row) => [row.code, row.id]));
  const item = (code: string): bigint => {
    const id = byCode.get(code);
    assert.notEqual(id, undefined, `${code} 정의가 필요합니다.`);
    return id!;
  };
  await database.execute(
    "INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES(?,?,3,1),(?,?,0,1),(?,?,7,1),(?,?,5,1),(?,?,2,1)",
    [targetA, item("ITEM-FREE-HOI-SUPPORT-01"), targetA, item("ITEM-FREE-HOI-SUPPORT-02"), targetA, item("ITEM-PROBE-UNRELATED"), targetB, item("ITEM-FREE-HOI-SUPPORT-01"), targetB, item("ITEM-FREE-HOI-SUPPORT-10")]
  );
}

async function run(eventId: string, externalUserId: string): Promise<Awaited<ReturnType<AdminPackageDeleteService["handle"]>>> {
  const identityId = externalUserId === operatorExternal ? operatorIdentity : unauthorizedIdentity;
  await db.execute(
    "INSERT IGNORE INTO event_inbox(event_id,provider_code,provider_event_id,external_user_id,external_identity_id,event_kind,processing_status,received_at) VALUES(?,'iris',?,?,?,'message','processing',UTC_TIMESTAMP(3))",
    [eventId, eventId, externalUserId, identityId]
  );
  return new AdminPackageDeleteService(db).handle({ eventId, externalUserId, channelId: room, message: "/선물삭제" });
}

async function itemId(code: string): Promise<bigint> {
  const row = (await db.query<ItemRow[]>("SELECT id,code FROM item_definitions WHERE code=?", [code]))[0];
  assert.notEqual(row, undefined, `${code} 정의가 필요합니다.`);
  return row!.id;
}

async function state(): Promise<ProbeState> {
  const row = (await db.query<Array<Record<keyof ProbeState, bigint | string>>>(
    `SELECT
      (SELECT COUNT(*) FROM inventory_stacks stack_row JOIN item_definitions item_row ON item_row.id=stack_row.item_id WHERE item_row.code LIKE 'ITEM-FREE-HOI-SUPPORT-%') targetStacks,
      (SELECT COALESCE(SUM(stack_row.quantity),0) FROM inventory_stacks stack_row JOIN item_definitions item_row ON item_row.id=stack_row.item_id WHERE item_row.code LIKE 'ITEM-FREE-HOI-SUPPORT-%') targetQuantity,
      (SELECT quantity FROM inventory_stacks stack_row JOIN item_definitions item_row ON item_row.id=stack_row.item_id WHERE item_row.code='ITEM-PROBE-UNRELATED' AND stack_row.player_id=997411002) unrelatedQuantity,
      (SELECT COUNT(*) FROM admin_package_delete_changes) changes,
      (SELECT COUNT(*) FROM inventory_ledger WHERE reason_code='ADMIN_FREE_SUPPORT_PACKAGE_DELETE') ledgers,
      (SELECT COUNT(*) FROM admin_package_delete_runs) runs,
      (SELECT COUNT(*) FROM command_executions WHERE command_code='ADMIN_PACKAGE_DELETE') executions,
      (SELECT COUNT(*) FROM command_audit WHERE action_code='admin.package_delete') audits,
      (SELECT COUNT(*) FROM outbox_messages outbox_row JOIN operations operation_row ON operation_row.id=outbox_row.operation_id WHERE operation_row.idempotency_scope='admin.inventory.free_support.delete') outboxes`
  ))[0]!;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, BigInt(value)])) as unknown as ProbeState;
}

async function probe(): Promise<void> {
  const registry = (await db.query<Array<{ rollout_state: string; alias_count: bigint; definition_count: bigint }>>(
    "SELECT registry.rollout_state,(SELECT COUNT(*) FROM command_aliases WHERE command_code='ADMIN_PACKAGE_DELETE' AND command_text='/선물삭제' AND active=TRUE) alias_count,(SELECT COUNT(*) FROM item_definitions WHERE code LIKE 'ITEM-FREE-HOI-SUPPORT-%' AND active=TRUE) definition_count FROM command_registry registry WHERE registry.command_code='ADMIN_PACKAGE_DELETE'"
  ))[0]!;
  assert.deepEqual([registry.rollout_state, registry.alias_count, registry.definition_count], ["SHADOW", 1n, 10n]);
  await seed(db);

  const unauthorizedBefore = await state();
  await assert.rejects(() => run("apd-unauthorized", unauthorizedExternal), /선물 삭제 권한이 없습니다/);
  assert.deepEqual(await state(), unauthorizedBefore);

  const first = await run("apd-success", operatorExternal);
  assert.deepEqual(
    [first.affectedMemberCount, first.deletedStackCount, first.positiveQuantityTotal, first.minVariant, first.maxVariant],
    ["2", "4", "10", 1, 10]
  );
  assert.deepEqual(await run("apd-success", operatorExternal), first);
  assert.deepEqual(await state(), {
    targetStacks: 0n, targetQuantity: 0n, unrelatedQuantity: 7n, changes: 4n,
    ledgers: 3n, runs: 1n, executions: 1n, audits: 1n, outboxes: 1n
  });

  const empty = await run("apd-empty", operatorExternal);
  assert.deepEqual([empty.affectedMemberCount, empty.deletedStackCount, empty.positiveQuantityTotal], ["0", "0", "0"]);

  await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES(?,?,4,1)", [targetA, await itemId("ITEM-FREE-HOI-SUPPORT-03")]);
  const concurrent = await Promise.all([run("apd-concurrent", operatorExternal), run("apd-concurrent", operatorExternal)]);
  assert.deepEqual(concurrent[0], concurrent[1]);
  assert.deepEqual([concurrent[0].affectedMemberCount, concurrent[0].deletedStackCount, concurrent[0].positiveQuantityTotal], ["1", "1", "4"]);

  await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES(?,?,6,1)", [targetB, await itemId("ITEM-FREE-HOI-SUPPORT-04")]);
  const rollbackBefore = await state();
  await db.execute("CREATE TRIGGER synthetic_admin_package_delete_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='admin package delete probe failure'");
  await assert.rejects(() => run("apd-rollback", operatorExternal), /admin package delete probe failure/);
  await db.execute("DROP TRIGGER synthetic_admin_package_delete_failure");
  assert.deepEqual(await state(), rollbackBefore);
  assert.equal(await db.verifyRollback(), true);
  const afterRollback = await run("apd-after-rollback", operatorExternal);
  assert.deepEqual([afterRollback.affectedMemberCount, afterRollback.deletedStackCount, afterRollback.positiveQuantityTotal], ["1", "1", "6"]);

  const current = await state();
  assert.deepEqual(current, {
    targetStacks: 0n, targetQuantity: 0n, unrelatedQuantity: 7n, changes: 6n,
    ledgers: 5n, runs: 4n, executions: 4n, audits: 4n, outboxes: 4n
  });
  process.stdout.write(JSON.stringify({
    mode: "probe",
    migration: "338_admin_package_delete.sql",
    scenarios: ["registry-shadow", "rbac-denied", "delete-positive-and-zero", "unrelated-preserved", "same-event-replay", "empty", "same-event-concurrency", "rollback", "retry-after-rollback"],
    state: current
  }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
}

async function restart(): Promise<void> {
  const before = await state();
  const replay = await run("apd-success", operatorExternal);
  assert.deepEqual([replay.affectedMemberCount, replay.deletedStackCount, replay.positiveQuantityTotal], ["2", "4", "10"]);
  assert.deepEqual(await state(), before);
  process.stdout.write(JSON.stringify({ mode: "verify-restart", replay, state: before, additionalMutation: false, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} required`);
  return value;
}

try {
  if (process.argv.includes("--verify-restart")) await restart();
  else await probe();
} finally {
  await db.close();
}
