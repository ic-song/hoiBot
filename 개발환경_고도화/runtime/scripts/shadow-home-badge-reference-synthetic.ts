import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { HomeBadgeReferenceService, parseHomeBadgeReferenceCommand } from "../src/home/home-badge-reference.js";
import { MariaHomeBadgeReferenceRepository } from "../src/home/maria-home-badge-reference-repository.js";

const database = createDatabaseClient(loadConfig().database);
const service = new HomeBadgeReferenceService(new MariaHomeBadgeReferenceRepository(database));

// legacy-visible 고정값과 DB snapshot 응답을 읽기 전용 Shadow로 비교합니다.
async function main() {
  let passCount = 0;
  const run = async (message: string) => service.execute({
    command: parseHomeBadgeReferenceCommand(message)!, providerCode: "kakao",
    externalUserId: "home-badge-reference-user", isGroupChat: true, hasActivePass: false
  });
  const cube = await run("/큐브확률");
  const gacha = await run("/홈뽑기확률");
  const list = await run("/특별뱃지목록");
  const detail = await run("/특별뱃지목록 S01");
  assert.equal(cube!.split(" : ").length - 1, 51); passCount++;
  assert.match(cube!, /10\.0% : 0\.001000%\n\n10\.1%/); passCount++;
  assert.match(cube!, /옵션별 최대 수치: 캐슬 50% \/ 레이드 50% \/ 펫강화 30% \/ 펫탐험 15%/); passCount++;
  assert.match(gacha!, /\[C\] 55% \| 23종 \| 각 2\.39%/); passCount++;
  assert.match(gacha!, /\[B\] 30% \| 17종 \| 각 1\.76%/); passCount++;
  assert.match(gacha!, /\[A\] 12% \| 11종 \| 각 1\.09%/); passCount++;
  assert.match(gacha!, /\[S\] 3% \| 6종 \| 각 0\.50%/); passCount++;
  assert.equal((list!.match(/^\[S\d{2}\]/gm) ?? []).length, 13); passCount++;
  assert.match(list!, /\[S01\] 🎂 펫홈 1주년/); passCount++;
  assert.match(list!, /\[S13\] 🐺 호패 프리미엄/); passCount++;
  assert.match(detail!, /획득 조건: 운영자 지급 특별 뱃지$/); passCount++;
  assert.equal(parseHomeBadgeReferenceCommand("/큐브확률 설명"), null); passCount++;
  console.log(JSON.stringify({ passCount, cubeBands: 51, gradeCounts: [23, 17, 11, 6], specialCount: 13, liveTraffic: false }));
}

main().finally(async () => database.close());
