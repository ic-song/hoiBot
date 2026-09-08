import assert from "node:assert/strict";
import test from "node:test";

import { MariaPlayerContextProvider } from "../src/account-platform/player-context-provider.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { MariaBagShadowParityProvider } from "../src/inventory/bag-shadow-parity-provider.js";
import { CanonicalItemBagDirectReadService } from "../src/inventory/canonical-item-bag-direct-read-service.js";
import { CanonicalItemBagImportReadinessProvider } from "../src/inventory/canonical-item-bag-import-readiness-provider.js";
import { CanonicalItemBagShadowReadProvider } from "../src/inventory/canonical-item-bag-shadow-read-provider.js";
import { LegacyBagOwnerLabelProvider } from "../src/inventory/legacy-bag-owner-label-provider.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../src/runtime/environment-context.js";

const enabled = process.env.RUN_ITEM_BAG_MARIADB_INTEGRATION === "true";
const run = enabled ? test : test.skip;
const now = "2026-09-08 00:00:00";
const audit = ["lease2604", now, "lease2604", now] as const;
let database: DatabaseClient;

const REHEARSAL_TARGET = Object.freeze({ host: "127.0.0.1", port: 3308, user: "lease2604_test", name: "hoibot_rehearsal_item_bag_2604" });
const REHEARSAL_SERVER_PORT = 3306;
const DESTRUCTIVE_ARMING = "hoibot_rehearsal_item_bag_2604";

export function assertItemBagRehearsalTarget(environment: Record<string, string | undefined>) {
  const target = {
    enabled: true,
    host: environment.ITEM_BAG_TEST_DB_HOST ?? "",
    port: Number(environment.ITEM_BAG_TEST_DB_PORT ?? ""),
    user: environment.ITEM_BAG_TEST_DB_USER ?? "",
    password: environment.ITEM_BAG_TEST_DB_PASSWORD ?? "",
    name: environment.ITEM_BAG_TEST_DB_NAME ?? "",
    connectionLimit: 4,
    connectTimeoutMs: 5000,
  };
  if (target.host !== REHEARSAL_TARGET.host || target.port !== REHEARSAL_TARGET.port
    || target.user !== REHEARSAL_TARGET.user || target.name !== REHEARSAL_TARGET.name
    || target.password.length === 0 || environment.ITEM_BAG_ALLOW_DESTRUCTIVE_SEED !== DESTRUCTIVE_ARMING) {
    throw new Error("ITEM_BAG_REHEARSAL_TARGET_NOT_ALLOWLISTED");
  }
  return target;
}

async function verifyConnectedItemBagRehearsalTarget(client: DatabaseClient, target: ReturnType<typeof assertItemBagRehearsalTarget>): Promise<void> {
  const rows = await client.query<Array<{ database_identity: string | null; current_user_value: string; server_port: bigint | number }>>(
    "SELECT DATABASE() AS database_identity,CURRENT_USER() AS current_user_value,@@port AS server_port",
  );
  const row = rows[0];
  if (rows.length !== 1 || row?.database_identity !== target.name || Number(row.server_port) !== REHEARSAL_SERVER_PORT
    || row.current_user_value.split("@", 1)[0] !== target.user) throw new Error("ITEM_BAG_REHEARSAL_CONNECTED_TARGET_NOT_ALLOWLISTED");
}

test("rejects a misdirected Maria environment before client creation or destructive seed SQL", () => {
  for (const environment of [
    {},
    { ITEM_BAG_TEST_DB_HOST: "db.example.invalid" }, { ITEM_BAG_TEST_DB_PORT: "3306" },
    { ITEM_BAG_TEST_DB_USER: "root" }, { ITEM_BAG_TEST_DB_NAME: "hoibot_schema_design" },
  ]) {
    let clientCreated = false;
    assert.throws(() => {
      const target = assertItemBagRehearsalTarget(environment);
      clientCreated = true;
      createDatabaseClient(target);
    }, /ITEM_BAG_REHEARSAL_TARGET_NOT_ALLOWLISTED/);
    assert.equal(clientCreated, false);
  }
  assert.deepEqual(assertItemBagRehearsalTarget({
    ITEM_BAG_TEST_DB_HOST: "127.0.0.1", ITEM_BAG_TEST_DB_PORT: "3308", ITEM_BAG_TEST_DB_USER: "lease2604_test",
    ITEM_BAG_TEST_DB_PASSWORD: "non-secret-fixture", ITEM_BAG_TEST_DB_NAME: "hoibot_rehearsal_item_bag_2604",
    ITEM_BAG_ALLOW_DESTRUCTIVE_SEED: DESTRUCTIVE_ARMING,
  }), {
    enabled: true, ...REHEARSAL_TARGET, password: "non-secret-fixture", connectionLimit: 4, connectTimeoutMs: 5000,
  });
});

