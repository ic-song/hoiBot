import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { HomeSocialFollowService, parseHomeSocialFollowCommand } from "../src/home/home-social-follow.js";
import { MariaHomeSocialFollowRepository } from "../src/home/maria-home-social-follow-repository.js";

const config = loadConfig();
if (!/^hoibot_[a-z0-9_]*(rehearsal|home_social_follow)[a-z0-9_]*$/i.test(config.database.name)) {
  throw new Error("Home social follow Shadow requires an isolated rehearsal database.");
}
const database = createDatabaseClient(config.database);
const room = "synthetic-home-social-follow-room";

async function event(eventId: string, externalUserId: string): Promise<void> {
  await database.execute(
    `INSERT IGNORE INTO event_inbox
      (event_id, provider_event_id, external_channel_id, external_user_id, event_kind, direction, payload_hash, processing_status, received_at)
     VALUES (?, ?, ?, ?, 'message', 'incoming', SHA2(?, 256), 'processed', UTC_TIMESTAMP(3))`,
    [eventId, eventId, room, externalUserId, eventId]
  );
}

// 실제 관계 snapshot을 legacy 표시 계약과 비교하는 비운영 Shadow를 실행합니다.
async function main(): Promise<void> {
  const service = new HomeSocialFollowService(new MariaHomeSocialFollowRepository(database), "ALLSEE");
  await event("follow-shadow-followers", "synthetic-user-alpha");
  const followers = await service.handle({ providerCode: "synthetic", externalUserId: "synthetic-user-alpha", channelId: room, message: "/팔로워", eventId: "follow-shadow-followers" });
  await event("follow-shadow-following", "synthetic-user-beta");
  const following = await service.handle({ providerCode: "synthetic", externalUserId: "synthetic-user-beta", channelId: room, message: "/팔로잉", eventId: "follow-shadow-following" });
  await event("follow-shadow-pass", "synthetic-user-gamma");
  const denied = await service.handle({ providerCode: "synthetic", externalUserId: "synthetic-user-gamma", channelId: room, message: "/팔로워", eventId: "follow-shadow-pass" });
  assert.match(followers.data!, /^\[👑호이패스 프리미엄👑\]\n\[🧪테스트알파\] 님/);
  assert.match(followers.data!, /1\. 🧪테스트베타/);
  assert.match(following.data!, /1\. 🧪테스트알파/);
  assert.match(denied.data!, /이용자만 확인/);
  assert.equal(parseHomeSocialFollowCommand("/팔로워순위"), null);
  assert.equal(parseHomeSocialFollowCommand("/팔로우"), null);
  process.stdout.write(JSON.stringify({ passCount: 6, liveTraffic: false, productionData: false }));
}

main().finally(async () => database.close());
