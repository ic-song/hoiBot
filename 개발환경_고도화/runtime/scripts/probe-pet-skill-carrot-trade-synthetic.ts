import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { PET_SKILL_CARROT_CODE, PET_SKILL_CARROT_THERMOMETER_CODE, PetSkillCarrotTradeService } from "../src/pet/pet-skill-carrot-trade-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("db required");
if (!/^hoibot_pet_skill_carrot/i.test(config.database.name)) throw new Error("blocked: isolated pet skill carrot database required");
let database = createDatabaseClient(config.database);
let service = new PetSkillCarrotTradeService(database);
const senderId = 989200001n;
const recipientId = 989200002n;
const senderPetId = 989200001n;
const recipientPetId = 989200002n;
const successEvent = "pet-skill-carrot-g7-success";
const rollbackEvent = "pet-skill-carrot-g7-rollback";

async function addEvent(eventId: string): Promise<void> {
  await database.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'pet-skill-carrot-room','pet-skill-carrot-sender','message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3))",
    [eventId, eventId],
  );
}

async function state(skillId: bigint, carrotItemId: bigint, thermometerItemId: bigint) {
  return (await database.query<Array<{ sender_skill: bigint; recipient_skill: bigint; carrot: bigint; thermometer: bigint; sender_counter: bigint; recipient_counter: bigint; trades: bigint; ledgers: bigint; operations: bigint }>>(
    `SELECT
      (SELECT quantity FROM pet_skill_inventory WHERE player_pet_id=? AND skill_id=?) sender_skill,
      (SELECT quantity FROM pet_skill_inventory WHERE player_pet_id=? AND skill_id=?) recipient_skill,
      (SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?) carrot,
      (SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?) thermometer,
      (SELECT value FROM player_counters WHERE player_id=? AND counter_code='carrot' AND period_key='lifetime') sender_counter,
      (SELECT value FROM player_counters WHERE player_id=? AND counter_code='thermo' AND period_key='lifetime') recipient_counter,
      (SELECT COUNT(*) FROM pet_skill_carrot_trades) trades,
      (SELECT COUNT(*) FROM inventory_ledger WHERE operation_id IN (SELECT operation_id FROM pet_skill_carrot_trades)) ledgers,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.skill_carrot_trade') operations`,
    [senderPetId, skillId, recipientPetId, skillId, senderId, carrotItemId, recipientId, thermometerItemId, senderId, recipientId],
  ))[0]!;
}

try {
  await database.execute("INSERT INTO players(id,status) VALUES (?,'active'),(?,'active')", [senderId, recipientId]);
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name,tier_code) VALUES (?,'당근 보내는 왕','king'),(?,'당근 받는 황제','emperor')", [senderId, recipientId]);
  await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (?,'👑',1),(?,'🏛️',2)", [senderId, recipientId]);
  await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (?,?, 'kakao','pet-skill-carrot-sender','당근 보내는 왕','linked')", [senderId, senderId]);
  await database.execute("INSERT INTO player_pets(id,player_id,display_name) VALUES (?,?,'보내는펫'),(?,?,'받는펫')", [senderPetId, senderId, recipientPetId, recipientId]);
  await database.execute("INSERT INTO skill_definitions(code,display_name,rules_json,active) VALUES ('probe-pet-skill-carrot','프로브스킬📙',JSON_OBJECT('grade','S'),TRUE)");
  const skill = (await database.query<Array<{ id: bigint }>>("SELECT id FROM skill_definitions WHERE code='probe-pet-skill-carrot'"))[0]!;
  const items = await database.query<Array<{ id: bigint; code: string }>>("SELECT id,code FROM item_definitions WHERE code IN (?,?)", [PET_SKILL_CARROT_CODE, PET_SKILL_CARROT_THERMOMETER_CODE]);
  const carrot = items.find((row) => row.code === PET_SKILL_CARROT_CODE)!;
  const thermometer = items.find((row) => row.code === PET_SKILL_CARROT_THERMOMETER_CODE)!;
  assert.ok(carrot && thermometer);
  await database.execute("INSERT INTO pet_skill_inventory(player_pet_id,skill_id,quantity) VALUES (?,?,3)", [senderPetId, skill.id]);
  await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity) VALUES (?,?,200)", [senderId, carrot.id]);

  await addEvent(successEvent);
  const result = await service.handle({ eventId: successEvent, externalUserId: "pet-skill-carrot-sender", destinationId: "pet-skill-carrot-room", message: "/펫스킬당근 당근 받는 황제 1 2" });
  assert.equal(result.quantity, "2");
  assert.equal(result.carrotFee, "100");
  assert.equal(result.thermometerReward, "2");
  const mutated = await state(skill.id, carrot.id, thermometer.id);
  assert.deepEqual(mutated, { sender_skill: 1n, recipient_skill: 2n, carrot: 100n, thermometer: 2n, sender_counter: 1n, recipient_counter: 2n, trades: 1n, ledgers: 2n, operations: 1n });
  assert.deepEqual(await service.handle({ eventId: successEvent, externalUserId: "pet-skill-carrot-sender", destinationId: "pet-skill-carrot-room", message: "/펫스킬당근 당근 받는 황제 1 2" }), result);
  assert.deepEqual(await state(skill.id, carrot.id, thermometer.id), mutated);

  await addEvent(rollbackEvent);
  await database.execute("CREATE TRIGGER probe_pet_skill_carrot_audit_fail BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced pet skill carrot rollback'");
  await assert.rejects(service.handle({ eventId: rollbackEvent, externalUserId: "pet-skill-carrot-sender", destinationId: "pet-skill-carrot-room", message: "/펫스킬당근 당근 받는 황제 1 1" }));
  await database.execute("DROP TRIGGER probe_pet_skill_carrot_audit_fail");
  assert.deepEqual(await state(skill.id, carrot.id, thermometer.id), mutated);

  await database.close();
  database = createDatabaseClient(config.database);
  service = new PetSkillCarrotTradeService(database);
  assert.deepEqual(await service.handle({ eventId: successEvent, externalUserId: "pet-skill-carrot-sender", destinationId: "pet-skill-carrot-room", message: "/펫스킬당근 당근 받는 황제 1 2" }), result);
  assert.deepEqual(await state(skill.id, carrot.id, thermometer.id), mutated);
  process.stdout.write(JSON.stringify({ scenarios: ["mutation", "idempotent-replay", "forced-rollback", "restart-replay"], state: mutated }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
} finally {
  await database.execute("DROP TRIGGER IF EXISTS probe_pet_skill_carrot_audit_fail").catch(() => undefined);
  await database.close();
}
