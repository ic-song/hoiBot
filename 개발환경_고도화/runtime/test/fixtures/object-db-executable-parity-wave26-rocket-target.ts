import { createHash,randomUUID } from "node:crypto";
import { readFileSync,writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { createDatabaseClient,type DatabaseClient,type DatabaseTransaction } from "../../src/database.js";
import { IrisAdminCommandService } from "../../src/admin/iris-admin-command-service.js";
import { RocketPackageGrantService } from "../../src/admin/rocket-package-grant-service.js";

const [inputPath,outputPath]=process.argv.slice(2);if(!inputPath||!outputPath)throw new Error("Wave26 target arguments missing");
const request=JSON.parse(readFileSync(resolve(inputPath),"utf8"));
const config=loadConfig().database;if(config.host!=="127.0.0.1"||config.port===3306||!config.name.startsWith("hoibot_wave26_rocket_"))throw new Error("Wave26 database isolation rejected");
const database=createDatabaseClient(config),normalize=(sql:string)=>sql.replace(/\s+/g," ").trim();
const allowed=["operations","outbox_messages","command_executions","command_audit","canonical_owned_item_stacks","canonical_item_inventory_operations","canonical_item_inventory_ledger_entries"];
const dml=/^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z0-9_]+)/i;
const stable=(value:unknown):unknown=>JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==="bigint"?item.toString():item).replace(/"(?:[a-z0-9]{8})"/g,(raw)=>raw));
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function snapshot(){
  const rows:Record<string,unknown[]>={
    operations:await database.query("SELECT idempotency_scope,idempotency_key,status,CAST(result_json AS CHAR) result_json FROM operations WHERE idempotency_scope='admin.rocket_package.grant' ORDER BY idempotency_key"),
    outbox_messages:await database.query("SELECT operation.idempotency_key,outbox.destination_id,CAST(outbox.payload_json AS CHAR) payload_json,outbox.status FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='admin.rocket_package.grant' ORDER BY operation.idempotency_key"),
    command_executions:await database.query("SELECT execution.event_id,execution.command_code,execution.execution_status,execution.result_code FROM command_executions execution JOIN operations operation ON operation.id=execution.operation_id WHERE operation.idempotency_scope='admin.rocket_package.grant' ORDER BY execution.event_id"),
    command_audit:await database.query("SELECT operation.idempotency_key,audit.action_code,audit.result_code,CAST(audit.change_summary_json AS CHAR) change_summary_json FROM command_audit audit JOIN operations operation ON operation.id=audit.operation_id WHERE operation.idempotency_scope='admin.rocket_package.grant' ORDER BY operation.idempotency_key"),
    canonical_owned_item_stacks:await database.query("SELECT stack.player_id,definition.item_name,stack.quantity FROM canonical_owned_item_stacks stack JOIN canonical_item_definitions definition ON definition.item_id=stack.item_id WHERE stack.player_id='player01' ORDER BY definition.item_name"),
    canonical_item_inventory_operations:await database.query("SELECT player_id,request_key,operation_status,resulting_quantity FROM canonical_item_inventory_operations WHERE player_id='player01' ORDER BY request_key"),
    canonical_item_inventory_ledger_entries:await database.query("SELECT operation.request_key,ledger.player_id,definition.item_name,ledger.quantity_delta,ledger.reason_type FROM canonical_item_inventory_ledger_entries ledger JOIN canonical_item_inventory_operations operation ON operation.item_inventory_operation_id=ledger.item_inventory_operation_id JOIN canonical_item_definitions definition ON definition.item_id=ledger.item_id WHERE ledger.player_id='player01' ORDER BY operation.request_key")
  };return stable(rows) as Record<string,unknown[]>;
}
async function reset(){
  await database.execute("DROP TRIGGER IF EXISTS wave26_fail_command_audit");
  for(const sql of ["DELETE FROM command_audit","DELETE FROM command_executions","DELETE FROM outbox_messages","DELETE FROM canonical_item_inventory_ledger_orderings","DELETE FROM canonical_item_inventory_ledger_heads","DELETE FROM canonical_item_inventory_ledger_entries","DELETE FROM canonical_item_inventory_operations","DELETE FROM canonical_owned_item_stacks","DELETE FROM operations WHERE idempotency_scope='admin.rocket_package.grant'","DELETE FROM event_inbox WHERE event_id LIKE 'wave26-%'","DELETE FROM canonical_item_definitions WHERE item_id LIKE 'rocket%'","DELETE FROM canonical_players WHERE player_id='player01'"])await database.execute(sql);
  await database.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('player01','LEGACY_JSON','대상 회원','WBS793','2026-09-09 16:00:00','WBS793','2026-09-09 16:00:00')");
  for(let n=1;n<=10;n++)await database.execute("INSERT INTO canonical_item_definitions(item_id,item_name,item_kind,stackable_flag,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES(?,?, 'PACKAGE',TRUE,TRUE,'WBS793','2026-09-09 16:00:00','WBS793','2026-09-09 16:00:00')",[`rocket${String(n).padStart(2,"0")}`,`로켓배송패키지🚀[${n}](/호팡오픈${n})`]);
  await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_ROCKET_PACKAGE_GRANT'");
}
async function event(id:string,user="wave26-admin"){await database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES(?,'iris',?,'wave26-room',?,'message','incoming',REPEAT('6',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",[id,id,user]);}
function traced(rollbackOnly=false){const attempts:any[]=[];const wrapper:DatabaseClient={...database,ping:()=>database.ping(),verifyRollback:()=>database.verifyRollback(),query:(s,p)=>database.query(s,p),execute:(s,p)=>database.execute(s,p),close:async()=>undefined,withTransaction:async<T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>database.withTransaction(async transaction=>{const attempt={attempt:attempts.length+1,outcome:"ROLLBACK",attemptedDmlStatements:[] as string[],affectedDmlStatements:[] as string[],affectedRowCount:0,lockOrder:[] as string[],failure:null as null|string};attempts.push(attempt);const proxy:DatabaseTransaction={query:async<T>(sql:string,values=[])=>{const q=normalize(sql);if(/FOR UPDATE/i.test(q))for(const match of q.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z0-9_]+)/gi))if(!attempt.lockOrder.includes(match[1]!))attempt.lockOrder.push(match[1]!);return transaction.query<T>(sql,values);},execute:async(sql,values=[])=>{const q=normalize(sql),match=dml.exec(q);if(match&&allowed.includes(match[1]!))attempt.attemptedDmlStatements.push(q);const result=await transaction.execute(sql,values);if(match&&allowed.includes(match[1]!)){attempt.affectedDmlStatements.push(q);attempt.affectedRowCount+=Number(result.affectedRows);}return result;}};try{const result=await work(proxy);if(rollbackOnly)throw new Error("WAVE26_SHADOW_ROLLBACK");attempt.outcome="COMMIT";return result;}catch(error){attempt.failure=error instanceof Error?error.message:String(error);throw error;}})};return{wrapper,attempts};}

