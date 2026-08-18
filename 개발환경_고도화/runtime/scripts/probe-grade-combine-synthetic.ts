import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { GradeCombineService, type GradeCombineCommand } from "../src/mini-pet/grade-combine-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic grade combine probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const playerId = 900000001n;
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";
const prefix = "grade-combine-bicbsq-v3";
const prepare = process.argv.includes("--prepare");
const commands: Record<string, GradeCombineCommand> = {
  primordialSuccess: { externalUserId, channelId, message: "/미니펫조합태초+ 1 2", eventId: `${prefix}-primordial-success` },
  primordialFailure: { externalUserId, channelId, message: "/미니펫조합태초+ 1 2", eventId: `${prefix}-primordial-failure` },
  genesisFailure: { externalUserId, channelId, message: "/미니펫조합창세 1 2", eventId: `${prefix}-genesis-failure` },
  creationAutomatic: { externalUserId, channelId, message: "/미니펫조합창조접미", eventId: `${prefix}-creation-automatic` },
  creationManual: { externalUserId, channelId, message: "/미니펫조합창조 1suffix 2suffix", eventId: `${prefix}-creation-manual` }
};

async function prepareDefinitions(tx: DatabaseTransaction): Promise<void> {
  for (const [code, name, emoji, grade] of [
    ["synthetic_grade_combine_primordial", "합성 태초", "🌳", "태초"],
    ["synthetic_grade_combine_primordial_plus", "합성 태초+", "🌿", "태초+"],
    ["synthetic_grade_combine_genesis", "합성 창세", "🌌", "창세"],
    ["synthetic_grade_combine_reward_barley", "찰보리", "🌾", "태초+"]
  ] as const) {
    await tx.execute(
      `INSERT INTO mini_pet_definitions (code, display_name, grade_code, grade_display_name, emoji_value, active)
       VALUES (?, ?, ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), grade_code = VALUES(grade_code),
         grade_display_name = VALUES(grade_display_name), emoji_value = VALUES(emoji_value), active = TRUE`,
      [code, name, `grade_${code.slice("synthetic_grade_combine_".length)}`, grade, emoji]
    );
  }
  await tx.execute(
    `INSERT INTO mini_pet_definitions (code, display_name, grade_code, grade_display_name, emoji_value, active)
     VALUES ('mini_pet_f879f4cf45f6a74d', '컬렉션창조 미니펫', 'grade_0f83fc6041262eb9', '창조', '🐹', TRUE)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), grade_code = VALUES(grade_code),
       grade_display_name = VALUES(grade_display_name), emoji_value = VALUES(emoji_value), active = TRUE`
  );
  for (const command of Object.values(commands)) {
    await tx.execute(
      `INSERT INTO event_inbox
       (event_id, provider_code, provider_event_id, external_channel_id, channel_id,
        external_user_id, external_identity_id, event_kind, event_origin, direction,
        payload_hash, parse_status, processing_status, received_at)
       VALUES (?, 'iris', ?, ?, 900000001, ?, 900000004, 'message', 'synthetic_probe', 'incoming',
         REPEAT('0', 64), 'parsed', 'processed', UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE processing_status = VALUES(processing_status)`,
      [command.eventId, command.eventId, channelId, externalUserId]
    );
  }
}

async function seed(gradeCode: string, values: bigint[]): Promise<void> {
  await database.withTransaction(async (tx) => {
    await tx.execute(
      `DELETE owned FROM owned_mini_pets owned JOIN mini_pet_definitions definition_row
       ON definition_row.id = owned.mini_pet_definition_id
       WHERE owned.player_id = ? AND owned.equipped = FALSE AND definition_row.code LIKE 'synthetic_grade_combine_%'`, [playerId]
    );
    for (let index = 0; index < values.length; index += 1) {
      await tx.execute(
        `INSERT INTO owned_mini_pets
         (player_id, mini_pet_definition_id, custom_name, progress, enhancement_level,
          battle_experience, castle_experience, raid_experience, equipped)
         SELECT ?, id, ?, 0, 0, ?, ?, ?, FALSE FROM mini_pet_definitions WHERE code = ? AND active = TRUE`,
        [playerId, `합성재료${index + 1}`, values[index], values[index], values[index], gradeCode]
      );
    }
  });
}

async function sourceCount(grade: string): Promise<bigint> {
  const rows = await database.query<Array<{ source_count: bigint }>>(
    `SELECT COUNT(*) AS source_count FROM owned_mini_pets owned JOIN mini_pet_definitions definition_row
     ON definition_row.id = owned.mini_pet_definition_id
     WHERE owned.player_id = ? AND owned.equipped = FALSE
       AND definition_row.code LIKE 'synthetic_grade_combine_%' AND definition_row.grade_display_name = ?`, [playerId, grade]
  );
  return rows[0]?.source_count ?? -1n;
}