async function seed(): Promise<void> {
  await database.withTransaction(async (tx) => {
    await tx.execute("SET FOREIGN_KEY_CHECKS=0");
    try {
    await tx.execute("DELETE FROM operation_notice_heads");
    await tx.execute("DELETE FROM configuration_values");
    await tx.execute("DELETE FROM configuration_sets");
    for (const table of ["canonical_app_wiring_receipt_links","canonical_app_wiring_operations","command_routing_decisions","outbox_messages","command_executions","operations","event_inbox","channel_activity_daily","channel_membership_events","channel_memberships","normalized_provider_events","channel_name_observations","external_identity_names","channels","data_migration_object_domain_import_records","data_migration_object_domain_import_runs","canonical_owned_item_stacks","canonical_item_definitions","player_pet_skill_rank_marker_projections","guild_rank_current_projections","guild_members","guilds","account_platform_active_player_selections","account_platform_context_memberships","account_platform_contexts","account_platform_identities","portal_game_account_links","canonical_portal_accounts","canonical_player_identity_crosswalks","canonical_players","inventory_stacks","item_definitions","player_legacy_rank_profiles","player_profiles","external_identities","players"]) await tx.execute(`DELETE FROM ${table}`);
    await tx.execute("INSERT INTO players(id,status,version) VALUES (2604001,'active',1),(2604002,'active',1)");
    await tx.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (2604001,'호출계정',1),(2604002,'활성부계정😀',1)");
    await tx.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (2604002,'🏆',1)");
    await tx.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (2604011,2604001,'kakao','lease2604-caller','호출계정','linked'),(2604012,2604002,'kakao','lease2604-selected','활성부계정😀','linked')");
    await tx.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('plr2604a','LEGACY_DB','2604002',?,?,?,?)", audit);
    await tx.execute("INSERT INTO canonical_player_identity_crosswalks(canonical_player_identity_crosswalk_id,provider_code,external_user_id,player_id,crosswalk_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('crs2604a','kakao','lease2604-selected','plr2604a','LINKED',?,?,?,?)", audit);
    await tx.execute("INSERT INTO canonical_portal_accounts(portal_account_id,legacy_user_account_id,portal_account_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('por2604a',2604001,'ACTIVE',?,?,?,?)", audit);
    await tx.execute("INSERT INTO portal_game_account_links(portal_game_account_link_id,portal_account_id,player_id,player_role,registration_sequence,link_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('lnk2604a','por2604a',2604001,'REPRESENTATIVE',1,'ACTIVE',?,?,?,?),('lnk2604b','por2604a',2604002,'SUB',2,'ACTIVE',?,?,?,?)", [...audit,...audit]);
    await tx.execute("INSERT INTO account_platform_identities(platform_identity_id,portal_account_id,platform_code,identity_scope_key,external_user_key,identity_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('api2604a','por2604a','KAKAO','room-2604','lease2604-caller','ACTIVE',?,?,?,?)", audit);
    await tx.execute("INSERT INTO account_platform_contexts(platform_context_id,platform_code,context_type,external_context_key,context_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('apc2604a','KAKAO','ROOM','room-2604','ACTIVE',?,?,?,?)", audit);
    await tx.execute("INSERT INTO account_platform_context_memberships(platform_context_membership_id,platform_identity_id,platform_context_id,membership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('apm2604a','api2604a','apc2604a','ACTIVE',?,?,?,?)", audit);
    await tx.execute("INSERT INTO account_platform_active_player_selections(active_player_selection_id,platform_context_membership_id,portal_game_account_link_id,active_player_id,selection_status,selection_version,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('aps2604a','apm2604a','lnk2604b',2604002,'ACTIVE',1,?,?,?,?)", audit);
    await tx.execute("INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES ('ITEM_BAG_READ','item_bag_canonical_read','VERIFIED_USER','SHADOW',TRUE,1) ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),rollout_state='SHADOW',enabled=TRUE,version=version+1");
    await tx.execute("INSERT INTO command_aliases(command_text,command_code,active) VALUES ('/가방','ITEM_BAG_READ',TRUE),('ㄴㄴㄴ','ITEM_BAG_READ',TRUE) ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE");
    const legacyItem = await tx.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active) VALUES ('lease2604_box','활성상자🎁','ITEM',TRUE,JSON_OBJECT('legacyBagOrder',20),TRUE)");
    await tx.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (2604002,?,9007199254740993,1)", [legacyItem.insertId]);
    await tx.execute("INSERT INTO canonical_item_definitions(item_id,item_name,item_kind,stackable_flag,active_flag,definition_options,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('itm2604a','활성상자🎁','LEGACY_BAG_ITEM',TRUE,TRUE,JSON_OBJECT('legacyBagOrder',20),?,?,?,?)", audit);
    await tx.execute("INSERT INTO canonical_owned_item_stacks(owned_item_stack_id,player_id,item_id,quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('stk2604a','plr2604a','itm2604a',9007199254740993,?,?,?,?)", audit);
    for (const [index, kind] of ["CASTLE_LORD","STAR","CARROT","THERMO","MINI_PET","TOP_LEVEL","MC","INTIMACY"].entries()) await tx.execute("INSERT INTO player_pet_skill_rank_marker_projections(player_pet_skill_rank_marker_projection_id,player_id,marker_kind,marker_priority,assignment_status,source_fingerprint,revision,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,NULL,?,?, 'UNASSIGNED',REPEAT('a',64),1,TRUE,?,?,?,?)", [`mrk2604${index}`,kind,index+1,...audit]);
    const guild = await tx.execute("INSERT INTO guilds(code,display_name,status,version) VALUES ('lease2604','검증길드','active',1)");
    await tx.execute("INSERT INTO guild_members(guild_id,player_id,role_code,version) VALUES (?,2604002,'member',1)", [guild.insertId]);
    await tx.execute("INSERT INTO guild_rank_snapshot_current(policy_key,snapshot_id,version) VALUES ('default',2604,1) ON DUPLICATE KEY UPDATE snapshot_id=2604,version=version+1");
    await tx.execute("INSERT INTO guild_rank_current_projections(guild_id,snapshot_id,ordinal_value,total_charm,title_code,title_display_name,version) VALUES (?,2604,20,1,'rank20','20위',1)", [guild.insertId]);
    await tx.execute("DELETE FROM guild_territory_start_scopes WHERE scope_code='world'");
    await tx.execute("UPDATE guild_territory_wars SET active=FALSE,lifecycle_state='READY' WHERE id=(SELECT war_id FROM (SELECT MIN(id) war_id FROM guild_territory_wars) x)");
    await tx.execute("INSERT INTO guild_territory_start_scopes(scope_code,war_id,version) SELECT 'world',MIN(id),1 FROM guild_territory_wars");
    const config = await tx.execute("INSERT INTO configuration_sets(set_code,version,status) VALUES ('lease2604_notice',2604,'active')");
    await tx.execute("INSERT INTO configuration_values(configuration_set_id,config_key,value_type,string_value) VALUES (?,'notice.advertisement','string','검증광고📢')", [config.insertId]);
    await tx.execute("INSERT INTO operation_notice_heads(set_code,active_configuration_set_id,version) VALUES ('operation_notices',?,2604) ON DUPLICATE KEY UPDATE active_configuration_set_id=VALUES(active_configuration_set_id),version=VALUES(version)", [config.insertId]);
    for (const [runId, recordId, table, column, pk] of [["run2604a","rec2604a","canonical_owned_item_stacks","owned_item_stack_id","stk2604a"],["run2604b","rec2604b","canonical_item_definitions","item_id","itm2604a"]]) {
      await tx.execute("INSERT INTO data_migration_object_domain_import_runs(object_domain_import_run_id,catalog_projection_run_id,catalog_version,catalog_projection_sha256,upstream_envelope_sha256,target_schema_sha256,import_contract_sha256,import_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,expected_row_count,imported_row_count,run_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,'lease2604',REPEAT('a',64),REPEAT('b',64),REPEAT('c',64),REPEAT('d',64),REPEAT('e',64),1,1,0,0,1,1,'COMPLETE',?,?,?,?)", [runId,runId,...audit]);
      await tx.execute("INSERT INTO data_migration_object_domain_import_records(object_domain_import_record_id,object_domain_import_run_id,catalog_projection_record_id,target_table_name,target_pk_column_name,target_pk_value,identity_locator_sha256,import_order,binding_fingerprint,imported_row_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?, ?,?,?,REPEAT('f',64),1,REPEAT('a',64),REPEAT('b',64),?,?,?,?)", [recordId,runId,recordId,table,column,pk,...audit]);
    }
    } finally {
      await tx.execute("SET FOREIGN_KEY_CHECKS=1");
    }
  });
}

