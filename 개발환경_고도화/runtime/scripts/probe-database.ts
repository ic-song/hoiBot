import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const config = loadConfig();
if (!config.database.enabled) {
  throw new Error("DATABASE_ENABLED must be true to probe MariaDB.");
}

const database = createDatabaseClient(config.database);
try {
  await database.ping();
  const rollbackVerified = await database.verifyRollback();
  if (!rollbackVerified) {
    throw new Error("MariaDB rollback probe left a row behind.");
  }
  process.stdout.write(JSON.stringify({ connected: true, rollbackVerified: true }));
} finally {
  await database.close();
}
