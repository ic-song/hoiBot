import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { PassListService } from "../src/pass/pass-list-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true", required = (name: string) => process.env[name] ?? "integration-not-configured";

describe("pass list read MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const suffix = Date.now().toString(), token = "synthetic-pass-list-token", room = "990000000000505", adminExternal = `pass-list-admin-${suffix}`;
  const open = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  async function event(id: string): Promise<void> { await database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','test','incoming',REPEAT('5',64),'parsed','processing',UTC_TIMESTAMP(3))", [id, id]); }
  async function player(name: string): Promise<bigint> { const row = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)"); await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [row.insertId, name]); return row.insertId; }

  before(async () => {
    database = open();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='PASS_LIST_READ'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,'x','active')", [`pass-list-${suffix}`, `패스 관리자 ${suffix}`]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`pass-list-${suffix}`]))[0]!;
    const admin = await player(`패스 관리자 ${suffix}`);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?, 'linked')", [admin, adminExternal, `패스 관리자 ${suffix}`]);
    const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE external_user_id=?", [adminExternal]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
  });

  after(async () => {
    if (!database) return;
    try { await database.execute("DROP TRIGGER IF EXISTS fail_pass_list_outbox"); await database.close(); }
    catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; }
  });

  it("projects both stores, expires D+1, replays, shadows, rolls back and reconnects", async () => {
    const active = await player(`영구 패스 ${suffix}`), expired = await player(`만료 패스 ${suffix}`), premium = await player(`프리미엄 만료 ${suffix}`), rollback = await player(`롤백 패스 ${suffix}`);
    await database.execute("INSERT INTO player_passes(player_id,pass_code,enabled,permanent,ends_at) VALUES (?,'hoi',TRUE,TRUE,NULL),(?,'newbie',TRUE,FALSE,DATE_SUB(UTC_TIMESTAMP(),INTERVAL 2 DAY)),(?,'premium',TRUE,FALSE,DATE_SUB(UTC_TIMESTAMP(),INTERVAL 2 DAY))", [active, expired, premium]);
    const seedOperation = await database.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,source_code,status,created_at,completed_at) VALUES (UUID(),'test.pass.seed',?,'system','test','completed',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [`pass-list-seed-${suffix}`]);
    await database.execute("INSERT INTO player_support_passes(player_id,pass_code,entitlement_kind,end_date,status,version,created_operation_id,updated_operation_id,created_at,updated_at) VALUES (?,'contribution','permanent',NULL,'active',1,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [active, seedOperation.insertId, seedOperation.insertId]);
    const premiumPet = await database.execute("INSERT INTO player_pets(player_id,display_name,version) VALUES (?,'프리미엄 펫',1)", [premium]);
    await database.execute("INSERT INTO player_pet_intimacy(player_pet_id,intimacy_level) VALUES (?,100)", [premiumPet.insertId]);
    await database.execute("INSERT INTO player_homes(player_id,display_name,floor_area,version) VALUES (?,'프리미엄 홈',0,1)", [premium]);
    await database.execute("INSERT INTO player_home_badges(player_id,badge_code,owned,equipped) VALUES (?,'S13',TRUE,TRUE)", [premium]);
    await database.execute("INSERT INTO player_home_badge_cubes(player_id,badge_code,equipped) VALUES (?,'S13',TRUE)", [premium]);
    for (let index = 1; index <= 3; index++) { const skill = await database.execute("INSERT INTO skill_definitions(code,display_name,rules_json,active) VALUES (?,?,JSON_OBJECT(),TRUE)", [`pass-list-skill-${suffix}-${index}`, `패스 스킬 ${index}`]); await database.execute("INSERT INTO pet_skills(player_pet_id,slot_no,skill_id,level,equipped) VALUES (?,?,?,1,TRUE)", [premiumPet.insertId, index, skill.insertId]); }
    const furniture = await database.execute("INSERT INTO furniture_definitions(code,display_name) VALUES (?,?)", [`pass-list-chair-${suffix}`, "패스 의자"]);
    const owned = await database.execute("INSERT INTO owned_furniture(player_id,furniture_definition_id,quantity) VALUES (?,?,3)", [premium, furniture.insertId]);
    for (let index = 1; index <= 3; index++) await database.execute("INSERT INTO furniture_placements(player_id,owned_furniture_id,placement_key) VALUES (?,?,?)", [premium, owned.insertId, `pass-list-place-${suffix}-${index}`]);
    await database.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES (?,'자동탐험권🌄','STACK',TRUE,JSON_OBJECT('fixture',TRUE),TRUE,1) ON DUPLICATE KEY UPDATE active=TRUE", [`pass-list-auto-ticket-${suffix}`]);
    const ticket = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE display_name='자동탐험권🌄' LIMIT 1"))[0]!;
    await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,2,1),(?,?,4,1)", [expired, ticket.id, premium, ticket.id]);
    const id = `pass-list-${suffix}`; await event(id);
    const service = new PassListService(database), result = await service.execute({ eventId: id, externalUserId: adminExternal, destinationId: room, message: "/패스목록" });
    assert.match(result.data, /호월패스 전체목록 안내/); assert.match(result.data, new RegExp(`영구 패스 ${suffix}`)); assert.match(result.data, /길드공헌패스/); assert.ok(result.expiredCount >= 1);
    assert.equal((await database.query<Array<{ enabled: number }>>("SELECT enabled FROM player_passes WHERE player_id=? AND pass_code='newbie'", [expired]))[0]!.enabled, 0);
    assert.equal(String((await database.query<Array<{ quantity: bigint }>>("SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?", [expired, ticket.id]))[0]!.quantity), "0");
    const premiumState = (await database.query<Array<{ locked: bigint; badge_owned: number; placements: bigint; ticket_quantity: bigint; cleanup_ops: bigint }>>("SELECT (SELECT COUNT(*) FROM pet_skills WHERE player_pet_id=? AND premium_locked=TRUE) locked,(SELECT owned FROM player_home_badges WHERE player_id=? AND badge_code='S13') badge_owned,(SELECT COUNT(*) FROM furniture_placements WHERE player_id=?) placements,(SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?) ticket_quantity,(SELECT COUNT(*) FROM hope_premium_delete_operations WHERE target_player_id=?) cleanup_ops", [premiumPet.insertId, premium, premium, premium, ticket.id, premium]))[0]!;
    assert.equal(premiumState.locked, 2n); assert.equal(premiumState.badge_owned, 0); assert.equal(premiumState.placements, 1n); assert.equal(premiumState.ticket_quantity, 0n); assert.equal(premiumState.cleanup_ops, 1n);
    assert.equal((await service.execute({ eventId: id, externalUserId: adminExternal, destinationId: room, message: "/패스목록" })).replayed, true);
    await database.execute("INSERT INTO player_passes(player_id,pass_code,enabled,permanent,ends_at) VALUES (?,'newbie',TRUE,FALSE,DATE_SUB(UTC_TIMESTAMP(),INTERVAL 2 DAY))", [rollback]);
    await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,3,1)", [rollback, ticket.id]);

    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "pass-list-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    process.env.PASS_LIST_READ_COMMAND_ENABLED = "true"; process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async () => {} });
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='PASS_LIST_READ'");
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: "/패스목록", room: "고도화펫테스트방", sender: `패스 관리자 ${suffix}`, json: { _id: `pass-list-shadow-${suffix}`, chat_id: room, user_id: adminExternal } } });
    assert.equal((await database.query<Array<{ enabled: number }>>("SELECT enabled FROM player_passes WHERE player_id=? AND pass_code='newbie'", [rollback]))[0]!.enabled, 1);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='PASS_LIST_READ'");

    const rollbackId = `pass-list-rollback-${suffix}`; await event(rollbackId);
    await database.execute("CREATE TRIGGER fail_pass_list_outbox BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic pass list outbox failure'");
    await assert.rejects(() => service.execute({ eventId: rollbackId, externalUserId: adminExternal, destinationId: room, message: "/패스목록" }), /synthetic pass list outbox failure/);
    await database.execute("DROP TRIGGER fail_pass_list_outbox");
    assert.equal((await database.query<Array<{ enabled: number }>>("SELECT enabled FROM player_passes WHERE player_id=? AND pass_code='newbie'", [rollback]))[0]!.enabled, 1);
    assert.equal(String((await database.query<Array<{ quantity: bigint }>>("SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?", [rollback, ticket.id]))[0]!.quantity), "3");
    await app.close(); database = open();
    assert.equal((await new PassListService(database).execute({ eventId: id, externalUserId: adminExternal, destinationId: room, message: "/패스목록" })).replayed, true);
    delete process.env.PASS_LIST_READ_COMMAND_ENABLED;
    assert.equal(today().length, 10);
  });
});
