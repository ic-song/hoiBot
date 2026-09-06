import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { CharacterCountStatsService } from "../src/admin/character-count-stats-service.js";
import { IrisAdminCommandService } from "../src/admin/iris-admin-command-service.js";

const integration = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;
const codes = ["member","pet_home","equipped_furniture","member_pet","pet_skill","member_title","pet_title","mini_pet_title","mini_pet_collection","trial_tower","pet_explore","guild","attendance_light","board","free_market"];

integration("admin character count stats MariaDB integration", () => {
  let database: DatabaseClient;
  const suffix=`${process.pid}-${Date.now()}`, externalUserId=`character-count-admin-${suffix}`, deniedUserId=`character-count-denied-${suffix}`, destinationId="character-count-room", prefix=`character-count-${suffix}`;
  let snapshotSetId=0n;

  before(async () => {
    database=createDatabaseClient(loadConfig().database);
    const operatorId=988910001;
    await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (?,'character-count-admin','글자수 통계 관리자','integration','active') ON DUPLICATE KEY UPDATE status='active'",[operatorId]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT ?,id FROM admin_roles WHERE code='super_admin' ON DUPLICATE KEY UPDATE role_id=VALUES(role_id)",[operatorId]);
    await database.execute("INSERT INTO external_identities(provider_code,external_user_id,status) VALUES ('kakao',?,'linked'),('kakao',?,'linked') ON DUPLICATE KEY UPDATE status='linked'",[externalUserId,deniedUserId]);
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) SELECT ?,id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? ON DUPLICATE KEY UPDATE operator_id=VALUES(operator_id)",[operatorId,externalUserId]);
    const set=await database.execute("INSERT INTO legacy_snapshot_sets(environment_code,database_identity,snapshot_version,snapshot_at,snapshot_status) VALUES ('prod','hoibot-prod',7001,UTC_TIMESTAMP(3),'ready')"); snapshotSetId=set.insertId;
    for(const code of codes){const raw=code==="member_pet"?JSON.stringify({"가":{pendant:{name:"달"}},"나":{pendantBag:[]},"다":{pendantBag:[{name:"별"}]}}):JSON.stringify({[`${code}-user`]:{value:code}});await database.execute("INSERT INTO legacy_source_snapshots(snapshot_set_id,source_code,raw_json,content_sha256,utf16_code_unit_count,entity_count,read_status,captured_at) VALUES (?,?,?,?,?,1,'valid',UTC_TIMESTAMP(3))",[snapshotSetId,code,raw,createHash("sha256").update(raw).digest("hex"),raw.length]);}
    await database.execute("UPDATE legacy_snapshot_environments SET active_snapshot_set_id=? WHERE environment_code='prod'",[snapshotSetId]);
  });

  after(async()=>database.close());
  async function event(id:string,user=externalUserId){await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3))",[id,id,destinationId,user]);}
  async function count(sql:string,values:readonly unknown[]=[]):Promise<bigint>{return BigInt((await database.query<Array<{value:bigint|string}>>(sql,values))[0]?.value??0);}

  it("validates Shadow, permission, exact bundle, replay, rollback and stable DB snapshot", async () => {
    const service=new CharacterCountStatsService(database,{environmentCode:"prod"}),shadowEvent=`${prefix}-shadow`;await event(shadowEvent);
    assert.deepEqual(await service.handleIris({eventId:shadowEvent,externalUserId,channelId:destinationId,message:"/글자수통계"}),{status:"shadow"});
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_CHARACTER_COUNT_STATS'");
    const success=`${prefix}-success`;await event(success);const result=await new IrisAdminCommandService(database,[],undefined,{environmentCode:"prod"}).changePlayerPoint({eventId:success,externalUserId,channelId:destinationId,message:"/글자수통계"});
    assert.equal(result.status,"changed");if(result.status==="changed"){assert.match(result.data,/펜던트: .* \/ 3명/);assert.match(result.data,/자유시장:/);}
    const replay=await service.read({eventId:success,externalUserId,destinationId,environment:"prod"});assert.ok(replay!==null);assert.equal(replay.projectionCount,16);assert.deepEqual(await service.read({eventId:success,externalUserId,destinationId,environment:"prod"}),replay);
    const denied=`${prefix}-denied`;await event(denied,deniedUserId);assert.equal(await service.read({eventId:denied,externalUserId:deniedUserId,destinationId,environment:"prod"}),null);
    const rollback=`${prefix}-rollback`;await event(rollback);await database.execute("CREATE TRIGGER fail_character_count_stats_audit BEFORE INSERT ON command_audit FOR EACH ROW BEGIN IF NEW.action_code='stats.character_count.read' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced character count stats audit failure'; END IF; END");try{await assert.rejects(()=>service.read({eventId:rollback,externalUserId,destinationId,environment:"prod"}),/forced character count stats audit failure/);}finally{await database.execute("DROP TRIGGER IF EXISTS fail_character_count_stats_audit");}assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?",[rollback]),0n);
    const incomplete=await database.execute("INSERT INTO legacy_snapshot_sets(environment_code,database_identity,snapshot_version,snapshot_at,snapshot_status) VALUES ('prod','hoibot-prod',7002,UTC_TIMESTAMP(3),'ready')");await database.execute("INSERT INTO legacy_source_snapshots(snapshot_set_id,source_code,raw_json,content_sha256,utf16_code_unit_count,entity_count,read_status,captured_at) SELECT ?,source_code,raw_json,content_sha256,utf16_code_unit_count,entity_count,read_status,captured_at FROM legacy_source_snapshots WHERE snapshot_set_id=? AND source_code<>'board'",[incomplete.insertId,snapshotSetId]);await database.execute("UPDATE legacy_snapshot_environments SET active_snapshot_set_id=? WHERE environment_code='prod'",[incomplete.insertId]);const missing=`${prefix}-missing`;await event(missing);const missingResult=await service.read({eventId:missing,externalUserId,destinationId,environment:"prod"});assert.ok(missingResult!==null);assert.match(missingResult.data,/게시판: ❌ 파일 없음/);assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?",[missing]),1n);await database.execute("UPDATE legacy_snapshot_environments SET active_snapshot_set_id=? WHERE environment_code='prod'",[snapshotSetId]);
    assert.deepEqual({operations:await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='stats.character_count.read'"),outboxes:await count("SELECT COUNT(*) value FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='stats.character_count.read'"),audits:await count("SELECT COUNT(*) value FROM command_audit WHERE action_code='stats.character_count.read'"),executions:await count("SELECT COUNT(*) value FROM admin_character_count_stat_executions")},{operations:2n,outboxes:2n,audits:2n,executions:2n});
  });
});