run("actual Maria read-only snapshot resolves the active subaccount and canonical decision", async () => {
  const target = assertItemBagRehearsalTarget(process.env);
  database = createDatabaseClient(target);
  try {
    await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:"dev",databaseIdentity:target.name}));
    await verifyConnectedItemBagRehearsalTarget(database,target);
    await seed();
    const service = new CanonicalItemBagDirectReadService(new CanonicalItemBagShadowReadProvider(new MariaPlayerContextProvider(),new MariaBagShadowParityProvider(),new LegacyBagOwnerLabelProvider(),new CanonicalItemBagImportReadinessProvider()));
    const result = await (database as any).withReadOnlySnapshot((snapshot: any) => service.execute(snapshot,{providerCode:"kakao",externalUserId:"lease2604-caller",externalContextId:"room-2604"}));
    assert.equal(result.status,"direct_reply");
    if (result.status === "direct_reply") {
      assert.equal(result.playerId,"plr2604a");
      assert.equal(result.data,"[🏆활성부계정😀_◻︎]의 가방🧳\n(알림📢)후원은 봇 개발에 많은 도움이됩니다.\n   1. 활성상자🎁 x 9007199254740993");
    }
    await database.execute("UPDATE data_migration_object_domain_import_runs SET quarantined_source_count=1,projected_source_count=0 WHERE object_domain_import_run_id='run2604a'");
    const incomplete = await (database as any).withReadOnlySnapshot((snapshot: any) => service.execute(snapshot,{providerCode:"kakao",externalUserId:"lease2604-caller",externalContextId:"room-2604"}));
    assert.equal(incomplete.status,"legacy_reply");
    await database.execute("UPDATE guild_territory_wars war JOIN guild_territory_start_scopes scope_row ON scope_row.war_id=war.id SET war.active=TRUE,war.lifecycle_state='ACTIVE_READY' WHERE scope_row.scope_code='world'");
    const castle = await (database as any).withReadOnlySnapshot((snapshot: any) => service.execute(snapshot,{providerCode:"kakao",externalUserId:"lease2604-caller",externalContextId:"room-2604"}));
    assert.equal(castle.status,"silent");
    if(castle.status==="silent")assert.equal(castle.reason,"CASTLE_SIEGE_ACTIVE");
  } finally { await database.close(); }
});

