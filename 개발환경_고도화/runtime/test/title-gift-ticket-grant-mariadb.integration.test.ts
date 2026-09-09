import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled=process.env.DATABASE_INTEGRATION_ENABLED==="true";
const required=(name:string)=>process.env[name]??"integration-not-configured";

describe("admin title gift ticket grant MariaDB integration",{skip:!enabled},()=>{
  let database:DatabaseClient;
  const token="title-ticket-grant-token",roomId="990000000000236",operatorExternalId="title-ticket-operator",unauthorizedExternalId="title-ticket-user",targetName="합성 타이틀 대상";
  const open=()=>createDatabaseClient({enabled:true,host:required("DATABASE_HOST"),port:Number(required("DATABASE_PORT")),user:required("DATABASE_USER"),password:required("DATABASE_PASSWORD"),name:required("DATABASE_NAME"),connectionLimit:5,connectTimeoutMs:5000});

  before(async()=>{
    database=open();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_TITLE_GIFT_TICKET_GRANT'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES('title-ticket-op','타이틀 관리자','synthetic','active')");
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES('title-ticket-role','타이틀 역할',1)");
    const operator=(await database.query<Array<{id:bigint}>>("SELECT id FROM admin_operators WHERE login_id='title-ticket-op'"))[0]!,role=(await database.query<Array<{id:bigint}>>("SELECT id FROM admin_roles WHERE code='title-ticket-role'"))[0]!;
    await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES (?,'inventory.title_gift_ticket.grant')",[role.id]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)",[operator.id,role.id]);
    await database.execute("INSERT INTO players(status,version) VALUES('active',1),('active',1),('active',1)");
    const players=await database.query<Array<{id:bigint}>>("SELECT id FROM players ORDER BY id DESC LIMIT 3"),target=players[0]!,unauthorized=players[1]!,operatorPlayer=players[2]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(?,?,1)",[target.id,targetName]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES(?,'kakao',?,'타이틀 관리자','linked'),(?,'kakao',?,'일반 회원','linked')",[operatorPlayer.id,operatorExternalId,unauthorized.id,unauthorizedExternalId]);
    const identity=(await database.query<Array<{id:bigint}>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?",[operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)",[operator.id,identity.id]);
  });

  after(async()=>{if(database)try{await database.close();}catch{}});

  it("grants once, keeps unauthorized and Shadow silent, rolls back and reconnects",async()=>{
    const replies:Array<{room:string;data:string}>=[];
    const config=loadConfig({NODE_ENV:"test",IRIS_SHARED_TOKEN:token,USER_VERIFICATION_PEPPER:"title-ticket-pepper",DATABASE_ENABLED:"true",DATABASE_HOST:required("DATABASE_HOST"),DATABASE_PORT:required("DATABASE_PORT"),DATABASE_USER:required("DATABASE_USER"),DATABASE_PASSWORD:required("DATABASE_PASSWORD"),DATABASE_NAME:required("DATABASE_NAME")});
    const dependencies={database,inspectIrisChannel:async()=>({mode:"operational" as const,channelClass:"open_group" as const,reason:"allowed" as const,evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}}),sendIrisTextReply:async(reply:{room:string;data:string})=>{replies.push(reply);}};
    let app=buildApp(config,dependencies);
    let send=(id:string,user:string,message:string)=>app.inject({method:"POST",url:`/api/v1/integrations/iris/events?token=${token}`,payload:{msg:message,room:"고도화팻테스트방",sender:"합성 관리자",json:{_id:id,chat_id:roomId,user_id:user}}});
    const event=`title-ticket-${Date.now()}`;
    assert.equal((await send(event,operatorExternalId,`/타이틀2, ${targetName}`)).statusCode,202);
    assert.equal(replies.at(-1)?.data,`${targetName}님에게 타이틀선물권💝(/타이틀선물 닉네임 내용) 2개를 지급했습니다.`);
    await send(event,operatorExternalId,`/타이틀2, ${targetName}`);
    let quantity=(await database.query<Array<{quantity:bigint}>>("SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id JOIN player_profiles profile ON profile.player_id=stack.player_id WHERE item.code='legacy-title-gift-ticket' AND profile.current_display_name=?",[targetName]))[0]!.quantity;
    assert.equal(quantity,2n);

    const beforeUnauthorized=replies.length;
    await send(`unauthorized-${Date.now()}`,unauthorizedExternalId,`/타이틀3, ${targetName}`);
    assert.equal(replies.length,beforeUnauthorized);
    quantity=(await database.query<Array<{quantity:bigint}>>("SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id JOIN player_profiles profile ON profile.player_id=stack.player_id WHERE item.code='legacy-title-gift-ticket' AND profile.current_display_name=?",[targetName]))[0]!.quantity;
    assert.equal(quantity,2n);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_TITLE_GIFT_TICKET_GRANT'");
    const beforeShadow=replies.length;await send(`shadow-${Date.now()}`,operatorExternalId,`/타이틀4, ${targetName}`);assert.equal(replies.length,beforeShadow);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_TITLE_GIFT_TICKET_GRANT'");
    await database.execute("CREATE TRIGGER synthetic_title_ticket_audit_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'");
    assert.equal((await send(`rollback-${Date.now()}`,operatorExternalId,`/타이틀5, ${targetName}`)).statusCode,500);
    await database.execute("DROP TRIGGER synthetic_title_ticket_audit_failure");
    quantity=(await database.query<Array<{quantity:bigint}>>("SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id JOIN player_profiles profile ON profile.player_id=stack.player_id WHERE item.code='legacy-title-gift-ticket' AND profile.current_display_name=?",[targetName]))[0]!.quantity;assert.equal(quantity,2n);

    await app.close();database=open();app=buildApp(config,{...dependencies,database});send=(id,user,message)=>app.inject({method:"POST",url:`/api/v1/integrations/iris/events?token=${token}`,payload:{msg:message,room:"고도화팻테스트방",sender:"합성 관리자",json:{_id:id,chat_id:roomId,user_id:user}}});
    assert.equal((await send(`reconnect-${Date.now()}`,operatorExternalId,`/타이틀, ${targetName}`)).statusCode,202);assert.match(replies.at(-1)!.data,/ 1개를 지급했습니다/);await app.close();
  });
});
