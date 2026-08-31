export const ADMIN_BALANCE_PERMISSION = {
  code: "admin.balance.manage",
  displayName: "확률·수치 관리",
} as const;

export interface AdminBalanceRoleFixture {
  roleCode: string;
  active: boolean;
  expectedGranted: boolean;
}

export const ADMIN_BALANCE_ROLE_FIXTURES: readonly AdminBalanceRoleFixture[] = [
  { roleCode: "super_admin", active: true, expectedGranted: true },
  { roleCode: "manager", active: true, expectedGranted: true },
  { roleCode: "administrator", active: false, expectedGranted: false },
  { roleCode: "auditor", active: true, expectedGranted: false },
  { roleCode: "manager", active: false, expectedGranted: false },
] as const;

export const ADMIN_BALANCE_GRANTED_ROLE_CODES = ["manager", "super_admin"] as const;
