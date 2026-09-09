import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { PetSkillMarketListingService } from "../src/market/pet-skill-market-listing-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_pet_skill_market_listing(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic pet skill market listing probe blocked: ${config.database.name}`);

let database = createDatabaseClient(config.database);
let service = new PetSkillMarketListingService(database);
const playerId = 989_300_001n;
const petId = 989_300_001n;
const externalUserId = "pet-skill-market-listing-user";
const room = "synthetic-pet-skill-market-listing-room";
const base = process.env.PET_SKILL_MARKET_LISTING_PROBE_EVENT_ID ?? "pet-skill-market-listing-g7-20260827-r1";

async function addEvent(eventId: string): Promise<void> {
  await database.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('6',64),'processed',UTC_TIMESTAMP(3))",
    [eventId, eventId, room, externalUserId],
  );
}

async function snapshot(skillId: bigint, carrotItemId: bigint) {
  return (await database.query<Array<{ skill_quantity: bigint; skill_version: bigint; carrots: bigint; carrot_version: bigint; listings: bigint; confirmations: bigint; ledgers: bigint; inventory_ledgers: bigint; market_events: bigint }>>(
    `SELECT
      (SELECT quantity FROM pet_skill_inventory WHERE player_pet_id=? AND skill_id=?) skill_quantity,
      (SELECT version FROM pet_skill_inventory WHERE player_pet_id=? AND skill_id=?) skill_version,
      (SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=?) carrots,
      (SELECT version FROM inventory_stacks WHERE player_id=? AND item_id=?) carrot_version,
      (SELECT COUNT(*) FROM market_listings WHERE seller_player_id=? AND asset_type_code='pet_skill') listings,
      (SELECT COUNT(*) FROM market_skill_registration_confirmations WHERE player_id=?) confirmations,
      (SELECT COUNT(*) FROM market_skill_registration_ledger WHERE player_id=?) ledgers,
      (SELECT COUNT(*) FROM inventory_ledger WHERE operation_id IN (SELECT operation_id FROM market_skill_registration_ledger WHERE player_id=?)) inventory_ledgers,
      (SELECT COUNT(*) FROM market_events WHERE listing_id IN (SELECT listing_id FROM market_skill_registration_ledger WHERE player_id=?)) market_events`,
    [petId, skillId, petId, skillId, playerId, carrotItemId, playerId, carrotItemId, playerId, playerId, playerId, playerId, playerId],
  ))[0]!;
}

