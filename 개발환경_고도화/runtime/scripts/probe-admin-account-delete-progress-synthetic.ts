import assert from "node:assert/strict";
import { AdminAccountDeleteProgressService } from "../src/admin/admin-account-delete-progress-service.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const database = createDatabaseClient(loadConfig().database);
const service = new AdminAccountDeleteProgressService(database);
const restart = process.argv.includes("--verify-restart");

async function scalar(sql: string, params: unknown[] = []): Promise<bigint> {
  return (await database.query<Array<{ value: bigint }>>(sql, params))[0]!.value;
}

async function seed() {
  await database.execute("INSERT IGNORE INTO players(id,status) VALUES (9900003471,'active'),(9900003472,'active'),(9900003473,'active'),(9900003474,'active')");
  await database.execute("INSERT IGNORE INTO player_profiles(player_id,current_display_name,terms_agreed) VALUES (9900003471,'삭제운영자',TRUE),(9900003472,'삭제대상A',TRUE),(9900003473,'삭제대상B',TRUE),(9900003474,'롤백대상',TRUE)");
  await database.execute("INSERT IGNORE INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (9900003471,9900003471,'kakao','account-delete-operator','삭제운영자','linked'),(9900003472,9900003472,'kakao','account-delete-target-a','삭제대상A','linked'),(9900003473,9900003473,'kakao','account-delete-target-b','삭제대상B','linked'),(9900003474,9900003474,'kakao','account-delete-target-rollback','롤백대상','linked')");
  await database.execute("INSERT IGNORE INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (9900003471,'deleteop','삭제운영자','x','active')");
  await database.execute("INSERT IGNORE INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (9900003471,9900003471)");
  await database.execute("INSERT INTO admin_operator_permission_overrides(operator_id,permission_code,effect,granted_by,reason) VALUES (9900003471,'account.delete','allow',9900003471,'synthetic') ON DUPLICATE KEY UPDATE effect='allow',granted_by=9900003471");
  await database.execute("INSERT IGNORE INTO user_accounts(id,player_id,login_id,password_hash,system_account_name,gender_code,account_type,status) VALUES (9900003472,9900003472,'deletetargeta','x','삭제대상A','unspecified','test','active'),(9900003473,9900003473,'deletetargetb','x','삭제대상B','unspecified','test','active'),(9900003474,9900003474,'rollbacktarget','x','롤백대상','unspecified','test','active')");
  await database.execute("INSERT IGNORE INTO user_sessions(id,user_account_id,token_hash,csrf_secret_hash,last_seen_at,idle_expires_at,absolute_expires_at) VALUES (9900003472,9900003472,REPEAT('a',64),REPEAT('b',64),UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 7 DAY))");
  await database.execute("INSERT IGNORE INTO guilds(id,code,display_name,status) VALUES (9900003471,'DELETE-GUILD','삭제길드','active')");
  await database.execute("INSERT IGNORE INTO guild_members(guild_id,player_id,role_code) VALUES (9900003471,9900003472,'master'),(9900003471,9900003473,'sub_master')");
  await database.execute(`INSERT IGNORE INTO event_inbox(event_id,event_kind,payload_hash,processing_status,received_at) VALUES
    ('account-delete-main','message',REPEAT('1',64),'received',UTC_TIMESTAMP(3)),
    ('account-delete-concurrent','message',REPEAT('2',64),'received',UTC_TIMESTAMP(3)),
    ('account-delete-rollback','message',REPEAT('3',64),'received',UTC_TIMESTAMP(3)),
    ('account-delete-self','message',REPEAT('4',64),'received',UTC_TIMESTAMP(3))`);
}

async function main() {
  if (restart) {
    const replay = await service.execute({ eventId: "account-delete-main", externalUserId: "account-delete-operator", destinationId: "isolated-account-delete-room", message: "/계삭진행 삭제대상A, 없는대상" });
    assert.equal(replay.replayed, true);
    assert.equal(await scalar("SELECT COUNT(*) value FROM admin_account_deletion_targets WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope='admin.account_delete_progress') AND result_code='deleted'"), 2n);
    console.log(JSON.stringify({ phase: "verify-restart", restartReplay: true, deletedTargets: "2" }));
    return;
  }
  await seed();
  const first = await service.execute({ eventId: "account-delete-main", externalUserId: "account-delete-operator", destinationId: "isolated-account-delete-room", message: "/계삭진행 삭제대상A, 없는대상" });
  const replay = await service.execute({ eventId: "account-delete-main", externalUserId: "account-delete-operator", destinationId: "isolated-account-delete-room", message: "/계삭진행 삭제대상A, 없는대상" });
  assert.equal(first.resultCode, "partial_success");
  assert.equal(replay.replayed, true);
  const concurrent = await Promise.all([
    service.execute({ eventId: "account-delete-concurrent", externalUserId: "account-delete-operator", destinationId: "isolated-account-delete-room", message: "/계삭진행 삭제대상B" }),
    service.execute({ eventId: "account-delete-concurrent", externalUserId: "account-delete-operator", destinationId: "isolated-account-delete-room", message: "/계삭진행 삭제대상B" })
  ]);
  assert.deepEqual(concurrent.map((value) => value.replayed).sort(), [false, true]);
  await assert.rejects(service.execute({ eventId: "account-delete-rollback", externalUserId: "account-delete-operator", destinationId: "x".repeat(300), message: "/계삭진행 롤백대상" }));
  assert.equal(await scalar("SELECT COUNT(*) value FROM players WHERE id=9900003474 AND status='active' AND deleted_at IS NULL"), 1n);
  const self = await service.execute({ eventId: "account-delete-self", externalUserId: "account-delete-operator", destinationId: "isolated-account-delete-room", message: "/계삭진행 삭제운영자" });
  assert.equal(self.failures[0]?.code, "self_forbidden");
  assert.equal(await scalar("SELECT COUNT(*) value FROM user_sessions WHERE user_account_id=9900003472"), 0n);
  assert.equal(await scalar("SELECT COUNT(*) value FROM guild_members WHERE guild_id=9900003471 AND player_id=9900003472"), 0n);
  assert.equal(await scalar("SELECT COUNT(*) value FROM guild_members WHERE guild_id=9900003471 AND player_id=9900003473 AND role_code='master'"), 0n);
  console.log(JSON.stringify({ phase: "run", replay: replay.replayed, concurrentReplay: concurrent.some((value) => value.replayed), rollback: true, selfBlocked: true, operations: (await scalar("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='admin.account_delete_progress'")).toString(), deletedTargets: (await scalar("SELECT COUNT(*) value FROM admin_account_deletion_targets WHERE result_code='deleted'")).toString() }));
}

main().finally(async () => database.close());
