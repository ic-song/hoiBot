import assert from "node:assert/strict";
import {after,before,describe,it} from "node:test";
import {buildApp} from "../src/app.js";
import {loadConfig} from "../src/config.js";
import {createDatabaseClient,type DatabaseClient} from "../src/database.js";

const enabled=process.env.DATABASE_INTEGRATION_ENABLED==="true";
const required=(name:string):string=>process.env[name]??"integration-not-configured";

describe("comment pin MariaDB integration",{skip:!enabled},()=>{
  let database:DatabaseClient;let playerId:bigint;
  const token="comment-pin-add-token";const roomId="990000000000432";const externalUserId=`comment-pin-add-${Date.now()}`;
  before(async()=>{
    database=createDatabaseClient({enabled:true,host:required("DATABASE_HOST"),port:Number(required("DATABASE_PORT")),user:required("DATABASE_USER"),password:required("DATABASE_PASSWORD"),name:required("DATABASE_NAME"),connectionLimit:5,connectTimeoutMs:5000});
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='HOME_COMMENT_PIN'");
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    playerId=(await database.query<Array<{id:bigint}>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'합성 집주인',1)",[playerId]);
    await database.execute("INSERT INTO player_homes(player_id,display_name,version) VALUES (?,'합성 홈',1)",[playerId]);
    await database.execute("INSERT INTO player_pets(player_id,display_name,version) VALUES (?,'합성 펫',1)",[playerId]);
    await database.execute("INSERT INTO player_passes(player_id,pass_code,enabled,permanent,starts_at) VALUES (?,'beginner',1,1,UTC_TIMESTAMP(3))",[playerId]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'합성 집주인','linked')",[playerId,externalUserId]);
    for(let index=1;index<=3;index+=1) await database.execute("INSERT INTO home_comments(home_player_id,author_player_id,body,status,created_at) VALUES (?,?,?,'visible',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND))",[playerId,playerId,`합성 댓글 ${index}`,index]);
    process.env.COMMENT_PIN_COMMAND_ENABLED="true";process.env.PARTIAL_COMMAND_DISPATCH_ENABLED="true";
  });
  after(async()=>{delete process.env.COMMENT_PIN_COMMAND_ENABLED;if(!database)return;try{await database.close();}catch(error){const code=typeof error==="object"&&error!==null&&"code" in error?(error as {code?:unknown}).code:undefined;if(code!=="ER_POOL_ALREADY_CLOSED")throw error;}});
  const createApp=(sendIrisTextReply:(reply:{room:string;data:string})=>Promise<void>)=>buildApp(loadConfig({NODE_ENV:"test",IRIS_SHARED_TOKEN:token,USER_VERIFICATION_PEPPER:"comment-pin-add-pepper",DATABASE_ENABLED:"true",DATABASE_HOST:required("DATABASE_HOST"),DATABASE_PORT:required("DATABASE_PORT"),DATABASE_USER:required("DATABASE_USER"),DATABASE_PASSWORD:required("DATABASE_PASSWORD"),DATABASE_NAME:required("DATABASE_NAME")}),{database,inspectIrisChannel:async()=>({mode:"operational",channelClass:"open_group",reason:"allowed",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}}),sendIrisTextReply});
  const send=(app:ReturnType<typeof createApp>,eventId:string,msg:string)=>app.inject({method:"POST",url:`/api/v1/integrations/iris/events?token=${token}`,payload:{msg,room:"고도화댓글핀등록테스트방",sender:"합성 집주인",json:{_id:eventId,chat_id:roomId,user_id:externalUserId}}});

  it("returns the guide without mutation",async()=>{const replies:Array<{room:string;data:string}>=[];const app=createApp(async reply=>{replies.push(reply);});const response=await send(app,`pin-guide-${Date.now()}`,"/댓글핀");assert.equal(response.statusCode,202,response.body);assert.match(replies.at(-1)?.data??"",/\/댓글핀 \[댓글번호\]/);});
  it("pins newest number two once with audit and outbox",async()=>{
    const replies:Array<{room:string;data:string}>=[];const app=createApp(async reply=>{replies.push(reply);});const eventId=`pin-add-${Date.now()}`;
    const first=await send(app,eventId,"/댓글핀 2");const second=await send(app,eventId,"/댓글핀 2");assert.equal(first.statusCode,202,first.body);assert.equal(second.statusCode,202,second.body);assert.match(replies[0]?.data??"",/합성 댓글 2/);
    const pins=await database.query<Array<{body:string;display_order:number}>>(`SELECT comment.body,pin.display_order FROM home_comment_pins pin JOIN home_comments comment ON comment.id=pin.comment_id WHERE pin.home_player_id=? AND pin.deleted_at IS NULL`,[playerId]);
    assert.deepEqual(pins,[{body:"합성 댓글 2",display_order:1}]);
    const key=`iris:${eventId}`;const evidence=(await database.query<Array<{mutations:bigint;audits:bigint;outbox:bigint}>>(`SELECT
      (SELECT COUNT(*) FROM home_comment_pin_mutations WHERE request_key=?) AS mutations,
      (SELECT COUNT(*) FROM command_audit audit JOIN home_comment_pin_mutations mutation ON mutation.operation_id=audit.operation_id WHERE mutation.request_key=?) AS audits,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN home_comment_pin_mutations mutation ON mutation.operation_id=outbox.operation_id WHERE mutation.request_key=?) AS outbox`,[key,key,key]))[0]!;
    assert.deepEqual(evidence,{mutations:1n,audits:1n,outbox:1n});
  });
  it("rolls pin, operation, audit and mutation back when outbox fails",async()=>{
    await database.execute("CREATE TRIGGER trg_comment_pin_outbox_fail BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic outbox failure'");
    const app=createApp(async()=>undefined);const eventId=`pin-rollback-${Date.now()}`;const before=(await database.query<Array<{count:bigint}>>("SELECT COUNT(*) AS count FROM home_comment_pins WHERE home_player_id=? AND deleted_at IS NULL",[playerId]))[0]!.count;
    try{const response=await send(app,eventId,"/댓글핀 1");assert.equal(response.statusCode,500,response.body);const afterCount=(await database.query<Array<{count:bigint}>>("SELECT COUNT(*) AS count FROM home_comment_pins WHERE home_player_id=? AND deleted_at IS NULL",[playerId]))[0]!.count;const mutations=(await database.query<Array<{count:bigint}>>("SELECT COUNT(*) AS count FROM home_comment_pin_mutations WHERE request_key=?",[`iris:${eventId}`]))[0]!.count;assert.equal(afterCount,before);assert.equal(mutations,0n);}finally{await database.execute("DROP TRIGGER IF EXISTS trg_comment_pin_outbox_fail");}
  });
  it("keeps Shadow pin mutation-free",async()=>{await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='HOME_COMMENT_PIN'");const before=(await database.query<Array<{count:bigint}>>("SELECT COUNT(*) AS count FROM home_comment_pins WHERE home_player_id=? AND deleted_at IS NULL",[playerId]))[0]!.count;const app=createApp(async()=>undefined);const eventId=`pin-shadow-${Date.now()}`;const response=await send(app,eventId,"/댓글핀 1");assert.equal(response.statusCode,202,response.body);const afterCount=(await database.query<Array<{count:bigint}>>("SELECT COUNT(*) AS count FROM home_comment_pins WHERE home_player_id=? AND deleted_at IS NULL",[playerId]))[0]!.count;assert.equal(afterCount,before);const route=(await database.query<Array<{route:string}>>("SELECT route FROM command_routing_decisions WHERE event_id=?",[`iris:${eventId}`]))[0]!;assert.equal(route.route,"SHADOW");await app.close();});
});
