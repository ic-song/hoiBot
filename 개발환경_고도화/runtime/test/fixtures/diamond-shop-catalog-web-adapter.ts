import type { DatabaseClient } from "../../src/database.js";

export const DIAMOND_WEB_FIXTURE = {
  managerOperatorId: "9800002361",
  superAdminOperatorId: "9800002362",
  unprivilegedOperatorId: "9800002363",
  source: "admin-diamond-web-v2400",
} as const;

// 비식별 operator와 기존 manager/super_admin 역할만 합성 MariaDB에 연결합니다.
export async function seedDiamondShopCatalogWebOperators(database: DatabaseClient): Promise<void> {
  const operators = [
    [DIAMOND_WEB_FIXTURE.managerOperatorId, "lease2361-manager", "Lease2361 Manager"],
    [DIAMOND_WEB_FIXTURE.superAdminOperatorId, "lease2361-super", "Lease2361 Super Admin"],
    [DIAMOND_WEB_FIXTURE.unprivilegedOperatorId, "lease2361-unprivileged", "Lease2361 Unprivileged"],
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
    [DIAMOND_WEB_FIXTURE.managerOperatorId],
  );
  await database.execute(
    `INSERT IGNORE INTO admin_operator_roles(operator_id,role_id)
     SELECT ?,id FROM admin_roles WHERE code='super_admin' AND active=TRUE`,
    [DIAMOND_WEB_FIXTURE.superAdminOperatorId],
  );
}
