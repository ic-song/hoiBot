import assert from "node:assert/strict";
import { createDatabaseClient } from "../src/database.js";
import { HomeUpgradeService, type HomeUpgradeResult } from "../src/home/home-upgrade-service.js";

const database = createDatabaseClient({
  enabled: true,
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? "13307"),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  name: process.env.DB_NAME ?? "hoibot",
  connectionLimit: 4,
  connectTimeoutMs: 5000
});
const service = new HomeUpgradeService(database);
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-home-parity";
let eventSequence = 0;

// 독립 실행 명령이 command_executions FK를 만족하도록 합성 inbox를 만듭니다.
async function seedEvent(eventId: string): Promise<void> {
  await database.execute(
    `INSERT IGNORE INTO event_inbox (event_id, event_kind, processing_status, received_at)
     VALUES (?, 'message', 'processing', UTC_TIMESTAMP(3))`,
    [eventId]
  );
}

// 각 parity 시나리오를 동일한 집·펫·재료 상태에서 시작합니다.
async function resetState(): Promise<void> {
  await database.execute("DROP TRIGGER IF EXISTS synthetic_home_upgrade_home_fault");
  await database.execute("DROP TRIGGER IF EXISTS synthetic_home_upgrade_pet_fault");
  await database.execute("DROP TRIGGER IF EXISTS synthetic_home_upgrade_outbox_fault");
  await database.execute("DELETE FROM home_upgrade_confirmations WHERE player_id = 900000001");
  await database.execute("UPDATE home_upgrade_definitions SET version = 1, active = TRUE WHERE floor_area IN (1, 2)");
  await database.execute(
    `INSERT INTO player_pets (player_id, display_name, experience, version) VALUES (900000001, '합성펫', 0, 1)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), experience = 0, version = player_pets.version + 1`
  );
  await database.execute(
    `INSERT INTO player_homes (player_id, display_name, base_experience, floor_area, version) VALUES (900000001, '빈 터', 0, 0, 1)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), base_experience = 0, floor_area = 0, version = player_homes.version + 1`
  );
  await database.execute(
    `UPDATE inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
     SET stack.quantity = CASE item.code WHEN 'synthetic-home-wood' THEN 10 ELSE 5 END, stack.version = stack.version + 1
     WHERE stack.player_id = 900000001 AND item.code IN ('synthetic-home-wood', 'synthetic-home-stone')`
  );
}

// 고유 event로 실제 서비스 명령을 실행합니다.
async function call(message: string, label: string, fixedEventId?: string): Promise<HomeUpgradeResult> {
  const eventId = fixedEventId ?? `home-upgrade-parity-${label}-${++eventSequence}`;
  await seedEvent(eventId);
  return service.handle({ externalUserId, channelId, message, eventId });
}

// 현재 authoritative 집·펫·재료·pending 상태를 읽습니다.
async function readState(): Promise<{ floor: bigint; petExp: bigint; wood: bigint; stone: bigint; pending: string | null }> {
  const rows = await database.query<Array<{ floor: bigint; pet_exp: bigint; wood: bigint; stone: bigint; pending_status: string | null }>>(
    `SELECT home.floor_area AS floor, pet.experience AS pet_exp,
            MAX(CASE WHEN item.code = 'synthetic-home-wood' THEN stack.quantity ELSE 0 END) AS wood,
            MAX(CASE WHEN item.code = 'synthetic-home-stone' THEN stack.quantity ELSE 0 END) AS stone,
            confirmation.status AS pending_status
     FROM player_homes home JOIN player_pets pet ON pet.player_id = home.player_id
     JOIN inventory_stacks stack ON stack.player_id = home.player_id
     JOIN item_definitions item ON item.id = stack.item_id
     LEFT JOIN home_upgrade_confirmations confirmation ON confirmation.player_id = home.player_id
     WHERE home.player_id = 900000001 AND item.code IN ('synthetic-home-wood', 'synthetic-home-stone')
     GROUP BY home.floor_area, pet.experience, confirmation.status`
  );
  const row = rows[0]!;
  return { floor: BigInt(row.floor), petExp: BigInt(row.pet_exp), wood: BigInt(row.wood), stone: BigInt(row.stone), pending: row.pending_status };
}

