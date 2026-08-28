import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { HomeBadgeInventoryService } from "../src/home/home-badge-inventory-service.js";

const database = createDatabaseClient(loadConfig().database);

// 비식별 fixture로 세 조회·재실행·204종 snapshot을 확인합니다.
async function main() {
  const service = new HomeBadgeInventoryService(database);
  const count = (await database.query<Array<{ definitions: bigint }>>(
    "SELECT COUNT(*) definitions FROM home_badge_definitions WHERE definition_version_id=930000001"
  ))[0]!.definitions;
  const owned = await service.execute({ eventId: "home-badge-probe-owned", externalUserId: "home-badge-inventory-user", destinationId: "isolated-home-badge-room", message: "/홈뱃지" });
  const all = await service.execute({ eventId: "home-badge-probe-all", externalUserId: "home-badge-inventory-user", destinationId: "isolated-home-badge-room", message: "/홈뱃지전체" });
  const detail = await service.execute({ eventId: "home-badge-probe-detail", externalUserId: "home-badge-inventory-user", destinationId: "isolated-home-badge-room", message: "/홈뱃지정보 [f01]" });
  const replay = await service.execute({ eventId: "home-badge-probe-detail", externalUserId: "home-badge-inventory-user", destinationId: "isolated-home-badge-room", message: "/홈뱃지정보 [f01]" });
  assert.equal(count, 204n);
  assert.match(all.message, /홈뱃지 전체 204종/);
  assert.match(detail.message, /\[F01\]/);
  assert.equal(replay.replayed, true);
  console.log(JSON.stringify({ definitions: count.toString(), ownedAwards: owned.awardedBadges, allLines: all.message.split("\n").length, detailCode: "F01", replayed: replay.replayed }));
}

main().finally(async () => database.close());
