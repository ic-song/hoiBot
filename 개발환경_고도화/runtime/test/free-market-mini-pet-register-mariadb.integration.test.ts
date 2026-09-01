import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { FreeMarketMiniPetRegisterService } from "../src/market/free-market-mini-pet-register-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("free market mini pet register MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  before(() => { database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 4, connectTimeoutMs: 5_000 }); });
  after(async () => { if (database) await database.close(); });

  it("confirms, reserves two stable mini pets, replays, and rolls back an audit failure", async () => {
    const suffix = Date.now().toString();
    const externalId = `mini-pet-register-${suffix}`;
    const player = (await database.execute("INSERT INTO players(status,version) VALUES ('active',1)")).insertId;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,tier_code,version) VALUES (?,'합성 판매자','king',1)", [player]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'합성 판매자','linked')", [player, externalId]);
    await database.execute("INSERT INTO market_registration_tier_policies(tier_code,can_register,minimum_legacy_tier) VALUES ('king',TRUE,'킹') ON DUPLICATE KEY UPDATE can_register=TRUE", []);
    await database.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,active) VALUES ('ITEM-RWD-044','당근','STACK',TRUE,TRUE) ON DUPLICATE KEY UPDATE active=TRUE", []);
    const carrot = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='ITEM-RWD-044'"))[0]!.id;
    await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,100,1)", [player, carrot]);
    const definition = (await database.execute("INSERT INTO mini_pet_definitions(code,display_name,grade_code,grade_display_name,emoji_value,active) VALUES (?,'합성 미니펫','S','S','🐹',TRUE)", [`market-register-${suffix}`])).insertId;
    await database.execute("INSERT INTO owned_mini_pets(player_id,mini_pet_definition_id,custom_name,custom_emoji,progress,enhancement_level,battle_experience,castle_experience,raid_experience,equipped,is_elite,bag_sequence,version) VALUES (?,?,NULL,NULL,0,3,10,20,30,FALSE,FALSE,1,1),(?,?,NULL,NULL,0,3,10,20,30,FALSE,FALSE,2,1)", [player, definition, player, definition]);
    const service = new FreeMarketMiniPetRegisterService(database);
    const command = "/미니펫거래등록 1 2 5000";
    const pendingEvent = `pending-${suffix}`;
    const registerEvent = `register-${suffix}`;
    const rollbackEvent = `rollback-${suffix}`;
    for (const eventId of [pendingEvent, registerEvent, rollbackEvent]) await database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','test','incoming',REPEAT('e',64),'parsed','processing',UTC_TIMESTAMP(3))", [eventId, eventId]);
    const pending = await service.handle({ eventId: pendingEvent, externalUserId: externalId, destinationId: "room", message: command });
    assert.equal(pending.status, "pending");
    const registered = await service.handle({ eventId: registerEvent, externalUserId: externalId, destinationId: "room", message: command });
    assert.equal(registered.status, "registered");
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM market_mini_pet_reservations WHERE listing_id=?", [registered.listingId]))[0]!.count, 2n);
    assert.equal((await database.query<Array<{ quantity: bigint }>>("SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?", [player, carrot]))[0]!.quantity, 60n);
    assert.equal((await database.query<Array<{ carrot_fee: bigint }>>("SELECT carrot_fee FROM market_listing_registration_fees WHERE listing_id=?", [registered.listingId]))[0]!.carrot_fee, 40n);
    const replay = await service.handle({ eventId: registerEvent, externalUserId: externalId, destinationId: "room", message: command });
    assert.equal(replay.replayed, true);
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM market_listings WHERE seller_player_id=?", [player]))[0]!.count, 1n);

    await database.execute("CREATE TRIGGER test_market_minipet_register_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'");
    await assert.rejects(() => service.handle({ eventId: rollbackEvent, externalUserId: externalId, destinationId: "room", message: "/미니펫거래등록 1 1 6000" }), /synthetic audit failure/);
    await database.execute("DROP TRIGGER test_market_minipet_register_audit");
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM operations WHERE idempotency_scope='market.mini_pet.register' AND idempotency_key=?", [rollbackEvent]))[0]!.count, 0n);
    await database.ping();
  });
});