try {
  await database.execute("INSERT INTO players(id,status) VALUES (?,'active')", [playerId]);
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name,tier_code) VALUES (?,'스킬 시장 왕','king')", [playerId]);
  await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (?,'👑',1)", [playerId]);
  await database.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES (?,'kakao',?,?,'linked')", [playerId, externalUserId, playerId]);
  await database.execute("INSERT INTO player_pets(id,player_id,display_name) VALUES (?,?,'시장 펫')", [petId, playerId]);
  await database.execute("INSERT INTO skill_definitions(code,display_name,rules_json,active) VALUES ('probe-pet-skill-market-listing','합성시장스킬',JSON_OBJECT('grade','S'),TRUE)");
  const skill = (await database.query<Array<{ id: bigint }>>("SELECT id FROM skill_definitions WHERE code='probe-pet-skill-market-listing'"))[0]!;
  const carrot = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='ITEM-RWD-044'"))[0]!;
  await database.execute("INSERT INTO pet_skill_inventory(player_pet_id,skill_id,quantity,version) VALUES (?,?,5,1)", [petId, skill.id]);
  await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,300,1)", [playerId, carrot.id]);
  assert.equal((await database.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='PET_SKILL_MARKET_LISTING'"))[0]!.rollout_state, "SHADOW");

  const command = "/스킬거래등록 1 2 5000000";
  const confirmEvent = `${base}-confirm`;
  await addEvent(confirmEvent);
  const pending = await service.handle({ eventId: confirmEvent, externalUserId, destinationId: room, message: command });
  assert.equal(pending.status, "pending");
  assert.deepEqual(await snapshot(skill.id, carrot.id), { skill_quantity: 5n, skill_version: 1n, carrots: 300n, carrot_version: 1n, listings: 0n, confirmations: 1n, ledgers: 0n, inventory_ledgers: 0n, market_events: 0n });
  assert.deepEqual(await service.handle({ eventId: confirmEvent, externalUserId, destinationId: room, message: command }), pending);

  const revalidateEvent = `${base}-revalidate`;
  await database.execute("UPDATE pet_skill_inventory SET version=version+1 WHERE player_pet_id=? AND skill_id=?", [petId, skill.id]);
  await addEvent(revalidateEvent);
  const revalidated = await service.handle({ eventId: revalidateEvent, externalUserId, destinationId: room, message: command });
  assert.equal(revalidated.status, "pending");
  assert.equal((await database.query<Array<{ source_version: bigint }>>("SELECT source_version FROM market_skill_registration_confirmations WHERE player_id=?", [playerId]))[0]!.source_version, 2n);

  const registerEvent = `${base}-register`;
  await addEvent(registerEvent);
  const registered = await service.handle({ eventId: registerEvent, externalUserId, destinationId: room, message: command });
  assert.equal(registered.status, "registered");
  const mutated = await snapshot(skill.id, carrot.id);
  assert.deepEqual(mutated, { skill_quantity: 3n, skill_version: 3n, carrots: 200n, carrot_version: 2n, listings: 1n, confirmations: 0n, ledgers: 1n, inventory_ledgers: 1n, market_events: 1n });
  assert.deepEqual(await service.handle({ eventId: registerEvent, externalUserId, destinationId: room, message: command }), registered);
  assert.deepEqual(await snapshot(skill.id, carrot.id), mutated);

  await database.execute("UPDATE pet_skill_inventory SET quantity=5,version=version+1 WHERE player_pet_id=? AND skill_id=?", [petId, skill.id]);
  await database.execute("UPDATE inventory_stacks SET quantity=300,version=version+1 WHERE player_id=? AND item_id=?", [playerId, carrot.id]);
  const rollbackConfirmEvent = `${base}-rollback-confirm`;
  await addEvent(rollbackConfirmEvent);
  await service.handle({ eventId: rollbackConfirmEvent, externalUserId, destinationId: room, message: "/스킬거래등록 1 1 7000000" });
  const beforeRollback = await snapshot(skill.id, carrot.id);
  await database.execute("CREATE TRIGGER probe_pet_skill_market_listing_audit_fail BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced pet skill market listing rollback'");
  const rollbackEvent = `${base}-rollback`;
  await addEvent(rollbackEvent);
  await assert.rejects(service.handle({ eventId: rollbackEvent, externalUserId, destinationId: room, message: "/스킬거래등록 1 1 7000000" }), /forced pet skill market listing rollback/);
  await database.execute("DROP TRIGGER probe_pet_skill_market_listing_audit_fail");
  assert.deepEqual(await snapshot(skill.id, carrot.id), beforeRollback);
  assert.equal(await database.verifyRollback(), true);

  await database.close();
  database = createDatabaseClient(config.database);
  service = new PetSkillMarketListingService(database);
  assert.deepEqual(await service.handle({ eventId: registerEvent, externalUserId, destinationId: room, message: command }), registered);
  assert.deepEqual(await snapshot(skill.id, carrot.id), beforeRollback);
  process.stdout.write(JSON.stringify({ mode: "probe", scenarios: ["shadow-registry", "stable-index", "confirmation", "source-version-revalidation", "atomic-mutation", "idempotent-replay", "forced-audit-rollback", "restart-replay"], operationalDataTouched: false }) + "\n");
} finally {
  await database.execute("DROP TRIGGER IF EXISTS probe_pet_skill_market_listing_audit_fail").catch(() => undefined);
  await database.close();
}
