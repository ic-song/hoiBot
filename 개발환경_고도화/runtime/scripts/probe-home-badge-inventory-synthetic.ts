import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { HomeBadgeInventoryService } from "../src/home/home-badge-inventory-service.js";

const config = loadConfig();
if (!config.database.name.includes("home_badge")) {
  throw new Error("home badge synthetic probe는 격리 DB에서만 실행할 수 있습니다.");
}
const database = createDatabaseClient(config.database);

// 비식별 fixture로 세 조회·재실행·204종 snapshot을 확인합니다.
async function main() {
  await database.withTransaction(async (tx) => {
    await tx.execute(
      "INSERT INTO players(id,status) VALUES (990000001,'active') ON DUPLICATE KEY UPDATE status=VALUES(status),deleted_at=NULL"
    );
    await tx.execute(
      "INSERT INTO player_profiles(player_id,current_display_name,terms_agreed) VALUES (990000001,'격리홈뱃지사용자',1) ON DUPLICATE KEY UPDATE current_display_name=VALUES(current_display_name)"
    );
    await tx.execute(
      "INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (990000001,'kakao','home-badge-inventory-user','격리홈뱃지사용자','linked') ON DUPLICATE KEY UPDATE player_id=VALUES(player_id),status=VALUES(status)"
    );
    for (const eventId of [
      "home-badge-probe-owned", "home-badge-probe-all", "home-badge-probe-detail"
    ]) {
      await tx.execute(
        "INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at) VALUES (?,'message','received',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
        [eventId]
      );
    }
  });
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
  assert.equal(owned.definitionVersionId, "930000002");
  assert.equal(all.definitionVersionId, "930000002");
  assert.equal(detail.definitionVersionId, "930000002");
  assert.equal(replay.replayed, true);
  console.log(JSON.stringify({ definitions: count.toString(), definitionVersionId: detail.definitionVersionId, ownedAwards: owned.awardedBadges, allLines: all.message.split("\n").length, detailCode: "F01", replayed: replay.replayed }));
}

main().finally(async () => database.close());
