import assert from "node:assert/strict";
import { AdminDormantAccountDeleteService } from "../src/admin/admin-dormant-account-delete-service.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const database = createDatabaseClient(loadConfig().database);
const service = new AdminDormantAccountDeleteService(database);
const restart = process.argv.includes("--verify-restart");
const scalar = async (sql: string): Promise<bigint> => (await database.query<Array<{ value: bigint }>>(sql))[0]!.value;

async function seed() {
  await database.execute("INSERT IGNORE INTO players(id,status) VALUES (9900003481,'active'),(9900003482,'active'),(9900003483,'active'),(9900003484,'active'),(9900003485,'active'),(9900003486,'active')");
  await database.execute("INSERT IGNORE INTO player_profiles(player_id,current_display_name,level,terms_agreed,updated_at) VALUES (9900003481,'잠수운영자',999,TRUE,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 DAY)),(9900003482,'잠수100',10,TRUE,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 6 DAY)),(9900003483,'채팅101',10,TRUE,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 6 DAY)),(9900003484,'최근5일',10,TRUE,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 119 HOUR)),(9900003485,'잠수대상',10,TRUE,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 6 DAY)),(9900003486,'롤백잠수',11,TRUE,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 6 DAY))");
  await database.execute("INSERT IGNORE INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (9900003481,9900003481,'kakao','dormant-operator','잠수운영자','linked'),(9900003482,9900003482,'kakao','dormant-100','잠수100','linked'),(9900003483,9900003483,'kakao','dormant-101','채팅101','linked'),(9900003484,9900003484,'kakao','dormant-five','최근5일','linked'),(9900003485,9900003485,'kakao','dormant-target','잠수대상','linked'),(9900003486,9900003486,'kakao','dormant-rollback','롤백잠수','linked')");
  await database.execute("INSERT IGNORE INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (9900003481,'dormantop','잠수운영자','x','active')");
  await database.execute("INSERT IGNORE INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (9900003481,9900003481)");
  await database.execute("INSERT INTO admin_operator_permission_overrides(operator_id,permission_code,effect,granted_by,reason) VALUES (9900003481,'account.delete','allow',9900003481,'synthetic') ON DUPLICATE KEY UPDATE effect='allow'");
  await database.execute("INSERT IGNORE INTO player_counters(player_id,counter_code,period_key,value) VALUES (9900003482,'chat_count','lifetime',100),(9900003483,'chat_count','lifetime',101)");
  await database.execute("INSERT IGNORE INTO event_inbox(event_id,event_kind,payload_hash,processing_status,received_at) VALUES ('dormant-probe-list','message',REPEAT('1',64),'received',UTC_TIMESTAMP(3)),('dormant-probe-delete','message',REPEAT('2',64),'received',UTC_TIMESTAMP(3)),('dormant-probe-rollback','message',REPEAT('3',64),'received',UTC_TIMESTAMP(3))");
}

async function main() {
  if (restart) {
    const replay = await service.execute({ eventId: "dormant-probe-delete", externalUserId: "dormant-operator", destinationId: "isolated-dormant-room", message: "/계정잠수삭제 10" });
    assert.equal(replay.replayed, true);
    assert.equal(await scalar("SELECT COUNT(*) value FROM admin_dormant_account_candidates WHERE action_code='deleted'"), 2n);
    console.log(JSON.stringify({ phase: "verify-restart", restartReplay: true, deleted: "2" }));
    return;
  }
  await seed();
  const listed = await service.execute({ eventId: "dormant-probe-list", externalUserId: "dormant-operator", destinationId: "isolated-dormant-room", message: "/계정잠수명단 10" });
  assert.deepEqual(listed.candidatePlayerIds, ["9900003482", "9900003485"]);
  const concurrent = await Promise.all([
    service.execute({ eventId: "dormant-probe-delete", externalUserId: "dormant-operator", destinationId: "isolated-dormant-room", message: "/계정잠수삭제 10" }),
    service.execute({ eventId: "dormant-probe-delete", externalUserId: "dormant-operator", destinationId: "isolated-dormant-room", message: "/계정잠수삭제 10" })
  ]);
  assert.deepEqual(concurrent.map((value) => value.replayed).sort(), [false, true]);
  assert.deepEqual(concurrent[0]!.deletedPlayerIds, ["9900003482", "9900003485"]);
  await assert.rejects(
    service.execute({ eventId: "dormant-probe-rollback", externalUserId: "dormant-operator", destinationId: "x".repeat(300), message: "/계정잠수삭제 11" })
  );
  assert.equal(await scalar("SELECT COUNT(*) value FROM players WHERE id=9900003486 AND status='active'"), 1n);
  console.log(JSON.stringify({ phase: "run", listed: listed.candidatePlayerIds.length, deleted: concurrent[0]!.deletedPlayerIds.length, concurrentReplay: concurrent.some((value) => value.replayed), rollback: true, chat101Protected: true, recent5Protected: true }));
}

main().finally(async () => database.close());
