import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const EXACT_NAME = "레이드타격대인장👑(+600👾)";
const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const json = <T>(path: string): T => JSON.parse(read(path)) as T;

function countHomeRequirements(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((count, entry) => count + countHomeRequirements(entry), 0);
  if (typeof value !== "object" || value === null) return 0;
  const row = value as Record<string, unknown>;
  let count = row.item === EXACT_NAME ? 1 : 0;
  for (const entry of Object.values(row)) count += countHomeRequirements(entry);
  return count;
}

describe("item25 raid strike seal exact consumer parity", () => {
  it("keeps the sealed pointer, payload, owner totals and generic ownership authority", () => {
    const itemInfo = json<{ raidSpecialItem: { dept2: { item_0: { name: string; exp: number } } } }>("data/itemInfo.json");
    assert.deepEqual(itemInfo.raidSpecialItem.dept2.item_0, { name: EXACT_NAME, exp: 600 });

    const audit = json<{ raidDept2: Record<string, unknown> }>(
      "개발환경_고도화/migration-control/evidence/item25-raid-territory-source-audit-lease2562-2563/audit.json"
    ).raidDept2;
    assert.deepEqual(
      [audit.pointer, audit.locatorSha256, audit.payloadSha256, audit.memberOwnerCount, audit.memberTotalQuantity],
      ["/raidSpecialItem/dept2/item_0", "064bcb1971ffce549b2d5f00810b58d3bcc0bec937d89b5bb232f40037c9f8bf",
        "77cb001679d3e915622e91a872848c4c53b388479d4c88ca68760361e18c6ee9", 308, 7342]
    );
  });

  it("keeps package, tower and all 140 home requirement occurrences", () => {
    const main = read("main.js");
    assert.match(main, /"레이드타격대인장👑\(\+600👾\)": 1/);
    const tower = json<Array<{ reward: Array<{ item?: string; quantity?: number }> }>>("data/trialTowerBoss.json");
    assert.deepEqual(tower[0]?.reward[15], { item: EXACT_NAME, quantity: 10 });
    assert.equal(countHomeRequirements(json<unknown>("data/petSweetHomeInfo.json")), 140);
  });

  it("keeps both legacy charm readers as bag count multiplied by catalog exp", () => {
    for (const path of ["main.js", "Info.js"]) {
      const source = read(path);
      assert.match(source, /raidSpecialItem\.dept2/);
      assert.match(source, /(?:returnObject\.)?raidExp \+= count \* item\.exp/);
    }
  });

  it("uses exact canonical identity and generic canonical ownership for crafting", () => {
    const source = read("개발환경_고도화/runtime/src/raid/raid-strike-seal-craft-service.ts")
      + read("개발환경_고도화/runtime/src/raid/raid-strike-seal-canonical-ownership-provider.ts");
    for (const required of ["/raidSpecialItem/dept2/item_0", "064bcb1971ffce549b2d5f00810b58d3bcc0bec937d89b5bb232f40037c9f8bf",
      "77cb001679d3e915622e91a872848c4c53b388479d4c88ca68760361e18c6ee9", "CanonicalItemInventoryRepository",
      "canonical_player_identity_crosswalks", "object_identity_crosswalks", "definition.active_flag=TRUE", "assertItem25CanonicalDefinitionOptions"]) {
      assert.ok(source.includes(required), required);
    }
    assert.doesNotMatch(source, /legacy-raid-strike-seal-600/);
  });

  it("routes the existing package, tower and modern charm consumers through one ownership provider", () => {
    const packageSource=read("개발환경_고도화/runtime/src/package/domain-item-provider.ts");
    const towerSource=read("개발환경_고도화/runtime/src/trial/trial-tower-provider.ts");
    const charmSource=read("개발환경_고도화/runtime/src/raid/raid-charm-ranking-read-service.ts");
    const homeSource=read("개발환경_고도화/runtime/src/crafting/maria-canonical-building-recipe-repository.ts");
    for(const source of [packageSource,towerSource,charmSource])assert.match(source,/RaidStrikeSealCanonicalOwnershipProvider/);
    assert.match(packageSource,/raidSealOwnership\.change/);
    assert.match(towerSource,/raidSealOwnership\.change/);
    assert.match(charmSource,/raidSealOwnership\.charmByLegacyPlayer/);
    assert.match(charmSource,/department_code='dept2'[\s\S]*source_item_key='item_0'/);
    assert.match(homeSource,/canonical_owned_item_stacks WHERE player_id=\? AND item_id=\?/);
  });
});
