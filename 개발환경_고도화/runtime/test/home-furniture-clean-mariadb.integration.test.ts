import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { HomeFurnitureCleanService } from "../src/home/home-furniture-clean-service.js";

const integration = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;

integration("home furniture clean MariaDB integration", () => {
  let database: DatabaseClient;
  const playerId = 988950001;
  const identityId = 988950001;
  const suffix = `${process.pid}-${Date.now()}`;
  const user = `home-clean-${suffix}`;
  const room = "home-clean-integration-room";

  before(async () => {
    database = createDatabaseClient(loadConfig().database);
    await database.execute("INSERT INTO players(id,status) VALUES (?,'active')", [playerId]);
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'집청소 사용자')", [playerId]);
    await database.execute("INSERT INTO player_homes(player_id,display_name) VALUES (?,'격리 테스트 집')", [playerId]);
    await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,status) VALUES (?,?,'kakao',?,'linked')", [identityId, playerId, user]);
    await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',500,0)", [playerId]);
    for (const [code, name, charm, status] of [["clean-high", "높은 침대", 1000, "placed"], ["clean-low", "낮은 의자", 100, "placed"], ["clean-bag", "가방 탁자", 5000, "bag"]] as const) {
      const definition = await database.execute("INSERT INTO furniture_definitions(code,display_name,charm_value) VALUES (?,?,?)", [`${code}-${suffix}`, name, charm]);
      await database.execute("INSERT INTO furniture_inventory_instances(player_id,furniture_definition_id,charm_snapshot,grade_display_name,status,version) VALUES (?,?,?,'테스트',?,1)", [playerId, definition.insertId, charm, status]);
    }
  });

  after(async () => database.close());

  async function event(id: string): Promise<void> {
    await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('6',64),'processed',UTC_TIMESTAMP(3))", [id, id, room, user]);
  }

  async function state(): Promise<{ placed: bigint; sold: bigint; bag: bigint; point: string; furnitureLedgers: bigint; currencyLedgers: bigint; cleanOperations: bigint }> {
    return (await database.query<Array<{ placed: bigint; sold: bigint; bag: bigint; point: string; furnitureLedgers: bigint; currencyLedgers: bigint; cleanOperations: bigint }>>("SELECT (SELECT COUNT(*) FROM furniture_inventory_instances WHERE player_id=? AND status='placed') placed,(SELECT COUNT(*) FROM furniture_inventory_instances WHERE player_id=? AND status='sold') sold,(SELECT COUNT(*) FROM furniture_inventory_instances WHERE player_id=? AND status='bag') bag,CAST((SELECT balance FROM currency_accounts WHERE player_id=? AND currency_code='point') AS CHAR) point,(SELECT COUNT(*) FROM furniture_inventory_ledger WHERE reason_code='HOME_FURNITURE_CLEAN') furnitureLedgers,(SELECT COUNT(*) FROM currency_ledger WHERE reason_code='HOME_FURNITURE_CLEAN_REWARD') currencyLedgers,(SELECT COUNT(*) FROM home_furniture_clean_operations) cleanOperations", [playerId, playerId, playerId, playerId]))[0]!;
  }

  it("keeps stable order, atomic reward, replay and rollback", async () => {
    const service = new HomeFurnitureCleanService(database);
    const usageEvent = `home-clean-${suffix}-usage`;
    await event(usageEvent);
    assert.equal((await service.handle({ eventId: usageEvent, externalUserId: user, destinationId: room, message: "/집청소" })).status, "rejected");

    const successEvent = `home-clean-${suffix}-success`;
    await event(successEvent);
    const success = await service.handle({ eventId: successEvent, externalUserId: user, destinationId: room, message: "/집청소 1" });
    assert.equal(success.status, "cleaned");
    assert.equal(success.rewardPoint, "100000");
    assert.match(success.reply, /높은 침대/);
    assert.deepEqual(await state(), { placed: 1n, sold: 1n, bag: 1n, point: "100500.000", furnitureLedgers: 1n, currencyLedgers: 1n, cleanOperations: 1n });
    assert.deepEqual(await service.handle({ eventId: successEvent, externalUserId: user, destinationId: room, message: "/집청소 1" }), success);

    const rollbackBefore = await state();
    const rollbackEvent = `home-clean-${suffix}-rollback`;
    await event(rollbackEvent);
    await database.execute("CREATE TRIGGER fail_home_clean_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced home clean audit failure'");
    try {
      await assert.rejects(() => service.handle({ eventId: rollbackEvent, externalUserId: user, destinationId: room, message: "/집청소 1" }), /forced home clean audit failure/);
    } finally {
      await database.execute("DROP TRIGGER IF EXISTS fail_home_clean_audit");
    }
    assert.deepEqual(await state(), rollbackBefore);
    assert.equal(await database.verifyRollback(), true);
  });
});
