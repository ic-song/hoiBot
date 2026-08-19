import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PetFoodBoxOpenService } from "../src/inventory/pet-food-box-open-service.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) throw new Error("Synthetic Shadow requires a hoibot_rehearsal_* database.");
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const externalUserId = `synthetic-petfood-${suffix}`;
let database = createDatabaseClient(config.database);
let playerId: bigint | undefined;
let identityId: bigint | undefined;

// 특정 SQL에서만 실패시키는 시험 DB wrapper로 atomic rollback을 확인합니다.
function failOn(inner: DatabaseClient, fragment: string): DatabaseClient {
  return { ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params), verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({ query: (sql, params) => transaction.query(sql, params), execute: async (sql, params) => { if (sql.includes(fragment)) throw new Error("synthetic failpoint"); return transaction.execute(sql, params); } })) };
}

async function stack(code: string): Promise<bigint | null> {
  const rows = await database.query<Array<{ quantity: bigint }>>("SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id WHERE stack.player_id = ? AND item.code = ?", [playerId!, code]);
  return rows[0]?.quantity ?? null;
}

async function seedEvent(eventId: string): Promise<void> {
  await database.execute("INSERT INTO event_inbox (event_id, provider_code, provider_event_id, event_kind, direction, payload_hash, parse_status, processing_status, received_at, attempt_count) VALUES (?, 'iris', ?, '1', 'incoming', ?, 'parsed', 'processed', UTC_TIMESTAMP(3), 1)", [eventId, eventId, "0".repeat(64)]);
}

try {
  const player = await database.execute("INSERT INTO players (status, version, created_at, updated_at) VALUES ('active', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))"); playerId = player.insertId;
  await database.execute("INSERT INTO player_profiles (player_id, current_display_name, version, updated_at) VALUES (?, '합성펫먹이', 1, UTC_TIMESTAMP(3))", [playerId]);
  const identity = await database.execute("INSERT INTO external_identities (player_id, provider_code, external_user_id, display_name, status, created_at, updated_at) VALUES (?, 'kakao', ?, '합성펫먹이', 'linked', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [playerId, externalUserId]); identityId = identity.insertId;
  for (const [code, name] of [["pet_food_dungeon_box", "펫먹이던전박스🍼(/펫먹이박스오픈)"], ["pet_food", "펫먹이🍼"]]) {
    await database.execute("INSERT INTO item_definitions (code, display_name, asset_type_code, stackable, metadata_json, active, version) VALUES (?, ?, 'item', TRUE, JSON_OBJECT('synthetic', TRUE), TRUE, 1) ON DUPLICATE KEY UPDATE active = TRUE", [code, name]);
  }
  await database.execute("INSERT INTO inventory_stacks (player_id, item_id, quantity, version) SELECT ?, id, 3, 1 FROM item_definitions WHERE code = 'pet_food_dungeon_box'", [playerId]);
  await database.execute("INSERT INTO inventory_stacks (player_id, item_id, quantity, version) SELECT ?, id, 5, 1 FROM item_definitions WHERE code = 'pet_food'", [playerId]);
  const eventId = `iris:petfood-${suffix}`;
  await seedEvent(eventId);
  const values = [0, .5, .999999]; let calls = 0;
  const normal = await new PetFoodBoxOpenService(database, () => values[calls++]!).handle({ externalUserId, channelId: "synthetic-room", message: "/펫먹이박스오픈 99", eventId });
  assert.deepEqual({ effective: normal.effectiveOpenCount, reward: normal.rewardTotal, trace: normal.randomTrace }, { effective: "3", reward: "135", trace: values });
  assert.deepEqual({ box: await stack("pet_food_dungeon_box"), food: await stack("pet_food") }, { box: null, food: 140n });
  await database.close();
  database = createDatabaseClient(config.database);
  const replay = await new PetFoodBoxOpenService(database, () => { throw new Error("duplicate must not re-roll"); }).handle({ externalUserId, channelId: "synthetic-room", message: "/펫먹이박스오픈 99", eventId });
  assert.equal(replay.duplicate, true);
  await database.execute("INSERT INTO inventory_stacks (player_id, item_id, quantity, version) SELECT ?, id, 1, 1 FROM item_definitions WHERE code = 'pet_food_dungeon_box'", [playerId]);
  const before = { box: await stack("pet_food_dungeon_box"), food: await stack("pet_food") };
  const failpointEvent = `${eventId}-failpoint`;
  await seedEvent(failpointEvent);
  await assert.rejects(() => new PetFoodBoxOpenService(failOn(database, "INSERT INTO inventory_ledger"), () => 0).handle({ externalUserId, channelId: "synthetic-room", message: "/펫먹이박스오픈", eventId: failpointEvent }), /synthetic failpoint/);
  assert.deepEqual({ box: await stack("pet_food_dungeon_box"), food: await stack("pet_food") }, before);
  const operationRows = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM operations WHERE idempotency_key IN (?, ?)", [eventId, `${eventId}-failpoint`]);
  assert.equal(operationRows[0]?.count, 1n);
  process.stdout.write(JSON.stringify({ slice: "SL-INVENTORY-PET-FOOD-BOX-OPEN", database: config.database.name, normal: true, duplicateReplay: true, failpointRollback: true, restartReplay: true, operationalSnapshotTouched: false }) + "\n");
} finally {
  await database.execute("DELETE ledger FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id WHERE operation_row.idempotency_scope LIKE 'inventory.pet-food-box-open:%'");
  await database.execute("DELETE audit FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id WHERE operation_row.idempotency_scope LIKE 'inventory.pet-food-box-open:%'");
  await database.execute("DELETE outbox FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_scope LIKE 'inventory.pet-food-box-open:%'");
  await database.execute("DELETE FROM command_executions WHERE command_code = 'pet_food_box_open'");
  await database.execute("DELETE FROM operations WHERE idempotency_scope LIKE 'inventory.pet-food-box-open:%'");
  await database.execute("DELETE FROM event_inbox WHERE event_id LIKE 'iris:petfood-%'");
  if (identityId !== undefined) await database.execute("DELETE FROM external_identities WHERE id = ?", [identityId]);
  if (playerId !== undefined) { await database.execute("DELETE FROM inventory_stacks WHERE player_id = ?", [playerId]); await database.execute("DELETE FROM player_profiles WHERE player_id = ?", [playerId]); await database.execute("DELETE FROM players WHERE id = ?", [playerId]); }
  await database.close();
}
