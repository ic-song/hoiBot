import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { RingRewardUseService } from "../src/ring/ring-reward-use-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_ring_reward_use(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic reward-use probe is blocked for database: ${config.database.name}`);
const baseEventId = process.env.RING_REWARD_USE_PROBE_EVENT_ID ?? "ring-reward-use-g7-20260826-r1";
const verifyRestart = process.argv.includes("--verify-restart");
const database = createDatabaseClient(config.database);
const service = new RingRewardUseService(database);

// command_executions 외래 키를 만족하는 비식별 합성 이벤트를 준비합니다.
async function seedEvent(eventId: string, userId: string): Promise<void> {
  await database.execute(`INSERT INTO event_inbox
    (event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at)
    VALUES (?,?,'synthetic-reward-use-room',?,'message','incoming',REPEAT('6',64),'processed',UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)`, [eventId, eventId, userId]);
}

// 감사 기록 직전 실패를 주입해 inventory와 pet 변경의 전체 rollback을 검증합니다.
function failingOnAudit(inner: DatabaseClient): DatabaseClient {
  return { ping:()=>inner.ping(),query:(sql,p)=>inner.query(sql,p),execute:(sql,p)=>inner.execute(sql,p),
    verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,
    withTransaction:<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction((transaction)=>work({
      query:(sql,p)=>transaction.query(sql,p),execute:async(sql,p)=>{
        if(sql.includes("INSERT INTO command_audit")) throw new Error("synthetic reward use audit failure");
        return transaction.execute(sql,p);
      }
    })) };
}

// 보상권 수량과 펫 존재 상태가 다른 다섯 합성 사용자를 준비합니다.
async function seedFixtures(): Promise<void> {
  const users = [[980000001,"reward-use-normal"],[980000002,"reward-use-zero"],[980000003,"reward-use-empty"],[980000004,"reward-use-no-pet"],[980000005,"reward-use-rollback"]];
  for (let index=0; index<users.length; index++) {
    const [playerId,userId]=users[index]!;
    await database.execute("INSERT INTO players(id,status) VALUES (?,'active')",[playerId]);
    await database.execute(`INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status)
      VALUES (?,?, 'kakao',?,'합성 사용자','linked')`,[990000001+index,playerId,userId]);
  }
  for(const [playerId,experience] of [[980000001,100],[980000002,10],[980000003,20],[980000005,30]]) {
    await database.execute("INSERT INTO player_pets(player_id,display_name,experience) VALUES (?,'합성펫',?)",[playerId,experience]);
  }
  const items=await database.query<Array<{id:bigint}>>("SELECT id FROM item_definitions WHERE code='ITEM-RING-CHARM-REWARD'");
  for(const [playerId,quantity] of [[980000001,5],[980000002,2],[980000005,3]]) {
    await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1)",[playerId,items[0]!.id,quantity]);
  }
}

