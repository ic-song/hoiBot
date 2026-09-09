import assert from "node:assert/strict";
import { AdminDormantAccountRegistryService } from "../src/admin/admin-dormant-account-registry-service.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
const database=createDatabaseClient(loadConfig().database),service=new AdminDormantAccountRegistryService(database),restart=process.argv.includes("--verify-restart");
async function seed(){
 await database.execute("INSERT IGNORE INTO players(id,status) VALUES (9900003491,'active'),(9900003492,'active'),(9900003493,'active')");
 await database.execute("INSERT IGNORE INTO player_profiles(player_id,current_display_name,level,terms_agreed) VALUES (9900003491,'휴면운영자',999,TRUE),(9900003492,'가휴면',1,TRUE),(9900003493,'나롤백',1,TRUE)");
 await database.execute("INSERT IGNORE INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (9900003491,9900003491,'kakao','registry-operator','휴면운영자','linked'),(9900003492,9900003492,'kakao','registry-target','가휴면','linked'),(9900003493,9900003493,'kakao','registry-rollback','나롤백','linked')");
 await database.execute("INSERT IGNORE INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (9900003491,'registryop','휴면운영자','x','active')");
 await database.execute("INSERT IGNORE INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (9900003491,9900003491)");
 await database.execute("INSERT INTO admin_operator_permission_overrides(operator_id,permission_code,effect,granted_by,reason) VALUES (9900003491,'account.delete','allow',9900003491,'synthetic') ON DUPLICATE KEY UPDATE effect='allow'");
 await database.execute("INSERT IGNORE INTO event_inbox(event_id,event_kind,payload_hash,processing_status,received_at) VALUES ('registry-probe-register','message',REPEAT('1',64),'received',UTC_TIMESTAMP(3)),('registry-probe-list','message',REPEAT('2',64),'received',UTC_TIMESTAMP(3)),('registry-probe-release','message',REPEAT('3',64),'received',UTC_TIMESTAMP(3)),('registry-probe-rollback','message',REPEAT('4',64),'received',UTC_TIMESTAMP(3))");
}
async function main(){
 if(restart){const replay=await service.execute({eventId:'registry-probe-register',externalUserId:'registry-operator',destinationId:'isolated',message:'/휴면계정 가휴면'});assert.equal(replay.replayed,true);console.log(JSON.stringify({phase:'verify-restart',restartReplay:true}));return;}
 await seed();
 const concurrent=await Promise.all([service.execute({eventId:'registry-probe-register',externalUserId:'registry-operator',destinationId:'isolated',message:'/휴면계정 가휴면'}),service.execute({eventId:'registry-probe-register',externalUserId:'registry-operator',destinationId:'isolated',message:'/휴면계정 가휴면'})]);
 assert.deepEqual(concurrent.map(v=>v.replayed).sort(),[false,true]);
 assert.match((await service.execute({eventId:'registry-probe-list',externalUserId:'registry-operator',destinationId:'isolated',message:'/휴면계정리스트'})).message,/가휴면/);
 await assert.rejects(service.execute({eventId:'registry-probe-rollback',externalUserId:'registry-operator',destinationId:'x'.repeat(300),message:'/휴면계정 나롤백'}));
 assert.equal((await database.query<Array<{value:bigint}>>("SELECT COUNT(*) value FROM dormant_account_registry WHERE player_id=9900003493"))[0]!.value,0n);
 const released=await service.execute({eventId:'registry-probe-release',externalUserId:'registry-operator',destinationId:'isolated',message:'/휴면해제 가휴면'});assert.equal(released.changed,true);
 console.log(JSON.stringify({phase:'run',concurrentReplay:true,rollback:true,released:true}));
}
main().finally(async()=>database.close());
