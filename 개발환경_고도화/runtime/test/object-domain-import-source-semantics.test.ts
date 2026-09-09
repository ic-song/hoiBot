import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

interface LegacyTitleScope {
  title?: { list?: Array<{ name?: unknown; price?: unknown }>; num?: number | null };
}
interface LegacyMiniPetScope { miniPet?: unknown; miniPetBag?: unknown[]; }

const sealedSourceHashes: Record<string, string> = {
  "data/member_title.json": "54a85e81367785990d7329a5ea0fbb65e3d7e8d27a8dd6f2afae60a4a25dca17",
  "data/pet_title.json": "1f6f8a2f82bf8658578471112b5ec9ddceda8677a5d7e699d973ee621247319b",
  "data/miniPet_title.json": "120af95d744bb3f82fc5d3e5d5acbdbd2d70f098a9f9b4f184a87c7474f9caa6",
  "data/member_pet.json": "9366caded5be5dea9ec30a2bece5675a642844123a4dbc9dcd16ec5c56f2e1c8",
  "data/petSweetHomeInfo.json": "73c93af3f0a5d52e4539047a21ce0d08f33603275ca542974eb11f47f93b2195",
  "data/petSweetHomeData.json": "7eb6dbe671dda766fc9d500fd25bf348737e13abdcd0d7649e61e98b7c1da2b5",
  "data/freeMarket.json": "54e2d3f80b349121eef684310288d08e2115296bacdbd7900a246a1e580310d0"
};

