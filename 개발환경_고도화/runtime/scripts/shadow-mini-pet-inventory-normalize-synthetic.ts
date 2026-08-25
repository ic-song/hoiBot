import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic mini-pet inventory Shadow is blocked for database: ${config.database.name}`);
}
const database = createDatabaseClient(config.database);
try {
  const rows = await database.query<Array<{
    environment_code: string; shape_code: string; first_sort: number; second_sort: number;
    stable_count: bigint; repair_count: bigint; execution_count: bigint; audit_count: bigint; outbox_count: bigint;
  }>>(
    `SELECT environment.environment_code, state.bag_shape_code AS shape_code,
      (SELECT sort_index FROM mini_pet_inventory_owned_states WHERE owned_mini_pet_id=900000001) AS first_sort,
      (SELECT sort_index FROM mini_pet_inventory_owned_states WHERE owned_mini_pet_id=900000011) AS second_sort,
      (SELECT COUNT(DISTINCT stable_owned_id) FROM mini_pet_inventory_owned_states WHERE player_id=900000001) AS stable_count,
      (SELECT COUNT(*) FROM mini_pet_inventory_repair_entries WHERE operation_id=operation_row.id) AS repair_count,
      (SELECT COUNT(*) FROM command_executions WHERE operation_id=operation_row.id) AS execution_count,
      (SELECT COUNT(*) FROM command_audit WHERE operation_id=operation_row.id) AS audit_count,
      (SELECT COUNT(*) FROM outbox_messages WHERE operation_id=operation_row.id) AS outbox_count
     FROM operations operation_row
     JOIN mini_pet_inventory_repair_executions execution ON execution.operation_id=operation_row.id AND execution.status='completed'
     JOIN mini_pet_projection_environment_identity environment ON environment.singleton_id=1
     JOIN mini_pet_inventory_player_states state ON state.player_id=900000001
     WHERE operation_row.idempotency_scope LIKE 'mini-pet.inventory-view-normalize:dev:%'
       AND operation_row.status='completed'
     ORDER BY operation_row.id DESC LIMIT 1`
  );
  assert.deepEqual(rows[0], {
    environment_code: "dev", shape_code: "array", first_sort: 1, second_sort: 2,
    stable_count: 2n, repair_count: 2n, execution_count: 1n, audit_count: 1n, outbox_count: 1n
  });
  process.stdout.write(`${JSON.stringify(
    { database: config.database.name, shadow: "PASS", ...rows[0] },
    (_key, value) => typeof value === "bigint" ? value.toString() : value
  )}\n`);
} finally {
  await database.close();
}
