import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { AdminAssetCatalogReadModel } from "../src/admin/asset-catalog-read-model.js";
import { MariaObjectCatalogRepository } from "../src/catalog/maria-object-catalog-repository.js";
import { ObjectCatalogService } from "../src/catalog/object-catalog.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { OBJECT_CATALOG_WEB_FIXTURE, seedObjectCatalogWebFixture } from "./fixtures/object-catalog-web-adapter.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true" && process.env.ASSET_CATALOG_MANAGEMENT_SHADOW_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "shadow-not-configured";

describe("admin asset catalog management MariaDB Shadow", { skip: !enabled }, () => {
  let database: DatabaseClient;
  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 4, connectTimeoutMs: 5_000 });
    await seedObjectCatalogWebFixture(database);
    await new ObjectCatalogService(new MariaObjectCatalogRepository(database)).register({ operationId: "asset-catalog-management-shadow-register", objectKey: OBJECT_CATALOG_WEB_FIXTURE.objectKey, objectType: "CURRENCY", displayName: "Lease2373 관리 크레딧", sourceBindings: [{ system: "RUNTIME_DB", table: "currency_definitions", key: OBJECT_CATALOG_WEB_FIXTURE.currencyCode }] });
  });
  after(async () => { if (database) await database.close(); });

  it("reads canonical domains, source bindings, and effective package gaps without mutation", async () => {
    const before = (await database.query<Array<{ changes: bigint }>>("SELECT COUNT(*) changes FROM object_catalog_change_log"))[0]!.changes;
    const catalog = await new AdminAssetCatalogReadModel(database).read({ query: "lease2373", objectType: "CURRENCY", active: true, page: 1, limit: 25 });
    const after = (await database.query<Array<{ changes: bigint }>>("SELECT COUNT(*) changes FROM object_catalog_change_log"))[0]!.changes;
    assert.equal(catalog.total >= 1, true);
    assert.equal(catalog.items[0]!.sourceBindings.some((binding) => binding.table === "currency_definitions"), true);
    assert.equal(catalog.domains.some((domain) => domain.domain === "PASS" && domain.canonicalTable === "support_pass_definitions"), true);
    assert.deepEqual([catalog.packageResolution?.frozenResolved, catalog.packageResolution?.overlayResolved, catalog.packageResolution?.effectiveResolved], [467, 10, 477]);
    assert.deepEqual([catalog.packageResolution?.residualStackGaps, catalog.packageResolution?.residualPackageGaps, catalog.packageResolution?.conflicts], [36, 44, 0]);
    assert.equal(after, before);
  });
});
