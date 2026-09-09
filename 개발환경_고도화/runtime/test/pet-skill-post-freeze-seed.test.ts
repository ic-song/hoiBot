import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { describe, it } from "node:test";

interface SkillSource {
  name: string;
  grade: string;
  rate?: number;
  [key: string]: unknown;
}

interface BaselineRow {
  definitionCode: string;
  source: SkillSource;
}

interface AdditionRow {
  sourceIndex: number;
  runtimeSourceIndex: number;
  sourceKey: string;
  objectKey: string;
  definitionCode: string;
  reusedExisting: boolean;
  source: SkillSource;
}

interface AdditionFixture {
  catalogVersion: string;
  sourceRef: string;
  sourceHash: string;
  baselineHash: string;
  commentedBacklog: string[];
  rows: AdditionRow[];
}

const baseline = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-skill-definitions-v2400.json", import.meta.url), "utf8")) as BaselineRow[];
const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-skill-post-freeze-v2435.json", import.meta.url), "utf8")) as AdditionFixture;
const migration = fs.readFileSync(new URL("../migrations/408_pet_skill_post_freeze_seed.sql", import.meta.url), "utf8");

// 객체 배열의 결정적 SHA-256 해시를 반환한다.
function sourceHash(rows: SkillSource[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

describe("post-freeze pet skill seed", () => {
  it("preserves the frozen 90 and reconstructs the exact active 93 source", () => {
    assert.equal(baseline.length, 90);
    assert.equal(sourceHash(baseline.map((row) => row.source)), fixture.baselineHash);
    const current = baseline.map((row) => row.source);
    for (const row of [...fixture.rows].sort((a, b) => a.runtimeSourceIndex - b.runtimeSourceIndex)) {
      current.splice(row.runtimeSourceIndex, 0, row.source);
    }
    assert.equal(current.length, 93);
    assert.equal(sourceHash(current), fixture.sourceHash);
    assert.equal(fixture.sourceHash, "435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176");
  });

  it("freezes three append-only stable identities without name-only merging", () => {
    assert.deepEqual(fixture.rows.map((row) => row.source.name), ["전설의 몽둥이", "무쌍귀신", "무쌍신화"]);
    assert.deepEqual(fixture.rows.map((row) => row.sourceIndex), [90, 91, 92]);
    assert.deepEqual(fixture.rows.map((row) => row.runtimeSourceIndex), [0, 29, 41]);
    assert.deepEqual(fixture.rows.map((row) => row.sourceKey), ["skill_090", "skill_091", "skill_092"]);
    assert.deepEqual(fixture.rows.map((row) => row.objectKey), ["skill.pet_skill_090", "skill.pet_skill_091", "skill.pet_skill_092"]);
    assert.deepEqual(fixture.rows.map((row) => row.definitionCode), ["pet_skill_legendary_club", "pet_skill_musou_ghost", "pet_skill_musou_myth"]);
    assert.equal(new Set([...baseline.map((row) => row.definitionCode), ...fixture.rows.map((row) => row.definitionCode)]).size, 93);
  });

  it("keeps the commented backlog inactive and preserves ten-won/salvation separation", () => {
    const activeNames = new Set([...baseline.map((row) => row.source.name), ...fixture.rows.map((row) => row.source.name)]);
    assert.deepEqual(fixture.commentedBacklog, ["길드의 심장", "기사도", "야호", "성실한 일꾼"]);
    fixture.commentedBacklog.forEach((name) => assert.equal(activeNames.has(name), false));
    assert.equal(baseline.find((row) => row.source.name === "십원")?.definitionCode, "pet_skill_ten_won");
    assert.equal(baseline.find((row) => row.source.name === "구원")?.definitionCode, "pet_skill_salvation");
  });

  it("seeds only the three additions through existing tables", () => {
    fixture.rows.forEach((row) => {
      assert.match(migration, new RegExp(row.definitionCode));
      assert.match(migration, new RegExp(row.objectKey.replaceAll(".", "\\.")));
      assert.match(migration, new RegExp(row.sourceKey));
    });
    fixture.commentedBacklog.forEach((name) => assert.equal(migration.includes(name), false));
    assert.equal((migration.match(/INSERT INTO skill_definitions/g) ?? []).length, 3);
    assert.equal((migration.match(/INSERT INTO object_registry/g) ?? []).length, 3);
    assert.equal(migration.includes("CREATE TABLE"), false);
    assert.equal(migration.includes("ALTER TABLE"), false);
  });

  it("replays only identical stable identities and fails closed on collisions", () => {
    assert.equal(migration.includes("INSERT IGNORE"), false);
    assert.equal((migration.match(/code = IF\(/g) ?? []).length, 3);
    assert.equal((migration.match(/object_key = IF\(/g) ?? []).length, 3);
    assert.equal((migration.match(/object_id = IF\(/g) ?? []).length, 6);
    assert.equal((migration.match(/object_aliases\.object_id = VALUES\(object_id\)/g) ?? []).length, 3);
    assert.equal((migration.match(/object_source_bindings\.object_id = VALUES\(object_id\)/g) ?? []).length, 3);
    assert.equal((migration.match(/AND JSON_EXTRACT\(rules_json, '\$\.catalog'\) = JSON_EXTRACT/g) ?? []).length, 3);
    assert.equal((migration.match(/AND JSON_EXTRACT\(metadata_json, '\$'\) = JSON_EXTRACT/g) ?? []).length, 3);
  });
});
