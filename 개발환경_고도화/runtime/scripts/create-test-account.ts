import { argon2id, hash } from "argon2";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { createInitialPlayer } from "../src/signup/create-initial-player.js";
import { validateLoginId, validateUserAccountName, validateUserPassword } from "../src/user-auth/policy.js";

const [loginIdValue, accountNameValue] = process.argv.slice(2);
const passwordValue = process.env.HOIBOT_TEST_ACCOUNT_PASSWORD;
const config = loadConfig();
if (config.nodeEnv !== "test") throw new Error("Test accounts can only be created when NODE_ENV=test.");
if (loginIdValue === undefined || accountNameValue === undefined || passwordValue === undefined) throw new Error("Usage: set HOIBOT_TEST_ACCOUNT_PASSWORD, then pass <loginId> <systemAccountName>.");
const loginId = validateLoginId(loginIdValue);
const accountName = validateUserAccountName(accountNameValue);
const password = validateUserPassword(passwordValue);
const database = createDatabaseClient(config.database);
try {
  const passwordHash = await hash(password, { type: argon2id });
  const result = await database.withTransaction(async (transaction) => {
    const playerId = await createInitialPlayer(transaction, accountName.displayName, "test-environment");
    const account = await transaction.execute(
      `INSERT INTO user_accounts
        (player_id, login_id, password_hash, system_account_name, gender_code, account_type, status, activated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'test', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [playerId, loginId, passwordHash, accountName.displayName, accountName.genderCode]
    );
    return { accountId: account.insertId.toString(), playerId: playerId.toString() };
  });
  process.stdout.write(`test-account-created account=${result.accountId} player=${result.playerId}\n`);
} finally {
  await database.close();
}
