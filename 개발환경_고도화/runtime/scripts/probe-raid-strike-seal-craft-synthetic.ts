import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { RaidStrikeSealCraftService } from "../src/raid/raid-strike-seal-craft-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic raid-strike-seal craft probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const eventId = process.env.RAID_STRIKE_SEAL_CRAFT_PROBE_EVENT_ID
  ?? `raid-strike-seal-craft-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const replayOnly = process.env.RAID_STRIKE_SEAL_CRAFT_PROBE_REPLAY_ONLY === "true";
const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";

try {
  if (!replayOnly) await database.withTransaction(async (transaction) => {
    await transaction.execute(
      "UPDATE currency_accounts SET balance = 3000000000, version = version + 1 WHERE player_id = 900000001 AND currency_code = 'point'"
    );
    await transaction.execute(
      `UPDATE inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
       SET stack.quantity = CASE item.code WHEN 'legacy-junk-item' THEN 2000 WHEN 'legacy-raid-strike-seal-600' THEN 0 END,
           stack.version = stack.version + 1
       WHERE stack.player_id = 900000001 AND item.code IN ('legacy-junk-item', 'legacy-raid-strike-seal-600')`
    );
    await transaction.execute(
      `INSERT INTO event_inbox
        (event_id, provider_code, provider_event_id, external_channel_id, channel_id,
         external_user_id, external_identity_id, event_kind, event_origin, direction,
         payload_hash, parse_status, processing_status, received_at)
       VALUES (?, 'iris', ?, ?, 900000001, ?, 900000004, 'message', 'synthetic_probe', 'incoming',
         REPEAT('0', 64), 'parsed', 'processed', UTC_TIMESTAMP(3))`,
      [eventId, eventId, channelId, externalUserId]
    );
  });

  const service = new RaidStrikeSealCraftService(database);
  const command = { externalUserId, channelId, message: "/레이드인장조합 2", eventId };
  const result = await service.handle(command);
  assert.deepEqual(await service.handle(command), result);
  assert.deepEqual(
    { status: result.status, count: result.craftQuantity, junk: result.junkQuantity, point: result.pointBalance, seal: result.sealQuantity },
    { status: "crafted", count: "2", junk: "0", point: "1000000000", seal: "2" }
  );
  assert.equal(result.data, "[테스트알파] 님\n레이드타격대인장👑(+600👾) 2개 조합 완료!\n(레이드매력+/펫공격에 적용됩니다.)");

  const rows = await database.query<Array<{
    point_balance: string; junk_quantity: bigint; seal_quantity: bigint; inventory_ledger_count: bigint;
    currency_ledger_count: bigint; operation_count: bigint; execution_count: bigint; audit_count: bigint; outbox_count: bigint;
  }>>(
    `SELECT CAST(account.balance AS CHAR) AS point_balance,
       MAX(CASE WHEN item.code = 'legacy-junk-item' THEN stack.quantity END) AS junk_quantity,
       MAX(CASE WHEN item.code = 'legacy-raid-strike-seal-600' THEN stack.quantity END) AS seal_quantity,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
         WHERE operation_row.idempotency_scope = 'raid.strike-seal.craft:900000004' AND operation_row.idempotency_key = ?) AS inventory_ledger_count,
       (SELECT COUNT(*) FROM currency_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
         WHERE operation_row.idempotency_scope = 'raid.strike-seal.craft:900000004' AND operation_row.idempotency_key = ?) AS currency_ledger_count,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'raid.strike-seal.craft:900000004' AND idempotency_key = ?) AS operation_count,
       (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'raid_strike_seal_craft') AS execution_count,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
         WHERE operation_row.idempotency_scope = 'raid.strike-seal.craft:900000004' AND operation_row.idempotency_key = ?) AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = 'raid.strike-seal.craft:900000004' AND operation_row.idempotency_key = ?) AS outbox_count
     FROM currency_accounts account
     JOIN inventory_stacks stack ON stack.player_id = account.player_id
     JOIN item_definitions item ON item.id = stack.item_id
     WHERE account.player_id = 900000001 AND account.currency_code = 'point'
       AND item.code IN ('legacy-junk-item', 'legacy-raid-strike-seal-600')
     GROUP BY account.balance`,
    [eventId, eventId, eventId, eventId, eventId, eventId]
  );
  assert.deepEqual(rows[0], {
    point_balance: "1000000000.000", junk_quantity: 0n, seal_quantity: 2n,
    inventory_ledger_count: 2n, currency_ledger_count: 1n, operation_count: 1n,
    execution_count: 1n, audit_count: 1n, outbox_count: 1n
  });

  process.stdout.write(`${JSON.stringify({
    database: config.database.name, playerId: result.playerId,
    balances: { junk: result.junkQuantity, point: result.pointBalance, seal: result.sealQuantity },
    effects: { inventoryLedger: 2, currencyLedger: 1, operation: 1, execution: 1, audit: 1, outbox: 1 },
    idempotent: true, restartReplay: replayOnly, operationalSnapshotTouched: false
  })}\n`);
} finally {
  await database.close();
}
