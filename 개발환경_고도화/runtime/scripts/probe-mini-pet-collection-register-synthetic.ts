import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MiniPetCollectionRegisterService } from "../src/mini-pet/collection-register-service.js";
import { MariaMiniPetCollectionRegisterRepository } from "../src/mini-pet/maria-collection-register-repository.js";

const database = createDatabaseClient(loadConfig().database);
const service = new MiniPetCollectionRegisterService(new MariaMiniPetCollectionRegisterRepository(database));
const playerId = 960000384n;
const base = { externalUserId: "synthetic-collection-register", channelId: "synthetic-room-384" };

async function event(eventId: string): Promise<void> {
  await database.execute(
    `INSERT INTO event_inbox
      (event_id, provider_code, provider_event_id, event_kind, processing_status, received_at, processed_at, attempt_count)
     VALUES (?, 'iris', ?, 'message', 'processed', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 1)
     ON DUPLICATE KEY UPDATE processing_status = VALUES(processing_status)`,
    [eventId, eventId]
  );
}

async function addPet(code: string, name: string, grade: string, stableId: string, sortIndex: number): Promise<void> {
  await database.execute(
    `INSERT INTO mini_pet_definitions (code, display_name, grade_code, active)
     VALUES (?, ?, ?, TRUE) ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), grade_code = VALUES(grade_code), active = TRUE`,
    [code, name, grade]
  );
  const definitions = await database.query<Array<{ id: bigint }>>("SELECT id FROM mini_pet_definitions WHERE code = ?", [code]);
  const owned = await database.execute(
    "INSERT INTO owned_mini_pets (player_id, mini_pet_definition_id, progress, equipped) VALUES (?, ?, 0, FALSE)",
    [playerId, definitions[0]!.id]
  );
  await database.execute(
    `INSERT INTO mini_pet_inventory_owned_states
      (owned_mini_pet_id, player_id, stable_owned_id, sort_index, version)
     VALUES (?, ?, ?, ?, 1)`,
    [owned.insertId, playerId, stableId, sortIndex]
  );
}

