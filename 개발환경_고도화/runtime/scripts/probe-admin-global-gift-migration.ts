import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import mariadb from "mariadb";

const connection=await mariadb.createConnection({host:process.env.DATABASE_HOST!,port:Number(process.env.DATABASE_PORT),user:process.env.DATABASE_USER!,password:process.env.DATABASE_PASSWORD!,database:process.env.DATABASE_NAME!,multipleStatements:true});
const forward=await readFile("migrations/479_admin_global_gift_object_db.sql","utf8"),rollback=await readFile("migrations/rollback/479_admin_global_gift_object_db.rollback.sql","utf8");
const externalSchema=process.env.ADMIN_GLOBAL_GIFT_EXTERNAL_REFERENCE_SCHEMA;
if(externalSchema!==undefined&&!/^[A-Za-z0-9_]+$/.test(externalSchema))throw new Error("INVALID_EXTERNAL_REFERENCE_SCHEMA");
try{
  const receipts=await connection.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM canonical_admin_global_gift_operations");
  if(receipts[0]!.count_value>0n){try{await connection.query(rollback);throw new Error("ROLLBACK_GUARD_MISSING");}catch(error){if(!String((error as Error).message).includes("ADMIN_GLOBAL_GIFT_DURABLE_STATE_EXISTS"))throw error;}}
  await connection.beginTransaction();
  await connection.query("DELETE FROM canonical_admin_global_gift_channel_snapshots;DELETE FROM canonical_admin_global_gift_recipients;DELETE FROM canonical_admin_global_gift_operations;DELETE FROM command_executions WHERE command_code='ADMIN_GLOBAL_GIFT';DELETE FROM outbox_messages WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope='admin.inventory.global_gift.v1');DELETE FROM operations WHERE idempotency_scope='admin.inventory.global_gift.v1';DELETE stack FROM canonical_owned_item_stacks stack JOIN canonical_item_definition_imports binding ON binding.item_id=stack.item_id WHERE binding.source_system='LEGACY_JS' AND binding.source_namespace='member.bag' AND binding.source_identifier='호이응원패키지(무료)🐹[2]';DELETE FROM schema_migrations WHERE version='479_admin_global_gift_object_db.sql'");
  await connection.commit();
  await connection.query(rollback);
  const freshRollback=await connection.query<Array<{table_count:bigint;item_count:bigint;import_count:bigint}>>("SELECT (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE 'canonical_admin_global_gift_%') table_count,(SELECT COUNT(*) FROM canonical_item_definitions WHERE item_id='j7uyw6vc' AND INSERT_USER='migration_479') item_count,(SELECT COUNT(*) FROM canonical_item_definition_imports WHERE item_definition_import_id='phk8c656' AND item_id='j7uyw6vc') import_count");
  if(freshRollback[0]!.table_count!==0n||freshRollback[0]!.item_count!==1n||freshRollback[0]!.import_count!==1n)throw new Error("SHARED_CATALOG_SEED_ROLLBACK_CONTRACT_DRIFT");
  await connection.query(forward);
  const probeLegacy=(await connection.query("INSERT INTO players(status) VALUES ('active')") as {insertId:bigint}).insertId;
  await connection.query("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('prvplyr1','LEGACY_DB',?,'wbs752-probe','2026-09-06 12:00:00','wbs752-probe','2026-09-06 12:00:00')",[probeLegacy.toString()]);
  await connection.query("INSERT INTO canonical_owned_item_stacks(owned_item_stack_id,player_id,item_id,quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('prvstak1','prvplyr1','j7uyw6vc',1,'wbs752-probe','2026-09-06 12:00:00','wbs752-probe','2026-09-06 12:00:00');INSERT INTO canonical_owned_item_instances(owned_item_id,player_id,item_id,ownership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('prvinst1','prvplyr1','j7uyw6vc','owned','wbs752-probe','2026-09-06 12:00:00','wbs752-probe','2026-09-06 12:00:00')");
  let externalTable:string|undefined;
  if(externalSchema!==undefined){externalTable=`\`${externalSchema}\`.\`canonical_owned_item_instances\``;await connection.query(`INSERT INTO ${externalTable}(external_owned_item_id,item_id) VALUES ('extinst1','j7uyw6vc')`);}
  await connection.query(rollback);
  const retained=await connection.query<Array<{table_count:bigint;stack_count:bigint;instance_count:bigint;item_count:bigint}>>("SELECT (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE 'canonical_admin_global_gift_%') table_count,(SELECT COUNT(*) FROM canonical_owned_item_stacks WHERE owned_item_stack_id='prvstak1' AND item_id='j7uyw6vc') stack_count,(SELECT COUNT(*) FROM canonical_owned_item_instances WHERE owned_item_id='prvinst1' AND item_id='j7uyw6vc') instance_count,(SELECT COUNT(*) FROM canonical_item_definitions WHERE item_id='j7uyw6vc') item_count");
  if(retained[0]!.table_count!==0n||retained[0]!.stack_count!==1n||retained[0]!.instance_count!==1n||retained[0]!.item_count!==1n)throw new Error("SHARED_CATALOG_REFERENCE_MUTATED_BY_ROLLBACK");
  if(externalTable!==undefined){const external=await connection.query<Array<{count_value:bigint}>>(`SELECT COUNT(*) count_value FROM ${externalTable} WHERE external_owned_item_id='extinst1' AND item_id='j7uyw6vc'`);if(external[0]!.count_value!==1n)throw new Error("CROSS_SCHEMA_REFERENCE_MUTATED_BY_ROLLBACK");await connection.query(`DELETE FROM ${externalTable} WHERE external_owned_item_id='extinst1'`);}
  await connection.query("DELETE FROM canonical_owned_item_stacks WHERE owned_item_stack_id='prvstak1';DELETE FROM canonical_owned_item_instances WHERE owned_item_id='prvinst1';DELETE FROM canonical_players WHERE player_id='prvplyr1';DELETE FROM players WHERE id=?",[probeLegacy]);
  await connection.query("DELETE FROM canonical_item_definition_imports WHERE item_definition_import_id='phk8c656';DELETE FROM canonical_item_definitions WHERE item_id='j7uyw6vc'");
  const now="2026-09-06 12:00:00",options=JSON.stringify({sourceObjectKey:"item.direct_bag.8349df1a3be0b247"});
  await connection.query("INSERT INTO canonical_item_definitions(item_id,item_name,item_kind,stackable_flag,active_flag,definition_options,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('j7uyw6vc','호이응원패키지(무료)🐹[2]','PACKAGE_ITEM',TRUE,TRUE,?,'wbs752-preexisting',?,'wbs752-preexisting',?)",[options,now,now]);
  await connection.query("INSERT INTO canonical_item_definition_imports(item_definition_import_id,item_id,source_system,source_namespace,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('phk8c656','j7uyw6vc','LEGACY_JS','member.bag','호이응원패키지(무료)🐹[2]','wbs752-preexisting',?,'wbs752-preexisting',?)",[now,now]);
  await connection.query("UPDATE canonical_item_definitions SET definition_options=JSON_OBJECT('sourceObjectKey','drift') WHERE item_id='j7uyw6vc'");
  try{await connection.query(forward);throw new Error("SOURCE_DRIFT_GUARD_MISSING");}catch(error){if(!String((error as Error).message).includes("ADMIN_GLOBAL_GIFT_ITEM_SOURCE_DRIFT"))throw error;}
  await connection.query("UPDATE canonical_item_definitions SET definition_options=? WHERE item_id='j7uyw6vc'",[options]);
  await connection.query(forward);
  const preserved=await connection.query<Array<{item_id:string;INSERT_USER:string}>>("SELECT binding.item_id,item.INSERT_USER FROM canonical_item_definition_imports binding JOIN canonical_item_definitions item ON item.item_id=binding.item_id WHERE binding.source_system='LEGACY_JS' AND binding.source_namespace='member.bag' AND BINARY binding.source_identifier=BINARY '호이응원패키지(무료)🐹[2]'");
  if(preserved.length!==1||preserved[0]!.item_id!=="j7uyw6vc"||preserved[0]!.INSERT_USER!=="wbs752-preexisting")throw new Error("PREEXISTING_SOURCE_REASSIGNED");
  await connection.query(rollback);
  const afterRollback=await connection.query<Array<{item_id:string;INSERT_USER:string}>>("SELECT binding.item_id,item.INSERT_USER FROM canonical_item_definition_imports binding JOIN canonical_item_definitions item ON item.item_id=binding.item_id WHERE binding.item_definition_import_id='phk8c656'");
  if(afterRollback[0]?.item_id!=="j7uyw6vc"||afterRollback[0]?.INSERT_USER!=="wbs752-preexisting")throw new Error("PREEXISTING_SOURCE_REMOVED_BY_ROLLBACK");
  await connection.query("DELETE FROM canonical_item_definition_imports WHERE item_definition_import_id='phk8c656';DELETE FROM canonical_item_definitions WHERE item_id='j7uyw6vc'");
  await connection.query(forward);
  await connection.query("INSERT INTO schema_migrations(version,checksum,applied_at) VALUES ('479_admin_global_gift_object_db.sql',?,UTC_TIMESTAMP(3))",[createHash("sha256").update(forward).digest("hex")]);
  const restored=await connection.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE 'canonical_admin_global_gift_%'");
  if(restored[0]!.count_value!==4n)throw new Error("REFORWARD_TABLES_MISSING");
  process.stdout.write(`receipt-guard=${receipts[0]!.count_value>0n?"PASS":"PREVIOUSLY_PROVED"} shared-seed-preserved=PASS ownership-preserved=PASS cross-schema-reference-preserved=${externalSchema===undefined?"SKIP":"PASS"} source-drift=PASS reserved-id-preexisting-preserved=PASS feature-rollback=PASS reapply=PASS tables=4\n`);
}finally{await connection.end();}