run("actual Maria app and pool reconstruction keeps one legacy outbox, one receipt, unchanged quantities, and zero immediate callback", async () => {
  const target = assertItemBagRehearsalTarget(process.env);
  const create = () => createDatabaseClient(target);
  database = create();
  let immediateReplies = 0;
  try {
    await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:"dev",databaseIdentity:target.name}));
    await verifyConnectedItemBagRehearsalTarget(database,target);
    await seed();
    const context = await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:"dev",databaseIdentity:target.name}));
    const config = loadConfig({NODE_ENV:"test",HOIBOT_ENVIRONMENT_CODE:"dev",IRIS_SHARED_TOKEN:"lease2604-test-token",USER_VERIFICATION_PEPPER:"lease2604-test-pepper",DATABASE_ENABLED:"true",DATABASE_HOST:"127.0.0.1",DATABASE_PORT:"3308",DATABASE_USER:"lease2604_test",DATABASE_PASSWORD:"lease2604_local",DATABASE_NAME:"hoibot_rehearsal_item_bag_2604"});
    const dependencies = {database,environmentContext:context,inspectIrisChannel:async()=>({mode:"operational" as const,channelClass:"open_group" as const,reason:"allowed" as const,evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}}),sendIrisTextReply:async()=>{immediateReplies+=1;}};
    let app = buildApp(config,dependencies);
    const request = () => app.inject({method:"POST",url:"/api/v1/integrations/iris/events?token=lease2604-test-token",payload:{msg:"/가방",room:"검증방",sender:"호출계정",json:{_id:"lease2604-bag-event",chat_id:"room-2604",user_id:"lease2604-caller"}}});
    const first = await request();
    assert.equal(first.statusCode,202,first.body);
    await app.close();
    database=create();
    const restartedContext=await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:"dev",databaseIdentity:"hoibot_rehearsal_item_bag_2604"}));
    await verifyConnectedItemBagRehearsalTarget(database,target);
    app=buildApp(config,{...dependencies,database,environmentContext:restartedContext});
    const replay = await request();
    assert.equal(replay.statusCode,202,replay.body);
    const rows=await database.query<Array<{outboxes:bigint;receipts:bigint;result_json:string}>>(`SELECT
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN command_executions execution ON execution.operation_id=outbox.operation_id WHERE execution.event_id='iris:lease2604-bag-event' AND execution.command_code='bag_read') outboxes,
      (SELECT COUNT(*) FROM canonical_app_wiring_operations WHERE external_request_id='iris:lease2604-bag-event' AND route='SHADOW' AND claim_state='COMPLETED') receipts,
      (SELECT receipt.result_json FROM canonical_app_wiring_operations app_wiring JOIN operations receipt ON receipt.id=CAST(JSON_UNQUOTE(JSON_EXTRACT(app_wiring.result_json,'$.referenceId')) AS UNSIGNED) WHERE app_wiring.external_request_id='iris:lease2604-bag-event' LIMIT 1) result_json`);
    assert.deepEqual([rows[0]!.outboxes,rows[0]!.receipts,immediateReplies],[1n,1n,0]);
    const domain=await database.query<Array<{legacy_quantity:bigint;canonical_quantity:bigint}>>("SELECT (SELECT quantity FROM inventory_stacks WHERE player_id=2604002 LIMIT 1) legacy_quantity,(SELECT quantity FROM canonical_owned_item_stacks WHERE player_id='plr2604a' LIMIT 1) canonical_quantity");
    assert.deepEqual([domain[0]!.legacy_quantity,domain[0]!.canonical_quantity],[9007199254740993n,9007199254740993n]);
    const receipt=typeof rows[0]!.result_json === "string" ? JSON.parse(rows[0]!.result_json) : rows[0]!.result_json as any;
    assert.equal(receipt.status,"SHADOW_EVALUATED");
    assert.equal(receipt.receiptProjection.version,"ITEM_BAG_CANONICAL_DIRECT_READ_V1");
    assert.equal(receipt.receiptProjection.value.status,"direct_reply");
    const tamperWrite=await database.execute(`UPDATE outbox_messages outbox
      JOIN command_executions execution ON execution.operation_id=outbox.operation_id
         SET outbox.payload_json=JSON_OBJECT('data','tampered')
       WHERE execution.event_id='iris:lease2604-bag-event' AND execution.command_code='bag_read'`);
    assert.equal(tamperWrite.affectedRows,1n);
    const tampered=await request();
    assert.equal(tampered.statusCode,500,tampered.body);
    const restoreWrite=await database.execute(`UPDATE outbox_messages outbox
      JOIN command_executions execution ON execution.operation_id=outbox.operation_id
         SET outbox.payload_json=JSON_OBJECT('data',?)
       WHERE execution.event_id='iris:lease2604-bag-event' AND execution.command_code='bag_read'`,[receipt.receiptProjection.value.legacyReply.data]);
    assert.equal(restoreWrite.affectedRows,1n);
    const deleteWrite=await database.execute(`DELETE outbox FROM outbox_messages outbox
      JOIN command_executions execution ON execution.operation_id=outbox.operation_id
       WHERE execution.event_id='iris:lease2604-bag-event' AND execution.command_code='bag_read'`);
    assert.equal(deleteWrite.affectedRows,1n);
    const missing=await request();
    assert.equal(missing.statusCode,500,missing.body);
    await app.close();
  } finally { try { await database.close(); } catch { /* app.close already owns the pool */ } }
});

