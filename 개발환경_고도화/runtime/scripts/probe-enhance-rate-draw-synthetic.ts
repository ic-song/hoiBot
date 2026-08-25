import assert from "node:assert/strict";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { EnhanceRateDrawService } from "../src/inventory/enhance-rate-draw-service.js";
import { MariaEnhanceRateDrawRepository } from "../src/inventory/maria-enhance-rate-draw-repository.js";

const database = createDatabaseClient({
  enabled: true, host: process.env.DB_HOST ?? "127.0.0.1", port: Number(process.env.DB_PORT ?? "13307"),
  user: process.env.DB_USER ?? "root", password: process.env.DB_PASSWORD ?? "", name: process.env.DB_NAME ?? "hoibot",
  connectionLimit: 4, connectTimeoutMs: 5000
});
const playerId = 900000001n;
const codes = ["enhance_rate_draw_ticket", "spirit_enhance_rate_up_30", "pet_enhance_rate_up_20", "mini_pet_enhance_rate_up_30"];

async function setStacks(ticketCount: bigint): Promise<void> {
  await database.execute(
    `DELETE stack FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
     WHERE stack.player_id = ? AND item.code IN (?, ?, ?, ?)`, [playerId, ...codes]
  );
  if (ticketCount > 0n) await database.execute(
    `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
     SELECT ?, id, ?, 1 FROM item_definitions WHERE code = 'enhance_rate_draw_ticket'`, [playerId, ticketCount]
  );
}

async function seedEvent(eventId: string): Promise<void> {
  await database.execute("INSERT IGNORE INTO event_inbox (event_id, event_kind, processing_status, received_at) VALUES (?, 'message', 'processing', UTC_TIMESTAMP(3))", [eventId]);
}

function failAtDraw(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), verifyRollback: () => inner.verifyRollback(), query: (sql, values) => inner.query(sql, values),
    execute: (sql, values) => inner.execute(sql, values), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, values) => transaction.query(sql, values),
      execute: async (sql, values) => {
        if (sql.includes("INSERT INTO enhance_rate_draws")) throw new Error("synthetic draw persistence failure");
        return transaction.execute(sql, values);
      }
    }))
  };
}

const command = (eventId: string, message = "/강화뽑기 3") => ({
  externalUserId: "synthetic-admin-alpha", channelId: "synthetic-room-001", message, eventId
});

try {
  await setStacks(3n); await seedEvent("enhance-rate-probe-normal");
  let index = 0;
  const service = new EnhanceRateDrawService(new MariaEnhanceRateDrawRepository(database), { next: () => [0.799999, 0.8, 0.9][index++]! });
  const first = await service.handle(command("enhance-rate-probe-normal"));
  const replay = await service.handle(command("enhance-rate-probe-normal"));
  assert.equal(first.status, "drawn"); assert.equal(replay.status, "drawn");
  if (first.status !== "drawn" || replay.status !== "drawn") throw new Error("unexpected ignored result");
  assert.deepEqual(first.drawRewardCodes, ["spirit_enhance_rate_up_30", "pet_enhance_rate_up_20", "mini_pet_enhance_rate_up_30"]);
  assert.equal(replay.duplicate, true); assert.equal(index, 3);
  const outbox = await database.query<Array<{ count: bigint; delayed_count: bigint | string }>>(
    `SELECT COUNT(*) AS count, SUM(available_at > created_at) AS delayed_count FROM outbox_messages
     WHERE id IN (?, ?)`, [first.outboxId, first.resultOutboxId]
  );
  assert.equal(outbox[0]?.count, 2n);
  assert.equal(BigInt(outbox[0]?.delayed_count ?? 0), 1n);

  await setStacks(3n); await seedEvent("enhance-rate-probe-failure");
  await assert.rejects(
    () => new EnhanceRateDrawService(new MariaEnhanceRateDrawRepository(failAtDraw(database)), { next: () => 0 }).handle(command("enhance-rate-probe-failure", "/강화뽑기 1")),
    /synthetic draw persistence failure/
  );
  const rollback = await database.query<Array<{ tickets: bigint; operations: bigint; draws: bigint }>>(
    `SELECT
       (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id WHERE stack.player_id = ? AND item.code = 'enhance_rate_draw_ticket') AS tickets,
       (SELECT COUNT(*) FROM operations WHERE idempotency_key = 'enhance-rate-probe-failure') AS operations,
       (SELECT COUNT(*) FROM enhance_rate_draws draw JOIN operations operation_row ON operation_row.id = draw.operation_id WHERE operation_row.idempotency_key = 'enhance-rate-probe-failure') AS draws`,
    [playerId]
  );
  assert.deepEqual(rollback[0], { tickets: 3n, operations: 0n, draws: 0n });

  await setStacks(1n);
  for (const eventId of ["enhance-rate-probe-concurrent-a", "enhance-rate-probe-concurrent-b"]) await seedEvent(eventId);
  const settled = await Promise.allSettled(["enhance-rate-probe-concurrent-a", "enhance-rate-probe-concurrent-b"].map((eventId) =>
    new EnhanceRateDrawService(new MariaEnhanceRateDrawRepository(database), { next: () => 0 }).handle(command(eventId, "/강화뽑기"))
  ));
  assert.equal(settled.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(settled.filter((entry) => entry.status === "rejected" && entry.reason?.code === "ENHANCE_RATE_DRAW_TICKET_SHORTAGE").length, 1);
  process.stdout.write(`${JSON.stringify({ scenarios: ["80-10-10-boundary", "duplicate-replay", "durable-delayed-outbox", "mid-write-rollback", "concurrent-first-commit"], first, rollback: true, concurrent: true })}\n`);
} finally {
  await database.close();
}
