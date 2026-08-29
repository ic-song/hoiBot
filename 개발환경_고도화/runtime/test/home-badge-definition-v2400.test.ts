import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

type Definition = {
  ordinal: number;
  badge_code: string;
  source_code: string;
  grade_code: string | null;
  emoji_value: string;
  display_name: string;
  detail_text: string;
  criteria_json: Record<string, number> | null;
  required_badge_codes_json: string[] | null;
};

type Fixture = {
  sourceContract: string;
  sourceCommit: string;
  contentHash: string;
  counts: Record<string, number>;
  definitions: Definition[];
};

const fixturePath = new URL(
  "../../migration-control/evidence/home-badge-inventory/v2400-home-badge-definitions.json",
  import.meta.url
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;

test("v2.400 홈뱃지 204개 정의와 127개 표시값을 고정한다", () => {
  const hash = createHash("sha256").update(JSON.stringify(fixture.definitions)).digest("hex");
  assert.equal(fixture.sourceContract, "v2.400");
  assert.equal(fixture.sourceCommit, "a286279b");
  assert.equal(fixture.definitions.length, 204);
  assert.deepEqual(fixture.counts, {
    achievement: 64, special: 13, gacha: 57, mbti: 20, love: 50, total: 204
  });
  assert.equal(hash, fixture.contentHash);

  const byCode = new Map(fixture.definitions.map((definition) => [definition.badge_code, definition]));
  assert.deepEqual(
    [byCode.get("HB001")?.grade_code, byCode.get("HB001")?.emoji_value, byCode.get("HB001")?.display_name],
    ["C", "🛏️", "이불 밖은 위험해"]
  );
  assert.match(byCode.get("MBTI20")?.detail_text ?? "", /PURE 순수결정체|아무것도 몰라요/);
  assert.equal(byCode.get("LOVE50")?.display_name, "평생 한 사람");
  assert.equal(byCode.get("LOVE50")?.emoji_value, "♾️");
  assert.equal(fixture.definitions.some((definition) =>
    /기존 뽑기 홈뱃지|MBTI 홈뱃지 \d|연애유형 홈뱃지 \d/.test(definition.display_name)
  ), false);

  const duplicateNames = fixture.definitions
    .filter((definition) => definition.display_name === "감정 롤러코스터")
    .map((definition) => definition.badge_code);
  assert.deepEqual(duplicateNames, ["HB027", "LOVE24"]);
});
