import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic paradise-box Shadow is blocked for database: ${config.database.name}`);
}
const verifyRestart = process.argv.includes("--verify-restart");
const baseEventId = process.env.PARADISE_BOX_SHADOW_EVENT_ID ?? `paradise-box-shadow-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
if (verifyRestart && process.env.PARADISE_BOX_SHADOW_EVENT_ID === undefined) throw new Error("PARADISE_BOX_SHADOW_EVENT_ID is required with --verify-restart.");
const database = createDatabaseClient(config.database);
const replies: string[] = [];
const playerId = 900000001n;
let itemId = 0n;
const app = buildApp(config, {
  database,
  inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }),
  sendIrisTextReply: async (reply) => { replies.push(reply.data); }
});

async function dispatch(providerEventId: string, message = "/극락오픈 2") {
  return app.inject({
    method: "POST", url: "/api/v1/integrations/iris/events", headers: { authorization: `Bearer ${config.irisSharedToken}` },
    payload: { msg: message, room: "합성 극락상자 Shadow 방", sender: "테스트알파", json: { id: providerEventId, chat_id: "synthetic-room-001", user_id: "synthetic-admin-alpha", type: 1 } }
  });
}

try {
  await database.execute(
    `INSERT INTO item_definitions (code, display_name, asset_type_code, stackable, metadata_json, active, version)
     VALUES ('paradise_point_box', '극락상자👹', 'item', TRUE, JSON_OBJECT('synthetic', TRUE), TRUE, 1)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = TRUE`
  );
  const definitions = await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code = 'paradise_point_box'");
  if (definitions[0] === undefined) throw new Error("synthetic paradise item definition missing");
  itemId = definitions[0].id;
  const normalEvent = `${baseEventId}-normal`;
  if (!verifyRestart) {
    await database.execute("DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ?", [playerId, itemId]);
    await database.execute("INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, 2, 1)", [playerId, itemId]);
    await database.execute("INSERT INTO currency_accounts (player_id, currency_code, balance, version) VALUES (?, 'point', 0, 1) ON DUPLICATE KEY UPDATE balance = 0, version = version + 1", [playerId]);
    const normal = await dispatch(normalEvent); assert.equal(normal.statusCode, 202); assert.match(replies.at(-1) ?? "", /극락상자👹 2개 오픈/);
    const duplicate = await dispatch(normalEvent); assert.equal(duplicate.json().duplicate, true);
    const suffix = await dispatch(`${baseEventId}-suffix`, "/극락오픈 1 해봐"); assert.equal(suffix.statusCode, 202);
    assert.equal(replies.filter((reply) => reply.includes("극락상자👹")).length, 1);
  } else {
    const replay = await dispatch(normalEvent); assert.equal(replay.json().duplicate, true); assert.equal(replies.length, 0);
  }
  const effects = await database.query<Array<{ operations: bigint; executions: bigint; draws: bigint; inventory_ledgers: bigint; currency_ledgers: bigint; grants: bigint; audits: bigint; outbox: bigint }>>(
    `SELECT
       (SELECT COUNT(*) FROM operations WHERE idempotency_key = ?) AS operations,
       (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'paradise_box_open') AS executions,
       (SELECT COUNT(*) FROM paradise_box_open_draws draw JOIN operations operation_row ON operation_row.id = draw.operation_id WHERE operation_row.idempotency_key = ?) AS draws,
       (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id WHERE operation_row.idempotency_key = ?) AS inventory_ledgers,
       (SELECT COUNT(*) FROM currency_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id WHERE operation_row.idempotency_key = ?) AS currency_ledgers,
       (SELECT COUNT(*) FROM paradise_box_open_grants grant_row JOIN operations operation_row ON operation_row.id = grant_row.operation_id WHERE operation_row.idempotency_key = ?) AS grants,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id WHERE operation_row.idempotency_key = ?) AS audits,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_key = ?) AS outbox`,
    [`iris:${normalEvent}`, `iris:${normalEvent}`, `iris:${normalEvent}`, `iris:${normalEvent}`, `iris:${normalEvent}`, `iris:${normalEvent}`, `iris:${normalEvent}`, `iris:${normalEvent}`]
  );
  assert.deepEqual(effects[0], { operations: 1n, executions: 1n, draws: 2n, inventory_ledgers: 1n, currency_ledgers: 1n, grants: 1n, audits: 1n, outbox: 1n });
  process.stdout.write(`${JSON.stringify({ mode: verifyRestart ? "verify-restart" : "shadow", baseEventId, effects: effects[0], operationalSnapshotTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value)}\n`);
} finally {
  await app.close();
}
