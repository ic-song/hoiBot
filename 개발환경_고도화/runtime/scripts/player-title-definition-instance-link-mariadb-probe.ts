import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { AdminMemberTitleMutateService } from "../src/admin/admin-member-title-mutate-service.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { PlayerTitleGiftService } from "../src/player/player-title-gift-service.js";
import { PlayerTitleSelectService } from "../src/player/player-title-select-service.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/player-title-definition-instance-link-v1.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || config.database.name !== "hoibot_player_title_link_probe") throw new Error(`Blocked database:${config.database.name}`);
let database = createDatabaseClient(config.database);
const checks: string[] = [];
const adminExternal = "lease2394-admin";
const targetExternal = "lease2394-target";
const targetName = "연결대상";
const room = "lease2394-room";

async function setup() {
  await database.execute("UPDATE castle_battle_seasons SET status='closed',ends_at=UTC_TIMESTAMP(3) WHERE status='active'");
  await database.execute("INSERT INTO players(id,status,version) VALUES (998394001,'active',1),(998394002,'active',1)");
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (998394001,'연결관리자',1),(998394002,?,1)", [targetName]);
  await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (998394101,998394001,'kakao',?,'연결관리자','linked'),(998394102,998394002,'kakao',?,?,'linked')", [adminExternal,targetExternal,targetName]);
  await database.execute("INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at) VALUES ('link-admin-1','message','received',UTC_TIMESTAMP(3)),('link-admin-2','message','received',UTC_TIMESTAMP(3)),('link-gift-1','message','received',UTC_TIMESTAMP(3)),('link-gift-2','message','received',UTC_TIMESTAMP(3)),('link-select-1','message','received',UTC_TIMESTAMP(3)),('link-remove-1','message','received',UTC_TIMESTAMP(3)),('link-notfound-1','message','received',UTC_TIMESTAMP(3)),('link-conflict-1','message','received',UTC_TIMESTAMP(3)),('link-rollback-1','message','received',UTC_TIMESTAMP(3))");
  await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (998394201,'lease2394-admin','연결관리자','synthetic','active')");
  await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (998394201,998394101)");
  await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 998394201,id FROM admin_roles WHERE code='manager'");
  const ticket = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='legacy-title-gift-ticket'"))[0]!;
  await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (998394001,?,3,1)", [ticket.id]);
}

