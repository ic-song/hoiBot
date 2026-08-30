import type { DatabaseClient } from "../../src/database.js";

export const OBJECT_CATALOG_WEB_FIXTURE = {
  managerOperatorId: "9800002373",
  superAdminOperatorId: "9800002374",
  unprivilegedOperatorId: "9800002375",
  source: "admin-object-web-v2400",
  currencyCode: "lease2373_credit",
  objectKey: "currency.lease2373_credit",
  shadowCurrencyCode: "lease2373_shadow_credit",
  shadowObjectKey: "currency.lease2373_shadow_credit",
} as const;

// 비식별 operator 역할과 canonical currency target만 격리 MariaDB에 준비합니다.
export async function seedObjectCatalogWebFixture(database: DatabaseClient): Promise<void> {
  const operators = [
    [OBJECT_CATALOG_WEB_FIXTURE.managerOperatorId, "lease2373-manager", "Lease2373 Manager"],
    [OBJECT_CATALOG_WEB_FIXTURE.superAdminOperatorId, "lease2373-super", "Lease2373 Super Admin"],
    [OBJECT_CATALOG_WEB_FIXTURE.unprivilegedOperatorId, "lease2373-unprivileged", "Lease2373 Unprivileged"],
  ] as const;
  for (const [operatorId, loginId, displayName] of operators) {
    await database.execute(
      `INSERT INTO admin_operators(id,login_id,display_name,password_hash,status)
       VALUES (?,?,?,'synthetic-only','active')
       ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),password_hash=VALUES(password_hash),status='active'`,
      [operatorId, loginId, displayName],
    );
  }
  await database.execute(
    `INSERT IGNORE INTO admin_operator_roles(operator_id,role_id)
     SELECT ?,id FROM admin_roles WHERE code='manager' AND active=TRUE`,
    [OBJECT_CATALOG_WEB_FIXTURE.managerOperatorId],
  );
  await database.execute(
    `INSERT IGNORE INTO admin_operator_roles(operator_id,role_id)
     SELECT ?,id FROM admin_roles WHERE code='super_admin' AND active=TRUE`,
    [OBJECT_CATALOG_WEB_FIXTURE.superAdminOperatorId],
  );
  for (const code of [OBJECT_CATALOG_WEB_FIXTURE.currencyCode, OBJECT_CATALOG_WEB_FIXTURE.shadowCurrencyCode]) {
    await database.execute(
      `INSERT INTO currency_definitions(code,display_name,scale_digits,active)
       VALUES (?,CONCAT('Lease2373 ',?),0,TRUE)
       ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),active=TRUE`,
      [code, code],
    );
  }
}
