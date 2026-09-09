import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sourcePath = path.join(repoRoot, "data/petSweetHomeInfo.json");
const fixturePath = path.join(repoRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/home-building-definition-crosswalk-v1.json");
const migrationPath = path.join(repoRoot, "개발환경_고도화/runtime/migrations/395_home_building_definition_catalog.sql");
const rollbackPath = path.join(repoRoot, "개발환경_고도화/migration-control/rollback/395_home_building_definition_catalog.sql");
const raw = fs.readFileSync(sourcePath);
const source = JSON.parse(raw.toString("utf8")).homeInfo;
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const migration = fs.readFileSync(migrationPath, "utf8");
const rollback = fs.readFileSync(rollbackPath, "utf8");

describe("home building definition catalog", () => {
  it("pins the exact 300-row legacy source", () => {
    assert.equal(source.length, 300);
    assert.equal(crypto.createHash("sha256").update(raw).digest("hex"), "73c93af3f0a5d52e4539047a21ce0d08f33603275ca542974eb11f47f93b2195");
  });

  it("maps 300 source rows to 299 canonical definitions", () => {
    assert.equal(fixture.length, 300);
    assert.equal(new Set(fixture.map((row: { definitionCode: string }) => row.definitionCode)).size, 299);
  });

  it("keeps both floor 190 rows as distinct definitions", () => {
    const rows = fixture.filter((row: { floor: number }) => row.floor === 190);
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map((row: { definitionCode: string }) => row.definitionCode)).size, 2);
  });

  it("shares one definition for exact duplicate source rows 262 and 263", () => {
    const rows = fixture.filter((row: { sourceIndex: number }) => row.sourceIndex === 262 || row.sourceIndex === 263);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].floor, 263);
    assert.equal(rows[0].definitionCode, rows[1].definitionCode);
    assert.equal(rows[0].sourceRowHash, rows[1].sourceRowHash);
  });

  it("preserves exact progression and recipe values", () => {
    fixture.forEach((row: { sourceIndex: number; floor: number; exp: number; required: unknown }) => {
      const legacy = source[row.sourceIndex - 1];
      assert.equal(row.floor, Number(legacy.floor));
      assert.equal(row.exp, Number(legacy.exp));
      assert.deepEqual(row.required, legacy.required ?? []);
    });
  });

  it("uses existing object bindings without creating recipe items", () => {
    assert.match(migration, /'HOME_BUILDING','LEGACY_JSON','petSweetHomeInfo\.homeInfo'/);
    assert.doesNotMatch(migration, /INSERT\s+INTO\s+item_definitions/i);
    assert.doesNotMatch(migration, /UPDATE\s+item_definitions/i);
  });

  it("is idempotent, reversible, and excludes protected consumers", () => {
    assert.match(migration, /ON DUPLICATE KEY UPDATE/g);
    assert.match(rollback, /DROP TABLE IF EXISTS home_building_progression/);
    for (const protectedTable of ["player_homes", "owned_furniture", "furniture_inventory_instances", "furniture_placements", "inventory_stacks", "inventory_ledger", "currency_ledger"]) {
      assert.doesNotMatch(migration, new RegExp(`(?:INSERT|UPDATE|DELETE)[\\s\\S]{0,40}${protectedTable}`, "i"));
    }
  });
});
