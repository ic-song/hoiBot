import assert from "node:assert/strict";
import { after,before,describe,it } from "node:test";
import { createDatabaseClient,type DatabaseClient,type DatabaseTransaction,type RootTransactionDatabaseClient } from "../src/database.js";
import { AdminGlobalGiftService,ADMIN_GLOBAL_GIFT_COMMAND,ADMIN_GLOBAL_GIFT_MESSAGE,dispatchAdminGlobalGiftCommand } from "../src/admin/admin-global-gift-service.js";
import { TransactionCommitAckAmbiguousError } from "../src/shared/transaction-receipt-outbox-contract.js";

const enabled=process.env.RUN_ADMIN_GLOBAL_GIFT_MARIADB==="1";
const config={enabled:true,host:process.env.DATABASE_HOST!,port:Number(process.env.DATABASE_PORT),user:process.env.DATABASE_USER!,password:process.env.DATABASE_PASSWORD!,name:process.env.DATABASE_NAME!,connectionLimit:5,connectTimeoutMs:5000};
let database:DatabaseClient;
const audit=["wbs752-test","2026-09-06 12:00:00","wbs752-test","2026-09-06 12:00:00"];

describe("admin global gift isolated MariaDB",{skip:!enabled},()=>{
  before(async()=>{
    database=createDatabaseClient(config);
    const adminIdentity=(await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (NULL,'kakao','wbs752-admin','합성관리자','linked')")).insertId;
    const operator=(await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES ('wbs752-admin','합성관리자','synthetic-not-login','active')")).insertId;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)",[operator,adminIdentity]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT ?,id FROM admin_roles WHERE code='super_admin'",[operator]);
    for(let index=1;index<=3;index+=1){const legacy=(await database.execute("INSERT INTO players(status) VALUES ('active')")).insertId;await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,?)",[legacy,`합성회원${index}`]);await database.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?, ?,?,?,?)",[`player0${index}`,'LEGACY_DB',legacy.toString(),...audit]);}
    for(let index=1;index<=11;index+=1)await database.execute("INSERT INTO canonical_admin_global_gift_channel_configs(admin_global_gift_channel_config_id,channel_sequence,destination_id,config_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,'ACTIVE',?,?,?,?)",[`chan${String(index).padStart(4,'0')}`,index,`synthetic-room-${index}`,...audit]);
    for(const eventId of ["wbs752-unauthorized","wbs752-config-gap","wbs752-event-1","wbs752-ambiguous","wbs752-unmapped","wbs752-overflow"])await database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?, 'iris',?, 'synthetic-command-room','wbs752-admin','message','incoming',REPEAT('0',64),'parsed','processed',UTC_TIMESTAMP(3))",[eventId,eventId]);
  });
  after(async()=>{await database.close();});

  it("matches the pinned applied operations key and has no logical outbox id column",async()=>{
    const fks=await database.query<Array<{COLUMN_NAME:string;REFERENCED_TABLE_NAME:string;REFERENCED_COLUMN_NAME:string}>>("SELECT COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canonical_admin_global_gift_operations' AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY CONSTRAINT_NAME");
    assert.ok(fks.some(row=>row.COLUMN_NAME==="operation_key"&&row.REFERENCED_TABLE_NAME==="operations"&&row.REFERENCED_COLUMN_NAME==="operation_key"));
    const columns=await database.query<Array<{COLUMN_NAME:string}>>("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canonical_admin_global_gift_channel_snapshots'");
    assert.equal(columns.some(row=>row.COLUMN_NAME==="outbox_message_id"),false);
  });

  it("fails closed for an unauthorized identity and an incomplete eleven-channel config",async()=>{
    await assert.rejects(()=>new AdminGlobalGiftService(database).handle({eventId:"wbs752-unauthorized",externalUserId:"synthetic-outsider",channelId:"synthetic-command-room",message:ADMIN_GLOBAL_GIFT_COMMAND}),error=>String(error).includes("선물 전달 권한이 없습니다"));
    await database.execute("UPDATE canonical_admin_global_gift_channel_configs SET config_status='INACTIVE' WHERE channel_sequence=11");
    await assert.rejects(()=>new AdminGlobalGiftService(database).handle({eventId:"wbs752-config-gap",externalUserId:"wbs752-admin",channelId:"synthetic-command-room",message:ADMIN_GLOBAL_GIFT_COMMAND}),error=>String(error).includes("채널 11개 설정이 필요합니다"));
    await database.execute("UPDATE canonical_admin_global_gift_channel_configs SET config_status='ACTIVE' WHERE channel_sequence=11");
    const count=(await database.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM canonical_admin_global_gift_operations"))[0]!.count_value;assert.equal(count,0n);
  });

  it("executes once, preserves ordered eleven outboxes, and replays concurrently",async()=>{
    const input={eventId:"wbs752-event-1",externalUserId:"wbs752-admin",channelId:"synthetic-command-room",message:ADMIN_GLOBAL_GIFT_COMMAND};
    const [first,second]=await Promise.all([new AdminGlobalGiftService(database).handle(input),new AdminGlobalGiftService(database).handle(input)]);
    assert.equal([first.replayed,second.replayed].filter(Boolean).length,1);
    const result=first.replayed?second:first;
    assert.equal(result.affectedMemberCount,"3");assert.equal(result.quantityDelta,"1");assert.equal(result.replies.length,11);
    assert.deepEqual(result.replies.map(row=>row.room),Array.from({length:11},(_,index)=>`synthetic-room-${index+1}`));
    assert.ok(result.replies.every(row=>row.data===ADMIN_GLOBAL_GIFT_MESSAGE));
    const stacks=await database.query<Array<{quantity:bigint}>>("SELECT stack.quantity FROM canonical_owned_item_stacks stack JOIN canonical_item_definition_imports binding ON binding.item_id=stack.item_id WHERE binding.source_system='LEGACY_JS' AND binding.source_namespace='member.bag' AND binding.source_identifier='호이응원패키지(무료)🐹[2]' ORDER BY stack.player_id");
    assert.deepEqual(stacks.map(row=>row.quantity),[1n,1n,1n]);
  });

  it("replays after restart and keeps SHADOW side-effect free",async()=>{
    await database.close();database=createDatabaseClient(config);
    const replay=await new AdminGlobalGiftService(database).handle({eventId:"wbs752-event-1",externalUserId:"wbs752-admin",channelId:"synthetic-command-room",message:ADMIN_GLOBAL_GIFT_COMMAND});
    assert.equal(replay.replayed,true);assert.equal(replay.replies.length,11);
    await assert.rejects(()=>new AdminGlobalGiftService(database).handle({eventId:"wbs752-event-1",externalUserId:"wbs752-admin",channelId:"synthetic-other-room",message:ADMIN_GLOBAL_GIFT_COMMAND}),error=>String(error).includes("REQUEST_REUSE_PAYLOAD_CONFLICT"));
    const shadow=await dispatchAdminGlobalGiftCommand({database,isOperationalChannel:true,duplicate:false,route:"SHADOW",handlerKey:"admin_global_gift",eventId:"wbs752-shadow",externalUserId:"wbs752-admin",channelId:"synthetic-command-room",message:ADMIN_GLOBAL_GIFT_COMMAND,queueError:async()=>{throw new Error("NO_REPLY");}});
    assert.deepEqual(shadow,[]);
    const count=(await database.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM canonical_admin_global_gift_operations"))[0]!.count_value;assert.equal(count,1n);
  });

  it("rejects replay when durable outbox payload or delivery status drifts",async()=>{
    const outbox=(await database.query<Array<{outbox_message_id:bigint}>>("SELECT outbox.id AS outbox_message_id FROM canonical_admin_global_gift_operations gift JOIN operations legacy_operation ON legacy_operation.operation_key=gift.operation_key JOIN outbox_messages outbox ON outbox.operation_id=legacy_operation.id WHERE gift.request_key='wbs752-event-1' ORDER BY outbox.id LIMIT 1"))[0]!;
    await database.execute("UPDATE outbox_messages SET payload_json=? WHERE id=?",[JSON.stringify({data:"tampered"}),outbox.outbox_message_id]);
    await assert.rejects(()=>new AdminGlobalGiftService(database).handle({eventId:"wbs752-event-1",externalUserId:"wbs752-admin",channelId:"synthetic-command-room",message:ADMIN_GLOBAL_GIFT_COMMAND}),error=>String(error).includes("ADMIN_GLOBAL_GIFT_REPLAY_OUTBOX_DRIFT"));
    await database.execute("UPDATE outbox_messages SET payload_json=?,status='invalid' WHERE id=?",[JSON.stringify({data:ADMIN_GLOBAL_GIFT_MESSAGE}),outbox.outbox_message_id]);
    await assert.rejects(()=>new AdminGlobalGiftService(database).handle({eventId:"wbs752-event-1",externalUserId:"wbs752-admin",channelId:"synthetic-command-room",message:ADMIN_GLOBAL_GIFT_COMMAND}),error=>String(error).includes("ADMIN_GLOBAL_GIFT_REPLAY_OUTBOX_DRIFT"));
    await database.execute("UPDATE outbox_messages SET status='pending' WHERE id=?",[outbox.outbox_message_id]);
  });

  it("rejects same-count recipient substitution and quantity-pair drift",async()=>{
    const recipient=(await database.query<Array<{admin_global_gift_recipient_id:string;player_id:string;quantity_before:bigint;quantity_after:bigint}>>("SELECT recipient.admin_global_gift_recipient_id,recipient.player_id,recipient.quantity_before,recipient.quantity_after FROM canonical_admin_global_gift_recipients recipient JOIN canonical_admin_global_gift_operations gift ON gift.admin_global_gift_operation_id=recipient.admin_global_gift_operation_id WHERE gift.request_key='wbs752-event-1' ORDER BY recipient.recipient_sequence LIMIT 1"))[0]!;
    const inactiveLegacy=(await database.execute("INSERT INTO players(status) VALUES ('inactive')")).insertId;
    await database.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('driftpl1','LEGACY_DB',?, ?,?,?,?)",[inactiveLegacy.toString(),...audit]);
    await database.execute("UPDATE canonical_admin_global_gift_recipients SET player_id='driftpl1' WHERE admin_global_gift_recipient_id=?",[recipient.admin_global_gift_recipient_id]);
    await assert.rejects(()=>new AdminGlobalGiftService(database).handle({eventId:"wbs752-event-1",externalUserId:"wbs752-admin",channelId:"synthetic-command-room",message:ADMIN_GLOBAL_GIFT_COMMAND}),error=>String(error).includes("ADMIN_GLOBAL_GIFT_REPLAY_EVIDENCE_DRIFT"));
    await database.execute("UPDATE canonical_admin_global_gift_recipients SET player_id=?,quantity_before=?,quantity_after=? WHERE admin_global_gift_recipient_id=?",[recipient.player_id,recipient.quantity_before+1n,recipient.quantity_after+1n,recipient.admin_global_gift_recipient_id]);
    await assert.rejects(()=>new AdminGlobalGiftService(database).handle({eventId:"wbs752-event-1",externalUserId:"wbs752-admin",channelId:"synthetic-command-room",message:ADMIN_GLOBAL_GIFT_COMMAND}),error=>String(error).includes("ADMIN_GLOBAL_GIFT_REPLAY_EVIDENCE_DRIFT"));
    await database.execute("UPDATE canonical_admin_global_gift_recipients SET quantity_before=?,quantity_after=? WHERE admin_global_gift_recipient_id=?",[recipient.quantity_before,recipient.quantity_after,recipient.admin_global_gift_recipient_id]);
    const stack=(await database.query<Array<{owned_item_stack_id:string;player_id:string}>>("SELECT owned_item_stack_id,player_id FROM canonical_admin_global_gift_recipients WHERE admin_global_gift_recipient_id=?",[recipient.admin_global_gift_recipient_id]))[0]!;
    await database.execute("UPDATE canonical_owned_item_stacks SET player_id='driftpl1' WHERE owned_item_stack_id=?",[stack.owned_item_stack_id]);
    await assert.rejects(()=>new AdminGlobalGiftService(database).handle({eventId:"wbs752-event-1",externalUserId:"wbs752-admin",channelId:"synthetic-command-room",message:ADMIN_GLOBAL_GIFT_COMMAND}),error=>String(error).includes("ADMIN_GLOBAL_GIFT_REPLAY_EVIDENCE_DRIFT"));
    await database.execute("UPDATE canonical_owned_item_stacks SET player_id=? WHERE owned_item_stack_id=?",[stack.player_id,stack.owned_item_stack_id]);
    const operation=(await database.query<Array<{admin_global_gift_operation_id:string;item_id:string}>>("SELECT admin_global_gift_operation_id,item_id FROM canonical_admin_global_gift_operations WHERE request_key='wbs752-event-1'"))[0]!;
    await database.execute("INSERT INTO canonical_item_definitions(item_id,item_name,item_kind,stackable_flag,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('c4n7x2qa','합성대체아이템','TEST',TRUE,TRUE,?,?,?,?)",audit);
    await database.execute("UPDATE canonical_admin_global_gift_operations SET item_id='c4n7x2qa' WHERE admin_global_gift_operation_id=?",[operation.admin_global_gift_operation_id]);
    await assert.rejects(()=>new AdminGlobalGiftService(database).handle({eventId:"wbs752-event-1",externalUserId:"wbs752-admin",channelId:"synthetic-command-room",message:ADMIN_GLOBAL_GIFT_COMMAND}),error=>String(error).includes("ADMIN_GLOBAL_GIFT_REPLAY_EVIDENCE_DRIFT"));
    await database.execute("UPDATE canonical_admin_global_gift_operations SET item_id=? WHERE admin_global_gift_operation_id=?",[operation.item_id,operation.admin_global_gift_operation_id]);
    await database.execute("DELETE FROM canonical_item_definitions WHERE item_id='c4n7x2qa'");
  });

  it("reconciles an ambiguous commit only after the same complete receipt and eleven outboxes verify",async()=>{
    const root=database as RootTransactionDatabaseClient;
    const ambiguous:DatabaseClient&RootTransactionDatabaseClient={
      ping:()=>database.ping(),verifyRollback:()=>database.verifyRollback(),query:<T>(sql:string,values?:readonly unknown[])=>database.query<T>(sql,values),execute:(sql:string,values?:readonly unknown[])=>database.execute(sql,values),withTransaction:<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>database.withTransaction(work),close:async()=>undefined,
      withRootTransaction:async<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>{await root.withRootTransaction(work);throw new TransactionCommitAckAmbiguousError();}
    };
    const result=await new AdminGlobalGiftService(ambiguous).handle({eventId:"wbs752-ambiguous",externalUserId:"wbs752-admin",channelId:"synthetic-command-room",message:ADMIN_GLOBAL_GIFT_COMMAND});
    assert.equal(result.replayed,false);assert.equal(result.replies.length,11);
    const count=(await database.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM canonical_admin_global_gift_operations WHERE request_key='wbs752-ambiguous'"))[0]!.count_value;assert.equal(count,1n);
  });

  it("fails closed when any active legacy member lacks a canonical player mapping",async()=>{
    const legacy=(await database.execute("INSERT INTO players(status) VALUES ('active')")).insertId;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,?)",[legacy,"합성미이관회원"]);
    await assert.rejects(()=>new AdminGlobalGiftService(database).handle({eventId:"wbs752-unmapped",externalUserId:"wbs752-admin",channelId:"synthetic-command-room",message:ADMIN_GLOBAL_GIFT_COMMAND}),error=>String(error).includes("활성 회원 canonical 연결이 완전하지 않습니다"));
    const count=(await database.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM canonical_admin_global_gift_operations WHERE request_key='wbs752-unmapped'"))[0]!.count_value;assert.equal(count,0n);
    await database.execute("UPDATE players SET status='inactive' WHERE id=?",[legacy]);
  });

  it("rolls back snapshots and prior increments on an overflowing member",async()=>{
    const player=(await database.query<Array<{player_id:string}>>("SELECT stack.player_id FROM canonical_owned_item_stacks stack JOIN canonical_item_definition_imports binding ON binding.item_id=stack.item_id WHERE binding.source_system='LEGACY_JS' AND binding.source_namespace='member.bag' AND binding.source_identifier='호이응원패키지(무료)🐹[2]' ORDER BY stack.player_id LIMIT 1"))[0]!;
    await database.execute("UPDATE canonical_owned_item_stacks stack JOIN canonical_item_definition_imports binding ON binding.item_id=stack.item_id SET stack.quantity=18446744073709551615 WHERE stack.player_id=? AND binding.source_system='LEGACY_JS' AND binding.source_namespace='member.bag' AND binding.source_identifier='호이응원패키지(무료)🐹[2]'",[player.player_id]);
    const outboxBefore=(await database.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM outbox_messages WHERE destination_id LIKE 'synthetic-room-%'"))[0]!.count_value;
    await assert.rejects(()=>new AdminGlobalGiftService(database).handle({eventId:"wbs752-overflow",externalUserId:"wbs752-admin",channelId:"synthetic-command-room",message:ADMIN_GLOBAL_GIFT_COMMAND}));
    const operationCount=(await database.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM canonical_admin_global_gift_operations WHERE request_key='wbs752-overflow'"))[0]!.count_value;assert.equal(operationCount,0n);
    const outboxCount=(await database.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM outbox_messages WHERE destination_id LIKE 'synthetic-room-%'"))[0]!.count_value;assert.equal(outboxCount,outboxBefore);
  });
});
