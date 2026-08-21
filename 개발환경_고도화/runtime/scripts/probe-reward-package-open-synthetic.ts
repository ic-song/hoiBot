import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { RewardPackageOpenService } from "../src/package/reward-package-open-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic reward-package probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const eventId = `reward-package-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";
const definitions = [
  ["deputy_reward_package_3", "부방상여패키지3(/고생하셨습니다)", 2n],
  ["pet_sweet_home_interior_shop", "펫스윗홈인테리어샵🖼️(/샵오픈)", 0n],
  ["exploration_probability_up_20", "탐험확률UP🗻(20%)", 0n],
  ["guild_contribution_medal", "길드공헌훈장🌟(/길드공헌 숫자)", 0n],
  ["guild_warehouse_package", "길드창고패키지🧳(/길드창고패키지오픈", 0n],
  ["loudspeaker_notice", "확성기📢(/알림 내용 30자)", 0n]
] as const;

try {
  await database.withTransaction(async (tx) => {
    for (const [code, displayName] of definitions) {
      await tx.execute(
        "INSERT INTO item_definitions (code, display_name, asset_type_code, stackable, metadata_json, active, version) VALUES (?, ?, 'item', TRUE, JSON_OBJECT('synthetic', TRUE), TRUE, 1) ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), stackable = TRUE, active = TRUE, version = version + 1",
        [code, displayName]
      );
    }
    const items = await tx.query<Array<{ id: bigint; code: string }>>(
      `SELECT id, code FROM item_definitions WHERE code IN (${definitions.map(() => "?").join(", ")})`,
      definitions.map(([code]) => code)
    );
    for (const [code, , quantity] of definitions) {
      const item = items.find((value) => value.code === code);
      assert.ok(item, code);
      await tx.execute(
        "INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (900000001, ?, ?, 1) ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), version = version + 1",
        [item.id, quantity]
      );
    }
    await tx.execute(
      `INSERT INTO event_inbox
        (event_id, provider_code, provider_event_id, external_channel_id, channel_id, external_user_id,
         external_identity_id, event_kind, event_origin, direction, payload_hash, parse_status, processing_status, received_at)
       VALUES (?, 'iris', ?, ?, 900000001, ?, 900000004, 'message', 'synthetic_probe', 'incoming',
         REPEAT('0', 64), 'parsed', 'processed', UTC_TIMESTAMP(3))`,
      [eventId, eventId, channelId, externalUserId]
    );
  });

  const service = new RewardPackageOpenService(database);
  const command = { externalUserId, channelId, message: "/고생하셨습니다", eventId };
  const result = await service.handle(command);
  const duplicate = await service.handle(command);
  assert.equal(result.status, "opened");
  assert.equal(duplicate.duplicate, true);
  assert.equal(result.packageAfter, "1");
  assert.deepEqual(result.rewards?.map((value) => value.after), ["20000", "20", "30", "1", "5"]);

  const effects = await database.query<Array<{
    operation_count: bigint; ledger_count: bigint; execution_count: bigint; audit_count: bigint; outbox_count: bigint;
  }>>(
    `SELECT
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'inventory.reward-package-open:900000004' AND idempotency_key = ?) AS operation_count,
      (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id WHERE operation_row.idempotency_scope = 'inventory.reward-package-open:900000004' AND operation_row.idempotency_key = ?) AS ledger_count,
      (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'admin_reward_package_open') AS execution_count,
      (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id WHERE operation_row.idempotency_scope = 'inventory.reward-package-open:900000004' AND operation_row.idempotency_key = ?) AS audit_count,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_scope = 'inventory.reward-package-open:900000004' AND operation_row.idempotency_key = ?) AS outbox_count`,
    [eventId, eventId, eventId, eventId, eventId]
  );
  assert.deepEqual(effects[0], { operation_count: 1n, ledger_count: 6n, execution_count: 1n, audit_count: 1n, outbox_count: 1n });
  process.stdout.write(JSON.stringify({
    database: config.database.name,
    package: { before: result.packageBefore, after: result.packageAfter },
    rewards: result.rewards,
    effects: { operation: 1, inventoryLedger: 6, execution: 1, audit: 1, outbox: 1 },
    idempotent: true,
    operationalSnapshotTouched: false
  }) + "\n");
} finally {
  await database.close();
}
