import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const migration = new URL("../migrations/441_asset_catalog_compatibility_reference_correction.sql", import.meta.url);
const exporter = new URL("../scripts/export-canonical-asset-reference-snapshot.ts", import.meta.url);

describe("asset catalog compatibility reference correction", () => {
  it("seeds the seventh frozen support pass without another pass model", async () => {
    const sql = await readFile(migration, "utf8");
    assert.match(sql, /INSERT INTO support_pass_definitions/);
    assert.match(sql, /'territory','영지패스',TRUE/);
    assert.doesNotMatch(sql, /CREATE TABLE/);
  });

  it("projects source and runtime package definitions into one typed snapshot identity", async () => {
    const source = await readFile(exporter, "utf8");
    assert.match(source, /asset_package_source_definitions/);
    assert.match(source, /package_catalog/);
    assert.match(source, /PACKAGE_DEFINITION/);
    assert.match(source, /packageEntries\.set/);
    assert.doesNotMatch(source, /INSERT INTO|UPDATE package_catalog|DELETE FROM/);
  });

  it("projects legacy mini-pet stat signatures without writing catalog data", async () => {
    const source = await readFile(exporter, "utf8");
    assert.match(source, /package_item_definitions WHERE item_type='MINI_PET'/);
    assert.match(source, /legacyStatSignature/);
    assert.match(source, /battle:\$\{String\(battle\)\}\|castle:/);
    assert.doesNotMatch(source, /UPDATE package_item_definitions|INSERT INTO package_item_definitions/);
  });
});
