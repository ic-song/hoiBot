import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PACKAGE_CATALOG_ADMIN_FIXTURES,
  PACKAGE_CATALOG_ADMIN_PERMISSION,
  SYNTHETIC_PACKAGE_CATALOG,
} from "./fixtures/package-catalog-admin.js";

describe("package catalog admin synthetic fixture", () => {
  it("uses only synthetic stable package identifiers and compact display order", () => {
    assert.deepEqual(SYNTHETIC_PACKAGE_CATALOG.map((entry) => entry.packageId), ["PKG-SYNTH-001", "PKG-SYNTH-002", "PKG-SYNTH-003"]);
    assert.deepEqual(SYNTHETIC_PACKAGE_CATALOG.map((entry) => entry.displayOrder), [1, 2, 3]);
    assert.equal(new Set(SYNTHETIC_PACKAGE_CATALOG.map((entry) => entry.packageId)).size, SYNTHETIC_PACKAGE_CATALOG.length);
  });

  it("covers every catalog mutation command and the removal alias", () => {
    assert.deepEqual(new Set(PACKAGE_CATALOG_ADMIN_FIXTURES.map((fixture) => fixture.commandCode)), new Set([
      "PACKAGE_CATALOG_ADD",
      "PACKAGE_CATALOG_EDIT",
      "PACKAGE_CATALOG_REMOVE",
      "PACKAGE_CATALOG_ENABLE",
    ]));
    assert.ok(PACKAGE_CATALOG_ADMIN_FIXTURES.some((fixture) => fixture.message.startsWith("/패키지리스트제거 ")));
    assert.equal(PACKAGE_CATALOG_ADMIN_PERMISSION, "package.catalog.manage");
  });

  it("requires one outbox reply only for committed mutations", () => {
    for (const fixture of PACKAGE_CATALOG_ADMIN_FIXTURES) {
      assert.equal(fixture.expectedOutboxCount, fixture.expectedResult === "COMMITTED" ? 1 : 0, fixture.fixtureId);
      if (fixture.expectedResult !== "COMMITTED") assert.equal(fixture.expectedMutationCount, 0, fixture.fixtureId);
    }
  });

  it("keeps optimistic conflict and dispatch misses mutation-free", () => {
    const stale = PACKAGE_CATALOG_ADMIN_FIXTURES.find((fixture) => fixture.fixtureId === "STALE-VERSION");
    assert.equal(stale?.expectedVersion, 6n);
    assert.equal(stale?.expectedResult, "REJECTED");
    assert.ok(PACKAGE_CATALOG_ADMIN_FIXTURES.filter((fixture) => fixture.expectedResult === "DISPATCH_MISS").length >= 3);
  });
});
