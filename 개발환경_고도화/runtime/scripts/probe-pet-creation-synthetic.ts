import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { PetCreationService } from "../src/pet/pet-creation-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic pet-creation probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const runKey = randomUUID().replaceAll("-", "").slice(0, 12);
const externalUserId = `synthetic-pet-create-${runKey}`;
const displayName = `합성펫${runKey} 남`;
const eventId = `pet-create-${runKey}`;
const channelId = "synthetic-room-001";

// `/펫생성` 검증용 합성 회원과 빈 펫 행, Iris 이벤트를 생성합니다.
async function seedSyntheticPlayer(): Promise<{ playerId: bigint; identityId: bigint; petId: bigint }> {
  return database.withTransaction(async (transaction) => {
    const player = await transaction.execute(
      "INSERT INTO players (status, version, created_at, updated_at) VALUES ('active', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))"
    );
    await transaction.execute(
      `INSERT INTO player_profiles
        (player_id, current_display_name, joined_at, level, accumulated_level_offset, experience,
         rebirth_count, game_server_id, tier_code, terms_agreed, first_sponsor, version, updated_at)
       VALUES (?, ?, UTC_TIMESTAMP(3), 1, 0, 0, 1, 900000001, 'seedling', TRUE, FALSE, 1, UTC_TIMESTAMP(3))`,
      [player.insertId, displayName]
    );
    const pet = await transaction.execute(
      "INSERT INTO player_pets (player_id, display_name, pet_type_code, image_value, experience, enhancement_level, version) VALUES (?, NULL, NULL, NULL, 0, 0, 1)",
      [player.insertId]
    );
    const identity = await transaction.execute(
      `INSERT INTO external_identities
        (player_id, provider_code, external_user_id, display_name, status, created_at, updated_at)
       VALUES (?, 'kakao', ?, ?, 'linked', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [player.insertId, externalUserId, displayName]
    );
    await transaction.execute(
      `INSERT INTO event_inbox
        (event_id, provider_code, provider_event_id, external_channel_id, channel_id,
         external_user_id, external_identity_id, event_kind, event_origin, direction,
         payload_hash, parse_status, processing_status, received_at)
       VALUES (?, 'iris', ?, ?, 900000001, ?, ?, 'message', 'synthetic_probe', 'incoming',
         REPEAT('0', 64), 'parsed', 'processed', UTC_TIMESTAMP(3))`,
      [eventId, eventId, channelId, externalUserId, identity.insertId]
    );
    return { playerId: player.insertId, identityId: identity.insertId, petId: pet.insertId };
  });
}

// 지정한 ApplicationError 코드가 발생하는지 확인합니다.
async function assertApplicationError(work: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(work, (error: unknown) => error instanceof ApplicationError && error.code === code);
}

try {
  const seeded = await seedSyntheticPlayer();
  const invalidService = new PetCreationService(database);
  await assertApplicationError(() => invalidService.handle({
    externalUserId, channelId, message: "/펫생성 봉봉 해봐", eventId
  }), "INVALID_PET_CREATE_COMMAND");

  const randomValues = [0, 0, 0.5, 0];
  const service = new PetCreationService(
    database,
    () => randomValues.shift() ?? 0,
    () => new Date("2026-08-13T01:02:03.000Z")
  );
  const command = { externalUserId, channelId, message: "/펫생성 봉봉", eventId };
  const result = await service.handle(command);
  const replay = await service.handle(command);
  assert.deepEqual(replay, result);
  assert.equal(result.petId, seeded.petId.toString());
  assert.equal(result.petName, "봉봉");
  assert.equal(result.petTypeCode, "legacy-sky");
  assert.equal(result.imageValue, "🦃");
  assert.equal(result.personality, "다정한");
  assert.equal(result.replies.length, 2);

  const state = await database.query<Array<{
    pet_name: string;
    pet_type_code: string;
    image_value: string;
    joined_on: string;
    personality_label: string;
    experience: bigint;
    enhancement_level: bigint;
    elemental_count: bigint;
    skill_inventory_count: bigint;
    mini_pet_count: bigint;
    home_count: bigint;
    operation_count: bigint;
    execution_count: bigint;
    audit_count: bigint;
    outbox_count: bigint;
  }>>(
    `SELECT pet.display_name AS pet_name, pet.pet_type_code, pet.image_value,
       DATE_FORMAT(pet.joined_on, '%Y-%m-%d') AS joined_on,
       pet.personality_label, pet.experience, pet.enhancement_level,
       (SELECT COUNT(*) FROM player_pet_elementals elemental WHERE elemental.player_pet_id = pet.id
         AND elemental.display_name = '피닉스🐦‍🔥' AND elemental.grade_code = 'spirit_king'
         AND elemental.enhancement_level = 80) AS elemental_count,
       (SELECT COUNT(*) FROM pet_skill_inventory inventory
         JOIN skill_definitions skill ON skill.id = inventory.skill_id
         WHERE inventory.player_pet_id = pet.id AND skill.code = 'legacy-ten-won' AND inventory.quantity = 1) AS skill_inventory_count,
       (SELECT COUNT(*) FROM owned_mini_pets mini
         JOIN mini_pet_definitions definition_row ON definition_row.id = mini.mini_pet_definition_id
         WHERE mini.player_id = pet.player_id AND definition_row.code = 'legacy-starter-mini-pet'
           AND mini.battle_experience = 100000 AND mini.castle_experience = 100000
           AND mini.raid_experience = 100000 AND mini.equipped = TRUE) AS mini_pet_count,
       (SELECT COUNT(*) FROM player_homes home WHERE home.player_id = pet.player_id
         AND home.display_name = '산이 보이는 텐트집🏕️' AND home.base_experience = 3510
         AND home.floor_area = 18) AS home_count,
       (SELECT COUNT(*) FROM operations operation_row WHERE operation_row.idempotency_scope = ?) AS operation_count,
       (SELECT COUNT(*) FROM command_executions execution
         JOIN operations operation_row ON operation_row.id = execution.operation_id
         WHERE operation_row.idempotency_scope = ?) AS execution_count,
       (SELECT COUNT(*) FROM command_audit audit
         JOIN operations operation_row ON operation_row.id = audit.operation_id
         WHERE operation_row.idempotency_scope = ?) AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages outbox
         JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = ?) AS outbox_count
     FROM player_pets pet WHERE pet.id = ?`,
    [`pet.create:${seeded.identityId}`, `pet.create:${seeded.identityId}`,
      `pet.create:${seeded.identityId}`, `pet.create:${seeded.identityId}`, seeded.petId]
  );
  assert.equal(state[0]?.pet_name, "봉봉");
  assert.equal(state[0]?.pet_type_code, "legacy-sky");
  assert.equal(state[0]?.image_value, "🦃");
  assert.equal(state[0]?.personality_label, "다정한");
  assert.equal(state[0]?.experience, 35000n);
  assert.equal(state[0]?.enhancement_level, 90n);
  assert.equal(state[0]?.joined_on, "2026-08-13");
  assert.deepEqual({
    elemental: state[0]?.elemental_count, skill: state[0]?.skill_inventory_count,
    miniPet: state[0]?.mini_pet_count, home: state[0]?.home_count,
    operation: state[0]?.operation_count, execution: state[0]?.execution_count,
    audit: state[0]?.audit_count, outbox: state[0]?.outbox_count
  }, { elemental: 1n, skill: 1n, miniPet: 1n, home: 1n, operation: 1n, execution: 1n, audit: 1n, outbox: 2n });

  await assertApplicationError(() => new PetCreationService(database).handle({
    externalUserId, channelId, message: "/펫생성 새이름", eventId: `${eventId}-again`
  }), "PET_ALREADY_EXISTS");

  process.stdout.write(`${JSON.stringify({
    database: config.database.name, playerId: seeded.playerId.toString(), petId: seeded.petId.toString(),
    petName: result.petName, petTypeCode: result.petTypeCode, personality: result.personality,
    relations: { elemental: 1, skillInventory: 1, miniPet: 1, home: 1 },
    effects: { operation: 1, execution: 1, audit: 1, outbox: 2 }, idempotent: true
  })}\n`);
} finally {
  await database.close();
}
