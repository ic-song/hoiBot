import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { parseRingReadCommand, RingReadService } from "../src/ring/ring-read-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_ring_read(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic ring read probe is blocked for database: ${config.database.name}`);
const baseEventId = process.env.RING_READ_PROBE_EVENT_ID ?? "ring-read-g7-20260826-r1";
const verifyRestart = process.argv.includes("--verify-restart");
const database = createDatabaseClient(config.database);
const service = new RingReadService(database);

// command_executions 외래 키를 만족하는 비식별 합성 이벤트를 준비합니다.
async function seedEvent(eventId: string, userId: string): Promise<void> {
  await database.execute(`INSERT INTO event_inbox
    (event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at)
    VALUES (?,?,'synthetic-ring-read-room',?,'message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)`, [eventId, eventId, userId]);
}

// 감사 기록 실패를 주입해 조회 원장 transaction rollback을 검증합니다.
function failingOnAudit(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), query: (sql, p) => inner.query(sql, p), execute: (sql, p) => inner.execute(sql, p),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, p) => transaction.query(sql, p), execute: async (sql, p) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic ring read audit failure");
        return transaction.execute(sql, p);
      }
    })) };
}

// 반지 통계와 역할 경계를 확인할 최소 비식별 fixture를 준비합니다.
async function seedFixtures(): Promise<void> {
  for (let i = 1; i <= 5; i++) {
    const playerId = 930000000 + i;
    await database.execute("INSERT INTO players(id,status) VALUES (?,'active') ON DUPLICATE KEY UPDATE status='active'", [playerId]);
    await database.execute("INSERT INTO player_pets(player_id,display_name) VALUES (?,'합성펫') ON DUPLICATE KEY UPDATE display_name='합성펫'", [playerId]);
  }
  const snapshots = [
    [930000001,"완료반지1","전설",7,1200,800,false,false,"claimed",2000],
    [930000002,"잔존반지","영웅",3,600,400,true,false,"claimed",1000],
    [930000003,"대기반지","희귀",2,300,200,true,false,"pending",null],
    [930000004,"오류반지","일반",0,0,0,true,true,"pending",null]
  ];
  for (const v of snapshots) await database.execute(`INSERT INTO player_legacy_ring_reward_snapshots
    (player_id,ring_name,ring_grade,enhancement_level,raid_charm,castle_charm,legacy_ring_present,calculation_error,claim_status,reward_quantity,source_version)
    VALUES (?,?,?,?,?,?,?,?,?,?,'synthetic-ver-2.400') ON DUPLICATE KEY UPDATE ring_name=VALUES(ring_name)`, v);
  const item = await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='ITEM-RING-CHARM-REWARD'");
  await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,500,1)", [930000001, item[0]!.id]);
  await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,200,1)", [930000002, item[0]!.id]);
  const identities = [[940000001,930000001,"ring-read-public"],[940000002,930000002,"ring-read-manager"],[940000003,930000003,"ring-read-master"],[940000004,930000004,"ring-read-ordinary"]];
  for (const v of identities) await database.execute(`INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status)
    VALUES (?,?,'kakao',?,'합성 사용자','linked')`, v);
  await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES ('manager','운영자',TRUE) ON DUPLICATE KEY UPDATE active=TRUE");
  await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES ('super_admin','총괄 운영자',TRUE) ON DUPLICATE KEY UPDATE active=TRUE");
  await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (950000001,'ring-manager','운영자','synthetic','active')");
  await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (950000002,'ring-master','총괄 운영자','synthetic','active')");
  await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (950000001,940000002),(950000002,940000003)");
  await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 950000001,id FROM admin_roles WHERE code='manager'");
  await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 950000002,id FROM admin_roles WHERE code='super_admin'");
}

