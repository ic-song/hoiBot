import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function repoText(path: string): string {
  const text = readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
  const expected = {
    "data/miniPetData.json": "b361e9d2922a9e7997416f49e49187fd6924642a5aec8018ab68d6c8c9d2b5a7",
    "data/member_pet.json": "9366caded5be5dea9ec30a2bece5675a642844123a4dbc9dcd16ec5c56f2e1c8",
    "main.js": "91bd1c772aeb0979359ff2af86320850b77a738c1ddee295ae843ca5bcb10495"
  }[path];
  if (expected) assert.equal(createHash("sha256").update(text).digest("hex"), expected, `${path}: sealed source hash`);
  return text;
}

function repoJson<T>(path: string): T {
  return JSON.parse(repoText(path)) as T;
}

interface MiniPetRecord {
  name?: unknown;
  emoji?: unknown;
  grade?: unknown;
  [key: string]: unknown;
}

const signature = (value: MiniPetRecord): string => [value.name, value.emoji, value.grade].map(String).join("\u0000");

describe("legacy mini-pet definition binding", () => {
  it("proves the sealed ownership snapshot has no immutable definition locator", () => {
    const catalog = repoJson<{ miniPet: MiniPetRecord[] }>("data/miniPetData.json");
    const members = repoJson<Record<string, { miniPetBag?: MiniPetRecord[]; miniPet?: MiniPetRecord }>>("data/member_pet.json");
    const catalogCounts = new Map<string, number>();
    for (const definition of catalog.miniPet) {
      const key = signature(definition);
      catalogCounts.set(key, (catalogCounts.get(key) ?? 0) + 1);
    }

    let occurrences = 0;
    let missingDefinitions = 0;
    let ambiguousDefinitions = 0;
    for (const member of Object.values(members)) {
      const owned = [...(member.miniPetBag ?? []), ...(member.miniPet ? [member.miniPet] : [])];
      for (const instance of owned) {
        occurrences += 1;
        const matches = catalogCounts.get(signature(instance)) ?? 0;
        if (matches === 0) missingDefinitions += 1;
        if (matches > 1) ambiguousDefinitions += 1;
        for (const forbiddenLocator of ["mini_pet_id", "miniPetId", "definition_id", "definitionId", "catalog_index", "original_name", "original_emoji"]) {
          assert.ok(!Object.hasOwn(instance, forbiddenLocator), `sealed source unexpectedly gained ${forbiddenLocator}`);
        }
      }
    }

    assert.equal(occurrences, 3890);
    assert.equal(missingDefinitions, 239);
    assert.equal(ambiguousDefinitions, 50);
  });

  it("proves display fields are mutable and arbitrary owned mini-pets can bypass the JSON catalog", () => {
    const main = repoText("main.js");
    assert.match(main, /member\.miniPet\.name = newName/);
    assert.match(main, /member\.miniPet\.emoji = newName/);
    assert.match(main, /member\.miniPetBag\.push\(member\.miniPet\)/);
    assert.match(main, /function addMiniPetToUserBag\(petData, receiver, name, emoji, grade, price, exp\)/);
    assert.match(main, /name: name,\s+emoji: emoji,\s+grade: grade,\s+price: price,\s+battleExp: exp,\s+castleExp: exp,\s+raidExp: exp/);

    const fieldMap = repoJson<{ mappings: Array<{ domain: string; fields: Array<{ targetColumns: string[]; conversion: string }> }> }>("개발환경_고도화/migration-control/contracts/object-domain-import-field-map.v1.json");
    const miniPet = fieldMap.mappings.find((mapping) => mapping.domain === "mini-pet");
    assert.ok(miniPet);
    const ownershipRules = miniPet.fields.filter((field) => field.targetColumns.includes("canonical_owned_mini_pet_instances.mini_pet_id"));
    assert.equal(ownershipRules.length, 2);
    for (const rule of ownershipRules) {
      assert.ok(rule.targetColumns.includes("canonical_owned_mini_pet_instances.custom_name"));
      assert.ok(rule.targetColumns.includes("canonical_owned_mini_pet_instances.custom_emoji"));
      assert.match(rule.conversion, /WBS725-approved occurrence-level crosswalk/);
      assert.match(rule.conversion, /every legacy occurrence without that explicit crosswalk is quarantined, including display-exact rows/);
      assert.match(rule.conversion, /never infer a base definition/);
    }
  });
});