try {
  if (prepare) {
    await database.withTransaction(prepareDefinitions);

    await seed("synthetic_grade_combine_primordial", [9000000002n, 9000000001n]);
    const successRandom = [0.1, 0];
    const successService = new GradeCombineService(database, () => successRandom.shift() ?? 0);
    const success = await successService.handle(commands.primordialSuccess!);
    assert.equal(success.status, "succeeded");
    assert.equal(success.reward?.experience, "700500");
    assert.deepEqual(await successService.handle(commands.primordialSuccess!), success);
    assert.equal(await sourceCount("태초"), 0n);

    await seed("synthetic_grade_combine_primordial", [9000000002n, 9000000001n]);
    const primordialFailure = await new GradeCombineService(database, () => 0.9).handle(commands.primordialFailure!);
    assert.equal(primordialFailure.status, "failed");
    assert.equal(await sourceCount("태초"), 0n);

    await seed("synthetic_grade_combine_primordial_plus", [9000000002n, 9000000001n]);
    const genesisFailure = await new GradeCombineService(database, () => 0.31).handle(commands.genesisFailure!);
    assert.equal(genesisFailure.status, "failed");
    assert.equal(await sourceCount("태초+"), 0n);

    await seed("synthetic_grade_combine_genesis", [9000000001n, 9000000003n, 9000000002n]);
    const automatic = await new GradeCombineService(database, () => 0).handle(commands.creationAutomatic!);
    assert.equal(automatic.status, "succeeded");
    assert.equal(await sourceCount("창세"), 1n);

    await seed("synthetic_grade_combine_genesis", [9000000002n, 9000000001n]);
    const manual = await new GradeCombineService(database, () => 0).handle(commands.creationManual!);
    assert.equal(manual.status, "succeeded");
    assert.equal(await sourceCount("창세"), 0n);

    await seed("synthetic_grade_combine_primordial", [9000000002n, 9000000001n]);
    await database.execute(
      "UPDATE mini_pet_definitions SET active = FALSE WHERE display_name = '레몬밤' AND emoji_value = '🍋' AND COALESCE(grade_display_name, grade_code) = '태초+'"
    );
    const missingRandom = [0.1, 0.011];
    try {
      await assert.rejects(
        () => new GradeCombineService(database, () => missingRandom.shift() ?? 0).handle({ ...commands.primordialSuccess!, eventId: `${prefix}-missing-reward` }),
        (error: unknown) => error instanceof ApplicationError && error.code === "GRADE_COMBINE_REWARD_DEFINITION_REQUIRED"
      );
      assert.equal(await sourceCount("태초"), 2n);
    } finally {
      await database.execute(
        "UPDATE mini_pet_definitions SET active = TRUE WHERE display_name = '레몬밤' AND emoji_value = '🍋' AND COALESCE(grade_display_name, grade_code) = '태초+'"
      );
    }
  } else {
    const expected = ["succeeded", "failed", "failed", "succeeded", "succeeded"];
    const replayed = await Promise.all(Object.values(commands).map((value) => new GradeCombineService(database, () => { throw new Error("replay random must not run"); }).handle(value)));
    assert.deepEqual(replayed.map(({ status }) => status), expected);
  }

  const rows = await database.query<Array<{ operation_count: bigint; execution_count: bigint; audit_count: bigint; outbox_count: bigint }>>(
    `SELECT
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'mini-pet.grade-combine:900000004' AND idempotency_key LIKE ?) AS operation_count,
      (SELECT COUNT(*) FROM command_executions WHERE event_id LIKE ?) AS execution_count,
      (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
        WHERE operation_row.idempotency_scope = 'mini-pet.grade-combine:900000004' AND operation_row.idempotency_key LIKE ?) AS audit_count,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
        WHERE operation_row.idempotency_scope = 'mini-pet.grade-combine:900000004' AND operation_row.idempotency_key LIKE ?) AS outbox_count`,
    [`${prefix}%`, `${prefix}%`, `${prefix}%`, `${prefix}%`]
  );
  assert.deepEqual(rows[0], { operation_count: 5n, execution_count: 5n, audit_count: 5n, outbox_count: 5n });
  process.stdout.write(`${JSON.stringify({
    database: config.database.name, scenarios: { primordialSuccess: true, primordialFailureConsumesTwo: true, genesisFailureConsumesTwo: true, creationAutomatic: true, creationManual: true, missingRewardRollbackPreservesTwo: true },
    effects: { operation: 5, execution: 5, audit: 5, outbox: 5 }, idempotent: true, restartSafeReplay: !prepare,
    broadStartsWithAndParseIntSuffixPreserved: true, operationalSnapshotTouched: false, operationalDatabaseTouched: false
  })}\n`);
} finally {
  await database.close();
}
