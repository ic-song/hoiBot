import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic yakitori Shadow is blocked for database: ${config.database.name}`);
}
const database = createDatabaseClient(config.database);
try {
  const rows = await database.query<Array<{
    environment_code: string; reward_count: bigint; owned_count: bigint; stable_count: bigint;
    ledger_count: bigint; execution_count: bigint; audit_count: bigint; outbox_count: bigint;
  }>>(
    `SELECT environment.environment_code,
       COUNT(DISTINCT reward.reward_ordinal) AS reward_count,
       COUNT(DISTINCT owned.id) AS owned_count,
       COUNT(DISTINCT reward.stable_owned_id) AS stable_count,
       (SELECT COUNT(*) FROM inventory_ledger WHERE operation_id=operation_row.id) AS ledger_count,
       (SELECT COUNT(*) FROM command_executions WHERE operation_id=operation_row.id AND command_code='yakitori_package_use') AS execution_count,
       (SELECT COUNT(*) FROM command_audit WHERE operation_id=operation_row.id) AS audit_count,
       (SELECT COUNT(*) FROM outbox_messages WHERE operation_id=operation_row.id) AS outbox_count
     FROM operations operation_row
     JOIN yakitori_package_use_executions execution ON execution.operation_id=operation_row.id AND execution.status='completed'
     JOIN mini_pet_projection_environment_identity environment ON environment.singleton_id=1
     JOIN yakitori_package_owned_rewards reward ON reward.operation_id=operation_row.id
     JOIN owned_mini_pets owned ON owned.id=reward.owned_mini_pet_id
     WHERE operation_row.idempotency_scope LIKE 'mini-pet.yakitori-package-use:dev:%'
       AND operation_row.status='completed'
     GROUP BY operation_row.id, environment.environment_code
     ORDER BY operation_row.id DESC LIMIT 1`
  );
  assert.deepEqual(rows[0], {
    environment_code: "dev", reward_count: 10n, owned_count: 10n, stable_count: 10n,
    ledger_count: 2n, execution_count: 1n, audit_count: 1n, outbox_count: 1n
  });
  process.stdout.write(`${JSON.stringify(
    { database: config.database.name, shadow: "PASS", ...rows[0] },
    (_key, value) => typeof value === "bigint" ? value.toString() : value
  )}\n`);
} finally {
  await database.close();
}
