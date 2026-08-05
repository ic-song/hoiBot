import { hash } from "argon2";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const [loginId, displayName, ...options] = process.argv.slice(2);
const password = process.env.HOIBOT_BOOTSTRAP_ADMIN_PASSWORD;
const config = loadConfig();
const resetPassword = options.includes("--reset-password");
const allowInsecureLocal = options.includes("--allow-insecure-local") && config.nodeEnv !== "production";
if (loginId === undefined || displayName === undefined || password === undefined
  || (password.length < 12 && !allowInsecureLocal)) {
  throw new Error("Usage: set HOIBOT_BOOTSTRAP_ADMIN_PASSWORD (12+ chars), then pass <loginId> <displayName> [--reset-password] [--allow-insecure-local].");
}
const database = createDatabaseClient(config.database);
try {
  const passwordHash = await hash(password, { type: 2 });
  await database.withTransaction(async (transaction) => {
    const existing = await transaction.query<Array<{ id: bigint }>>(
      "SELECT id FROM admin_operators WHERE login_id = ? FOR UPDATE",
      [loginId]
    );
    if (existing[0] !== undefined) {
      if (!resetPassword) {
        throw new Error("Administrator login ID already exists. Use --reset-password only for an intentional credential reset.");
      }
      await transaction.execute(
        `UPDATE admin_operators SET display_name = ?, password_hash = ?, status = 'active',
          failed_login_count = 0, locked_until = NULL, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
        [displayName, passwordHash, existing[0].id]
      );
      await transaction.execute(
        `INSERT IGNORE INTO admin_operator_roles (operator_id, role_id)
         SELECT ?, id FROM admin_roles WHERE code = 'super_admin'`,
        [existing[0].id]
      );
      await transaction.execute(
        "UPDATE admin_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE operator_id = ? AND revoked_at IS NULL",
        [existing[0].id]
      );
      return;
    }
    const operator = await transaction.execute(
      `INSERT INTO admin_operators (login_id, display_name, password_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [loginId, displayName, passwordHash]
    );
    await transaction.execute(
      `INSERT INTO admin_operator_roles (operator_id, role_id)
       SELECT ?, id FROM admin_roles WHERE code = 'super_admin'`,
      [operator.insertId]
    );
  });
  process.stdout.write(resetPassword ? "super-admin-password-reset\n" : "super-admin-created\n");
} finally {
  await database.close();
}