const passed: string[] = [];
try {
  await resetState();
  await database.execute("UPDATE player_homes SET floor_area = 2 WHERE player_id = 900000001");
  assert.match((await call("/집짓기", "max")).data ?? "", /최고 단계/);
  passed.push("max-floor");

  await resetState();
  await database.execute("UPDATE inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id SET stack.quantity=1 WHERE stack.player_id=900000001 AND item.code='synthetic-home-wood'");
  assert.match((await call("/집짓기", "lack")).data ?? "", /재료가 부족/);
  passed.push("initial-material-shortage");

  await resetState();
  await database.execute("DELETE FROM furniture_placements WHERE player_id = 900000001");
  await database.execute("DELETE FROM home_activity_events WHERE home_player_id = 900000001");
  await database.execute("DELETE FROM home_comments WHERE home_player_id = 900000001");
  await database.execute("DELETE FROM home_reactions WHERE home_player_id = 900000001");
  await database.execute("DELETE FROM home_visits WHERE home_player_id = 900000001");
  await database.execute("DELETE FROM player_homes WHERE player_id = 900000001");
  assert.equal((await call("/집짓기", "new-home-preview")).status, "completed");
  assert.equal((await call("/집뚝딱", "new-home-execute")).status, "completed");
  assert.equal((await readState()).floor, 1n);
  passed.push("new-home-lazy-insert");

  await resetState();
  assert.match((await call("/집뚝딱", "no-pending")).data ?? "", /진행 중인/);
  passed.push("execute-without-pending");

  await resetState();
  await call("/집짓기", "material-preview");
  await database.execute("UPDATE inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id SET stack.quantity=0 WHERE stack.player_id=900000001 AND item.code='synthetic-home-wood'");
  assert.match((await call("/집뚝딱", "material-execute")).data ?? "", /재료가 부족/);
  assert.deepEqual(await readState(), { floor: 0n, petExp: 0n, wood: 0n, stone: 5n, pending: "invalidated" });
  passed.push("material-recheck");

  await resetState();
  await call("/집짓기", "stage-preview");
  await database.execute("UPDATE player_homes SET floor_area=1, version=version+1 WHERE player_id=900000001");
  assert.match((await call("/집뚝딱", "stage-execute")).data ?? "", /정보가 변경/);
  passed.push("stale-home-stage");

  await resetState();
  await call("/집짓기", "pet-preview");
  await database.execute("DELETE FROM pet_equipment WHERE player_pet_id IN (SELECT id FROM player_pets WHERE player_id=900000001)");
  await database.execute("DELETE FROM pet_expedition_runs WHERE player_pet_id IN (SELECT id FROM player_pets WHERE player_id=900000001)");
  await database.execute("DELETE FROM pet_skills WHERE player_pet_id IN (SELECT id FROM player_pets WHERE player_id=900000001)");
  await database.execute("DELETE FROM pet_skill_inventory WHERE player_pet_id IN (SELECT id FROM player_pets WHERE player_id=900000001)");
  await database.execute("DELETE FROM pet_titles WHERE player_pet_id IN (SELECT id FROM player_pets WHERE player_id=900000001)");
  await database.execute("DELETE FROM player_pet_elementals WHERE player_pet_id IN (SELECT id FROM player_pets WHERE player_id=900000001)");
  await database.execute("DELETE FROM player_pet_intimacy WHERE player_pet_id IN (SELECT id FROM player_pets WHERE player_id=900000001)");
  await database.execute("DELETE FROM player_pet_pendants WHERE player_pet_id IN (SELECT id FROM player_pets WHERE player_id=900000001)");
  await database.execute("DELETE FROM player_pets WHERE player_id=900000001");
  assert.match((await call("/집뚝딱", "pet-execute")).data ?? "", /정보가 변경/);
  passed.push("deleted-pet-invalidation");

  await resetState();
  await call("/집짓기", "definition-preview");
  await database.execute("UPDATE home_upgrade_definitions SET version=version+1 WHERE floor_area=1");
  assert.match((await call("/집뚝딱", "definition-execute")).data ?? "", /정보가 변경/);
  passed.push("definition-version-invalidation");

  await resetState();
  await call("/집짓기", "cancel-slash-preview");
  assert.equal((await call("/생각해본다", "cancel-slash")).status, "completed");
  assert.equal((await readState()).pending, "cancelled");
  passed.push("cancel-slash");

  await resetState();
  await call("/집짓기", "cancel-bare-preview");
  assert.equal((await call("생각해본다", "cancel-bare")).status, "completed");
  passed.push("cancel-bare-alias");

  await resetState();
  assert.match((await call("/생각해본다", "cancel-none")).data ?? "", /보류할/);
  passed.push("cancel-without-pending");

  await resetState();
  const duplicateEvent = "home-upgrade-parity-preview-duplicate";
  const firstPreview = await call("/집짓기", "preview-duplicate-first", duplicateEvent);
  const secondPreview = await call("/집짓기", "preview-duplicate-second", duplicateEvent);
  assert.deepEqual(secondPreview, firstPreview);
  passed.push("preview-event-replay");

  await resetState();
  await call("/집짓기", "concurrent-preview");
  const concurrentA = "home-upgrade-parity-concurrent-a";
  const concurrentB = "home-upgrade-parity-concurrent-b";
  await Promise.all([seedEvent(concurrentA), seedEvent(concurrentB)]);
  const concurrent = await Promise.all([
    service.handle({ externalUserId, channelId, message: "/집뚝딱", eventId: concurrentA }),
    service.handle({ externalUserId, channelId, message: "/집뚝딱", eventId: concurrentB })
  ]);
  assert.equal(concurrent.filter((result) => result.status === "completed").length, 1);
  assert.equal((await readState()).floor, 1n);
  passed.push("concurrent-single-consume");

  await resetState();
  await call("/집짓기", "ttl-preview");
  await database.execute("UPDATE home_upgrade_confirmations SET expires_at=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE player_id=900000001");
  assert.match((await call("/집뚝딱", "ttl-execute")).data ?? "", /만료/);
  assert.equal((await readState()).pending, "expired");
  passed.push("pending-expiry");

  await resetState();
  await call("/집짓기", "home-fault-preview");
  await database.execute("CREATE TRIGGER synthetic_home_upgrade_home_fault BEFORE UPDATE ON player_homes FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic home fault'");
  await assert.rejects(() => call("/집뚝딱", "home-fault-execute"));
  await database.execute("DROP TRIGGER synthetic_home_upgrade_home_fault");
  assert.deepEqual(await readState(), { floor: 0n, petExp: 0n, wood: 10n, stone: 5n, pending: "pending" });
  passed.push("home-write-rollback");

  await resetState();
  await call("/집짓기", "pet-fault-preview");
  await database.execute("CREATE TRIGGER synthetic_home_upgrade_pet_fault BEFORE UPDATE ON player_pets FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic pet fault'");
  await assert.rejects(() => call("/집뚝딱", "pet-fault-execute"));
  await database.execute("DROP TRIGGER synthetic_home_upgrade_pet_fault");
  assert.deepEqual(await readState(), { floor: 0n, petExp: 0n, wood: 10n, stone: 5n, pending: "pending" });
  passed.push("pet-write-rollback");

  await resetState();
  await call("/집짓기", "outbox-fault-preview");
  await database.execute("CREATE TRIGGER synthetic_home_upgrade_outbox_fault BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic outbox fault'");
  await assert.rejects(() => call("/집뚝딱", "outbox-fault-execute"));
  await database.execute("DROP TRIGGER synthetic_home_upgrade_outbox_fault");
  assert.deepEqual(await readState(), { floor: 0n, petExp: 0n, wood: 10n, stone: 5n, pending: "pending" });
  passed.push("outbox-rollback");

  await resetState();
  assert.equal((await call("집뚝딱", "bare-execute-none")).status, "rejected");
  assert.equal((await call("생각해본다", "bare-cancel-none")).status, "rejected");
  passed.push("approved-bare-alias-dispatch");

  assert.equal(passed.length, 18);
  console.log(JSON.stringify({ passCount: passed.length, liveTraffic: false, productionData: false, passed }));
} finally {
  await database.execute("DROP TRIGGER IF EXISTS synthetic_home_upgrade_home_fault").catch(() => undefined);
  await database.execute("DROP TRIGGER IF EXISTS synthetic_home_upgrade_pet_fault").catch(() => undefined);
  await database.execute("DROP TRIGGER IF EXISTS synthetic_home_upgrade_outbox_fault").catch(() => undefined);
  await database.close();
}
