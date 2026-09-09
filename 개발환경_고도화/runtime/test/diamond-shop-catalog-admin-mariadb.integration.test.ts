import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { DiamondShopCatalogAdminService } from "../src/shop/diamond-shop-catalog-admin-service.js";

const enabled=process.env.DATABASE_INTEGRATION_ENABLED==="true";
const required=(name:string):string=>process.env[name]??"integration-not-configured";
describe("diamond shop catalog admin MariaDB integration",{skip:!enabled},()=>{
  let database:DatabaseClient; const token="diamond-shop-token",roomId="990000000000630",adminId="diamond-shop-admin",userId="diamond-shop-user";
  const open=()=>createDatabaseClient({enabled:true,host:required("DATABASE_HOST"),port:Number(required("DATABASE_PORT")),user:required("DATABASE_USER"),password:required("DATABASE_PASSWORD"),name:required("DATABASE_NAME"),connectionLimit:5,connectTimeoutMs:5000});
  before(async()=>{
    database=open(); await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE handler_key='diamond_shop_catalog_admin'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES ('diamond-shop-op','다이아상점 관리자','synthetic','active')");
    const op=(await database.query<Array<{id:bigint}>>("SELECT id FROM admin_operators WHERE login_id='diamond-shop-op'"))[0]!;
    const role=(await database.query<Array<{id:bigint}>>("SELECT id FROM admin_roles WHERE code='manager'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)",[op.id,role.id]);
    for(const f of [{id:adminId,name:"다이아상점 관리자"},{id:userId,name:"일반 사용자"}]){
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const p=(await database.query<Array<{id:bigint}>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')",[p.id,f.id,f.name]);
      if(f.id===adminId){const identity=(await database.query<Array<{id:bigint}>>("SELECT id FROM external_identities WHERE external_user_id=?",[f.id]))[0]!;await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)",[op.id,identity.id]);}
    }
  });
  after(async()=>{if(!database)return;try{await database.close();}catch(e){const code=typeof e==="object"&&e!==null&&"code"in e?(e as{code?:unknown}).code:undefined;if(code!=="ER_POOL_ALREADY_CLOSED")throw e;}});
  it("preserves duplicate append, stable IDs, ordinal delete, replay, permission, rollback, restart and Shadow",async()=>{
    const replies:Array<{room:string;data:string}>=[]; const config=loadConfig({NODE_ENV:"test",IRIS_SHARED_TOKEN:token,USER_VERIFICATION_PEPPER:"diamond-shop-pepper",PARTIAL_COMMAND_DISPATCH_ENABLED:"true",DATABASE_ENABLED:"true",DATABASE_HOST:required("DATABASE_HOST"),DATABASE_PORT:required("DATABASE_PORT"),DATABASE_USER:required("DATABASE_USER"),DATABASE_PASSWORD:required("DATABASE_PASSWORD"),DATABASE_NAME:required("DATABASE_NAME")});
    const app=buildApp(config,{database,inspectIrisChannel:async()=>({mode:"operational",channelClass:"open_group",reason:"allowed",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}}),sendIrisTextReply:async r=>{replies.push(r);}});
    const send=(externalId:string,eventId:string,msg:string)=>app.inject({method:"POST",url:`/api/v1/integrations/iris/events?token=${token}`,payload:{msg,room:"고도화팻테스트방",sender:externalId,json:{_id:eventId,chat_id:roomId,user_id:externalId}}});
    const firstEvent="diamond-shop-add-1"; assert.equal((await send(adminId,firstEvent,"/다이아상점추가 특별 아이템 0 0")).statusCode,202); await send(adminId,firstEvent,"/다이아상점추가 특별 아이템 0 0");
    await send(adminId,"diamond-shop-add-2","/다이아상점추가 특별 아이템 2 15");
    const items=await database.query<Array<{product_id:string;reward_quantity:string;diamond_price:string;enabled:number}>>("SELECT product_id,reward_quantity,diamond_price,enabled FROM diamond_shop_catalog_items ORDER BY display_order");
    assert.equal(items.length,2); assert.notEqual(items[0]!.product_id,items[1]!.product_id); assert.equal(BigInt(items[0]!.reward_quantity),0n); assert.equal(BigInt(items[0]!.diamond_price),0n);
    await send(userId,"diamond-shop-denied","/다이아상점추가 금지 1 1"); assert.equal((await database.query<Array<{count:bigint}>>("SELECT COUNT(*) count FROM diamond_shop_catalog_items WHERE display_name='금지'"))[0]!.count,0n);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='DIAMOND_SHOP_CATALOG_ADD'"); await send(adminId,"diamond-shop-shadow","/다이아상점추가 그림자 1 1"); assert.equal((await database.query<Array<{count:bigint}>>("SELECT COUNT(*) count FROM diamond_shop_catalog_items WHERE display_name='그림자'"))[0]!.count,0n); await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='DIAMOND_SHOP_CATALOG_ADD'");
    await database.execute("CREATE TRIGGER fail_diamond_shop_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic diamond shop rollback'"); const rollback="diamond-shop-rollback"; assert.equal((await send(adminId,rollback,"/다이아상점추가 롤백 1 1")).statusCode,500); await database.execute("DROP TRIGGER fail_diamond_shop_audit"); assert.equal((await database.query<Array<{count:bigint}>>("SELECT COUNT(*) count FROM diamond_shop_catalog_items WHERE display_name='롤백'"))[0]!.count,0n);
    const deleteEvent="diamond-shop-delete"; await send(adminId,deleteEvent,"/다이아상점삭제 1"); const states=await database.query<Array<{product_id:string;enabled:number}>>("SELECT product_id,enabled FROM diamond_shop_catalog_items ORDER BY display_order"); assert.equal(states[0]!.enabled,0); assert.equal(states[1]!.enabled,1); assert.match(replies.at(-1)?.data??"",/삭제했습니다/);
    const bootstrap=(await database.query<Array<{bootstrap_source:string;bootstrap_status:string}>>("SELECT bootstrap_source,bootstrap_status FROM diamond_shop_catalog_state"))[0]!; assert.deepEqual(bootstrap,{bootstrap_source:"legacy.defaultShop",bootstrap_status:"pending_seed"});
    await app.close();try{await database.close();}catch{}database=open();const replay=await new DiamondShopCatalogAdminService(database).handle({externalUserId:adminId,channelId:roomId,message:"/다이아상점삭제 1",eventId:`iris:${deleteEvent}`});assert.equal(replay?.replayed,true);assert.equal((await database.query<Array<{count:bigint}>>("SELECT COUNT(*) count FROM diamond_shop_catalog_events"))[0]!.count,3n);
  });
});
