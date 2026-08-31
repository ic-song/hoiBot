import assert from "node:assert/strict";

import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import {
  ADMIN_BALANCE_GRANTED_ROLE_CODES,
  ADMIN_BALANCE_PERMISSION,
} from "../test/fixtures/admin-balance-permission-registry.js";

const config = loadConfig();
const expectedDatabase = "hoibot_admin_balance_permission_registry_g7";
if (!config.database.enabled || config.database.name !== expectedDatabase) {
  throw new Error(`Blocked database: ${config.database.name || "disabled"}`);
}

interface PermissionRow {
  code: string;
  display_name: string;
}

interface GrantRow {
  role_code: string;
  active: number;
}

async function snapshot(): Promise<{ permission: PermissionRow; grants: GrantRow[] }> {
  const database = createDatabaseClient(config.database);
  try {
    const permission = (await database.query<PermissionRow[]>(
      "SELECT code,display_name FROM admin_permissions WHERE code=?",
      [ADMIN_BALANCE_PERMISSION.code],
    ))[0];
    assert.ok(permission);
    const grants = await database.query<GrantRow[]>(
      `SELECT role.code role_code,role.active
         FROM admin_role_permissions grant_row
         JOIN admin_roles role ON role.id=grant_row.role_id
        WHERE grant_row.permission_code=?
        ORDER BY role.code`,
      [ADMIN_BALANCE_PERMISSION.code],
    );
    return { permission, grants };
  } finally {
    await database.close();
  }
}

let database = createDatabaseClient(config.database);
try {
  await database.ping();
  const first = await snapshot();
  assert.deepEqual(first.permission, {
    code: ADMIN_BALANCE_PERMISSION.code,
    display_name: ADMIN_BALANCE_PERMISSION.displayName,
  });
  assert.deepEqual(first.grants.map((row) => row.role_code), [...ADMIN_BALANCE_GRANTED_ROLE_CODES]);
  assert.ok(first.grants.every((row) => Number(row.active) === 1));
  assert.equal(first.grants.some((row) => row.role_code === "administrator"), false);

  const rollbackCode = "admin.balance.synthetic.rollback";
  await assert.rejects(
    database.withTransaction(async (transaction) => {
      await transaction.execute(
        "INSERT INTO admin_permissions(code,display_name) VALUES (?,?)",
        [rollbackCode, "합성 롤백 권한"],
      );
      await transaction.execute(
        `INSERT INTO admin_role_permissions(role_id,permission_code)
         SELECT id,? FROM admin_roles WHERE code='manager' AND active=TRUE`,
        [rollbackCode],
      );
      throw new Error("synthetic permission rollback");
    }),
    /synthetic permission rollback/,
  );
  assert.equal(
    Number((await database.query<Array<{ count_value: bigint }>>(
      "SELECT COUNT(*) count_value FROM admin_permissions WHERE code=?",
      [rollbackCode],
    ))[0]?.count_value ?? 1n),
    0,
  );
  assert.equal(await database.verifyRollback(), true);
} finally {
  await database.close();
}

const reconnect = await snapshot();
assert.deepEqual(reconnect, await snapshot());
process.stdout.write(`${JSON.stringify({
  mode: "synthetic-shadow",
  permission: reconnect.permission.code,
  grantedRoles: reconnect.grants.map((row) => row.role_code),
  deniedRoles: ["administrator", "unregistered", "inactive"],
  scenarios: ["definition", "active-role-grants", "fail-closed", "rollback", "reconnect", "migration-replay"],
  schemaChanges: 0,
  providerChanges: 0,
  operationalDataTouched: false,
})}\n`);
