import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { describe, it } from "node:test";

interface PetSkillRow {
  sourceIndex: number;
  sourceKey: string;
  objectKey: string;
  definitionCode: string;
  reusedExisting: boolean;
  source: {
    name: string;
    grade: string;
    rate: number;
    fixedRate?: boolean;
    tierExclusive?: boolean;
  };
}

const rows = JSON.parse(
  fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-skill-definitions-v2400.json", import.meta.url), "utf8")
) as PetSkillRow[];

describe("pet skill definition catalog v2.400", () => {
  it("preserves all 90 source rows and the frozen source hash", () => {
    const hash = crypto.createHash("sha256").update(JSON.stringify(rows.map((row) => row.source))).digest("hex");
    assert.equal(rows.length, 90);
    assert.equal(hash, "595370c8495ca8901412b892b022faf7493d20eddd8dcc4f4849fea72d777a0f");
    assert.equal(new Set(rows.map((row) => row.source.name)).size, 90);
  });

  it("keeps stable source keys, object keys, and definition identities", () => {
    assert.equal(new Set(rows.map((row) => row.sourceKey)).size, 90);
    assert.equal(new Set(rows.map((row) => row.objectKey)).size, 90);
    assert.equal(new Set(rows.map((row) => row.definitionCode)).size, 90);
    rows.forEach((row, index) => {
      const pad = String(index).padStart(3, "0");
      assert.equal(row.sourceIndex, index);
      assert.equal(row.sourceKey, "skill_" + pad);
      assert.equal(row.objectKey, "skill.pet_skill_" + pad);
    });
  });

  it("preserves frozen grade, normal, tier, fixed-rate, and rate totals", () => {
    const grades = new Map<string, number>();
    let normalRate = 0;
    for (const row of rows) {
      grades.set(row.source.grade, (grades.get(row.source.grade) ?? 0) + 1);
      if (!row.source.tierExclusive) normalRate += row.source.rate;
    }
    assert.deepEqual(Object.fromEntries(grades), { S: 18, SS: 3, A: 23, B: 19, C: 21, D: 6 });
    assert.equal(rows.filter((row) => !row.source.tierExclusive).length, 60);
    assert.equal(rows.filter((row) => row.source.tierExclusive).length, 30);
    assert.equal(rows.filter((row) => row.source.fixedRate).length, 8);
    assert.ok(Math.abs(normalRate - 198.4) < 0.000001);
  });

  it("reuses exactly 15 definitions and separates pet skill from trial identities", () => {
    assert.equal(rows.filter((row) => row.reusedExisting).length, 15);
    assert.equal(rows.filter((row) => !row.reusedExisting).length, 75);
    assert.equal(rows.find((row) => row.source.name === "십원")?.definitionCode, "pet_skill_ten_won");
    assert.equal(rows.find((row) => row.source.name === "구원")?.definitionCode, "pet_skill_salvation");
    assert.equal(rows.some((row) => row.definitionCode === "trial_ten_won"), false);
    assert.equal(rows.some((row) => row.definitionCode === "trial_salvation"), false);
  });
});
