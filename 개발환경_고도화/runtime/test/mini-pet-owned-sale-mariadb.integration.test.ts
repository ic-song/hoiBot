import assert from "node:assert/strict";
import { it } from "node:test";
import mariadb from "mariadb";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { MiniPetOwnedSaleService } from "../src/mini-pet/owned-sale-service.js";

const enabled = process.env.HOIBOT_ISOLATED_MARIADB === "1";

it("sells one stable mini-pet once and preserves durable lifecycle history", { skip: !enabled }, async () => {
  const pool = mariadb.createPool({ host:process.env.MARIADB_HOST!, port:Number(process.env.MARIADB_PORT),
    user:process.env.MARIADB_USER!, password:process.env.MARIADB_PASSWORD!, database:process.env.MARIADB_DATABASE!,
    connectionLimit:2, bigIntAsNumber:false });
  const database = {
    async withTransaction<T>(work:(tx:DatabaseTransaction)=>Promise<T>):Promise<T>{
      const connection=await pool.getConnection();
      try{await connection.beginTransaction();
        const tx={query:async<R>(sql:string,p?:unknown[])=>connection.query(sql,p) as Promise<R>,
          execute:async(sql:string,p?:unknown[]):Promise<DatabaseWriteResult>=>{
            const result=await connection.query(sql,p) as {affectedRows?:number|bigint;insertId?:number|bigint};
            return {affectedRows:BigInt(result.affectedRows??0),insertId:BigInt(result.insertId??0)};
          }} as DatabaseTransaction;
        const result=await work(tx); await connection.commit(); return result;
      }catch(error){await connection.rollback();throw error;}finally{connection.release();}
    }
  } as DatabaseClient;
  try{
    const c=await pool.getConnection();
    try{
      await c.query("INSERT INTO players (id) VALUES (1)");
      await c.query("INSERT INTO player_profiles (player_id,current_display_name) VALUES (1,'판매자')");
      await c.query("INSERT INTO external_identities (id,player_id,provider_code,external_user_id,status) VALUES (1,1,'kakao','sale-user','linked')");
      await c.query("INSERT INTO event_inbox (event_id,event_kind,processing_status,received_at) VALUES ('sale-event','message','processed',UTC_TIMESTAMP(3))");
      await c.query("INSERT INTO mini_pet_projection_environment_identity (singleton_id,environment_code,database_identity) VALUES (1,'dev','00000000-0000-0000-0000-000000000055')");
      await c.query("INSERT INTO mini_pet_definitions (id,code,display_name) VALUES (900055,'sale-pet','판매펫')");
      await c.query("INSERT INTO owned_mini_pets (id,player_id,mini_pet_definition_id,custom_name,equipped) VALUES (700055,1,900055,'첫째',FALSE),(700056,1,900055,'둘째',FALSE)");
      await c.query(`INSERT INTO mini_pet_inventory_owned_states
        (owned_mini_pet_id,player_id,stable_owned_id,sort_index) VALUES
        (700055,1,'00000000-0000-0000-0000-000000700055',2),
        (700056,1,'00000000-0000-0000-0000-000000700056',3)`);
      await c.query("INSERT INTO mini_pet_sale_policies (mini_pet_definition_id,point_price,sellable) VALUES (900055,5000,TRUE)");
      await c.query("INSERT INTO currency_definitions (code,display_name,scale_digits) VALUES ('point','포인트',0) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name)");
      await c.query("INSERT INTO currency_accounts (player_id,currency_code,balance,version) VALUES (1,'point',1000,1)");
    }finally{c.release();}
    const service=new MiniPetOwnedSaleService(database);
    const command={externalUserId:"sale-user",channelId:"sale-room",eventId:"sale-event",message:"/미니펫판매 2",environmentCode:"dev" as const};
    const first=await service.execute(command); const replay=await service.execute(command);
    assert.equal(first.status,"sold"); assert.equal(first.ownedMiniPetId,"700055"); assert.equal(first.pointBalance,"6000");
    assert.equal(replay.replayed,true); assert.equal(replay.ownedMiniPetId,"700055");
    const v=await pool.getConnection();
    try{
      const lifecycle=await v.query<Array<{owned_mini_pet_id:bigint;state_code:string}>>("SELECT owned_mini_pet_id,state_code FROM mini_pet_owned_lifecycle");
      const events=await v.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM mini_pet_sale_events");
      const ledger=await v.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM currency_ledger WHERE reason_code='mini_pet_owned_sale'");
      const account=await v.query<Array<{balance:string}>>("SELECT balance FROM currency_accounts WHERE player_id=1 AND currency_code='point'");
      const states=await v.query<Array<{owned_mini_pet_id:bigint;sort_index:number|null}>>("SELECT owned_mini_pet_id,sort_index FROM mini_pet_inventory_owned_states ORDER BY owned_mini_pet_id");
      assert.deepEqual(lifecycle.map(row=>[Number(row.owned_mini_pet_id),row.state_code]),[[700055,"sold"]]);
      assert.equal(Number(events[0]!.count_value),1); assert.equal(Number(ledger[0]!.count_value),1);
      assert.equal(String(account[0]!.balance),"6000.000");
      assert.deepEqual(states.map(row=>[Number(row.owned_mini_pet_id),row.sort_index]),[[700055,null],[700056,2]]);
    }finally{v.release();}
  }finally{await pool.end();}
});
