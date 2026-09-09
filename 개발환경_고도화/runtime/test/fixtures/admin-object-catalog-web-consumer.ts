import type { AdminSession } from "../../src/admin/auth-service.js";
import type { CatalogObject } from "../../src/catalog/object-catalog.js";

export const syntheticObjectCatalogAdminSession: AdminSession = {
  sessionId: "2374",
  operatorId: "9800002374",
  loginId: "lease2374.manager",
  displayName: "Lease2374 합성 관리자",
  roleCodes: ["manager"],
  permissions: [],
};

export const syntheticObjectCatalogObject: CatalogObject = {
  definitionId: "18446744073709551615",
  objectKey: "currency.lease2374_credit",
  objectType: "CURRENCY",
  displayName: "Lease2374 합성 크레딧",
  version: "9007199254740993",
  active: true,
  metadata: { fixture: true, scale: "0" },
};

export const syntheticObjectCatalogMutationHeaders = {
  cookie: "hoibot_admin_session=synthetic-session-token",
  "x-csrf-token": "synthetic-csrf-token",
  "idempotency-key": "lease2374-object-request",
} as const;
