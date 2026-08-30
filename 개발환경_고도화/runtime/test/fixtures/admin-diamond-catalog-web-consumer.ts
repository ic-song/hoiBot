import type { AdminSession } from "../../src/admin/auth-service.js";

export const syntheticDiamondCatalogAdminSession: AdminSession = {
  sessionId: "99002366",
  operatorId: "9800002366",
  loginId: "lease2366-manager",
  displayName: "Lease2366 합성 운영자",
  roleCodes: ["manager"],
  permissions: [],
};

export const syntheticDiamondCatalogSnapshot = {
  catalogVersion: 14n,
  bootstrapSource: "legacy.defaultShop",
  bootstrapVersion: "v2400-synthetic",
  bootstrapStatus: "verified",
  items: [
    {
      productId: "00000000-0000-0000-0000-000000002366",
      displayName: "합성 초대형 다이아 상품",
      quantity: 123456789012345678901234567890n,
      price: 9007199254740993n,
      displayOrder: 1,
      version: 3n,
    },
  ],
} as const;

export const syntheticDiamondCatalogResponse = {
  catalogVersion: "14",
  bootstrapSource: "legacy.defaultShop",
  bootstrapVersion: "v2400-synthetic",
  bootstrapStatus: "verified",
  items: [
    {
      productId: "00000000-0000-0000-0000-000000002366",
      displayName: "합성 초대형 다이아 상품",
      quantity: "123456789012345678901234567890",
      price: "9007199254740993",
      displayOrder: 1,
      version: "3",
    },
  ],
} as const;

export const syntheticDiamondCatalogMutationHeaders = {
  cookie: "hoibot_admin_session=synthetic-session-token",
  "x-csrf-token": "synthetic-csrf-token",
  "idempotency-key": "lease2366-add-001",
} as const;
