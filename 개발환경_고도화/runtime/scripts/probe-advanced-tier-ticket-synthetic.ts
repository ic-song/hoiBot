import assert from "node:assert/strict";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { AdvancedTierTicketCraftService } from "../src/crafting/advanced-tier-ticket-craft-service.js";

const database = createDatabaseClient({ enabled: true, host: process.env.DB_HOST ?? "127.0.0.1", port: Number(process.env.DB_PORT ?? "13307"), user: process.env.DB_USER ?? "root", password: process.env.DB_PASSWORD ?? "", name: process.env.DB_NAME ?? "hoibot", connectionLimit: 4, connectTimeoutMs: 5000 });
const playerId = 900000001n;
const codes = ["tier_promotion_ticket", "legendary_stone", "pet_enhance_stone", "advanced_tier_promotion_ticket"];

// 합성 회원의 조합 아이템 스택을 지정한 수량으로 교체합니다.
async function setStacks(tier: bigint, legendary: bigint, pet: bigint, advanced = 0n): Promise<void> {
  await database.execute(`DELETE stack FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id WHERE stack.player_id = ? AND item.code IN (?, ?, ?, ?)`, [playerId, ...codes]);
  for (const [code, quantity] of [[codes[0], tier], [codes[1], legendary], [codes[2], pet], [codes[3], advanced]] as Array<[string, bigint]>) if (quantity > 0n) await database.execute("INSERT INTO inventory_stacks (player_id, item_id, quantity, version) SELECT ?, id, ?, 1 FROM item_definitions WHERE code = ?", [playerId, quantity, code]);
}

// command execution FK용 합성 inbox event를 준비합니다.
async function seedEvent(eventId: string): Promise<void> { await database.execute("INSERT IGNORE INTO event_inbox (event_id, event_kind, processing_status, received_at) VALUES (?, 'message', 'processing', UTC_TIMESTAMP(3))", [eventId]); }

// 원장 쓰기 직전 실패를 주입하는 DB wrapper를 만듭니다.
function failAtLedger(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), verifyRollback: () => inner.verifyRollback(), query: (sql, values) => inner.query(sql, values), execute: (sql, values) => inner.execute(sql, values), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({ query: (sql, values) => transaction.query(sql, values), execute: async (sql, values) => { if (sql.includes("INSERT INTO inventory_ledger")) throw new Error("synthetic craft ledger failure"); return transaction.execute(sql, values); } })) };
}

const command = (eventId: string, message = "/고급티켓조합 2", externalUserId = "synthetic-admin-alpha") => ({ externalUserId, channelId: "synthetic-room-001", message, eventId });

try {
  await setStacks(3_050n, 4n, 300n); await seedEvent("advanced-tier-probe-normal");
  const service = new AdvancedTierTicketCraftService(database);
  const first = await service.handle(command("advanced-tier-probe-normal"));
  const replay = await service.handle(command("advanced-tier-probe-normal"));
  assert.equal(first.status, "crafted"); assert.equal(replay.duplicate, true);
  assert.deepEqual([first.tierTicketQuantity, first.legendaryStoneQuantity, first.petEnhanceStoneQuantity, first.advancedTicketQuantity], ["2550", "0", "0", "2"]);
  const normalEffects = await database.query<Array<{ operations: bigint; ledgers: bigint; outbox: bigint }>>(`SELECT
    (SELECT COUNT(*) FROM operations WHERE idempotency_key = 'advanced-tier-probe-normal') AS operations,
    (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id WHERE operation_row.idempotency_key = 'advanced-tier-probe-normal') AS ledgers,
    (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id WHERE operation_row.idempotency_key = 'advanced-tier-probe-normal') AS outbox`);
  assert.deepEqual(normalEffects[0], { operations: 1n, ledgers: 4n, outbox: 1n });

  await setStacks(2_799n, 2n, 150n); await seedEvent("advanced-tier-probe-short");
  await assert.rejects(() => service.handle(command("advanced-tier-probe-short", "/고급티켓조합")), (error: any) => error?.code === "TIER_TICKET_RESERVE_REQUIRED");
  await seedEvent("advanced-tier-probe-unlinked");
  await assert.rejects(() => service.handle(command("advanced-tier-probe-unlinked", "/고급티켓조합", "synthetic-unlinked")), (error: any) => error?.code === "PLAYER_IDENTITY_REQUIRED");
  const rejected = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM operations WHERE idempotency_key IN ('advanced-tier-probe-short','advanced-tier-probe-unlinked')");
  assert.equal(rejected[0]?.count, 0n);

  await setStacks(2_800n, 2n, 150n); await seedEvent("advanced-tier-probe-failure");
  await assert.rejects(() => new AdvancedTierTicketCraftService(failAtLedger(database)).handle(command("advanced-tier-probe-failure", "/고급티켓조합")), /synthetic craft ledger failure/);
  const rollback = await database.query<Array<{ tier: bigint; operations: bigint; ledgers: bigint }>>(`SELECT
    (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id WHERE stack.player_id = ? AND item.code = 'tier_promotion_ticket') AS tier,
    (SELECT COUNT(*) FROM operations WHERE idempotency_key = 'advanced-tier-probe-failure') AS operations,
    (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id = ledger.operation_id WHERE operation_row.idempotency_key = 'advanced-tier-probe-failure') AS ledgers`, [playerId]);
  assert.deepEqual(rollback[0], { tier: 2_800n, operations: 0n, ledgers: 0n });

  await setStacks(2_800n, 2n, 150n);
  for (const eventId of ["advanced-tier-probe-concurrent-a", "advanced-tier-probe-concurrent-b"]) await seedEvent(eventId);
  const settled = await Promise.allSettled(["advanced-tier-probe-concurrent-a", "advanced-tier-probe-concurrent-b"].map((eventId) => new AdvancedTierTicketCraftService(database).handle(command(eventId, "/고급티켓조합"))));
  assert.equal(settled.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(settled.filter((entry) => entry.status === "rejected" && (entry.reason as any)?.code === "TIER_TICKET_RESERVE_REQUIRED").length, 1);
  process.stdout.write(`${JSON.stringify({ scenarios: ["reserve-2550", "three-material-atomic", "duplicate-replay", "unlinked-and-shortage-no-mutation", "mid-write-rollback", "concurrent-first-commit"], first, rollback: true, concurrent: true })}\n`);
} finally { await database.close(); }
