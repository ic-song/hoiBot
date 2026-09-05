import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { PackageDomainItemMutationStore, type PackageDomainTransaction } from "../src/package/domain-item-provider.js";
import { RaidCharmRankingReadService } from "../src/raid/raid-charm-ranking-read-service.js";
import { RaidStrikeSealCanonicalOwnershipProvider } from "../src/raid/raid-strike-seal-canonical-ownership-provider.js";
import { TrialTowerProvider } from "../src/trial/trial-tower-provider.js";

type ChangeInput = {actor:string;legacyPlayerId:string;requestKey:string;quantityDelta:bigint;reasonType:string};

class RecordingSealProvider extends RaidStrikeSealCanonicalOwnershipProvider {
  readonly changes:ChangeInput[]=[];
  balanceValue=3n;
  charmValue=new Map<string,bigint>();

  override isLegacyCompatibilityInput(value:string):boolean{return value==="ITEM-RWD-043";}
  override async change(_transaction:DatabaseTransaction,input:ChangeInput):Promise<{quantity:bigint;replayed:boolean}>{this.changes.push(input);return{quantity:this.balanceValue+input.quantityDelta,replayed:false};}
  override async balance(_transaction:DatabaseTransaction,_legacyPlayerId:string):Promise<bigint>{return this.balanceValue;}
  override async charmByLegacyPlayer(_transaction:DatabaseTransaction):Promise<Map<string,bigint>>{return this.charmValue;}
}

function transactionDatabase(transaction:DatabaseTransaction):DatabaseClient{return{
  ping:async()=>undefined,verifyRollback:async()=>true,
  query:async()=>{throw new Error("unexpected client query");},execute:async()=>{throw new Error("unexpected client execute");},
  withTransaction:<T>(work:(value:DatabaseTransaction)=>Promise<T>)=>work(transaction),close:async()=>undefined
};}

describe("raid strike seal canonical consumer routing",()=>{
  it("routes package stack balance and mutation through the one canonical ownership provider",async()=>{
    const provider=new RecordingSealProvider(),executed:Array<{sql:string;values:readonly unknown[]}>=[];
    const transaction:PackageDomainTransaction={
      query:async()=>{throw new Error("legacy stack query must not run");},
      execute:async(sql,values=[])=>{executed.push({sql,values});return{affectedRows:1n,insertId:1n};}
    };
    const store=new PackageDomainItemMutationStore(provider);
    const definition={id:"ITEM-RWD-043",type:"STACK" as const,displayName:"레이드타격대인장👑(+600👾)",metadata:{}};
    const mutation={operationId:"operation-1",sequenceNo:4,playerId:"308",quantity:2,reasonCode:"PACKAGE_GRANT"};
    assert.equal(await store.getBalance(transaction,definition,mutation),3);
    await store.add(transaction,definition,mutation);
    assert.deepEqual(provider.changes,[{actor:"package-domain-item",legacyPlayerId:"308",requestKey:"package:operation-1:4:PACKAGE_GRANT",quantityDelta:2n,reasonType:"PACKAGE_GRANT"}]);
    assert.equal(executed.some(row=>row.sql.includes("package_item_effects")),true);
    assert.equal(executed.some(row=>/inventory_stacks|inventory_ledger/.test(row.sql)),false);
  });

  it("routes an exact tower reward through canonical ownership without a legacy target write",async()=>{
    const provider=new RecordingSealProvider(),executed:string[]=[];
    let insertId=10n;
    const transaction:DatabaseTransaction={
      query:async<T>(sql:string):Promise<T>=>{
        if(sql.includes("FROM operations"))return [] as T;
        if(sql.includes("FROM trial_tower_seasons"))return [{season_key:"S1",max_daily_attempts:3,auto_bonus_attempts:0,free_floor_max:10n,paid_entry_point:"0.000"}] as T;
        if(sql.includes("FROM player_pet_daily_records"))return [{tower_attempts:0n}] as T;
        if(sql.includes("FROM trial_tower_progress"))return [{floor:0n}] as T;
        if(sql.includes("FROM trial_tower_event_bosses"))return [{boss_code:"B1",display_name:"보스",pet_type_name:null,rewards_json:[{itemCode:"ITEM-RWD-043",quantity:2}]}] as T;
        if(sql.includes("FROM item_definitions"))return [{id:1n,code:"trial_junk",quantity:0n}] as T;
        throw new Error(`unexpected query: ${sql}`);
      },
      execute:async(sql:string):Promise<DatabaseWriteResult>=>{executed.push(sql);insertId+=1n;return{affectedRows:1n,insertId};}
    };
    const result=await new TrialTowerProvider(transactionDatabase(transaction),()=>0.9,provider).attempt({
      eventId:"tower-event",destinationId:"room",playerId:"308",profile:{charm:2000,petType:null,upgrade:0,skills:[]},recordDate:"2026-09-06",suppressOutbox:true
    });
    assert.equal(result.status,"win");
    assert.deepEqual(provider.changes,[{actor:"trial-tower",legacyPlayerId:"308",requestKey:"tower:tower-event:1:0",quantityDelta:2n,reasonType:"TRIAL_TOWER_BOSS_REWARD"}]);
    assert.equal(executed.some(sql=>sql.includes("inventory_stacks")&&sql.includes("ITEM-RWD-043")),false);
  });

  it("adds the canonical seal quantity times sealed 600 to the ranking snapshot",async()=>{
    const provider=new RecordingSealProvider();provider.charmValue.set("308",1200n);
    const entryValues:unknown[][]=[];let insertId=100n;
    const transaction:DatabaseTransaction={
      query:async<T>(sql:string):Promise<T>=>{
        if(sql.includes("FROM players player"))return [{player_id:308n,pet_id:7n,source_order:1n,pet_image:"🐶",pet_title:"",pet_name:"테스트펫",item_raid_charm:5n,pet_experience:1n,mini_pet_raid_charm:0n,home_charm:0n,personal_cube_percent:"0",guild_cube_units:0n,pet_version:1n,item_version:1n,personal_cube_version:0n,guild_cube_version:0n}] as T;
        throw new Error(`unexpected query: ${sql}`);
      },
      execute:async(sql:string,values:readonly unknown[]=[]):Promise<DatabaseWriteResult>=>{if(sql.includes("raid_charm_rank_entries"))entryValues.push([...values]);insertId+=1n;return{affectedRows:1n,insertId};}
    };
    const result=await new RaidCharmRankingReadService(transactionDatabase(transaction),provider).handle({eventId:"rank-event",externalUserId:"kakao",channelId:"room",message:"/레이드매력순위"});
    assert.equal(result?.rowCount,1);
    assert.equal(entryValues.length,1);
    assert.equal(entryValues[0]?.[8],"1205");
    assert.equal(entryValues[0]?.[14],"1206");
  });
});
