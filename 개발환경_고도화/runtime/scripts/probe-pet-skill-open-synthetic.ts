import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { PET_SKILL_OPEN_BOOK_CODE, PetSkillOpenService } from "../src/pet/pet-skill-open-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("db required");
if (!/^hoibot_pet_skill_open/i.test(config.database.name)) throw new Error("blocked: isolated pet skill open database required");
let database = createDatabaseClient(config.database);
const playerId = 989300001n;
const petId = 989300001n;
const externalUserId = "pet-skill-open-user";
const destinationId = "pet-skill-open-room";
const successEvent = "pet-skill-open-g7-success";
const changedCatalogEvent = "pet-skill-open-g7-changed-catalog";
const rollbackEvent = "pet-skill-open-g7-rollback";
const capacityEvent = "pet-skill-open-g7-capacity";
let isolatedCatalogIds: bigint[] = [];

async function addEvent(eventId: string): Promise<void> {
  await database.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3))",
    [eventId, eventId, destinationId, externalUserId],
  );
}

async function state(bookItemId: bigint, firstSkillId: bigint, secondSkillId: bigint) {
  return (await database.query<Array<{ books: bigint; first_skill: string; second_skill: string; operations: bigint; draws: bigint; ledgers: bigint; audits: bigint; outbox: bigint }>>(
    `SELECT
      (SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?) books,
      COALESCE((SELECT quantity FROM pet_skill_inventory WHERE player_pet_id=? AND skill_id=?),0) first_skill,
      COALESCE((SELECT quantity FROM pet_skill_inventory WHERE player_pet_id=? AND skill_id=?),0) second_skill,
      (SELECT COUNT(*) FROM pet_skill_open_operations) operations,
      (SELECT COUNT(*) FROM pet_skill_open_draws) draws,
      (SELECT COUNT(*) FROM inventory_ledger WHERE reason_code='pet_skill_book_open_consume') ledgers,
      (SELECT COUNT(*) FROM command_audit WHERE action_code='pet.skill_open') audits,
      (SELECT COUNT(*) FROM outbox_messages WHERE operation_id IN (SELECT operation_id FROM pet_skill_open_operations)) outbox`,
    [playerId, bookItemId, petId, firstSkillId, petId, secondSkillId],
  ))[0]!;
}

