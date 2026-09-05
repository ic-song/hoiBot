import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import mariadb from "mariadb";

const connection=await mariadb.createConnection({host:process.env.DATABASE_HOST!,port:Number(process.env.DATABASE_PORT),user:process.env.DATABASE_USER!,password:process.env.DATABASE_PASSWORD!,database:process.env.DATABASE_NAME!,multipleStatements:true});
const forward=await readFile("migrations/479_admin_global_gift_object_db.sql","utf8"),rollback=await readFile("migrations/rollback/479_admin_global_gift_object_db.rollback.sql","utf8");
try{
  const receipts=await connection.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM canonical_admin_global_gift_operations");
  if(receipts[0]!.count_value>0n){try{await connection.query(rollback);throw new Error("ROLLBACK_GUARD_MISSING");}catch(error){if(!String((error as Error).message).includes("ADMIN_GLOBAL_GIFT_RECEIPT_EXISTS"))throw error;}}
  await connection.beginTransaction();
  await connection.query("DELETE FROM canonical_admin_global_gift_channel_snapshots;DELETE FROM canonical_admin_global_gift_recipients;DELETE FROM canonical_admin_global_gift_operations;DELETE FROM command_executions WHERE command_code='ADMIN_GLOBAL_GIFT';DELETE FROM outbox_messages WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope='admin.inventory.global_gift.v1');DELETE FROM operations WHERE idempotency_scope='admin.inventory.global_gift.v1';DELETE stack FROM canonical_owned_item_stacks stack JOIN canonical_item_definition_imports binding ON binding.item_id=stack.item_id WHERE binding.source_system='LEGACY_JS' AND binding.source_namespace='member.bag' AND binding.source_identifier='호이응원패키지(무료)🐹[2]';DELETE FROM schema_migrations WHERE version='479_admin_global_gift_object_db.sql'");
  await connection.commit();
  await connection.query(rollback);
  const removed=await connection.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE 'canonical_admin_global_gift_%'");
  if(removed[0]!.count_value!==0n)throw new Error("ROLLBACK_TABLES_REMAIN");
  const now="2026-09-06 12:00:00",options=JSON.stringify({sourceObjectKey:"item.direct_bag.8349df1a3be0b247"});
  await connection.query("INSERT INTO canonical_item_definitions(item_id,item_name,item_kind,stackable_flag,active_flag,definition_options,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('zpreitm1','호이응원패키지(무료)🐹[2]','PACKAGE_ITEM',TRUE,TRUE,?,'wbs752-preexisting',?,'wbs752-preexisting',?)",[options,now,now]);
  await connection.query("INSERT INTO canonical_item_definition_imports(item_definition_import_id,item_id,source_system,source_namespace,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('zpreimp1','zpreitm1','LEGACY_JS','member.bag','호이응원패키지(무료)🐹[2]','wbs752-preexisting',?,'wbs752-preexisting',?)",[now,now]);
  await connection.query("UPDATE canonical_item_definitions SET definition_options=JSON_OBJECT('sourceObjectKey','drift') WHERE item_id='zpreitm1'");
  try{await connection.query(forward);throw new Error("SOURCE_DRIFT_GUARD_MISSING");}catch(error){if(!String((error as Error).message).includes("ADMIN_GLOBAL_GIFT_ITEM_SOURCE_DRIFT"))throw error;}
  await connection.query("UPDATE canonical_item_definitions SET definition_options=? WHERE item_id='zpreitm1'",[options]);
  await connection.query(forward);
  const preserved=await connection.query<Array<{item_id:string;INSERT_USER:string}>>("SELECT binding.item_id,item.INSERT_USER FROM canonical_item_definition_imports binding JOIN canonical_item_definitions item ON item.item_id=binding.item_id WHERE binding.source_system='LEGACY_JS' AND binding.source_namespace='member.bag' AND BINARY binding.source_identifier=BINARY '호이응원패키지(무료)🐹[2]'");
  if(preserved.length!==1||preserved[0]!.item_id!=="zpreitm1"||preserved[0]!.INSERT_USER!=="wbs752-preexisting")throw new Error("PREEXISTING_SOURCE_REASSIGNED");
  await connection.query(rollback);
  const afterRollback=await connection.query<Array<{item_id:string}>>("SELECT item_id FROM canonical_item_definition_imports WHERE item_definition_import_id='zpreimp1'");
  if(afterRollback[0]?.item_id!=="zpreitm1")throw new Error("PREEXISTING_SOURCE_REMOVED_BY_ROLLBACK");
  await connection.query("DELETE FROM canonical_item_definition_imports WHERE item_definition_import_id='zpreimp1';DELETE FROM canonical_item_definitions WHERE item_id='zpreitm1'");
  await connection.query(forward);
  await connection.query("INSERT INTO schema_migrations(version,checksum,applied_at) VALUES ('479_admin_global_gift_object_db.sql',?,UTC_TIMESTAMP(3))",[createHash("sha256").update(forward).digest("hex")]);
  const restored=await connection.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE 'canonical_admin_global_gift_%'");
  if(restored[0]!.count_value!==4n)throw new Error("REFORWARD_TABLES_MISSING");
  process.stdout.write(`guarded-rollback=${receipts[0]!.count_value>0n?"PASS":"PREVIOUSLY_PROVED"} source-drift=PASS preexisting-preserved=PASS rollback=PASS reapply=PASS tables=4\n`);
}finally{await connection.end();}
