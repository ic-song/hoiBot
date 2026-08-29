import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { OverallRankRewardPayoutService } from "../src/admin/overall-rank-reward-payout-service.js";

const config=loadConfig();
if(!config.database.enabled||config.database.name!=="hoibot_overall_rank_reward_payout_g7") throw new Error(`Blocked database: ${config.database.name}`);
const database=createDatabaseClient(config.database);
const restart=process.argv.includes("--verify-restart");
const base=process.env.OVERALL_RANK_REWARD_EVENT_ID??"overall-rank-reward-fixed";
const room="synthetic-overall-rank-reward-room",noticeRoom="synthetic-overall-rank-reward-notice",externalUserId="synthetic-overall-rank-reward-master";
let period="2026-08-29";
const service=new OverallRankRewardPayoutService(database,()=>period);

async function event(id:string,userId=externalUserId):Promise<void>{await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",[id,id,room,userId]);}
function failAudit(inner:DatabaseClient):DatabaseClient{return{ping:()=>inner.ping(),query:(sql,params)=>inner.query(sql,params),execute:(sql,params)=>inner.execute(sql,params),verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,withTransaction:<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction(transaction=>work({query:(sql,params)=>transaction.query(sql,params),execute:async(sql,params)=>{if(sql.includes("INSERT INTO command_audit"))throw new Error("synthetic overall rank reward audit failure");return transaction.execute(sql,params);}}))};}
async function state(){return(await database.query<Array<{runs:bigint;snapshots:bigint;entries:bigint;recipients:bigint;ledgers:bigint;statuses:bigint;operations:bigint;outboxes:bigint;audits:bigint;executions:bigint;quantity:string}>>(`SELECT
 (SELECT COUNT(*) FROM overall_rank_reward_runs) runs,(SELECT COUNT(*) FROM overall_rank_reward_snapshots) snapshots,(SELECT COUNT(*) FROM overall_rank_reward_snapshot_entries) entries,
 (SELECT COUNT(*) FROM overall_rank_reward_recipients) recipients,(SELECT COUNT(*) FROM inventory_ledger WHERE reason_code='overall_rank_reward_payout') ledgers,
 (SELECT COUNT(*) FROM overall_rank_reward_status) statuses,(SELECT COUNT(*) FROM operations WHERE idempotency_scope='admin.overall_rank_reward.payout') operations,
 (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='admin.overall_rank_reward.payout') outboxes,
 (SELECT COUNT(*) FROM command_audit WHERE action_code='admin.overall_rank_reward.payout') audits,(SELECT COUNT(*) FROM command_executions WHERE command_code='OVERALL_RANK_REWARD_PAYOUT') executions,
 COALESCE((SELECT SUM(stack.quantity) FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE item.code='pet_enhance_stone'),'0') quantity`))[0]!;}
async function payout(id:string){await event(id);return service.payout({eventId:id,externalUserId,channelId:room,message:"/보상지급"});}

try{
 const expected={runs:3n,snapshots:3n,entries:450n,recipients:450n,ledgers:450n,statuses:150n,operations:3n,outboxes:6n,audits:3n,executions:3n,quantity:"1320"};
 if(restart){const before=await state();period="2026-08-29";const replay=await payout(`${base}-restart-replay`);assert.equal(replay.periodKey,"2026-08-29");assert.deepEqual(await state(),before);assert.deepEqual(before,expected);process.stdout.write(`${JSON.stringify({mode:"verify-restart",runs:3,snapshots:3,entries:450,recipients:450,quantity:1320,additionalMutation:false,operationalDataTouched:false})}\n`);}else{
  assert.equal((await database.query<Array<{rollout_state:string}>>("SELECT rollout_state FROM command_registry WHERE command_code='OVERALL_RANK_REWARD_PAYOUT'"))[0]!.rollout_state,"SHADOW");
  await event(`${base}-shadow`);assert.deepEqual(await service.handleIris({eventId:`${base}-shadow`,externalUserId,channelId:room,message:"/보상지급"}),{status:"shadow"});
  const operatorPlayer=await database.execute("INSERT INTO players(status,version) VALUES('active',1)");
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(?,'합성 종합보상 운영자',1)",[operatorPlayer.insertId]);
  const identity=await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES(?,'kakao',?,'합성 종합보상 운영자','linked')",[operatorPlayer.insertId,externalUserId]);
  const operator=await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES('synthetic-overall-rank-reward','합성 종합보상 운영자',REPEAT('a',60),'active')");
  await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)",[operator.insertId,identity.insertId]);
  await database.execute("INSERT INTO overall_rank_reward_operator_allowlist(operator_id,active) VALUES (?,TRUE)",[operator.insertId]);
  await database.execute("INSERT INTO overall_rank_reward_destinations(destination_id,display_order,active) VALUES (?,1,TRUE)",[noticeRoom]);
  await database.execute("UPDATE overall_rank_reward_policies SET maximum_rank=150,enabled=TRUE WHERE policy_version=1");
  await database.execute("INSERT INTO overall_rank_reward_rules(policy_version,rank_start,rank_end,reward_quantity) VALUES (1,1,1,70),(1,2,10,10),(1,11,150,2)");
  const playerIds:bigint[]=[];
  for(let index=0;index<151;index+=1){const player=await database.execute("INSERT INTO players(status,version) VALUES('active',1)");playerIds.push(player.insertId);await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)",[player.insertId,`합성 종합회원${String(index+1).padStart(3,"0")}`]);const experience=index<2?1000000:1000000-index;await database.execute("INSERT INTO player_pets(player_id,display_name,experience,enhancement_level,version) VALUES (?,?,?,0,1)",[player.insertId,`합성펫${index+1}`,experience]);}
  await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='OVERALL_RANK_REWARD_PAYOUT'");
  await event(`${base}-unauthorized`,"unknown-user");await assert.rejects(()=>service.payout({eventId:`${base}-unauthorized`,externalUserId:"unknown-user",channelId:room,message:"/보상지급"}),/권한이 없습니다/);
  const first=await payout(`${base}-success`);assert.equal(first.eligiblePlayerCount,151);assert.equal(first.recipientCount,150);assert.equal(first.totalRewardQuantity,"440");assert.equal(first.outboxIds.length,2);
  assert.deepEqual(await payout(`${base}-period-replay`),first);
  const top=await database.query<Array<{ordinal_value:number;player_id:bigint}>>("SELECT ordinal_value,player_id FROM overall_rank_reward_snapshot_entries WHERE snapshot_id=? AND ordinal_value<=2 ORDER BY ordinal_value",[first.snapshotId]);assert.deepEqual(top.map(row=>row.player_id),playerIds.slice(0,2));
  const excluded=(await database.query<Array<{quantity:bigint}>>("SELECT COALESCE(SUM(stack.quantity),0) quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code='pet_enhance_stone'",[playerIds[150]]))[0]!.quantity;assert.equal(BigInt(excluded),0n);
  period="2026-08-30";const beforeRollback=await state();await event(`${base}-rollback`);await assert.rejects(()=>new OverallRankRewardPayoutService(failAudit(database),()=>period).payout({eventId:`${base}-rollback`,externalUserId,channelId:room,message:"/보상지급"}),/synthetic overall rank reward audit failure/);assert.deepEqual(await state(),beforeRollback);assert.equal(await database.verifyRollback(),true);assert.equal((await payout(`${base}-recovery`)).periodKey,"2026-08-30");
  period="2026-08-31";assert.equal((await payout(`${base}-third`)).recipientCount,150);assert.deepEqual(await state(),expected);
  process.stdout.write(`${JSON.stringify({mode:"probe",migrationCount:361,scenarios:["shadow","operator-rbac","official-overall-score","stable-player-id-tie","rank150-included","rank151-excluded","period-replay","audit-rollback","retry"],effects:{runs:3,snapshots:3,entries:450,recipients:450,ledgers:450,statuses:150,quantity:1320,outboxes:6,audits:3,executions:3},operationalDataTouched:false})}\n`);
 }
}finally{await database.close();}
