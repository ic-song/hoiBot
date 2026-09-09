import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { HomeBadgeInventoryService } from "../src/home/home-badge-inventory-service.js";

const enabled = process.env.HOME_BADGE_INVENTORY_MARIADB_TEST === "true";
const database = enabled ? createDatabaseClient(loadConfig().database) : null;
const service = database === null ? null : new HomeBadgeInventoryService(database);
after(async () => { if (database !== null) await database.close(); });

describe("home badge inventory MariaDB", { skip: !enabled }, () => {
  it("keeps invalid, concurrent replay, catch-up alert and rollback atomic", async () => {
    assert.ok(database !== null && service !== null);
    await database.query("INSERT INTO players(id,status) VALUES (990000109,'active')");
    await database.query("INSERT INTO player_profiles(player_id,current_display_name,terms_agreed) VALUES (990000109,'뱃지테스트',TRUE)");
    await database.query("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (990000109,'kakao','home-badge-inventory-user','뱃지테스트','linked')");
    await database.query("INSERT INTO pet_home_badge_stats(player_id,followers) VALUES (990000109,1)");
    await database.query(`INSERT INTO event_inbox(event_id,event_kind,payload_hash,processing_status,received_at) VALUES
      ('badge-invalid','message',REPEAT('a',64),'received',UTC_TIMESTAMP(3)),
      ('badge-concurrent','message',REPEAT('b',64),'received',UTC_TIMESTAMP(3)),
      ('badge-forced-rollback','message',REPEAT('c',64),'received',UTC_TIMESTAMP(3)),
      ('badge-detail','message',REPEAT('d',64),'received',UTC_TIMESTAMP(3)),
      ('badge-shadow-all','message',REPEAT('e',64),'received',UTC_TIMESTAMP(3))`);

    const invalid = await service.execute({
      eventId: "badge-invalid", externalUserId: "home-badge-inventory-user",
      destinationId: "isolated-home-badge-room", message: "/홈뱃지정보 UNKNOWN"
    });
    assert.equal(invalid.resultCode, "invalid_selection");
    assert.equal((await database.query<Array<{ value: bigint }>>(
      "SELECT COUNT(*) value FROM player_badge_assignments WHERE player_id=990000109"
    ))[0]!.value, 0n);

    const concurrent = await Promise.all([
      service.execute({ eventId: "badge-concurrent", externalUserId: "home-badge-inventory-user", destinationId: "isolated-home-badge-room", message: "/홈뱃지" }),
      service.execute({ eventId: "badge-concurrent", externalUserId: "home-badge-inventory-user", destinationId: "isolated-home-badge-room", message: "/홈뱃지" })
    ]);
    assert.deepEqual(concurrent.map((result) => result.replayed).sort(), [false, true]);
    assert.deepEqual(concurrent[0]!.awardedBadges, ["F01"]);
    assert.equal((await database.query<Array<{ value: bigint }>>(
      "SELECT COUNT(*) value FROM pet_home_activity_alerts WHERE owner_player_id=990000109 AND alert_type='badge_earned'"
    ))[0]!.value, 1n);

    await database.query("UPDATE pet_home_badge_stats SET followers=10 WHERE player_id=990000109");
    await assert.rejects(service.execute({
      eventId: "badge-forced-rollback", externalUserId: "home-badge-inventory-user",
      destinationId: "x".repeat(300), message: "/홈뱃지"
    }));
    assert.equal((await database.query<Array<{ value: bigint }>>(
      "SELECT COUNT(*) value FROM player_home_badges WHERE player_id=990000109 AND badge_code='F02' AND owned=TRUE"
    ))[0]!.value, 0n);
    assert.equal((await database.query<Array<{ value: bigint }>>(
      "SELECT COUNT(*) value FROM operations WHERE idempotency_scope='home.badge_inventory.read' AND idempotency_key='badge-forced-rollback'"
    ))[0]!.value, 0n);

    const detail = await service.execute({
      eventId: "badge-detail", externalUserId: "home-badge-inventory-user",
      destinationId: "isolated-home-badge-room", message: "/홈뱃지정보 [f02]"
    });
    assert.deepEqual(detail.awardedBadges, ["F02"]);
    assert.match(detail.message, /\[F02\].*친근한 홈/s);
  });
});
