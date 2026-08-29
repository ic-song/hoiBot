import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

type Definition = {
  ordinal: number; badge_code: string; source_code: string; grade_code: string | null;
  emoji_value: string; display_name: string; detail_text: string;
  criteria_json: unknown; required_badge_codes_json: unknown;
};
type Fixture = {
  versionId: string; versionKey: string; contentHash: string;
  counts: Record<string, number>; definitions: Definition[];
};
type VersionRow = { id: bigint; version_key: string; content_hash: string; status: string };
type DefinitionRow = Definition & { definition_version_id: bigint };

const fixture = JSON.parse(readFileSync(new URL(
  "../../migration-control/evidence/home-badge-inventory/v2400-home-badge-definitions.json",
  import.meta.url
), "utf8")) as Fixture;
const database = createDatabaseClient(loadConfig().database);

function normalizedJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

// 격리 DB의 최신 Shadow 정의를 v2.400 불변 fixture 204개와 전수 대사합니다.
async function main(): Promise<void> {
  const version = (await database.query<VersionRow[]>(
    "SELECT id,version_key,content_hash,status FROM home_badge_definition_versions WHERE id=930000002"
  ))[0];
  assert.ok(version);
  assert.equal(version.id, 930000002n);
  assert.equal(version.version_key, fixture.versionKey);
  assert.equal(version.content_hash, fixture.contentHash);
  assert.equal(version.status, "shadow");

  const rows = await database.query<DefinitionRow[]>(
    "SELECT definition_version_id,ordinal,badge_code,source_code,grade_code,emoji_value,display_name,detail_text,criteria_json,required_badge_codes_json FROM home_badge_definitions WHERE definition_version_id=930000002 ORDER BY ordinal"
  );
  const actual = rows.map(({ definition_version_id: _versionId, ...row }) => ({
    ...row,
    ordinal: Number(row.ordinal),
    criteria_json: normalizedJson(row.criteria_json),
    required_badge_codes_json: normalizedJson(row.required_badge_codes_json)
  }));
  assert.deepEqual(actual, fixture.definitions);
  assert.equal(createHash("sha256").update(JSON.stringify(actual)).digest("hex"), fixture.contentHash);
  assert.equal(rows.filter((row) => ["gacha", "mbti", "love"].includes(row.source_code)).length, 127);

  console.log(JSON.stringify({
    sourceContract: "v2.400",
    versionId: version.id.toString(),
    contentHash: version.content_hash,
    definitions: rows.length,
    exactDisplayDefinitions: 127,
    counts: fixture.counts,
    operationalDataTouched: false
  }));
}

main().finally(async () => database.close());