try {
  const registry = (await database.query<Array<{ handler_key: string; rollout_state: string; enabled: number | bigint }>>(
    "SELECT handler_key,rollout_state,enabled FROM command_registry WHERE command_code='PET_SKILL_OPEN'",
  ))[0];
  assert.ok(registry);
  assert.equal(registry.handler_key, "pet_skill_open");
  assert.equal(registry.rollout_state, "SHADOW");
  assert.equal(Number(registry.enabled), 1);
  const aliases = await database.query<Array<{ command_text: string; active: number | bigint }>>(
    "SELECT command_text,active FROM command_aliases WHERE command_code='PET_SKILL_OPEN' ORDER BY command_text",
  );
  assert.deepEqual(aliases.map((row) => ({ commandText: row.command_text, active: Number(row.active) })), [
    { commandText: "/펫스킬오픈", active: 1 },
    { commandText: "/펫스킬오픈 [숫자]", active: 1 },
  ]);

  isolatedCatalogIds = (await database.query<Array<{ id: bigint }>>(
    `SELECT id FROM skill_definitions
     WHERE active=TRUE AND JSON_EXTRACT(rules_json,'$.grade') IS NOT NULL
       AND (JSON_EXTRACT(rules_json,'$.actualRate') IS NOT NULL OR JSON_EXTRACT(rules_json,'$.rate') IS NOT NULL)
       AND JSON_EXTRACT(rules_json,'$.weight') IS NOT NULL
     ORDER BY id`,
  )).map((row) => row.id);
  if (isolatedCatalogIds.length > 0) {
    await database.execute(
      `UPDATE skill_definitions SET active=FALSE WHERE id IN (${isolatedCatalogIds.map(() => "?").join(",")})`,
      isolatedCatalogIds,
    );
  }

  await database.execute("INSERT INTO players(id,status) VALUES (?,'active')", [playerId]);
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'펫스킬 오픈테스터')", [playerId]);
  await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (?,'👑',1)", [playerId]);
  await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (?,?,'kakao',?,'펫스킬 오픈테스터','linked')", [playerId, playerId, externalUserId]);
  await database.execute("INSERT INTO player_pets(id,player_id,display_name) VALUES (?,?,'오픈테스트펫')", [petId, playerId]);
  await database.execute(
    `INSERT INTO skill_definitions(code,display_name,rules_json,active) VALUES
      ('probe-pet-skill-open-a','알파스킬📙',JSON_OBJECT('grade','SS','rate',25.0,'actualRate',25.0,'weight',1),TRUE),
      ('probe-pet-skill-open-b','베타스킬📙',JSON_OBJECT('grade','D','rate',75.0,'actualRate',75.0,'weight',3),TRUE)`,
  );
  const skills = await database.query<Array<{ id: bigint; code: string }>>("SELECT id,code FROM skill_definitions WHERE code IN ('probe-pet-skill-open-a','probe-pet-skill-open-b') ORDER BY code");
  const firstSkill = skills[0]!;
  const secondSkill = skills[1]!;
  const bookItem = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code=?", [PET_SKILL_OPEN_BOOK_CODE]))[0]!;
  assert.ok(bookItem);
  await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity) VALUES (?,?,10)", [playerId, bookItem.id]);

  const samples = [0, 0.75];
  let rngCalls = 0;
  let service = new PetSkillOpenService(database, () => { rngCalls += 1; return samples.shift()!; });
  await addEvent(successEvent);
  const result = await service.handle({ eventId: successEvent, externalUserId, destinationId, message: "/펫스킬오픈 2" });
  assert.equal(result.status, "opened");
  if (result.status !== "opened") throw new Error("unexpected siege block");
  assert.equal(result.openCount, "2");
  assert.equal(rngCalls, 2);
  const mutated = await state(bookItem.id, firstSkill.id, secondSkill.id);
  assert.deepEqual(mutated, { books: 8n, first_skill: "1", second_skill: "1", operations: 1n, draws: 2n, ledgers: 1n, audits: 1n, outbox: 1n });
  const evidence = await database.query<Array<{ catalog_hash: string; catalog_snapshot_json: string | object; sequence_no: number; sample_value: string; interval_lower: string; interval_upper: string; selected_skill_code: string }>>(
    `SELECT operation.catalog_hash,operation.catalog_snapshot_json,draw.sequence_no,draw.sample_value,draw.interval_lower,draw.interval_upper,draw.selected_skill_code
     FROM pet_skill_open_operations operation JOIN pet_skill_open_draws draw ON draw.operation_id=operation.operation_id
     ORDER BY draw.sequence_no`,
  );
  assert.equal(evidence.length, 2);
  assert.equal(evidence[0]!.selected_skill_code, "probe-pet-skill-open-a");
  assert.equal(evidence[1]!.selected_skill_code, "probe-pet-skill-open-b");
  assert.equal(evidence[0]!.catalog_hash.length, 64);
  assert.ok(evidence[0]!.catalog_snapshot_json);

  await database.execute("UPDATE skill_definitions SET rules_json=JSON_SET(rules_json,'$.weight',9,'$.rate',90,'$.actualRate',90) WHERE code='probe-pet-skill-open-a'");
  assert.deepEqual(await service.handle({ eventId: successEvent, externalUserId, destinationId, message: "/펫스킬오픈 2" }), result);
  assert.equal(rngCalls, 2);
  assert.deepEqual(await state(bookItem.id, firstSkill.id, secondSkill.id), mutated);

  await addEvent(changedCatalogEvent);
  service = new PetSkillOpenService(database, () => { rngCalls += 1; return 0.5; });
  const changedCatalogResult = await service.handle({ eventId: changedCatalogEvent, externalUserId, destinationId, message: "/펫스킬오픈" });
  assert.equal(changedCatalogResult.status, "opened");
  if (changedCatalogResult.status !== "opened") throw new Error("unexpected siege block");
  assert.notEqual(changedCatalogResult.catalogHash, result.catalogHash);
  const beforeRollback = await state(bookItem.id, firstSkill.id, secondSkill.id);

  await addEvent(rollbackEvent);
  await database.execute("CREATE TRIGGER probe_pet_skill_open_audit_fail BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced pet skill open rollback'");
  service = new PetSkillOpenService(database, () => 0.99);
  await assert.rejects(service.handle({ eventId: rollbackEvent, externalUserId, destinationId, message: "/펫스킬오픈" }));
  await database.execute("DROP TRIGGER probe_pet_skill_open_audit_fail");
  assert.deepEqual(await state(bookItem.id, firstSkill.id, secondSkill.id), beforeRollback);

  const currentFirst = (await database.query<Array<{ quantity: bigint }>>("SELECT quantity FROM pet_skill_inventory WHERE player_pet_id=? AND skill_id=?", [petId, firstSkill.id]))[0]!.quantity;
  await database.execute("UPDATE pet_skill_inventory SET quantity=quantity+? WHERE player_pet_id=? AND skill_id=?", [100n - currentFirst - 1n, petId, firstSkill.id]);
  await database.execute("UPDATE pet_skill_inventory SET quantity=1 WHERE player_pet_id=? AND skill_id=?", [petId, secondSkill.id]);
  await addEvent(capacityEvent);
  await assert.rejects(service.handle({ eventId: capacityEvent, externalUserId, destinationId, message: "/펫스킬오픈" }), /스킬가방 공간이 부족합니다/);

  await database.close();
  database = createDatabaseClient(config.database);
  service = new PetSkillOpenService(database, () => { throw new Error("replay must not call RNG"); });
  assert.deepEqual(await service.handle({ eventId: successEvent, externalUserId, destinationId, message: "/펫스킬오픈 2" }), result);
  process.stdout.write(JSON.stringify({ scenarios: ["shadow-registry", "catalog-snapshot", "mutation", "idempotent-replay", "forced-audit-rollback", "restart-replay", "capacity"], catalogHash: result.catalogHash, state: beforeRollback }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
} finally {
  await database.execute("DROP TRIGGER IF EXISTS probe_pet_skill_open_audit_fail").catch(() => undefined);
  if (isolatedCatalogIds.length > 0) {
    await database.execute(
      `UPDATE skill_definitions SET active=TRUE WHERE id IN (${isolatedCatalogIds.map(() => "?").join(",")})`,
      isolatedCatalogIds,
    ).catch(() => undefined);
  }
  await database.close();
}
