import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { AdminDormantAccountRegistryService } from "../src/admin/admin-dormant-account-registry-service.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
const enabled=process.env.ADMIN_DORMANT_ACCOUNT_REGISTRY_MARIADB_TEST==="true";
const database=enabled?createDatabaseClient(loadConfig().database):null;
const service=database===null?null:new AdminDormantAccountRegistryService(database);
after(async()=>{if(database!==null)await database.close();});
describe("admin dormant account registry MariaDB",{skip:!enabled},()=>{
  it("registers, lists, releases and replays one stable target",async()=>{
    assert.ok(database!==null&&service!==null);
    await database.execute("INSERT IGNORE INTO players(id,status) VALUES (9900003491,'active'),(9900003492,'active')");
    await database.execute("INSERT IGNORE INTO player_profiles(player_id,current_display_name,level,terms_agreed) VALUES (9900003491,'휴면운영자',999,TRUE),(9900003492,'휴면대상',1,TRUE)");
    await database.execute("INSERT IGNORE INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (9900003491,9900003491,'kakao','registry-operator','휴면운영자','linked'),(9900003492,9900003492,'kakao','registry-target','휴면대상','linked')");
    await database.execute("INSERT IGNORE INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (9900003491,'registryop','휴면운영자','x','active')");
    await database.execute("INSERT IGNORE INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (9900003491,9900003491)");
    await database.execute("INSERT INTO admin_operator_permission_overrides(operator_id,permission_code,effect,granted_by,reason) VALUES (9900003491,'account.delete','allow',9900003491,'synthetic') ON DUPLICATE KEY UPDATE effect='allow'");
    await database.execute("INSERT IGNORE INTO event_inbox(event_id,event_kind,payload_hash,processing_status,received_at) VALUES ('registry-int-register','message',REPEAT('1',64),'received',UTC_TIMESTAMP(3)),('registry-int-list','message',REPEAT('2',64),'received',UTC_TIMESTAMP(3)),('registry-int-release','message',REPEAT('3',64),'received',UTC_TIMESTAMP(3))");
    const registered=await service.execute({eventId:'registry-int-register',externalUserId:'registry-operator',destinationId:'isolated',message:'/휴면계정 휴면대상'});
    assert.equal(registered.changed,true);
    assert.equal((await service.execute({eventId:'registry-int-register',externalUserId:'registry-operator',destinationId:'isolated',message:'/휴면계정 휴면대상'})).replayed,true);
    assert.match((await service.execute({eventId:'registry-int-list',externalUserId:'registry-operator',destinationId:'isolated',message:'/휴면계정리스트'})).message,/휴면대상/);
    assert.equal((await service.execute({eventId:'registry-int-release',externalUserId:'registry-operator',destinationId:'isolated',message:'/휴면해제 휴면대상'})).changed,true);
  });
});