async function verify() {
  await setup();
  const admin = new AdminMemberTitleMutateService(database);
  const gift = new PlayerTitleGiftService(database);
  const select = new PlayerTitleSelectService(database);
  const first = await admin.handle({ eventId: "link-admin-1", externalUserId: adminExternal, destinationId: room, message: `/타이틀추가 ${targetName}, ${fixture.dynamicDisplayName} 100` });
  const repeated = await admin.handle({ eventId: "link-admin-2", externalUserId: adminExternal, destinationId: room, message: `/타이틀추가 ${targetName}, ${fixture.dynamicDisplayName} 100` });
  assert.deepEqual([first?.status,repeated?.status], ["applied","applied"]);
  const giftOne = await gift.gift({ eventId: "link-gift-1", externalUserId: adminExternal, destinationId: room, message: `/타이틀선물 ${targetName} ${fixture.dynamicDisplayName}` });
  const giftTwo = await gift.gift({ eventId: "link-gift-2", externalUserId: adminExternal, destinationId: room, message: `/타이틀선물 ${targetName} ${fixture.dynamicDisplayName}` });
  const replay = await gift.gift({ eventId: "link-gift-2", externalUserId: adminExternal, destinationId: room, message: `/타이틀선물 ${targetName} ${fixture.dynamicDisplayName}` });
  assert.deepEqual([giftOne?.created,giftTwo?.created,replay?.replayed], [true,false,true]);
  checks.push("normal repeat and replay");

  const selected = await select.select({ eventId: "link-select-1", externalUserId: targetExternal, destinationId: room, message: "/타이틀 1", senderDisplayName: targetName });
  assert.equal(selected.status, "selected");
  const removed = await admin.handle({ eventId: "link-remove-1", externalUserId: adminExternal, destinationId: room, message: `/타이틀제거 ${targetName} 1` });
  const notFound = await admin.handle({ eventId: "link-notfound-1", externalUserId: adminExternal, destinationId: room, message: "/타이틀제거 없는회원 1" });
  assert.deepEqual([removed?.status,notFound?.status], ["applied","not_found"]);
  checks.push("equip remove and notfound");

  const adminCode = fixture.admin.stableCode;
  await database.execute("UPDATE title_definitions SET display_name='합성충돌' WHERE code=?", [adminCode]);
  await assert.rejects(() => admin.handle({ eventId: "link-conflict-1", externalUserId: adminExternal, destinationId: room, message: `/타이틀추가 ${targetName}, ${fixture.dynamicDisplayName} 100` }), /타이틀 정의 충돌/);
  await database.execute("UPDATE title_definitions SET display_name=? WHERE code=?", [fixture.dynamicDisplayName,adminCode]);
  checks.push("definition conflict");

  await database.execute("CREATE TRIGGER fail_title_instance_link BEFORE INSERT ON player_title_instances FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic title instance rollback'");
  await assert.rejects(() => admin.handle({ eventId: "link-rollback-1", externalUserId: adminExternal, destinationId: room, message: `/타이틀추가 ${targetName}, 롤백타이틀 100` }), /synthetic title instance rollback/);
  await database.execute("DROP TRIGGER fail_title_instance_link");
  const rollbackCode = `admin-custom-title:${createHash("sha256").update("롤백타이틀").digest("hex").slice(0,32)}`;
  assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM title_definitions WHERE code=?", [rollbackCode]))[0]!.count_value), 0);
  assert.equal(await database.verifyRollback(), true);
  checks.push("transaction rollback");

  const counts = (await database.query<Array<Record<string,bigint>>>(`SELECT
    (SELECT COUNT(*) FROM title_definitions) definitions,
    (SELECT COUNT(*) FROM title_definition_catalog_entries) catalog_entries,
    (SELECT COUNT(*) FROM title_definition_catalog_entries WHERE source_scope IN ('PLAYER_ADMIN_CUSTOM','PLAYER_GIFT')) dynamic_definitions,
    (SELECT COUNT(*) FROM player_title_instances WHERE player_id=998394002) instances,
    (SELECT COUNT(*) FROM player_title_instances WHERE player_id=998394002 AND status='owned') owned_instances,
    (SELECT COUNT(*) FROM player_title_instances WHERE player_id=998394002 AND status='removed') removed_instances,
    (SELECT COUNT(*) FROM player_titles WHERE player_id=998394002) aggregate_projection_rows,
    (SELECT COUNT(*) FROM player_title_instances WHERE player_id=998394002 AND title_catalog_entry_id IS NOT NULL) instance_catalog_links,
    (SELECT COUNT(DISTINCT source_operation_id) FROM player_title_instances WHERE player_id=998394002) distinct_source_operations,
    (SELECT COUNT(*) FROM player_title_instances WHERE player_id=998394002 AND source_sequence_no=1) sequence_one,
    (SELECT COUNT(*) FROM player_title_instances WHERE player_id=998394002 AND equipped=TRUE) equipped_instances,
    (SELECT COALESCE(SUM(version),0) FROM player_title_instances WHERE player_id=998394002) version_sum`))[0]!;
  const numeric = Object.fromEntries(Object.entries(counts).map(([key,value]) => [key,Number(value)]));
  assert.deepEqual(numeric, { definitions:7,catalog_entries:7,dynamic_definitions:2,instances:4,owned_instances:3,
    removed_instances:1,aggregate_projection_rows:2,instance_catalog_links:4,distinct_source_operations:4,
    sequence_one:4,equipped_instances:0,version_sum:5 });
  checks.push("exact instance and aggregate parity");
  return numeric;
}

try {
  const counts = await verify();
  await database.close();
  database = createDatabaseClient(config.database);
  assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM player_title_instances WHERE player_id=998394002 AND title_catalog_entry_id IS NOT NULL"))[0]!.count_value), 4);
  checks.push("reconnect");
  console.log(JSON.stringify({ result:"passed",checks,total:checks.length,counts,staticDefinitions:5,sameDisplayMerges:0 }));
} finally { await database.close(); }
