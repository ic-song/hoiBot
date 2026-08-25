import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { EnhanceRateDrawService } from "../src/inventory/enhance-rate-draw-service.js";
import { MariaEnhanceRateDrawRepository } from "../src/inventory/maria-enhance-rate-draw-repository.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) throw new Error(`Synthetic enhance-rate Shadow is blocked for database: ${config.database.name}`);
const verifyRestart = process.argv.includes("--verify-restart");
const baseEventId = process.env.ENHANCE_RATE_SHADOW_EVENT_ID ?? `enhance-rate-shadow-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
if (verifyRestart && process.env.ENHANCE_RATE_SHADOW_EVENT_ID === undefined) throw new Error("ENHANCE_RATE_SHADOW_EVENT_ID is required with --verify-restart.");
const database = createDatabaseClient(config.database);
const replies: string[] = [];
let randomIndex = 0;
const app = buildApp(config, {
  database,
  enhanceRateDraw: new EnhanceRateDrawService(new MariaEnhanceRateDrawRepository(database), { next: () => [0.799999, 0.8, 0.9][randomIndex++] ?? 0 }),
  inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }),
  sendIrisTextReply: async (reply) => { replies.push(reply.data); }
});

async function dispatch(providerEventId: string, message = "/강화뽑기 3") {
  return app.inject({ method: "POST", url: "/api/v1/integrations/iris/events", headers: { authorization: `Bearer ${config.irisSharedToken}` },
    payload: { msg: message, room: "합성 강화뽑기 Shadow 방", sender: "테스트알파", json: { id: providerEventId, chat_id: "synthetic-room-001", user_id: "synthetic-admin-alpha", type: 1 } } });
}

try {
  const itemCodes = ["enhance_rate_draw_ticket", "spirit_enhance_rate_up_30", "pet_enhance_rate_up_20", "mini_pet_enhance_rate_up_30"];
  const normalEvent = `${baseEventId}-normal`;
  if (!verifyRestart) {
    await database.execute(`DELETE stack FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id WHERE stack.player_id = 900000001 AND item.code IN (?, ?, ?, ?)`, itemCodes);
    await database.execute(`INSERT INTO inventory_stacks (player_id, item_id, quantity, version) SELECT 900000001, id, 3, 1 FROM item_definitions WHERE code = 'enhance_rate_draw_ticket'`);
    const normal = await dispatch(normalEvent); assert.equal(normal.statusCode, 202); assert.match(replies.at(-1) ?? "", /강화뽑기 3회/);
    const duplicate = await dispatch(normalEvent); assert.equal(duplicate.json().duplicate, true); assert.equal(randomIndex, 3);
    const suffix = await dispatch(`${baseEventId}-suffix`, "/강화뽑기 1 해봐"); assert.equal(suffix.statusCode, 202); assert.equal(replies.length, 1);
  } else {
    const replay = await dispatch(normalEvent); assert.equal(replay.json().duplicate, true); assert.equal(replies.length, 0); assert.equal(randomIndex, 0);
  }
  const key = `iris:${normalEvent}`;
  const effects = await database.query<Array<{ operations: bigint; executions: bigint; draws: bigint; ledgers: bigint; audits: bigint; outbox: bigint; delayed_count: bigint; deliveries: bigint }>>(
    `SELECT
       (SELECT COUNT(*) FROM operations WHERE idempotency_key = ?) AS operations,
       (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'enhance_rate_draw') AS executions,
       (SELECT COUNT(*) FROM enhance_rate_draws draw JOIN operations operation_row ON operation_row.id = draw.operation_id WHERE operation_row.idempotency_key = ?) AS draws,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id WHERE operation_row.idempotency_key = ?) AS ledgers,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id WHERE operation_row.idempotency_key = ?) AS audits,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_key = ?) AS outbox,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_key = ? AND outbox.available_at > outbox.created_at) AS delayed_count,
       (SELECT COUNT(*) FROM delivery_attempts delivery JOIN outbox_messages outbox ON outbox.id = delivery.outbox_message_id JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_key = ?) AS deliveries`,
    [key, key, key, key, key, key, key, key]
  );
  assert.deepEqual(effects[0], { operations: 1n, executions: 1n, draws: 3n, ledgers: 4n, audits: 1n, outbox: 2n, delayed_count: 1n, deliveries: 1n });
  process.stdout.write(`${JSON.stringify({ mode: verifyRestart ? "verify-restart" : "shadow", baseEventId, effects: effects[0], operationalSnapshotTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value)}\n`);
} finally {
  await app.close();
}
