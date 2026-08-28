import assert from "node:assert/strict";
import { AdminMemberTitleMutateService } from "../src/admin/admin-member-title-mutate-service.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const db = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5000 });
const operatorPlayer = 997315001n, targetA = 997315002n, targetB = 997315003n, unauthorizedPlayer = 997315004n;
const operatorIdentity = 997316001n, unauthorizedIdentity = 997316002n;
const operatorExternal = "997317001", unauthorizedExternal = "997317002", room = "고도화타이틀변경방";

async function seed(database: DatabaseClient): Promise<void> {
  await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code IN('ADMIN_MEMBER_TITLE_ADD','ADMIN_MEMBER_TITLE_GRANT','ADMIN_MEMBER_TITLE_REMOVE')");
  await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES(997318001,'probe-title-mutate','합성 타이틀 관리자','synthetic','active')");
  await database.execute("INSERT INTO admin_roles(id,code,display_name,active) VALUES(997319001,'probe-title-mutate-role','합성 타이틀 역할',1)");
  await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES(997319001,'player.title.change')");
  await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES(997318001,997319001)");
  await database.execute("INSERT INTO players(id,status,version) VALUES(?,'active',1),(?,'active',1),(?,'active',1),(?,'active',1)", [operatorPlayer, targetA, targetB, unauthorizedPlayer]);
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(?,'프로브대상가',1),(?,'프로브대상나',1)", [targetA, targetB]);
  await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES(?,?,'kakao',?,'합성 타이틀 관리자','linked'),(?,?,'kakao',?,'일반 회원','linked')", [operatorIdentity, operatorPlayer, operatorExternal, unauthorizedIdentity, unauthorizedPlayer, unauthorizedExternal]);
  await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES(997318001,?)", [operatorIdentity]);
}

async function run(eventId: string, externalUserId: string, message: string) {
  const identityId = externalUserId === operatorExternal ? operatorIdentity : unauthorizedIdentity;
  await db.execute("INSERT IGNORE INTO event_inbox(event_id,provider_code,provider_event_id,external_user_id,external_identity_id,event_kind,processing_status,received_at) VALUES (?,'iris',?,?,?,'message','processing',UTC_TIMESTAMP(3))", [eventId, eventId, externalUserId, identityId]);
  return new AdminMemberTitleMutateService(db).handle({ eventId, externalUserId, destinationId: room, message });
}

async function state() {
  return (await db.query<Array<{ total_instances: bigint; owned_instances: bigint; removed_instances: bigint; executions: bigint; audits: bigint; outboxes: bigint }>>(
    "SELECT (SELECT COUNT(*) FROM player_title_instances WHERE player_id IN (997315002,997315003)) total_instances,(SELECT COUNT(*) FROM player_title_instances WHERE player_id IN (997315002,997315003) AND status='owned') owned_instances,(SELECT COUNT(*) FROM player_title_instances WHERE player_id IN (997315002,997315003) AND status='removed') removed_instances,(SELECT COUNT(*) FROM command_executions WHERE event_id LIKE 'amt-%' AND execution_status='completed') executions,(SELECT COUNT(*) FROM command_audit audit_row JOIN operations operation_row ON operation_row.id=audit_row.operation_id WHERE operation_row.idempotency_key LIKE 'amt-%') audits,(SELECT COUNT(*) FROM outbox_messages outbox_row JOIN operations operation_row ON operation_row.id=outbox_row.operation_id WHERE operation_row.idempotency_key LIKE 'amt-%') outboxes"
  ))[0]!;
}

async function probe(): Promise<void> {
  await seed(db);
  const first = await run("amt-add-1", operatorExternal, "/타이틀추가 프로브대상가, 중복타이틀 000");
  assert.equal(first?.changedCount, 1);
  assert.equal((await run("amt-add-1", operatorExternal, "/타이틀추가 프로브대상가, 중복타이틀 000"))?.replayed, true);
  assert.equal((await run("amt-add-2", operatorExternal, "/타이틀추가 프로브대상가, 중복타이틀 000"))?.changedCount, 1);
  assert.equal((await run("amt-grant", operatorExternal, "/타이틀지급 프로브대상가,프로브대상나,없는회원/공용타이틀/000000000000000000000000001"))?.changedCount, 2);
  assert.equal((await run("amt-remove", operatorExternal, "/타이틀제거 프로브대상가 2"))?.changedCount, 1);
  assert.equal(await run("amt-unauthorized", unauthorizedExternal, "/타이틀추가 프로브대상가, 거부타이틀 1"), null);
  const legacyJson = await db.query<Array<{ legacy_price_json: string }>>("SELECT legacy_price_json FROM player_title_instances WHERE player_id IN (997315002,997315003) AND snapshot_name='공용타이틀' ORDER BY player_id");
  assert.deepEqual(legacyJson, [{ legacy_price_json: "1" }, { legacy_price_json: "1" }]);

  const before = await state();
  await db.execute("CREATE TRIGGER synthetic_admin_title_probe_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='admin title probe failure'");
  await assert.rejects(() => run("amt-rollback", operatorExternal, "/타이틀추가 프로브대상가, 롤백타이틀 1"), /admin title probe failure/);
  await db.execute("DROP TRIGGER synthetic_admin_title_probe_failure");
  assert.deepEqual(await state(), before);
  assert.equal(await db.verifyRollback(), true);
  assert.equal((await run("amt-after-rollback", operatorExternal, "/타이틀추가 프로브대상가, 재시작타이틀 1"))?.changedCount, 1);
  const current = await state();
  assert.deepEqual([current.total_instances,current.owned_instances,current.removed_instances,current.executions,current.audits,current.outboxes],[5n,4n,1n,5n,5n,5n]);
  process.stdout.write(JSON.stringify({ mode: "probe", migration: "313_admin_member_title_mutate.sql", scenarios: ["add","duplicate","grant","missing-target","remove","unauthorized","replay","rollback","restart"], state: current }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
}

async function restart(): Promise<void> {
  const current = await state();
  assert.deepEqual([current.total_instances,current.owned_instances,current.removed_instances,current.executions,current.audits,current.outboxes],[5n,4n,1n,5n,5n,5n]);
  process.stdout.write(JSON.stringify({ mode: "verify-restart", state: current, additionalMutation: false, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
}

function required(name: string): string { const value = process.env[name]; if (value === undefined || value === "") throw new Error(`${name} required`); return value; }
try { if (process.argv.includes("--verify-restart")) await restart(); else await probe(); } finally { await db.close(); }
