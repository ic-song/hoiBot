import { hash } from "argon2";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const [loginId, displayName] = process.argv.slice(2);
const password = process.env.HOIBOT_BOOTSTRAP_ADMIN_PASSWORD;
if (loginId === undefined || displayName === undefined || password === undefined || password.length < 12) {
  throw new Error("Usage: set HOIBOT_BOOTSTRAP_ADMIN_PASSWORD (12+ chars), then pass <loginId> <displayName>.");
}
const config = loadConfig();
const database = createDatabaseClient(config.database);
try {
  const passwordHash = await hash(password, { type: 2 });
  await database.withTransaction(async (transaction) => {
    const operator = await transaction.execute(
      `INSERT INTO admin_operators (login_id, display_name, password_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [loginId, displayName, passwordHash]
    );
    await transaction.execute(
      `INSERT INTO admin_operator_roles (operator_id, role_id)
       SELECT ?, id FROM admin_roles WHERE code = 'administrator'`,
      [operator.insertId]
    );
  });
  process.stdout.write("administrator-created\n");
} finally {
  await database.close();
}
