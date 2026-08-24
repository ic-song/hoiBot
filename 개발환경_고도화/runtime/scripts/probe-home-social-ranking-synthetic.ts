import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { HomeSocialRankingService } from "../src/home/home-social-ranking.js";
import { MariaHomeSocialRankingRepository } from "../src/home/maria-home-social-ranking-repository.js";

const database = createDatabaseClient(loadConfig().database);
const service = new HomeSocialRankingService(new MariaHomeSocialRankingRepository(database), "ALLSEE");

// 조회 전후 핵심 테이블과 이벤트 테이블 카운트로 mutation 0을 검증합니다.
async function counts() {
  const rows = await database.query<Array<Record<string, bigint>>>(
    `SELECT (SELECT COUNT(*) FROM home_follow_relationships) AS follows,
      (SELECT COUNT(*) FROM home_heart_expression_totals) AS hearts,
      (SELECT COUNT(*) FROM player_badge_assignments) AS badges,
      (SELECT COUNT(*) FROM operations) AS operations,
      (SELECT COUNT(*) FROM command_audit) AS audits,
      (SELECT COUNT(*) FROM outbox_messages) AS outboxes`
  );
  return rows[0]!;
}

// 세 명령의 DB 집계·표시와 미가입 silent 경계를 검증합니다.
async function main() {
  const before = await counts();
  const run = (kind: "followers" | "hearts" | "badges", externalUserId = "synthetic-admin-alpha") =>
    service.execute({ providerCode: "kakao", externalUserId, kind });
  const followers = await run("followers");
  const hearts = await run("hearts");
  const badges = await run("badges");
  const missing = await run("followers", "missing-user");
  const after = await counts();
  assert.match(followers!, /팔로워 3,002명/);
  assert.match(hearts!, /총 10회/);
  assert.match(hearts!, /귀여워🐾 1 \| 멋져요✨ 3 \| 응원해⭐ 2 \| 사랑해💖 4/);
  assert.match(badges!, /뱃지 2개/);
  assert.doesNotMatch(badges!, /테스트베타/);
  assert.equal(missing, null);
  assert.deepEqual(after, before);
  console.log(JSON.stringify({ followerTop: 3002, heartTop: 10, badgeTop: 2, mutationZero: before }, (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
