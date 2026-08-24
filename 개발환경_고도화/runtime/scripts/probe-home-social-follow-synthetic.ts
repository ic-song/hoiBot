import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { HomeSocialFollowService } from "../src/home/home-social-follow.js";
import { MariaHomeSocialFollowRepository } from "../src/home/maria-home-social-follow-repository.js";

const config = loadConfig();
if (!/^hoibot_[a-z0-9_]*(rehearsal|home_social_follow)[a-z0-9_]*$/i.test(config.database.name)) {
  throw new Error("Home social follow probe requires an isolated rehearsal database.");
}
const database = createDatabaseClient(config.database);
const room = "synthetic-home-social-follow-room";

// command execution FK를 만족하는 비식별 합성 Iris event를 준비합니다.
async function event(eventId: string, externalUserId: string): Promise<void> {
  await database.execute(
    `INSERT IGNORE INTO event_inbox
      (event_id, provider_event_id, external_channel_id, external_user_id, event_kind, direction, payload_hash, processing_status, received_at)
     VALUES (?, ?, ?, ?, 'message', 'incoming', SHA2(?, 256), 'processed', UTC_TIMESTAMP(3))`,
    [eventId, eventId, room, externalUserId, eventId]
  );
}

// 정상·맞팔·멱등·언팔과 원장 수를 실제 MariaDB에서 검증합니다.
async function main(): Promise<void> {
  const service = new HomeSocialFollowService(new MariaHomeSocialFollowRepository(database), "ALLSEE");
  await event("follow-normal-001", "synthetic-user-alpha");
  const normal = await service.handle({ providerCode: "synthetic", externalUserId: "synthetic-user-alpha", channelId: room, message: "/팔로우 테스트베타", eventId: "follow-normal-001" });
  const replay = await service.handle({ providerCode: "synthetic", externalUserId: "synthetic-user-alpha", channelId: room, message: "/팔로우 테스트베타", eventId: "follow-normal-001" });
  assert.match(normal.data!, /현재 팔로잉: 1명/); assert.equal(replay.outboxId, normal.outboxId);

  await event("follow-mutual-002", "synthetic-user-beta");
  const mutual = await service.handle({ providerCode: "synthetic", externalUserId: "synthetic-user-beta", channelId: room, message: "/팔로우 테스트알파", eventId: "follow-mutual-002" });
  assert.match(mutual.data!, /^🤝/);

  await event("unfollow-normal-009", "synthetic-user-alpha");
  const unfollow = await service.handle({ providerCode: "synthetic", externalUserId: "synthetic-user-alpha", channelId: room, message: "/언팔로우 테스트베타", eventId: "unfollow-normal-009" });
  assert.match(unfollow.data!, /해제했습니다/);

  const rows = await database.query<Array<Record<string, bigint>>>(
    `SELECT
      (SELECT COUNT(*) FROM home_follow_relationships WHERE status = 'active' AND followed_player_id IN (900000001,900000002)) AS active_relations,
      (SELECT COUNT(*) FROM home_activity_alerts WHERE target_player_id IN (900000001,900000002)) AS alerts,
      (SELECT COUNT(*) FROM player_badge_assignments WHERE player_id IN (900000001,900000002) AND badge_code IN ('synthetic-followers-1','synthetic-mutual-1')) AS badges,
      (SELECT COUNT(*) FROM command_executions WHERE event_id IN ('follow-normal-001','follow-mutual-002','unfollow-normal-009')) AS executions,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id = outbox.operation_id WHERE operation.idempotency_scope LIKE 'home.social:%') AS outboxes`
  );
  assert.deepEqual(rows[0], { active_relations: 1n, alerts: 7n, badges: 4n, executions: 3n, outboxes: 3n });
  process.stdout.write(JSON.stringify({ ...rows[0], replayStable: true }, (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
