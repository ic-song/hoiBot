export interface PackageCatalogAdminFixture {
  fixtureId: string;
  message: string;
  commandCode: "PACKAGE_CATALOG_ADD" | "PACKAGE_CATALOG_EDIT" | "PACKAGE_CATALOG_REMOVE" | "PACKAGE_CATALOG_ENABLE";
  expectedVersion: bigint;
  expectedResult: "COMMITTED" | "REJECTED" | "DISPATCH_MISS";
  expectedMutationCount: number;
  expectedOutboxCount: number;
}

export const PACKAGE_CATALOG_ADMIN_PERMISSION = "package.catalog.manage";

export const SYNTHETIC_PACKAGE_CATALOG = [
  { packageId: "PKG-SYNTH-001", displayName: "합성 패키지 하나", displayOrder: 1, active: true, rowVersion: 1n },
  { packageId: "PKG-SYNTH-002", displayName: "합성 패키지 둘", displayOrder: 2, active: false, rowVersion: 1n },
  { packageId: "PKG-SYNTH-003", displayName: "합성 패키지 셋", displayOrder: 3, active: true, rowVersion: 1n },
] as const;

export const PACKAGE_CATALOG_ADMIN_FIXTURES: readonly PackageCatalogAdminFixture[] = [
  { fixtureId: "ADD-STANDARD", message: "/패키지추가 새 패키지 | 합성 설명 | point:10, item:합성아이템:2", commandCode: "PACKAGE_CATALOG_ADD", expectedVersion: 7n, expectedResult: "COMMITTED", expectedMutationCount: 3, expectedOutboxCount: 1 },
  { fixtureId: "ADD-NATURAL", message: "/패키지추가 자연어 패키지 | 합성 설명 | 합성아이템 x4,000, 합성아이템 x2", commandCode: "PACKAGE_CATALOG_ADD", expectedVersion: 7n, expectedResult: "COMMITTED", expectedMutationCount: 3, expectedOutboxCount: 1 },
  { fixtureId: "ADD-DUPLICATE", message: "/패키지추가 합성 패키지 하나 | 중복 | point:1", commandCode: "PACKAGE_CATALOG_ADD", expectedVersion: 7n, expectedResult: "REJECTED", expectedMutationCount: 0, expectedOutboxCount: 0 },
  { fixtureId: "ADD-PIPE-MISS", message: "/패키지추가 이름 | 설명 | point:1 | extra", commandCode: "PACKAGE_CATALOG_ADD", expectedVersion: 7n, expectedResult: "DISPATCH_MISS", expectedMutationCount: 0, expectedOutboxCount: 0 },
  { fixtureId: "EDIT-STANDARD", message: "/패키지수정 2 | item:합성아이템:3", commandCode: "PACKAGE_CATALOG_EDIT", expectedVersion: 7n, expectedResult: "COMMITTED", expectedMutationCount: 2, expectedOutboxCount: 1 },
  { fixtureId: "EDIT-OUT-OF-RANGE", message: "/패키지수정 99 | point:1", commandCode: "PACKAGE_CATALOG_EDIT", expectedVersion: 7n, expectedResult: "REJECTED", expectedMutationCount: 0, expectedOutboxCount: 0 },
  { fixtureId: "EDIT-DECIMAL-MISS", message: "/패키지수정 1.5 | point:1", commandCode: "PACKAGE_CATALOG_EDIT", expectedVersion: 7n, expectedResult: "DISPATCH_MISS", expectedMutationCount: 0, expectedOutboxCount: 0 },
  { fixtureId: "REMOVE-PRIMARY", message: "/패키지제거 2", commandCode: "PACKAGE_CATALOG_REMOVE", expectedVersion: 7n, expectedResult: "COMMITTED", expectedMutationCount: 2, expectedOutboxCount: 1 },
  { fixtureId: "REMOVE-ALIAS", message: "/패키지리스트제거 2", commandCode: "PACKAGE_CATALOG_REMOVE", expectedVersion: 7n, expectedResult: "COMMITTED", expectedMutationCount: 2, expectedOutboxCount: 1 },
  { fixtureId: "REMOVE-SUFFIX-MISS", message: "/패키지제거 2 안내", commandCode: "PACKAGE_CATALOG_REMOVE", expectedVersion: 7n, expectedResult: "DISPATCH_MISS", expectedMutationCount: 0, expectedOutboxCount: 0 },
  { fixtureId: "ENABLE-DISABLED", message: "/패키지활성 2", commandCode: "PACKAGE_CATALOG_ENABLE", expectedVersion: 7n, expectedResult: "COMMITTED", expectedMutationCount: 1, expectedOutboxCount: 1 },
  { fixtureId: "ENABLE-ACTIVE", message: "/패키지활성 1", commandCode: "PACKAGE_CATALOG_ENABLE", expectedVersion: 7n, expectedResult: "COMMITTED", expectedMutationCount: 1, expectedOutboxCount: 1 },
  { fixtureId: "ENABLE-ZERO", message: "/패키지활성 0", commandCode: "PACKAGE_CATALOG_ENABLE", expectedVersion: 7n, expectedResult: "REJECTED", expectedMutationCount: 0, expectedOutboxCount: 0 },
  { fixtureId: "STALE-VERSION", message: "/패키지활성 2", commandCode: "PACKAGE_CATALOG_ENABLE", expectedVersion: 6n, expectedResult: "REJECTED", expectedMutationCount: 0, expectedOutboxCount: 0 },
] as const;

