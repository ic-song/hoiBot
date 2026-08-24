import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { HomeBadgeReferenceService, parseHomeBadgeReferenceCommand } from "../src/home/home-badge-reference.js";
import { MariaHomeBadgeReferenceRepository } from "../src/home/maria-home-badge-reference-repository.js";

const database = createDatabaseClient(loadConfig().database);
const service = new HomeBadgeReferenceService(new MariaHomeBadgeReferenceRepository(database));

// 기준정보 조회 전후 주요 테이블 카운트로 mutation 0을 확인합니다.
async function counts() {
  const rows = await database.query<Array<{ versions: bigint; bands: bigint; grades: bigint; specials: bigint; operations: bigint; audits: bigint; outboxes: bigint }>>(
    `SELECT (SELECT COUNT(*) FROM home_badge_reference_versions) AS versions,
      (SELECT COUNT(*) FROM home_badge_cube_rate_bands) AS bands,
      (SELECT COUNT(*) FROM home_badge_gacha_grade_rates) AS grades,
      (SELECT COUNT(*) FROM home_badge_special_definitions) AS specials,
      (SELECT COUNT(*) FROM operations) AS operations,
      (SELECT COUNT(*) FROM command_audit) AS audits,
      (SELECT COUNT(*) FROM outbox_messages) AS outboxes`
  );
  return rows[0]!;
}

// 비식별 identity로 네 기준정보 응답과 미가입 silent 경계를 검증합니다.
async function main() {
  const before = await counts();
  const execute = async (message: string, externalUserId = "home-badge-reference-user") => {
    const command = parseHomeBadgeReferenceCommand(message)!;
    return service.execute({ command, providerCode: "kakao", externalUserId, isGroupChat: true, hasActivePass: false });
  };
  const cube = await execute("/큐브확률");
  const gacha = await execute("/홈뽑기확률");
  const list = await execute("/특별뱃지목록");
  const detail = await execute("/특별뱃지목록 [s13]");
  const missing = await execute("/큐브확률", "missing-user");
  const after = await counts();
  assert.match(cube!, /1\.0%~1\.9% : 45\.967600%/);
  assert.match(cube!, /50\.0% : 0\.001000%/);
  assert.match(gacha!, /\[C\] 55% \| 23종 \| 각 2\.39%/);
  assert.match(gacha!, /\[S\] 3% \| 6종 \| 각 0\.50%/);
  assert.match(list!, /\[S01\].*\n.*\[S13\]/s);
  assert.match(detail!, /\[S13\] 🐺 호패 프리미엄/);
  assert.equal(missing, null);
  assert.deepEqual(after, before);
  console.log(JSON.stringify({ cubeLines: cube!.split("\n").length, gachaLines: gacha!.split("\n").length, specialCount: 13, detail, mutationZero: before }, (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