function repoText(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

function repoJson<T>(path: string): T {
  const text = repoText(path);
  const expectedHash = sealedSourceHashes[path];
  if (expectedHash) assert.equal(createHash("sha256").update(text).digest("hex"), expectedHash, `${path}: sealed source hash`);
  return JSON.parse(text) as T;
}

describe("object domain import legacy source semantics", () => {
  it("treats title.num as a one-based ordinal and null/zero as unselected", () => {
    const sources = ["data/member_title.json", "data/pet_title.json", "data/miniPet_title.json"];
    let validSelected = 0;
    let zeroSentinels = 0;
    let outOfRange = 0;
    for (const source of sources) {
      const root = repoJson<{ member: Record<string, LegacyTitleScope> }>(source);
      for (const value of Object.values(root.member)) {
        const list = value.title?.list ?? [];
        const num = value.title?.num;
        if (num === null || num === undefined) continue;
        assert.ok(Number.isInteger(num) && num >= 0, source);
        if (num === 0) { zeroSentinels += 1; continue; }
        if (num > list.length) { outOfRange += 1; continue; }
        assert.ok(list[num - 1], source);
        validSelected += 1;
      }
    }
    assert.ok(validSelected > 0);
    assert.ok(zeroSentinels > 0);
    assert.ok(outOfRange > 0, "out-of-range selections must exercise selection-only quarantine");

    const main = repoText("main.js");
    const info = repoText("Info.js");
    assert.match(main, /usert\.title\.list\[newActiveTitleIndex - 1\]/);
    assert.match(main, /userPetTitle\.title\.list\[newActivePetTitleIndex - 1\]/);
    assert.match(main, /userTitle\.list\[titleIndex - 1\]/);
    assert.match(info, /titleList\[activeTitleNum - 1\]/);
  });

  it("preserves title list price as occurrence state instead of deriving it from the definition", () => {
    const sources = ["data/member_title.json", "data/pet_title.json", "data/miniPet_title.json"];
    const pricesByScopedName = new Map<string, Set<string>>();
    let occurrences = 0;
    for (const source of sources) {
      const root = repoJson<{ member: Record<string, LegacyTitleScope> }>(source);
      for (const value of Object.values(root.member)) {
        for (const title of value.title?.list ?? []) {
          const price = Number(title.price);
          assert.ok(Number.isSafeInteger(price) && price >= 0, `${source}: title occurrence price`);
          const key = `${source}:${String(title.name ?? "")}`;
          const values = pricesByScopedName.get(key) ?? new Set<string>();
          values.add(String(price));
          pricesByScopedName.set(key, values);
          occurrences += 1;
        }
      }
    }
    assert.ok(occurrences > 0);

    assert.ok([...pricesByScopedName.values()].some((values) => values.size > 1), "at least one title name must prove per-occurrence price variance");

    const main = repoText("main.js");
    assert.match(main, /var saleTitlePrice = titleList\[titleNumber - 1\]\.price;/);
    assert.match(main, /sellPrice = saleTitlePrice \* 0\.3;/);
    assert.match(main, /price: auctionBid/);
  });

  it("keeps the equipped mini-pet as a separate occurrence from miniPetBag", () => {
    const root = repoJson<Record<string, LegacyMiniPetScope>>("data/member_pet.json");
    let equipped = 0;
    let equippedAbsentFromBag = 0;
    let miniPetOccurrences = 0;
    let missingUpgrade = 0;
    for (const value of Object.values(root)) {
      const occurrences = [...(Array.isArray(value.miniPetBag) ? value.miniPetBag : [])];
      if (value.miniPet !== undefined && value.miniPet !== null) occurrences.push(value.miniPet);
      miniPetOccurrences += occurrences.length;
      missingUpgrade += occurrences.filter((candidate) => typeof candidate === "object" && candidate !== null && !("upgrade" in candidate)).length;
      if (value.miniPet === undefined || value.miniPet === null) continue;
      equipped += 1;
      const fingerprint = JSON.stringify(value.miniPet);
      const bag = Array.isArray(value.miniPetBag) ? value.miniPetBag : [];
      if (!bag.some((candidate) => JSON.stringify(candidate) === fingerprint)) equippedAbsentFromBag += 1;
    }
    assert.ok(equipped > 0);
    assert.equal(equippedAbsentFromBag, equipped);
    assert.equal(miniPetOccurrences, 3890);
    assert.equal(missingUpgrade, 3599);

    const main = repoText("main.js");
    assert.match(main, /let selectedPet = bag\.find\(\(p\) => p\.sortIndex === index\)/);
    assert.match(main, /bag\.splice\(removeIndex, 1\)/);
    assert.match(main, /petData\[sender\]\.miniPet = selectedPet/);
    assert.match(main, /미니펫은 한 번 장착하면 귀속됩니다/);
    assert.match(main, /member\.miniPetBag\.push\(member\.miniPet\)/);
    assert.match(main, /delete member\.miniPet/);
    assert.match(main, /if \(!mini\.upgrade\) mini\.upgrade = 0/);
  });

  it("proves furniture rate is draw probability and missing catalog fields are not inferred", () => {
    const source = repoJson<{ furniture: Array<Record<string, unknown>> }>("data/petSweetHomeInfo.json");
    assert.ok(source.furniture.length > 0);
    assert.ok(source.furniture.some((row) => Object.hasOwn(row, "rate")));
    assert.ok(source.furniture.every((row) => !Object.hasOwn(row, "purchase_price") && !Object.hasOwn(row, "charm_per_enhancement")));

    const byName = new Map<string, Set<string>>();
    for (const row of source.furniture) {
      const name = String(row.name ?? "");
      const values = byName.get(name) ?? new Set<string>();
      values.add(String(row.exp ?? ""));
      byName.set(name, values);
    }
    assert.ok([...byName.values()].some((values) => values.size > 1), "display name cannot identify the definition");

    const ownership = repoJson<Record<string, { furnitureBag?: Array<{ id?: unknown }>; placedFurniture?: Array<{ id?: unknown }> }>>("data/petSweetHomeData.json");
    const ids = new Set<string>();
    let occurrences = 0;
    for (const value of Object.values(ownership)) {
      for (const row of [...(value.furnitureBag ?? []), ...(value.placedFurniture ?? [])]) {
        const id = String(row.id ?? "");
        assert.notEqual(id, "", "legacy furniture occurrence ID is required");
        assert.ok(!ids.has(id), "legacy furniture occurrence ID must be globally unique in the sealed source");
        ids.add(id);
        occurrences += 1;
      }
    }
    assert.ok(occurrences > 0);

    const catalogSignatures = new Map<string, number>();
    for (const row of source.furniture) {
      const signature = [row.name, row.exp, row.grade].map(String).join("\u0000");
      catalogSignatures.set(signature, (catalogSignatures.get(signature) ?? 0) + 1);
    }
    assert.equal([...catalogSignatures.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0), 20);
    let ambiguousOwnedOccurrences = 0;
    let missingOwnedDefinitions = 0;
    for (const value of Object.values(ownership)) {
      for (const row of [...(value.furnitureBag ?? []), ...(value.placedFurniture ?? [])] as Array<Record<string, unknown>>) {
        const signature = [row.name, row.exp, row.grade].map(String).join("\u0000");
        const matches = catalogSignatures.get(signature) ?? 0;
        if (matches > 1) ambiguousOwnedOccurrences += 1;
        if (matches === 0) missingOwnedDefinitions += 1;
      }
    }
    assert.equal(ambiguousOwnedOccurrences, 87, "ambiguous definition references must be quarantined, never assigned arbitrarily");
    assert.equal(missingOwnedDefinitions, 1715, "missing JSON-catalog references require validated CODE_SEED resolution or quarantine");

    const boutiqueDefinitions = [
      ["부쉐론 귀걸이🔗", 41350, "부띠끄"], ["루이비통 가방🎀", 42700, "부띠끄"],
      ["까르띠에 반지💍", 44800, "부띠끄"], ["티파니 반지💍", 46550, "부띠끄"],
      ["불가리 반지🪙", 47900, "부띠끄"], ["까르띠에 탁상시계🕰️", 48700, "부띠끄"],
      ["까르띠에 목걸이⛓️", 50000, "부띠끄"]
    ];
    const boutiqueSignatures = new Set(boutiqueDefinitions.map((row) => row.map(String).join("\u0000")));
    let boutiqueOwnedOccurrences = 0;
    for (const value of Object.values(ownership)) {
      for (const row of [...(value.furnitureBag ?? []), ...(value.placedFurniture ?? [])] as Array<Record<string, unknown>>) {
        if (boutiqueSignatures.has([row.name, row.exp, row.grade].map(String).join("\u0000"))) boutiqueOwnedOccurrences += 1;
      }
    }
    assert.equal(boutiqueOwnedOccurrences, 90);

    const historicalSpec = "82a0373d3666b6afa29912ef9441273d20375266:data/petSweetHomeInfo.json";
    const historicalBytes = execFileSync("git", ["show", historicalSpec], { encoding: null, maxBuffer: 50 * 1024 * 1024 });
    assert.equal(createHash("sha256").update(historicalBytes).digest("hex"), "9aa01517393750942992547223445ad0c77f0351d4a6700c05c36bd10cc7e288");
    const historical = JSON.parse(historicalBytes.toString("utf8")) as { furniture: Array<Record<string, unknown>> };
    assert.equal(historical.furniture.length, 2447);
    const historicalCounts = new Map<string, number>();
    for (const row of historical.furniture) {
      const signature = [row.name, row.exp, row.grade].map(String).join("\u0000");
      historicalCounts.set(signature, (historicalCounts.get(signature) ?? 0) + 1);
    }
    let historicallyResolved = 0;
    const historicallyResolvedSignatures = new Set<string>();
    for (const value of Object.values(ownership)) {
      for (const row of [...(value.furnitureBag ?? []), ...(value.placedFurniture ?? [])] as Array<Record<string, unknown>>) {
        const signature = [row.name, row.exp, row.grade].map(String).join("\u0000");
        if ((catalogSignatures.get(signature) ?? 0) === 0 && historicalCounts.get(signature) === 1) {
          historicallyResolved += 1;
          historicallyResolvedSignatures.add(signature);
        }
      }
    }
    assert.equal(historicallyResolved, 326);
    assert.equal(historicallyResolvedSignatures.size, 235);

    const furnitureMigration = repoText("개발환경_고도화/runtime/migrations/445_object_furniture_home_canonical_model.sql");
    assert.match(furnitureMigration, /ownership_status IN \('bag','placed','listed','sold','removed'\)/);

    const main = repoText("main.js");
    assert.match(main, /map\[g\] = Number\(item\.rate\) \|\| 0/);
    assert.match(main, /var r = Math\.random\(\) \* total/);
    assert.match(main, /acc \+= Number\(gradeRates\[j\]\.rate\)/);
    for (const [name, exp, grade] of boutiqueDefinitions) {
      assert.match(main, new RegExp(`name: "${String(name)}"[\\s\\S]{0,80}exp: ${String(exp)}[\\s\\S]{0,80}grade: "${String(grade)}"`));
    }

    const market = repoJson<{ listings?: Array<{ status?: unknown }> }>("data/freeMarket.json");
    const activeListings = market.listings ?? [];
    assert.ok(activeListings.length > 0);
    assert.ok(activeListings.every((listing) => listing.status === "SELLING"));
    assert.match(main, /listing\.status !== "SELLING"/);
  });

  it("maps every homeInfo.required item into a target-floor building-upgrade recipe", () => {
    const source = repoJson<{ homeInfo: Array<{ floor?: unknown; required?: Array<{ item?: unknown; count?: unknown }> }> }>("data/petSweetHomeInfo.json");
    assert.ok(source.homeInfo.length > 0);
    let inputs = 0;
    const indicesByFloor = new Map<string, number[]>();
    for (let index = 0; index < source.homeInfo.length; index += 1) {
      const row = source.homeInfo[index]!;
      const indices = indicesByFloor.get(String(row.floor)) ?? [];
      indices.push(index);
      indicesByFloor.set(String(row.floor), indices);
      assert.ok(Array.isArray(row.required));
      for (const required of row.required ?? []) {
        assert.notEqual(String(required.item ?? ""), "");
        assert.ok(Number.isInteger(required.count) && Number(required.count) > 0);
        inputs += 1;
      }
    }
    assert.ok(inputs > 0);
    const duplicateFloors = [...indicesByFloor.values()].filter((indices) => indices.length > 1);
    assert.ok(duplicateFloors.length > 0, "sealed source must exercise first-match duplicate-floor policy");
    const main = repoText("main.js");
    assert.match(main, /let required = nextInfo\.required \|\| \[\]/);
    assert.match(main, /hasItem\(data, sender, need\.item, need\.count\)/);
    assert.match(main, /removeItem\(data, sender, need\.item, need\.count\)/);
    assert.match(main, /for \(var i = 0; i < homeInfo\.homeInfo\.length; i\+\+\) \{\s*if \(homeInfo\.homeInfo\[i\]\.floor == target\) return homeInfo\.homeInfo\[i\]/);
  });
});