try{
  if(request.mode==="RESET"){await reset();writeFileSync(outputPath,JSON.stringify({reset:true,processId:process.pid}));}
  else if(request.mode==="FAIL_ON_AUDIT"){await database.execute("CREATE TRIGGER wave26_fail_command_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='WAVE26_DOMAIN_FAILURE'");writeFileSync(outputPath,JSON.stringify({ready:true}));}
  else{
    await event(request.eventId,request.mode==="AUTH"?"wave26-unauthorized":"wave26-admin");const before=await snapshot(),trace=traced(request.mode==="SHADOW");let result:any=null,errorCode:null|string=null;
    try{result=request.mode==="AUTH"?await new IrisAdminCommandService(trace.wrapper).handleRocketPackageGrant({externalUserId:"wave26-unauthorized",channelId:"wave26-room",message:request.message,eventId:request.eventId}):await new RocketPackageGrantService(trace.wrapper).grant({eventId:request.eventId,destinationId:"wave26-room",operatorId:"998100001",message:request.message});}catch(error){errorCode=error instanceof Error?error.message:String(error);}
    if(request.mode==="AUTH"&&trace.attempts.length===0)trace.attempts.push({attempt:1,outcome:"COMMIT",attemptedDmlStatements:[],affectedDmlStatements:[],affectedRowCount:0,lockOrder:[],failure:null});
    const after=await snapshot(),committed=trace.attempts.filter(x=>x.outcome==="COMMIT"),rolled=trace.attempts.filter(x=>x.outcome==="ROLLBACK");
    writeFileSync(outputPath,JSON.stringify({processId:process.pid,moduleExecutionId:randomUUID(),mode:request.mode,role:request.role,result,errorCode,replayed:request.role==="REPLAY"||(result?.status==="granted"&&committed.flatMap(x=>x.affectedDmlStatements).length===0),database:{host:config.host,port:config.port,name:config.name},attempts:trace.attempts,committedDmlStatements:committed.flatMap(x=>x.affectedDmlStatements),committedRowCount:committed.reduce((s,x)=>s+x.affectedRowCount,0),rolledBackAffectedRowCount:rolled.reduce((s,x)=>s+x.affectedRowCount,0),before,after,beforeSha256:hash(before),afterSha256:hash(after),externalNetworkCalls:0,replyCalls:0}));
  }
}finally{await database.close();}