try {
  const numericEvent=`${baseEventId}-numeric`, scope="ring.reward_use:980000001";
  if(verifyRestart) {
    const before=await database.query<Array<{experience:bigint;stacks:bigint;operations:bigint}>>(`SELECT pet.experience,
      (SELECT COUNT(*) FROM inventory_stacks WHERE player_id=pet.player_id) stacks,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope=? AND idempotency_key=?) operations
      FROM player_pets pet WHERE pet.player_id=980000001`,[scope,numericEvent]);
    const replay=await service.handleIris({externalUserId:"reward-use-normal",channelId:"synthetic-reward-use-room",message:"/보상받기 10",eventId:numericEvent});
    const after=await database.query<Array<{experience:bigint;stacks:bigint;operations:bigint}>>(`SELECT pet.experience,
      (SELECT COUNT(*) FROM inventory_stacks WHERE player_id=pet.player_id) stacks,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope=? AND idempotency_key=?) operations
      FROM player_pets pet WHERE pet.player_id=980000001`,[scope,numericEvent]);
    assert.equal(replay.status,"changed");assert.deepEqual(after,before);assert.deepEqual(after[0],{experience:105n,stacks:0n,operations:1n});
    process.stdout.write(`${JSON.stringify({mode:"verify-restart",database:config.database.name,experience:105,inventoryStacks:0,operationCount:1,additionalMutation:false,operationalDataTouched:false})}\n`);
  } else {
    await seedFixtures();
    const shadow=await service.handleIris({externalUserId:"reward-use-normal",channelId:"synthetic-reward-use-room",message:"/보상받기",eventId:`${baseEventId}-shadow`});
    assert.equal(shadow.status,"shadow");
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='RING_REWARD_USE'");
    for(const [suffix,user] of [["one","reward-use-normal"],["numeric","reward-use-normal"],["zero","reward-use-zero"],["empty","reward-use-empty"],["no-pet","reward-use-no-pet"],["rollback","reward-use-rollback"]]) await seedEvent(`${baseEventId}-${suffix}`,user);
    const one=await service.handleIris({externalUserId:"reward-use-normal",channelId:"synthetic-reward-use-room",message:"/보상받기",eventId:`${baseEventId}-one`});
    assert.equal(one.status,"changed");if(one.status==="changed") assert.match(one.data,/사용: 1개\n매력💕 \+1\n현재 펫 매력💕: 101/);
    const replay=await service.handleIris({externalUserId:"reward-use-normal",channelId:"synthetic-reward-use-room",message:"/보상받기",eventId:`${baseEventId}-one`});assert.deepEqual(replay,one);
    const numeric=await service.handleIris({externalUserId:"reward-use-normal",channelId:"synthetic-reward-use-room",message:"/보상받기 10",eventId:numericEvent});
    assert.equal(numeric.status,"changed");if(numeric.status==="changed") assert.match(numeric.data,/사용: 4개\n매력💕 \+4\n현재 펫 매력💕: 105/);
    const zero=await service.handleIris({externalUserId:"reward-use-zero",channelId:"synthetic-reward-use-room",message:"/보상받기 0",eventId:`${baseEventId}-zero`});assert.equal(zero.status,"changed");if(zero.status==="changed")assert.equal(zero.data,"사용법: /보상받기 또는 /보상받기 숫자");
    const empty=await service.handleIris({externalUserId:"reward-use-empty",channelId:"synthetic-reward-use-room",message:"/보상받기",eventId:`${baseEventId}-empty`});assert.equal(empty.status,"changed");if(empty.status==="changed")assert.equal(empty.data,"사용할 반지 매력 보상권이 없습니다.");
    const noPet=await service.handleIris({externalUserId:"reward-use-no-pet",channelId:"synthetic-reward-use-room",message:"/보상받기",eventId:`${baseEventId}-no-pet`});assert.equal(noPet.status,"changed");if(noPet.status==="changed")assert.equal(noPet.data,"펫을 먼저 생성해주세요.");
    await assert.rejects(()=>new RingRewardUseService(failingOnAudit(database)).consume({playerId:"980000005",identityId:"990000005",destinationId:"synthetic-reward-use-room",sourceEventId:`${baseEventId}-rollback`,idempotencyKey:`${baseEventId}-rollback`,requestedQuantity:3n}),/synthetic reward use audit failure/);
    const effects=await database.query<Array<{normalExp:bigint;normalStacks:bigint;normalLedger:bigint;zeroExp:bigint;zeroQty:bigint;rollbackExp:bigint;rollbackQty:bigint;rollbackOps:bigint}>>(`SELECT
      (SELECT experience FROM player_pets WHERE player_id=980000001) normalExp,
      (SELECT COUNT(*) FROM inventory_stacks WHERE player_id=980000001) normalStacks,
      (SELECT COUNT(*) FROM inventory_ledger WHERE player_id=980000001 AND reason_code='RING_REWARD_USE') normalLedger,
      (SELECT experience FROM player_pets WHERE player_id=980000002) zeroExp,
      (SELECT quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=980000002 AND item.code='ITEM-RING-CHARM-REWARD') zeroQty,
      (SELECT experience FROM player_pets WHERE player_id=980000005) rollbackExp,
      (SELECT quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=980000005 AND item.code='ITEM-RING-CHARM-REWARD') rollbackQty,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='ring.reward_use:980000005') rollbackOps`);
    assert.deepEqual(effects[0],{normalExp:105n,normalStacks:0n,normalLedger:2n,zeroExp:10n,zeroQty:2n,rollbackExp:30n,rollbackQty:3n,rollbackOps:0n});
    assert.equal(await database.verifyRollback(),true);
    process.stdout.write(`${JSON.stringify({mode:"probe",database:config.database.name,migrationCount:110,scenarios:["shadow","default-one","replay","numeric-clamp","zero-guide","no-reward","missing-pet","rollback"],effects:{experience:105,inventoryStacks:0,ledger:2,zeroUnchanged:true,rollback:"0/30/3"},operationalDataTouched:false})}\n`);
  }
} finally { await database.close(); }
