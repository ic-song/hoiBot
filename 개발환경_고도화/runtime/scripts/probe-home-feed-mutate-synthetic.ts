import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { parseHomeFeedMutationCommand } from "../src/home/home-feed-mutate-command.js";
import { HomeFeedMutationService } from "../src/home/home-feed-mutate-service.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_home_feed_mutate(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic feed probe blocked: ${config.database.name}`);
const db = createDatabaseClient(config.database);
const base = process.env.HOME_FEED_PROBE_EVENT_ID ?? "home-feed-g7-20260829-r1";
const eventId = `${base}-create`;
const restart = process.argv.includes("--verify-restart");
const room = "synthetic-home-feed-room";
const state = async () => (await db.query<Array<{ activeFeeds: bigint; alerts: bigint; days: bigint; counter: bigint; mutations: bigint; operations: bigint; outboxes: bigint }>>(`SELECT (SELECT COUNT(*) FROM home_feeds WHERE home_player_id=321001 AND deleted_at IS NULL) activeFeeds,(SELECT COUNT(*) FROM pet_home_activity_alerts WHERE actor_player_id=321001 AND feed_content='합성 피드') alerts,(SELECT COUNT(*) FROM pet_home_feed_activity_days WHERE player_id=321001) days,(SELECT value FROM player_counters WHERE player_id=321001 AND counter_code='feed_post' ORDER BY period_key DESC LIMIT 1) counter,(SELECT COUNT(*) FROM home_feed_mutation_events WHERE player_id=321001 AND action_code='create') mutations,(SELECT COUNT(*) FROM operations WHERE idempotency_scope='home.feed.mutate' AND idempotency_key=?) operations,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='home.feed.mutate' AND operation_row.idempotency_key=?) outboxes`, [eventId, eventId]))[0]!;
try {
  const service = new HomeFeedMutationService(db);
  if (restart) {
    const before = await state();
    const replay = await service.execute({ eventId, externalUserId: "home-feed-probe-owner", destinationId: room, command: parseHomeFeedMutationCommand("/피드 합성 피드")! });
    assert.equal(replay.replayed, true);
    assert.deepEqual(await state(), before);
    process.stdout.write(JSON.stringify({ mode: "restart", state: before }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  } else {
    await db.execute("INSERT INTO players(id,status,version) VALUES(321001,'active',1),(321002,'active',1)");
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(321001,'합성 피드 사용자',1),(321002,'합성 피드 팔로워',1)");
    await db.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES(321001,321001,'kakao','home-feed-probe-owner','합성 피드 사용자','linked')");
    await db.execute("INSERT INTO player_passes(player_id,pass_code,enabled,permanent) VALUES(321001,'support',TRUE,TRUE)");
    await db.execute("INSERT INTO player_pets(player_id,display_name,version) VALUES(321001,'합성 피드펫',1)");
    await db.execute("INSERT INTO pet_home_follows(follower_player_id,followed_player_id,active,version) VALUES(321002,321001,TRUE,1)");
    await db.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES(?,'iris',?,'message','synthetic','incoming',REPEAT('6',64),'parsed','processing',UTC_TIMESTAMP(3))", [eventId, eventId]);
    const result = await service.execute({ eventId, externalUserId: "home-feed-probe-owner", destinationId: room, command: parseHomeFeedMutationCommand("/피드 합성 피드")! });
    assert.equal(result.deliveredCount, 1);
    assert.equal((await service.execute({ eventId, externalUserId: "home-feed-probe-owner", destinationId: room, command: parseHomeFeedMutationCommand("/피드 합성 피드")! })).replayed, true);
    const final = await state();
    assert.deepEqual(final, { activeFeeds: 1n, alerts: 2n, days: 1n, counter: 1n, mutations: 1n, operations: 1n, outboxes: 1n });
    process.stdout.write(JSON.stringify({ mode: "probe", migrationCount: 321, scenarios: ["create", "follower-alert", "kst-day-counter", "idempotent-replay"], state: final, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  }
} finally {
  await db.close();
}
