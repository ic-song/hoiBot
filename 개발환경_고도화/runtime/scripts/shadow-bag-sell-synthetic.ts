import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error("Synthetic bag-sell Shadow is blocked for database: " + config.database.name);
}
const database = createDatabaseClient(config.database);
try {
  const rows = await database.query<Array<{
    snapshots: bigint;
    bad_entries: bigint;
    operations: bigint;
    inventory_ledgers: bigint;
    currency_ledgers: bigint;
    audits: bigint;
    outbox: bigint;
  }>>(
    `SELECT
      (SELECT COUNT(*) FROM bag_selection_snapshots WHERE player_id=900000001) snapshots,
      (SELECT COUNT(*) FROM bag_selection_snapshot_entries entry
        JOIN bag_selection_snapshots snapshot ON snapshot.id=entry.snapshot_id
        WHERE snapshot.player_id=900000001 AND (entry.display_seq < 1 OR entry.item_id IS NULL)) bad_entries,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='inventory.bag_sell:900000001') operations,
      (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id=ledger.operation_id
        WHERE operation_row.idempotency_scope='inventory.bag_sell:900000001') inventory_ledgers,
      (SELECT COUNT(*) FROM currency_ledger ledger JOIN operations operation_row ON operation_row.id=ledger.operation_id
        WHERE operation_row.idempotency_scope='inventory.bag_sell:900000001') currency_ledgers,
      (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id=audit.operation_id
        WHERE operation_row.idempotency_scope='inventory.bag_sell:900000001') audits,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id
        WHERE operation_row.idempotency_scope='inventory.bag_sell:900000001') outbox`
  );
  const value = rows[0]!;
  assert.ok(value.snapshots >= 2n);
  assert.equal(value.bad_entries, 0n);
  assert.ok(value.operations >= 1n);
  assert.equal(value.inventory_ledgers, value.operations);
  assert.equal(value.currency_ledgers, value.operations);
  assert.equal(value.audits, value.operations);
  assert.equal(value.outbox, value.operations);
  process.stdout.write(JSON.stringify({
    result: "passed",
    checks: ["stable-definition-id", "snapshot-seq", "stack-version", "ledger-parity", "audit-outbox", "restart"],
    counts: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item.toString()]))
  }) + "\n");
} finally {
  await database.close();
}
