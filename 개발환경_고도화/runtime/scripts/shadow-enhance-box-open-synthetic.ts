import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic enhance-box Shadow is blocked for database: ${config.database.name}`);
}
const verifyRestart = process.argv.includes("--verify-restart");
const baseEventId = process.env.ENHANCE_BOX_SHADOW_EVENT_ID ?? `enhance-box-shadow-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
if (verifyRestart && process.env.ENHANCE_BOX_SHADOW_EVENT_ID === undefined) throw new Error("ENHANCE_BOX_SHADOW_EVENT_ID is required with --verify-restart.");
const database = createDatabaseClient(config.database);
const replies: string[] = [];
const app = buildApp(config, {
  database,
  inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }),
  sendIrisTextReply: async (reply) => { replies.push(reply.data); }
});

async function dispatch(providerEventId: string, message = "/강화박스오픈 2") {
  return app.inject({
    method: "POST", url: "/api/v1/integrations/iris/events", headers: { authorization: `Bearer ${config.irisSharedToken}` },
    payload: { msg: message, room: "합성 강화박스 Shadow 방", sender: "테스트알파", json: { id: providerEventId, chat_id: "synthetic-room-001", user_id: "synthetic-admin-alpha", type: 1 } }
  });
}

try {
  await database.execute(
    `INSERT INTO item_definitions (id, code, display_name, asset_type_code, stackable, metadata_json, active, version)
     VALUES (927000001, 'enhance_dungeon_box', '강화박스⭐(/강화박스오픈)', 'item', TRUE, JSON_OBJECT('synthetic', TRUE), TRUE, 1),
            (927000002, 'pet_enhance_stone', '펫 강화석⭐', 'item', TRUE, JSON_OBJECT('synthetic', TRUE), TRUE, 1)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = TRUE`
  );
  const normalEvent = `${baseEventId}-normal`;
  if (!verifyRestart) {
    await database.execute("DELETE FROM inventory_stacks WHERE player_id = 900000001 AND item_id IN (927000001, 927000002)");
    await database.execute("INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (900000001, 927000001, 2, 1)");
    const normal = await dispatch(normalEvent); assert.equal(normal.statusCode, 202); assert.match(replies.at(-1) ?? "", /강화박스⭐ 2개/);
    const duplicate = await dispatch(normalEvent); assert.equal(duplicate.json().duplicate, true);
    const suffix = await dispatch(`${baseEventId}-suffix`, "/강화박스오픈 1 해봐"); assert.equal(suffix.statusCode, 202);
    assert.equal(replies.filter((reply) => reply.includes("강화박스⭐")).length, 1);
  } else {
    const replay = await dispatch(normalEvent); assert.equal(replay.json().duplicate, true); assert.equal(replies.length, 0);
  }
  const effects = await database.query<Array<{ operations: bigint; executions: bigint; draws: bigint; ledgers: bigint; audits: bigint; outbox: bigint }>>(
    `SELECT
       (SELECT COUNT(*) FROM operations WHERE idempotency_key = ?) AS operations,
       (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'enhance_box_open') AS executions,
       (SELECT COUNT(*) FROM enhance_box_open_draws draw JOIN operations operation_row ON operation_row.id = draw.operation_id WHERE operation_row.idempotency_key = ?) AS draws,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id WHERE operation_row.idempotency_key = ?) AS ledgers,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id WHERE operation_row.idempotency_key = ?) AS audits,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_key = ?) AS outbox`,
    [`iris:${normalEvent}`, `iris:${normalEvent}`, `iris:${normalEvent}`, `iris:${normalEvent}`, `iris:${normalEvent}`, `iris:${normalEvent}`]
  );
  assert.deepEqual(effects[0], { operations: 1n, executions: 1n, draws: 2n, ledgers: 2n, audits: 1n, outbox: 1n });
  process.stdout.write(`${JSON.stringify(
    { mode: verifyRestart ? "verify-restart" : "shadow", baseEventId, effects: effects[0], operationalSnapshotTouched: false },
    (_key, value) => typeof value === "bigint" ? value.toString() : value
  )}\n`);
} finally {
  await app.close();
}
