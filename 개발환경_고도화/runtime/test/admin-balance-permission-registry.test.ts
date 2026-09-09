import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  ADMIN_BALANCE_GRANTED_ROLE_CODES,
  ADMIN_BALANCE_PERMISSION,
  ADMIN_BALANCE_ROLE_FIXTURES,
} from "./fixtures/admin-balance-permission-registry.js";

const migrationUrl = new URL("../migrations/401_admin_balance_permission_registry.sql", import.meta.url);

describe("admin balance permission registry", () => {
  it("freezes the stable permission and active role matrix", () => {
    assert.deepEqual(ADMIN_BALANCE_PERMISSION, {
      code: "admin.balance.manage",
      displayName: "확률·수치 관리",
    });
    assert.deepEqual(
      ADMIN_BALANCE_ROLE_FIXTURES.filter((fixture) => fixture.active && fixture.expectedGranted)
        .map((fixture) => fixture.roleCode).sort(),
      [...ADMIN_BALANCE_GRANTED_ROLE_CODES],
    );
  });

  it("keeps legacy, inactive and unregistered roles fail-closed", () => {
    for (const fixture of ADMIN_BALANCE_ROLE_FIXTURES) {
      const granted = fixture.active
        && ADMIN_BALANCE_GRANTED_ROLE_CODES.includes(fixture.roleCode as "manager" | "super_admin");
      assert.equal(granted, fixture.expectedGranted, fixture.roleCode);
    }
    assert.equal(ADMIN_BALANCE_GRANTED_ROLE_CODES.includes("administrator" as "manager"), false);
  });

  it("uses only existing idempotent permission seed tables", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    assert.match(sql, /INSERT INTO admin_permissions\(code, display_name\)/);
    assert.match(sql, /INSERT INTO admin_role_permissions\(role_id, permission_code\)/);
    assert.match(sql, /role\.active = TRUE/);
    assert.match(sql, /role\.code IN \('super_admin', 'manager'\)/);
    assert.equal((sql.match(/ON DUPLICATE KEY UPDATE/g) ?? []).length, 2);
    assert.doesNotMatch(sql, /CREATE\s+TABLE|ALTER\s+TABLE/i);
    assert.doesNotMatch(sql, /role\.code\s*=\s*'administrator'|role\.code\s+IN\s*\([^)]*'administrator'/i);
  });
});
