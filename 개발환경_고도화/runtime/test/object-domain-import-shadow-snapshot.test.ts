import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../../../", import.meta.url);
const files = [
  "data/member.json", "data/itemInfo.json", "data/itemList.json", "data/member_pet.json",
  "data/miniPetData.json", "data/petSweetHomeInfo.json", "data/petSweetHomeData.json",
  "data/freeMarket.json", "data/member_title.json", "data/pet_title.json",
  "data/miniPet_title.json", "data/petSkillData.json", "data/packageInfo.json"
] as const;
const bytes = (path: string): Buffer => readFileSync(new URL(path, root));
const sha = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");
const signature = (row: Record<string, unknown>): string => [row.name, row.exp, row.grade].map(String).join("\u0000");
const miniSignature = (row: Record<string, unknown>): string => [row.name, row.emoji, row.grade].map(String).join("\u0000");

describe("WBS742 Gate 7 read-only production-like snapshot inventory", () => {
  it("seals sources and classifies only aggregate unique-candidate/quarantine/ambiguous outcomes", () => {
    const before = Object.fromEntries(files.map((path) => [path, sha(bytes(path))]));
    for (const path of files) JSON.parse(bytes(path).toString("utf8"));

    const furnitureCatalog = JSON.parse(bytes("data/petSweetHomeInfo.json").toString("utf8")) as { furniture: Array<Record<string, unknown>> };
    const furnitureOwners = JSON.parse(bytes("data/petSweetHomeData.json").toString("utf8")) as Record<string, { furnitureBag?: Array<Record<string, unknown>>; placedFurniture?: Array<Record<string, unknown>> }>;
    const furnitureCounts = new Map<string, number>();
    for (const row of furnitureCatalog.furniture) furnitureCounts.set(signature(row), (furnitureCounts.get(signature(row)) ?? 0) + 1);
    let furnitureResolved = 0, furnitureMissing = 0, furnitureAmbiguous = 0;
    for (const owner of Object.values(furnitureOwners)) for (const row of [...(owner.furnitureBag ?? []), ...(owner.placedFurniture ?? [])]) {
      const count = furnitureCounts.get(signature(row)) ?? 0;
      if (count === 1) furnitureResolved += 1;
      else if (count === 0) furnitureMissing += 1;
      else furnitureAmbiguous += 1;
    }

    const miniCatalog = JSON.parse(bytes("data/miniPetData.json").toString("utf8")) as { miniPet: Array<Record<string, unknown>> };
    const miniOwners = JSON.parse(bytes("data/member_pet.json").toString("utf8")) as Record<string, { miniPetBag?: Array<Record<string, unknown>>; miniPet?: Record<string, unknown> }>;
    const miniCounts = new Map<string, number>();
    for (const row of miniCatalog.miniPet) miniCounts.set(miniSignature(row), (miniCounts.get(miniSignature(row)) ?? 0) + 1);
    let miniResolved = 0, miniMissing = 0, miniAmbiguous = 0;
    for (const owner of Object.values(miniOwners)) for (const row of [...(owner.miniPetBag ?? []), ...(owner.miniPet ? [owner.miniPet] : [])]) {
      const count = miniCounts.get(miniSignature(row)) ?? 0;
      if (count === 1) miniResolved += 1;
      else if (count === 0) miniMissing += 1;
      else miniAmbiguous += 1;
    }

    assert.deepEqual({ uniqueCandidate: furnitureResolved, quarantineMissing: furnitureMissing, quarantineAmbiguous: furnitureAmbiguous }, { uniqueCandidate: 3525, quarantineMissing: 1715, quarantineAmbiguous: 87 });
    assert.deepEqual({ uniqueCandidate: miniResolved, quarantineMissing: miniMissing, quarantineAmbiguous: miniAmbiguous }, { uniqueCandidate: 3601, quarantineMissing: 239, quarantineAmbiguous: 50 });
    const after = Object.fromEntries(files.map((path) => [path, sha(bytes(path))]));
    assert.deepEqual(after, before, "snapshot bytes changed during read-only inventory");
    const inventorySha256 = sha(JSON.stringify({ sourceHashes: Object.entries(before).sort(), furniture: [furnitureResolved, furnitureMissing, furnitureAmbiguous], miniPet: [miniResolved, miniMissing, miniAmbiguous] }));
    process.stdout.write(`GATE7_SNAPSHOT_INVENTORY ${JSON.stringify({ sourceFileCount: files.length, sourceAggregateSha256: sha(JSON.stringify(Object.entries(before).sort())), inventorySha256, furniture: { uniqueCandidate: furnitureResolved, quarantineMissing: furnitureMissing, quarantineAmbiguous: furnitureAmbiguous }, miniPet: { uniqueCandidate: miniResolved, quarantineMissing: miniMissing, quarantineAmbiguous: miniAmbiguous }, sourceBytesUnchanged: true, approvedProjectRows: 0 })}\n`);
  });
});