try {
  await database.execute("INSERT INTO players (id, status, version) VALUES (?, 'active', 1)", [playerId]);
  await database.execute(
    `INSERT INTO external_identities (player_id, provider_code, external_user_id, display_name, status)
     VALUES (?, 'kakao', ?, '합성 컬렉션 사용자', 'linked')`,
    [playerId, base.externalUserId]
  );
  await database.execute("INSERT INTO currency_accounts (player_id, currency_code, balance, version) VALUES (?, 'point', 100000, 1)", [playerId]);
  await database.execute(
    `INSERT INTO item_definitions (code, display_name, asset_type_code, stackable, active, version)
     VALUES ('pet_food', '펫먹이🍼', 'item', TRUE, TRUE, 1)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = TRUE`,
  );
  await addPet("collection-probe-myth", "합성신화", "mythic", "10000000-0000-4000-8000-000000000384", 1);
  await addPet("collection-probe-trans", "합성초월", "transcendence", "20000000-0000-4000-8000-000000000384", 2);
  await database.execute("UPDATE mini_pet_collection_grade_rules SET minimum_progress = 10, point_cost_per_missing_progress = 100 WHERE grade_code IN ('mythic', 'transcendence')");

  await event("collection-preview-384");
  const preview = await service.handle({ ...base, eventId: "collection-preview-384", message: "/컬렉션등록 1 2" });
  assert.equal(preview.status, "previewed");
  assert.match(preview.confirmationToken ?? "", /^[0-9a-f-]{36}$/);
  await event("collection-confirm-384");
  const confirmMessage = `/컬렉션등록 확인 ${preview.confirmationToken}`;
  const confirmed = await service.handle({ ...base, eventId: "collection-confirm-384", message: confirmMessage });
  const replay = await service.handle({ ...base, eventId: "collection-confirm-384", message: confirmMessage });
  assert.deepEqual(replay, confirmed);
  assert.equal(confirmed.status, "registered");
  assert.equal(confirmed.pointCost, "2000");
  assert.equal(confirmed.completedStage, 1);
  assert.deepEqual(confirmed.rewards, [{ itemCode: "pet_food", quantity: "52100" }]);

  await addPet("collection-probe-concurrent", "합성창세", "genesis", "40000000-0000-4000-8000-000000000384", 1);
  await event("collection-preview-concurrent-384");
  const concurrentPreview = await service.handle({ ...base, eventId: "collection-preview-concurrent-384", message: "/컬렉션등록 1" });
  await event("collection-confirm-concurrent-384");
  const concurrentMessage = `/컬렉션등록 확인 ${concurrentPreview.confirmationToken}`;
  const concurrent = await Promise.all([
    service.handle({ ...base, eventId: "collection-confirm-concurrent-384", message: concurrentMessage }),
    service.handle({ ...base, eventId: "collection-confirm-concurrent-384", message: concurrentMessage })
  ]);
  assert.deepEqual(concurrent[1], concurrent[0]);
  assert.equal(concurrent[0].completedStage, 2);

  const state = await database.query<Array<{ pets: bigint; food: bigint; point: string; entries: bigint; titles: bigint; ledger: bigint }>>(
    `SELECT
      (SELECT COUNT(*) FROM owned_mini_pets WHERE player_id = ?) pets,
      (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id WHERE stack.player_id = ? AND item.code = 'pet_food') food,
      (SELECT balance FROM currency_accounts WHERE player_id = ? AND currency_code = 'point') point,
      (SELECT COUNT(*) FROM mini_pet_collection_entries WHERE player_id = ?) entries,
      (SELECT COUNT(*) FROM player_titles WHERE player_id = ?) titles,
      (SELECT COUNT(*) FROM mini_pet_collection_registration_ledger WHERE player_id = ?) ledger`,
    [playerId, playerId, playerId, playerId, playerId, playerId]
  );
  assert.deepEqual({ pets: state[0]!.pets.toString(), food: state[0]!.food.toString(), point: state[0]!.point,
    entries: state[0]!.entries.toString(), titles: state[0]!.titles.toString(), ledger: state[0]!.ledger.toString() },
  { pets: "0", food: "119100", point: "98000.000", entries: "3", titles: "2", ledger: "2" });

  await addPet("collection-probe-stale", "합성태초", "primordial", "30000000-0000-4000-8000-000000000384", 1);
  await event("collection-preview-stale-384");
  const stale = await service.handle({ ...base, eventId: "collection-preview-stale-384", message: "/컬렉션등록 1" });
  await database.execute("UPDATE mini_pet_inventory_owned_states SET version = version + 1 WHERE player_id = ? AND sort_index = 1", [playerId]);
  await event("collection-confirm-stale-384");
  await assert.rejects(service.handle({ ...base, eventId: "collection-confirm-stale-384", message: `/컬렉션등록 확인 ${stale.confirmationToken}` }), /가방이 변경/);
  const staleCount = await database.query<Array<{ pets: bigint; ledger: bigint }>>(
    "SELECT (SELECT COUNT(*) FROM owned_mini_pets WHERE player_id = ?) pets, (SELECT COUNT(*) FROM mini_pet_collection_registration_ledger WHERE player_id = ?) ledger",
    [playerId, playerId]
  );
  assert.deepEqual([staleCount[0]!.pets.toString(), staleCount[0]!.ledger.toString()], ["1", "2"]);

  await event("collection-preview-cancel-384");
  const cancelPreview = await service.handle({ ...base, eventId: "collection-preview-cancel-384", message: "/컬렉션등록 1" });
  await event("collection-cancel-384");
  const cancelled = await service.handle({ ...base, eventId: "collection-cancel-384", message: `/컬렉션등록 취소 ${cancelPreview.confirmationToken}` });
  assert.equal(cancelled.status, "cancelled");
  await addPet("collection-probe-late-rollback", "합성창조", "creation", "50000000-0000-4000-8000-000000000384", 2);
  await event("collection-preview-late-rollback-384");
  const latePreview = await service.handle({ ...base, eventId: "collection-preview-late-rollback-384", message: "/컬렉션등록 2" });
  await assert.rejects(service.handle({ ...base, eventId: "collection-confirm-late-rollback-384",
    message: `/컬렉션등록 확인 ${latePreview.confirmationToken}` }));
  const lateState = await database.query<Array<{ registrations: bigint; pets: bigint; food: bigint; titles: bigint }>>(
    `SELECT
      (SELECT COUNT(*) FROM mini_pet_collection_registration_ledger WHERE player_id = ?) registrations,
      (SELECT COUNT(*) FROM owned_mini_pets WHERE player_id = ?) pets,
      (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id WHERE stack.player_id = ? AND item.code = 'pet_food') food,
      (SELECT COUNT(*) FROM player_titles WHERE player_id = ?) titles`,
    [playerId, playerId, playerId, playerId]
  );
  assert.deepEqual([lateState[0]!.registrations.toString(), lateState[0]!.pets.toString(),
    lateState[0]!.food.toString(), lateState[0]!.titles.toString()], ["2", "2", "119100", "2"]);
  const ignored = await service.handle({ externalUserId: "unlinked-collection-user", channelId: base.channelId,
    eventId: "collection-unlinked-384", message: "/컬렉션등록 1" });
  assert.equal(ignored.status, "ignored");
  console.log(JSON.stringify({ token: preview.confirmationToken, confirmEventId: "collection-confirm-384",
    registered: true, stableIdentity: true, versionCas: true, replay: true, concurrent: true,
    staleRollback: true, lateRollback: true, unlinkedIgnored: true, cancelled: true,
    pointCost: confirmed.pointCost, rewards: confirmed.rewards }));
} finally {
  await database.close();
}
