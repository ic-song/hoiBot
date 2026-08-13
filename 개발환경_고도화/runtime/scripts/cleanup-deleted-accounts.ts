import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { AccountCleanupService } from "../src/user-auth/account-cleanup-service.js";

const config = loadConfig();
const database = createDatabaseClient(config.database);
try {
  const result = await new AccountCleanupService(database).runMaintenance();
  process.stdout.write(
    `account-cleanup pending_processed=${result.pending.processed} pending_failed=${result.pending.failed}`
    + ` deleted_processed=${result.deleted.processed} deleted_failed=${result.deleted.failed}\n`
  );
  if (result.pending.failed > 0 || result.deleted.failed > 0) process.exitCode = 1;
} finally {
  await database.close();
}
