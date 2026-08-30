import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { describe, it } from "node:test";

interface DirectBagRow {
  sourceIndex: number;
  sourceKey: string;
  objectKey: string;
  definitionCode: string;
  definitionDisplayName: string;
  legacyName: string;
  occurrenceCount: number;
  sourceLines: number[];
  sourceHash: string;
  reusedExisting: boolean;
  definitionActive: boolean;
  displayDrift: boolean;
  ownershipModel: "STACK";
}

const rows = JSON.parse(fs.readFileSync(
  new URL("../../migration-control/fixtures/synthetic-relational/direct-bag-stack-crosswalk-v1.json", import.meta.url),
  "utf8"
)) as DirectBagRow[];
const migration = fs.readFileSync(new URL("../migrations/391_direct_bag_stack_definition_seed.sql", import.meta.url), "utf8");

const sha256 = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");

describe("direct bag stack catalog", () => {
  it("freezes all 182 exact legacy keys and 689 source occurrences", () => {
    assert.equal(rows.length, 182);
    assert.equal(rows.reduce((sum, row) => sum + row.occurrenceCount, 0), 689);
    assert.equal(new Set(rows.map((row) => row.legacyName)).size, 182);
    assert.equal(sha256(rows.map((row) => row.legacyName).sort().join("\n")), "10b21ddf32092b4b2c4450664694644f89bcb9991bc0bae436d9582fcad13d6a");
    rows.forEach((row) => assert.equal(row.occurrenceCount, row.sourceLines.length));
  });

  it("reuses 66 semantic identities and creates 116 collision-free stable codes", () => {
    assert.equal(rows.filter((row) => row.reusedExisting).length, 66);
    assert.equal(rows.filter((row) => !row.reusedExisting).length, 116);
    assert.equal(new Set(rows.map((row) => row.definitionCode)).size, 182);
    assert.equal(new Set(rows.map((row) => row.objectKey)).size, 182);
    for (const row of rows.filter((candidate) => !candidate.reusedExisting)) {
      assert.match(row.definitionCode, /^legacy_bag_[0-9a-f]{16}$/);
      assert.equal(row.definitionCode, `legacy_bag_${sha256(row.legacyName).slice(0, 16)}`);
    }
    assert.equal(
      sha256(rows.map((row) => `${row.legacyName}\t${row.definitionCode}\t${row.reusedExisting}\t${row.definitionActive}`).join("\n")),
      "ca1b7e5a26193e9d74fdc4cd1f812489b4b5ac847a18cab0774dd2ae06aab1c7"
    );
    assert.equal(
      sha256(rows.filter((row) => !row.reusedExisting).map((row) => `${row.legacyName}\t${row.definitionCode}`).join("\n")),
      "81acd708eed3a6e7bbe86860f48793b01115df82e01254bbbf89bdca6d0d6e16"
    );
  });

  it("preserves existing active state and the one verified display drift", () => {
    const reusedRows = rows.filter((row) => row.reusedExisting);
    assert.equal(reusedRows.filter((row) => row.definitionActive).length, 32);
    assert.equal(reusedRows.filter((row) => !row.definitionActive).length, 34);
    assert.deepEqual(rows.filter((row) => row.displayDrift).map((row) => [row.legacyName, row.definitionDisplayName]), [
      ["미니펫 강화석💫", "미니펫 강화석"]
    ]);
    assert.ok(rows.every((row) => row.ownershipModel === "STACK"));
  });

  it("keeps all eleven multi-code decisions on the active canonical identity", () => {
    const expected: Record<string, string> = {
      "경찰과 도둑🚨(/삐뽀삐뽀)": "police_thief_ticket",
      "길드공헌훈장🌟(/길드공헌 숫자)": "guild_contribution_medal",
      "땅문서📜": "land_document",
      "미니펫강화석패키지💫(/미강오픈)": "mini_pet_enhance_stone_package",
      "미니펫뽑기🐹(/미니펫오픈)": "mini_pet_draw",
      "양념치킨🐔": "legacy-seasoned-chicken",
      "정령 강화석🥀": "ITEM-ELEMENTAL-UPGRADE-STONE",
      "펫 강화석⭐": "pet_enhance_stone",
      "펫던전 입장권🌋": "ITEM-PET-DUNGEON-ENTRY-TICKET",
      "펫먹이특식🥡(/특식오픈)": "pet_food_special",
      "펫먹이🍼": "pet_food"
    };
    assert.deepEqual(Object.fromEntries(rows.filter((row) => row.legacyName in expected).map((row) => [row.legacyName, row.definitionCode])), expected);
  });

  it("limits migration 391 to new definitions and object catalog bindings", () => {
    assert.equal((migration.match(/^\('legacy_bag_[0-9a-f]{16}',/gm) ?? []).length, 116);
    assert.equal((migration.match(/^\('item\.direct_bag\.[0-9a-f]{16}','ITEM',/gm) ?? []).length, 182);
    assert.match(migration, /INSERT IGNORE INTO object_aliases/);
    assert.match(migration, /INSERT IGNORE INTO object_source_bindings/);
    assert.doesNotMatch(migration, /\binventory_(?:stacks|instances|ledger)\b/i);
    assert.doesNotMatch(migration, /\bpackage_(?:catalog|item_definitions|contents|rewards)\b/i);
    assert.doesNotMatch(migration, /\b(?:DELETE|TRUNCATE)\b/i);
  });
});
