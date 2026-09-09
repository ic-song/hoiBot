import type { AdminSession } from "../../src/admin/auth-service.js";

export const syntheticPackageCatalogAdminSession: AdminSession = {
  sessionId: "99002368",
  operatorId: "9800002368",
  loginId: "lease2368-package-manager",
  displayName: "Lease2368 합성 패키지 운영자",
  roleCodes: ["catalog_manager"],
  permissions: ["package.catalog.manage"],
};

export const syntheticPackageCatalogSnapshot = {
  catalogVersion: 9007199254740993n,
  entries: [
    { packageId: "PKG-SYNTH-LEASE2368-ACTIVE", displayName: "합성 활성 패키지", displayOrder: 1, active: true, rowVersion: 18446744073709551615n },
    { packageId: "PKG-SYNTH-LEASE2368-INACTIVE", displayName: "합성 비활성 패키지", displayOrder: 2, active: false, rowVersion: 9007199254740995n },
  ],
};

export const syntheticPackageCatalogResponse = {
  catalogKey: "PACKAGE_CATALOG",
  catalogVersion: "9007199254740993",
  entries: syntheticPackageCatalogSnapshot.entries.map((entry) => ({ packageId: entry.packageId, displayName: entry.displayName, displayOrder: entry.displayOrder, active: entry.active, expectedVersion: entry.rowVersion.toString() })),
};

export const syntheticPackageCatalogMutationHeaders = {
  cookie: "hoibot_admin_session=synthetic-session-token",
  "x-csrf-token": "synthetic-csrf-token",
  "idempotency-key": "lease2368-package-001",
} as const;
