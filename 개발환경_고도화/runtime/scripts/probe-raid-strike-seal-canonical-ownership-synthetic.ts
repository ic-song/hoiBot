import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PackageDomainItemMutationStore, type PackageDomainTransaction } from "../src/package/domain-item-provider.js";
import { RaidCharmRankingReadService } from "../src/raid/raid-charm-ranking-read-service.js";
import { RaidStrikeSealCanonicalOwnershipProvider } from "../src/raid/raid-strike-seal-canonical-ownership-provider.js";
import { TrialTowerProvider } from "../src/trial/trial-tower-provider.js";

const config=loadConfig();
if(!config.database.enabled||config.database.name!=="hoibot_item25_wbs754_20260906")throw new Error("WBS754_ISOLATED_DATABASE_REQUIRED");
const database=createDatabaseClient(config.database),provider=new RaidStrikeSealCanonicalOwnershipProvider();
const audit=["wbs754","2026-09-06 12:00:00","wbs754","2026-09-06 12:00:00"] as const;

async function seed():Promise<void>{
  await database.withTransaction(async tx=>{
    await tx.execute("INSERT INTO players(id,status) VALUES (308,'active')");
    await tx.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (308,'WBS754 합성회원')");
    await tx.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (308,'kakao','wbs754-kakao','WBS754 합성회원','linked')");
    await tx.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES ('wbs754-tower-1','wbs754-tower-1','wbs754-room','wbs754-kakao','message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3)),('wbs754-rank-1','wbs754-rank-1','wbs754-room','wbs754-kakao','message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3))");
    await tx.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('pseal001','LEGACY_JSON','player/308',?,?,?,?)",audit);
    await tx.execute("INSERT INTO canonical_player_identity_crosswalks(canonical_player_identity_crosswalk_id,provider_code,external_user_id,player_id,crosswalk_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('cseal001','kakao','wbs754-kakao','pseal001','LINKED',?,?,?,?)",audit);
    await tx.execute("INSERT INTO object_identities(object_identity_id,object_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('rseal001','CANONICAL_ITEM_DEFINITIONS',?,?,?,?)",audit);
    await tx.execute("INSERT INTO canonical_item_definitions(item_id,item_name,item_kind,stackable_flag,active_flag,definition_options,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('rseal001','레이드타격대인장👑(+600👾)','RAID_SPECIAL',TRUE,TRUE,JSON_OBJECT('name','레이드타격대인장👑(+600👾)','exp',600),?,?,?,?)",audit);
    await tx.execute("INSERT INTO canonical_item_definition_imports(item_definition_import_id,item_id,source_system,source_namespace,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('iseal001','rseal001','LEGACY_JSON','itemInfo.json','/raidSpecialItem/dept2/item_0',?,?,?,?)",audit);
    await tx.execute("INSERT INTO object_identity_crosswalks(object_identity_crosswalk_id,object_identity_id,source_system,source_namespace,source_identifier,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('xseal001','rseal001','LEGACY_JSON','object-import.item.canonical_item_definitions','064bcb1971ffce549b2d5f00810b58d3bcc0bec937d89b5bb232f40037c9f8bf','77cb001679d3e915622e91a872848c4c53b388479d4c88ca68760361e18c6ee9',?,?,?,?)",audit);
    const legacy=(await tx.query<Array<{id:bigint}>>("SELECT id FROM item_definitions WHERE code='ITEM-RWD-043'"))[0]!;
    await tx.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity) VALUES (308,?,9)",[legacy.id]);
    await tx.execute("INSERT INTO player_overall_charm_skill_rules(rule_code,display_name,raid_charm,castle_charm,condition_code,condition_threshold,home_charm_percent,active) VALUES ('WBS754-LEGACY-EXACT','레이드타격대인장👑(+600👾)',600,0,NULL,0,0,TRUE)");
    await tx.execute("INSERT INTO player_pets(player_id,display_name,image_value,experience) VALUES (308,'합성펫','🐶',6)");
    await tx.execute("INSERT INTO trial_tower_event_bosses(season_key,floor,boss_code,display_name,pet_type_name,rewards_json,active) VALUES ('current',1,'WBS754-BOSS','합성보스',NULL,JSON_ARRAY(JSON_OBJECT('itemCode','ITEM-RWD-043','quantity',10)),TRUE)");
  });
}

async function snapshot():Promise<{canonicalQuantity:bigint;canonicalOperations:bigint;canonicalLedger:bigint;legacyQuantity:bigint;legacyTargetLedger:bigint}>{
  const row=(await database.query<Array<Record<string,bigint|string>>>(`SELECT
    COALESCE((SELECT quantity FROM canonical_owned_item_stacks WHERE player_id='pseal001' AND item_id='rseal001'),0) canonicalQuantity,
    (SELECT COUNT(*) FROM canonical_item_inventory_operations WHERE player_id='pseal001') canonicalOperations,
    (SELECT COUNT(*) FROM canonical_item_inventory_ledger_entries WHERE player_id='pseal001' AND item_id='rseal001') canonicalLedger,
    COALESCE((SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions definition ON definition.id=stack.item_id WHERE stack.player_id=308 AND definition.code='ITEM-RWD-043'),0) legacyQuantity,
    (SELECT COUNT(*) FROM inventory_ledger ledger JOIN item_definitions definition ON definition.id=ledger.item_id WHERE ledger.player_id=308 AND definition.code='ITEM-RWD-043') legacyTargetLedger`))[0]!;
  return{canonicalQuantity:BigInt(row.canonicalQuantity!),canonicalOperations:BigInt(row.canonicalOperations!),canonicalLedger:BigInt(row.canonicalLedger!),legacyQuantity:BigInt(row.legacyQuantity!),legacyTargetLedger:BigInt(row.legacyTargetLedger!)};
}

