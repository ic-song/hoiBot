import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { OPEN_ALL_ITEMS } from "../src/inventory/open-all-policy.js";
import { MariaOpenAllRepository } from "../src/inventory/maria-open-all-repository.js";
import { OpenAllService } from "../src/inventory/open-all-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic open-all Shadow is blocked for database: ${config.database.name}`);
}

const verifyRestart = process.argv.includes("--verify-restart");
const baseEventId = process.env.OPEN_ALL_SHADOW_EVENT_ID
  ?? `open-all-shadow-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
if (verifyRestart && process.env.OPEN_ALL_SHADOW_EVENT_ID === undefined) {
  throw new Error("OPEN_ALL_SHADOW_EVENT_ID is required with --verify-restart.");
}

const externalUserId = "synthetic-admin-alpha";
const channelId = "synthetic-room-001";
const playerId = 900000001n;
const guildId = 900000001n;
const guildMemberId = 900000002n;
const database = createDatabaseClient(config.database);
const replies: Array<{ room: string; data: string }> = [];
const app = buildApp(config, {
  database,
  inspectIrisChannel: async () => ({
    mode: "operational", channelClass: "open_group", reason: "allowed",
    evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false }
  }),
  sendIrisTextReply: async (reply) => { replies.push(reply); }
});

async function seedCatalog(): Promise<void> {
  for (const [index, definition] of OPEN_ALL_ITEMS.entries()) {
    await database.execute(
      `INSERT INTO item_definitions (id, code, display_name, asset_type_code, stackable, metadata_json, active, version)
       VALUES (?, ?, ?, 'item', TRUE, JSON_OBJECT('synthetic', TRUE, 'slice', 'SL-INVENTORY-OPEN-ALL'), TRUE, 1)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = TRUE`,
      [920000000 + index, definition.code, definition.name]
    );
  }
}

async function resetStacks(entries: Record<string, bigint>): Promise<void> {
  await database.execute(
    `DELETE stack FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
     WHERE stack.player_id = ? AND JSON_VALUE(item.metadata_json, '$.slice') = 'SL-INVENTORY-OPEN-ALL'`,
    [playerId]
  );
  for (const [code, quantity] of Object.entries(entries)) {
    await database.execute(
      `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
       SELECT ?, id, ?, 1 FROM item_definitions WHERE code = ?`,
      [playerId, quantity, code]
    );
  }
}

async function resetGuildState(): Promise<void> {
  await database.execute("UPDATE guilds SET level = 10, max_members = 5, version = 1 WHERE id = ?", [guildId]);
  await database.execute(
    `INSERT INTO player_counters (player_id, counter_code, period_key, value) VALUES
       (?, 'guild_contribution', 'lifetime', 0), (?, 'guild_contribution_use_count', 'lifetime', 0)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = UTC_TIMESTAMP(3)`,
    [playerId, playerId]
  );
  await database.execute(
    `INSERT INTO guild_resource_accounts (guild_id, currency_code, balance, version) VALUES
       (?, 'guild_experience', 39999, 1), (?, 'point', 5000, 1)
     ON DUPLICATE KEY UPDATE balance = VALUES(balance), version = VALUES(version)`,
    [guildId, guildId]
  );
  await database.execute(
    `INSERT INTO guild_warehouse_stacks (guild_id, item_id, quantity, version)
     SELECT ?, id, 0, 1 FROM item_definitions
     WHERE code IN ('pet_skill_book', 'guild_warehouse_pendant', 'guild_warehouse_pet_enhance', 'guild_warehouse_mini_pet_enhance')
     ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), version = VALUES(version)`,
    [guildId]
  );
  await database.execute(
    `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
     SELECT ?, id, 7, 1 FROM item_definitions WHERE code = 'pet_food'
     ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), version = VALUES(version)`,
    [guildMemberId]
  );
}

async function dispatch(providerEventId: string) {
  return app.inject({
    method: "POST", url: "/api/v1/integrations/iris/events",
    headers: { authorization: `Bearer ${config.irisSharedToken}` },
    payload: {
      msg: "/전체오픈", room: "합성 전체오픈 Shadow 방", sender: "테스트알파",
      json: { id: providerEventId, chat_id: channelId, user_id: externalUserId, type: 1 }
    }
  });
}

function failingOnSql(inner: DatabaseClient, fragment: string): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => {
      const wrapped: DatabaseTransaction = {
        query: (sql, params) => transaction.query(sql, params),
        execute: async (sql, params) => {
          if (sql.includes(fragment)) throw new Error("synthetic mid-write failure");
          return transaction.execute(sql, params);
        }
      };
      return work(wrapped);
    })
  };
}

async function readGuildState() {
  const rows = await database.query<Array<Record<string, bigint | number | string>>>(
    `SELECT guild.level, guild.max_members,
       (SELECT value FROM player_counters WHERE player_id = ? AND counter_code = 'guild_contribution' AND period_key = 'lifetime') AS contribution,
       (SELECT value FROM player_counters WHERE player_id = ? AND counter_code = 'guild_contribution_use_count' AND period_key = 'lifetime') AS contribution_uses,
       (SELECT balance FROM guild_resource_accounts WHERE guild_id = ? AND currency_code = 'guild_experience') AS experience,
       (SELECT balance FROM guild_resource_accounts WHERE guild_id = ? AND currency_code = 'point') AS guild_point,
       (SELECT quantity FROM guild_warehouse_stacks stack JOIN item_definitions item ON item.id = stack.item_id
         WHERE stack.guild_id = ? AND item.code = 'pet_skill_book') AS pet_skill_book,
       (SELECT quantity FROM guild_warehouse_stacks stack JOIN item_definitions item ON item.id = stack.item_id
         WHERE stack.guild_id = ? AND item.code = 'guild_warehouse_pendant') AS pendant,
       (SELECT quantity FROM guild_warehouse_stacks stack JOIN item_definitions item ON item.id = stack.item_id
         WHERE stack.guild_id = ? AND item.code = 'guild_warehouse_pet_enhance') AS pet,
       (SELECT quantity FROM guild_warehouse_stacks stack JOIN item_definitions item ON item.id = stack.item_id
         WHERE stack.guild_id = ? AND item.code = 'guild_warehouse_mini_pet_enhance') AS mini_pet,
       (SELECT quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
         WHERE stack.player_id = ? AND item.code = 'pet_food') AS member_food
     FROM guilds guild WHERE guild.id = ?`,
    [playerId, playerId, guildId, guildId, guildId, guildId, guildId, guildId, guildMemberId, guildId]
  );
  return Object.fromEntries(Object.entries(rows[0] ?? {}).map(([key, value]) => [key, value.toString()]));
}

try {
  await seedCatalog();
  const normalEvent = `${baseEventId}-normal`;
  if (!verifyRestart) {
    await resetGuildState();
    await resetStacks({ guild_contribution_medal: 1n, guild_warehouse_package: 1n });
    const guildBefore = await readGuildState();
    await assert.rejects(
      () => new OpenAllService(new MariaOpenAllRepository(failingOnSql(database, "INSERT INTO guild_warehouse_ledger")), { next: () => 0 }).handle({
        externalUserId, channelId, message: "/전체오픈", eventId: `iris:${baseEventId}-guild-failure`
      }),
      /synthetic mid-write failure/
    );
    assert.deepEqual(await readGuildState(), guildBefore);
    const guildRolledBack = await database.query<Array<{ count: bigint }>>(
      "SELECT COUNT(*) AS count FROM operations WHERE idempotency_key = ?", [`iris:${baseEventId}-guild-failure`]
    );
    assert.equal(guildRolledBack[0]?.count, 0n);

    await resetGuildState();
    await resetStacks({ trash_box: 2n, mini_point_box: 1n, guild_contribution_medal: 1n, guild_warehouse_package: 2n });
    const normal = await dispatch(normalEvent);
    assert.equal(normal.statusCode, 202);
    assert.equal(normal.json().duplicate, false);
    const normalReply = replies.at(-1)?.data ?? "";
    assert.match(normalReply, /전체 오픈/);
    assert.ok(normalReply.indexOf("길드공헌훈장🌟 1개 사용") < normalReply.indexOf("길드창고패키지🧳 2개 오픈"));
    assert.ok(normalReply.indexOf("길드창고패키지🧳 2개 오픈") < normalReply.indexOf("미니상자🎁 1개 오픈"));

    const duplicate = await dispatch(normalEvent);
    assert.equal(duplicate.statusCode, 202);
    assert.equal(duplicate.json().duplicate, true);

    await resetStacks({});
    const empty = await dispatch(`${baseEventId}-empty`);
    assert.equal(empty.statusCode, 202);
    assert.match(replies.at(-1)?.data ?? "", /오픈할 상자가 없습니다/);

    await resetStacks({ pet_food_box: 1n });
    const partial = await dispatch(`${baseEventId}-partial`);
    assert.equal(partial.statusCode, 202);
    assert.match(replies.at(-1)?.data ?? "", /펫먹이상자/);

    await resetStacks({ trash_box: 1n, spirit_box: 1n });
    const before = await database.query<Array<{ code: string; quantity: bigint }>>(
      `SELECT item.code, stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
       WHERE stack.player_id = ? AND item.code IN ('trash_box', 'spirit_box') ORDER BY item.code`, [playerId]
    );
    await assert.rejects(
      () => new OpenAllService(new MariaOpenAllRepository(failingOnSql(database, "INSERT INTO inventory_ledger")), { next: () => 0 }).handle({
        externalUserId, channelId, message: "/전체오픈", eventId: `iris:${baseEventId}-failure`
      }),
      /synthetic mid-write failure/
    );
    const after = await database.query<Array<{ code: string; quantity: bigint }>>(
      `SELECT item.code, stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
       WHERE stack.player_id = ? AND item.code IN ('trash_box', 'spirit_box') ORDER BY item.code`, [playerId]
    );
    assert.deepEqual(after, before);
    const rolledBack = await database.query<Array<{ count: bigint }>>(
      "SELECT COUNT(*) AS count FROM operations WHERE idempotency_key = ?", [`iris:${baseEventId}-failure`]
    );
    assert.equal(rolledBack[0]?.count, 0n);
  } else {
    const replay = await dispatch(normalEvent);
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.json().duplicate, true);
    assert.equal(replies.length, 0);
  }

  const eventId = `iris:${normalEvent}`;
  const scope = "inventory.open-all:900000004";
  const effects = await database.query<Array<{
    operation_count: bigint; execution_count: bigint; audit_count: bigint; outbox_count: bigint; delivery_count: bigint;
    guild_resource_ledger_count: bigint; guild_warehouse_ledger_count: bigint;
  }>>(
    `SELECT
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope = ? AND idempotency_key = ?) AS operation_count,
       (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'open_all') AS execution_count,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
         WHERE operation_row.idempotency_scope = ? AND operation_row.idempotency_key = ?) AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = ? AND operation_row.idempotency_key = ?) AS outbox_count,
       (SELECT COUNT(*) FROM delivery_attempts delivery JOIN outbox_messages outbox ON outbox.id = delivery.outbox_message_id
         JOIN operations operation_row ON operation_row.id = outbox.operation_id
         WHERE operation_row.idempotency_scope = ? AND operation_row.idempotency_key = ?) AS delivery_count,
       (SELECT COUNT(*) FROM guild_resource_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
         WHERE operation_row.idempotency_scope = ? AND operation_row.idempotency_key = ?) AS guild_resource_ledger_count,
       (SELECT COUNT(*) FROM guild_warehouse_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id
         WHERE operation_row.idempotency_scope = ? AND operation_row.idempotency_key = ?) AS guild_warehouse_ledger_count`,
    [scope, eventId, eventId, scope, eventId, scope, eventId, scope, eventId, scope, eventId, scope, eventId]
  );
  assert.deepEqual(effects[0], {
    operation_count: 1n, execution_count: 1n, audit_count: 1n, outbox_count: 1n, delivery_count: 1n,
    guild_resource_ledger_count: 2n, guild_warehouse_ledger_count: 4n
  });
  assert.deepEqual(await readGuildState(), {
    level: "11", max_members: "5", contribution: "1", contribution_uses: "1",
    experience: "40000.000", guild_point: "100005000.000", pet_skill_book: "2", pendant: "2",
    pet: "30", mini_pet: "10", member_food: "100007"
  });

  process.stdout.write(`${JSON.stringify({
    mode: verifyRestart ? "verify-restart" : "shadow", database: config.database.name, baseEventId,
    scenarios: ["normal", "empty", "partial", "multiple", "duplicate", "inventory-rollback", "guild-rollback", "restart-replay"],
    effects: { operation: 1, execution: 1, audit: 1, outbox: 1, delivery: 1, guildResourceLedger: 2, guildWarehouseLedger: 4 },
    operationalSnapshotTouched: false
  })}\n`);
} finally {
  await app.close();
}