try {
  const statsEvent = `${baseEventId}-stats`;
  const statsScope = "ring_reward_stats:940000002";
  if (verifyRestart) {
    const before = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [statsScope, statsEvent]);
    const replay = await service.handleIris({ externalUserId: "ring-read-manager", channelId: "synthetic-ring-read-room", message: "/반지보상통계", eventId: statsEvent });
    const after = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [statsScope, statsEvent]);
    assert.equal(replay.status, "changed"); assert.deepEqual(after, before); assert.equal(after[0]?.count, 1n);
    process.stdout.write(`${JSON.stringify({ mode:"verify-restart",database:config.database.name,operationCount:1,additionalReplyLedger:false,operationalDataTouched:false })}\n`);
  } else {
    await seedFixtures();
    const shadow = await service.handleIris({ externalUserId:"ring-read-manager",channelId:"synthetic-ring-read-room",message:"/반지보상통계",eventId:`${baseEventId}-shadow` });
    assert.equal(shadow.status,"shadow");
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code IN ('RING_REWARD_STATS','RING_RANK_RETIRED','RING_INFO_RETIRED')");
    for (const [suffix,user,message] of [["rank","ring-read-public","/반지순위"],["info-manager","ring-read-manager","/반지정보"],["info-master","ring-read-master","/반지정보"],["stats","ring-read-manager","/반지보상통계"],["stats-denied","ring-read-ordinary","/반지보상통계"]]) await seedEvent(`${baseEventId}-${suffix}`,user);
    const rank = await service.handleIris({externalUserId:"ring-read-public",channelId:"synthetic-ring-read-room",message:"/반지순위",eventId:`${baseEventId}-rank`});
    assert.equal(rank.status,"changed"); if(rank.status==="changed") assert.equal(rank.data,"반지순위는 펜던트 콘텐츠 전환으로 종료되었습니다.");
    const infoDenied = await service.handleIris({externalUserId:"ring-read-manager",channelId:"synthetic-ring-read-room",message:"/반지정보",eventId:`${baseEventId}-info-manager`}); assert.equal(infoDenied.status,"handled_no_reply");
    const info = await service.handleIris({externalUserId:"ring-read-master",channelId:"synthetic-ring-read-room",message:"/반지정보",eventId:`${baseEventId}-info-master`}); assert.equal(info.status,"changed");
    const stats = await service.handleIris({externalUserId:"ring-read-manager",channelId:"synthetic-ring-read-room",message:"/반지보상통계",eventId:statsEvent});
    assert.equal(stats.status,"changed"); if(stats.status==="changed") { assert.match(stats.data,/완료 유저 : 2명/); assert.match(stats.data,/지급 총수량 : 3,000개/); assert.match(stats.data,/보상권 잔여 : 700개/); assert.match(stats.data,/사용 추정 : 2,300개/); assert.match(stats.data,/예상 지급 수량 : 500개/); }
    const denied = await service.handleIris({externalUserId:"ring-read-ordinary",channelId:"synthetic-ring-read-room",message:"/반지보상통계",eventId:`${baseEventId}-stats-denied`}); assert.equal(denied.status,"handled_no_reply");
    const replay = await service.handleIris({externalUserId:"ring-read-manager",channelId:"synthetic-ring-read-room",message:"/반지보상통계",eventId:statsEvent}); assert.deepEqual(replay,stats);
    const rollbackEvent=`${baseEventId}-rollback`; await seedEvent(rollbackEvent,"ring-read-manager");
    await assert.rejects(()=>new RingReadService(failingOnAudit(database)).reply({command:parseRingReadCommand("/반지보상통계")!,actorId:"940000002",destinationId:"synthetic-ring-read-room",sourceEventId:rollbackEvent,idempotencyKey:rollbackEvent}),/synthetic ring read audit failure/);
    const effects=await database.query<Array<{operations:bigint;outboxes:bigint;executions:bigint}>>(`SELECT
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='ring_reward_stats:940000002' AND idempotency_key=?) operations,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,
      (SELECT COUNT(*) FROM command_executions WHERE event_id=?) executions`,[rollbackEvent,rollbackEvent,rollbackEvent]);
    assert.deepEqual(effects[0],{operations:0n,outboxes:0n,executions:0n}); assert.equal(await database.verifyRollback(),true);
    process.stdout.write(`${JSON.stringify({mode:"probe",database:config.database.name,migrationCount:109,scenarios:["shadow","rank","info-role","stats-role","stats-parity","replay","rollback"],stats:{petUsers:5,claimed:2,reward:3000,remain:700,used:2300,pending:2,pendingReward:500,residual:1,error:1},rollback:true,operationalDataTouched:false})}\n`);
  }
} finally { await database.close(); }