function failCanonicalLedger(inner:DatabaseClient):DatabaseClient{return{
  ping:()=>inner.ping(),query:(sql,values)=>inner.query(sql,values),execute:(sql,values)=>inner.execute(sql,values),verifyRollback:()=>inner.verifyRollback(),close:async()=>undefined,
  withTransaction:<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>inner.withTransaction(tx=>work({query:(sql,values)=>tx.query(sql,values),execute:(sql,values)=>sql.includes("INSERT INTO canonical_item_inventory_ledger_entries")?Promise.reject(new Error("WBS754_SYNTHETIC_LEDGER_FAILURE")):tx.execute(sql,values)}))
};}

try{
  await seed();
  const exact=await database.withTransaction(async tx=>({definition:await provider.resolve(tx),playerId:await provider.resolvePlayer(tx,"308")}));
  assert.deepEqual(exact,{definition:{itemId:"rseal001",raidCharmPerItem:600n},playerId:"pseal001"});

  const packageOperation=(await database.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status) VALUES (?,'wbs754.package','package-1','player',308,'synthetic','processing')",[randomUUID()])).insertId;
  const packageMutation={operationId:packageOperation.toString(),sequenceNo:1,playerId:"308",quantity:2,reasonCode:"WBS754_PACKAGE"};
  await database.withTransaction(tx=>new PackageDomainItemMutationStore().add(tx as unknown as PackageDomainTransaction,{id:"ITEM-RWD-043",type:"STACK",displayName:"레이드타격대인장👑(+600👾)",metadata:{}},packageMutation));
  const afterPackage=await snapshot();
  assert.deepEqual(afterPackage,{canonicalQuantity:2n,canonicalOperations:1n,canonicalLedger:1n,legacyQuantity:9n,legacyTargetLedger:0n});

  const restarted=new RaidStrikeSealCanonicalOwnershipProvider();
  const packageReplay=await database.withTransaction(tx=>restarted.change(tx,{actor:"package-domain-item",legacyPlayerId:"308",requestKey:`package:${packageOperation}:1:WBS754_PACKAGE`,quantityDelta:2n,reasonType:"WBS754_PACKAGE"}));
  assert.deepEqual(packageReplay,{quantity:2n,replayed:true});
  assert.deepEqual(await snapshot(),afterPackage);

  const towerInput={eventId:"wbs754-tower-1",destinationId:"wbs754-room",playerId:"308",profile:{charm:2000,petType:null,upgrade:0,skills:[] as string[]},recordDate:"2026-09-06",suppressOutbox:true};
  const tower=await new TrialTowerProvider(database,()=>0.9).attempt(towerInput);
  assert.equal(tower.status,"win");
  const afterTower=await snapshot();
  assert.deepEqual(afterTower,{canonicalQuantity:12n,canonicalOperations:2n,canonicalLedger:2n,legacyQuantity:9n,legacyTargetLedger:0n});
  const towerReplay=await new TrialTowerProvider(database,()=>0).attempt(towerInput);
  assert.equal(towerReplay.status,"win");
  assert.deepEqual(await snapshot(),afterTower);

  const ranking=await new RaidCharmRankingReadService(database).handle({eventId:"wbs754-rank-1",externalUserId:"wbs754-kakao",channelId:"wbs754-room",message:"/레이드매력순위"});
  assert.equal(ranking?.rowCount,1);
  const rankRow=(await database.query<Array<Record<string,bigint|string>>>("SELECT item_raid_charm,pet_experience,final_raid_charm FROM raid_charm_rank_entries ORDER BY snapshot_id DESC,ordinal_value LIMIT 1"))[0]!;
  const rankEntry={item_raid_charm:BigInt(rankRow.item_raid_charm!),pet_experience:BigInt(rankRow.pet_experience!),final_raid_charm:BigInt(rankRow.final_raid_charm!)};
  assert.deepEqual(rankEntry,{item_raid_charm:7200n,pet_experience:6n,final_raid_charm:7206n});

  const beforeRollback=await snapshot();
  await assert.rejects(failCanonicalLedger(database).withTransaction(tx=>new RaidStrikeSealCanonicalOwnershipProvider().change(tx,{actor:"wbs754-rollback",legacyPlayerId:"308",requestKey:"rollback-1",quantityDelta:1n,reasonType:"WBS754_ROLLBACK"})),/WBS754_SYNTHETIC_LEDGER_FAILURE/);
  assert.deepEqual(await snapshot(),beforeRollback);

  process.stdout.write(`${JSON.stringify({status:"PASS",exact:{itemId:exact.definition.itemId,playerId:exact.playerId,raidCharmPerItem:exact.definition.raidCharmPerItem.toString()},afterPackage,packageReplay,afterTower,towerReplay:true,rankEntry,rollbackPreserved:true,legacyTargetDualWrite:false},(_key,value)=>typeof value==="bigint"?value.toString():value)}\n`);
}finally{await database.close();}