run("actual Maria castle silence records one SHADOW receipt and no legacy outbox", async () => {
  const target = assertItemBagRehearsalTarget(process.env);
  database = createDatabaseClient(target);
  let immediateReplies = 0;
  let app: ReturnType<typeof buildApp> | undefined;
  try {
    const context = await verifyStartupDatabaseIdentity(database,createEnvironmentContext({environmentCode:"dev",databaseIdentity:target.name}));
    await verifyConnectedItemBagRehearsalTarget(database,target);
    await seed();
    await database.execute("UPDATE guild_territory_wars war JOIN guild_territory_start_scopes scope_row ON scope_row.war_id=war.id SET war.active=TRUE,war.lifecycle_state='ACTIVE_READY' WHERE scope_row.scope_code='world'");
    const config = loadConfig({NODE_ENV:"test",HOIBOT_ENVIRONMENT_CODE:"dev",IRIS_SHARED_TOKEN:"lease2604-test-token",USER_VERIFICATION_PEPPER:"lease2604-test-pepper",DATABASE_ENABLED:"true",DATABASE_HOST:"127.0.0.1",DATABASE_PORT:"3308",DATABASE_USER:"lease2604_test",DATABASE_PASSWORD:"lease2604_local",DATABASE_NAME:"hoibot_rehearsal_item_bag_2604"});
    app=buildApp(config,{database,environmentContext:context,inspectIrisChannel:async()=>({mode:"operational" as const,channelClass:"open_group" as const,reason:"allowed" as const,evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}}),sendIrisTextReply:async()=>{immediateReplies+=1;}});
    const response=await app.inject({method:"POST",url:"/api/v1/integrations/iris/events?token=lease2604-test-token",payload:{msg:"/가방",room:"검증방",sender:"호출계정",json:{_id:"lease2604-bag-silent",chat_id:"room-2604",user_id:"lease2604-caller"}}});
    assert.equal(response.statusCode,202,response.body);
    const rows=await database.query<Array<{outboxes:bigint;receipts:bigint;result_json:string}>>(`SELECT
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN command_executions execution ON execution.operation_id=outbox.operation_id WHERE execution.event_id='iris:lease2604-bag-silent' AND execution.command_code='bag_read') outboxes,
      (SELECT COUNT(*) FROM canonical_app_wiring_operations WHERE external_request_id='iris:lease2604-bag-silent' AND route='SHADOW' AND claim_state='COMPLETED') receipts,
      (SELECT receipt.result_json FROM canonical_app_wiring_operations app_wiring JOIN operations receipt ON receipt.id=CAST(JSON_UNQUOTE(JSON_EXTRACT(app_wiring.result_json,'$.referenceId')) AS UNSIGNED) WHERE app_wiring.external_request_id='iris:lease2604-bag-silent' LIMIT 1) result_json`);
    assert.deepEqual([rows[0]!.outboxes,rows[0]!.receipts,immediateReplies],[0n,1n,0]);
    const receipt=typeof rows[0]!.result_json==="string"?JSON.parse(rows[0]!.result_json):rows[0]!.result_json as any;
    assert.equal(receipt.receiptProjection.value.status,"silent");
    assert.equal(receipt.receiptProjection.value.canonicalDecision.reason,"CASTLE_SIEGE_ACTIVE");
  } finally {
    if(app!==undefined)await app.close();
    else await database.close();
  }
});
