import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { describe, it } from "node:test";

interface MiniPetDefinitionRow {
  sourceIndex: number;
  sourceKey: string;
  canonicalCode: string;
  compatibilityCode: string;
  name: string;
  emoji: string;
  plusGradeCode: string | null;
  gradeDisplayName: string;
  drawEligible: boolean;
  elite: boolean;
  definitionReused: boolean;
  bindingStrategy: "MINI_PET_DEFINITION_SOURCE_BINDING";
  objectCatalogType: null;
  sourceHash: string;
}

const rows = JSON.parse(fs.readFileSync(
  new URL("../../migration-control/fixtures/synthetic-relational/minipet-definition-crosswalk-v1.json", import.meta.url),
  "utf8"
)) as MiniPetDefinitionRow[];
const migration = fs.readFileSync(new URL("../migrations/392_minipet_definition_catalog_normalization.sql", import.meta.url), "utf8");
const sha256 = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");

describe("mini-pet definition catalog normalization", () => {
  it("freezes all 1,078 source rows and source-row identities", () => {
    assert.equal(rows.length, 1078);
    assert.equal(new Set(rows.map((row) => row.sourceKey)).size, 1078);
    assert.equal(rows[0]?.sourceKey, "source-row-0001");
    assert.equal(rows[1077]?.sourceKey, "source-row-1078");
    assert.ok(rows.every((row) => row.sourceHash === "7fd91bacee010ec3c4623ca34ddb92f647e7f30fa1d71a764eb38e320b79f644"));
  });

  it("uses the frozen canonical mapping without collapsing duplicate names", () => {
    assert.equal(new Set(rows.map((row) => row.canonicalCode)).size, 1078);
    assert.equal(new Set(rows.map((row) => `${row.name}\t${row.gradeDisplayName}`)).size, 1055);
    assert.equal(rows.filter((row) => row.definitionReused).length, 1078);
    assert.equal(rows[1065]?.canonicalCode, "ITEM-MINIPET-CATALOG-1066");
    assert.equal(rows[1066]?.canonicalCode, "elite-combine-01");
    assert.equal(rows[1077]?.canonicalCode, "elite-combine-12");
    assert.equal(
      sha256(rows.map((row) => `${row.sourceIndex}\t${row.canonicalCode}`).join("\n")),
      "bf7019c2eb619947994bde524be2fd2c8f40a5d8f9d19a0771028ad59f36f9bf"
    );
  });

  it("keeps exact source grade display names and isolates three plus grades", () => {
    assert.deepEqual([...new Set(rows.filter((row) => row.plusGradeCode !== null).map((row) => row.gradeDisplayName))].sort(), ["신화+", "전설+", "초월+"].sort());
    assert.ok(rows.filter((row) => row.gradeDisplayName === "전설+").every((row) => row.plusGradeCode === "legendary_plus"));
    assert.ok(rows.filter((row) => row.gradeDisplayName === "신화+").every((row) => row.plusGradeCode === "mythic_plus"));
    assert.ok(rows.filter((row) => row.gradeDisplayName === "초월+").every((row) => row.plusGradeCode === "transcendent_plus"));
    assert.ok(rows.filter((row) => ["희귀", "영웅"].includes(row.gradeDisplayName)).every((row) => row.plusGradeCode === null));
  });

  it("separates definition identity from draw membership and elite combine", () => {
    assert.equal(rows.filter((row) => row.drawEligible).length, 1066);
    assert.equal(rows.filter((row) => row.elite).length, 12);
    assert.ok(rows.slice(0, 1066).every((row) => row.canonicalCode === row.compatibilityCode));
    assert.ok(rows.slice(1066).every((row) => row.canonicalCode !== row.compatibilityCode));
  });

  it("uses a mini-pet definition binding without mislabelling PET objects", () => {
    assert.ok(rows.every((row) => row.bindingStrategy === "MINI_PET_DEFINITION_SOURCE_BINDING"));
    assert.ok(rows.every((row) => row.objectCatalogType === null));
    assert.match(migration, /CREATE TABLE IF NOT EXISTS mini_pet_definition_source_bindings/);
    assert.doesNotMatch(migration, /\bobject_(?:registry|aliases|source_bindings)\b/i);
    assert.doesNotMatch(migration, /['"]PET['"]/);
  });

  it("limits migration 392 to definitions, plus grades, and source bindings", () => {
    assert.equal((migration.match(/^\(\d+,'source-row-\d{4}',/gm) ?? []).length, 1078);
    assert.doesNotMatch(migration, /INSERT\s+INTO\s+mini_pet_definitions/i);
    assert.doesNotMatch(migration, /^\s*(?:DELETE|TRUNCATE)\b/im);
    assert.doesNotMatch(migration, /\bdynamic_item_catalog_entries\b/i);
    assert.doesNotMatch(migration, /\bowned_mini_pets\b/i);
    assert.doesNotMatch(migration, /\b(?:inventory_ledger|mini_pet_upgrade|mini_pet_equip)\b/i);
    assert.doesNotMatch(migration, /\bpackage_(?:catalog|item_definitions|reward_rules|contents|rewards)\b/i);
    assert.match(migration, /COALESCE\(source_row\.plus_grade_code,definition_row\.grade_code\)/);
  });
});
