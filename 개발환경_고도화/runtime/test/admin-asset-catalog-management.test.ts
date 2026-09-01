import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ADMIN_WEB_CLIENT } from "../src/admin/web-shell-assets.js";
import { buildSyntheticAdminWebShellApp } from "./support/admin-web-shell-preview.js";

describe("admin asset catalog management", () => {
  it("renders unified domain, source, availability, version, and package gap controls", () => {
    for (const value of ["자산 카탈로그", "canonicalTable", "sourceBindings", "objectCatalogType", "effectiveResolved", "residualStackGaps", "residualPackageGaps", "catalogVersion"]) assert.match(ADMIN_WEB_CLIENT, new RegExp(value));
    assert.match(ADMIN_WEB_CLIENT, /object-catalog\/objects\?/);
  });

  it("filters assets and preserves frozen plus overlay package parity", async () => {
    const app = await buildSyntheticAdminWebShellApp();
    try {
      await app.inject({ method: "POST", url: "/api/v1/admin/sessions", payload: { loginId: "shadow.manager", password: "synthetic" } });
      const response = await app.inject({ method: "GET", url: "/api/v1/admin/object-catalog/objects?query=credit&objectType=CURRENCY&active=true&page=1&limit=25" });
      assert.equal(response.statusCode, 200);
      const catalog = response.json().catalog;
      assert.equal(catalog.total, 1);
      assert.equal(catalog.items[0].sourceBindings[0].table, "currency_definitions");
      assert.equal(catalog.domains.find((domain: { domain: string }) => domain.domain === "PASS").count, 7);
      assert.deepEqual([catalog.packageResolution.frozenResolved, catalog.packageResolution.overlayResolved, catalog.packageResolution.effectiveResolved], [467, 10, 477]);
      assert.deepEqual([catalog.packageResolution.residualStackGaps, catalog.packageResolution.residualPackageGaps, catalog.packageResolution.conflicts], [36, 44, 0]);
    } finally { await app.close(); }
  });
});
