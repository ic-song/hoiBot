import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { HomeSocialRankingService, parseHomeSocialRankingCommand } from "../src/home/home-social-ranking.js";
import { MariaHomeSocialRankingRepository } from "../src/home/maria-home-social-ranking-repository.js";

const database = createDatabaseClient(loadConfig().database);
const service = new HomeSocialRankingService(new MariaHomeSocialRankingRepository(database), "ALLSEE");

// legacy-visible 계약과 DB snapshot 출력을 읽기 전용 Shadow로 비교합니다.
async function main() {
  let passCount = 0;
  const run = async (message: string) => service.execute({
    providerCode: "kakao", externalUserId: "synthetic-admin-alpha", kind: parseHomeSocialRankingCommand(message)!
  });
  const followers = await run("/팔로워순위");
  const hearts = await run("/마음순위");
  const badges = await run("/뱃지순위");
  assert.match(followers!, /^\[🧪테스트알파\] 님\n🐾━━ 팔로워 순위 TOP 100 ━━🐾\nALLSEE/s); passCount++;
  assert.match(followers!, /1위\. 🧪테스트알파 — 팔로워 3,002명/); passCount++;
  assert.match(followers!, /2위\. 🧪테스트베타 — 팔로워 1명/); passCount++;
  assert.match(hearts!, /1위\. 🧪테스트베타 — 총 10회/); passCount++;
  assert.match(hearts!, /2위\. 🧪테스트알파 — 총 10회/); passCount++;
  assert.match(hearts!, /귀여워🐾 1 \| 멋져요✨ 3 \| 응원해⭐ 2 \| 사랑해💖 4/); passCount++;
  assert.match(badges!, /1위\. 🧪테스트알파 — 뱃지 2개/); passCount++;
  assert.doesNotMatch(badges!, /테스트베타/); passCount++;
  assert.equal(parseHomeSocialRankingCommand("/팔로워순위 설명"), null); passCount++;
  assert.equal(parseHomeSocialRankingCommand("/마음순위 "), null); passCount++;
  console.log(JSON.stringify({ passCount, liveTraffic: false, mutation: false }));
}

main().finally(async () => database.close());
