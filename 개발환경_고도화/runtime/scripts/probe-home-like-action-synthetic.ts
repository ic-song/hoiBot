import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { HomeLikeService } from "../src/home/home-like-service.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_home_social_home_like(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic home like probe blocked: ${config.database.name}`);
const database = createDatabaseClient(config.database);
const base = process.env.HOME_LIKE_PROBE_EVENT_ID ?? "home-like-g7-20260829-r1";
const restart = process.argv.includes("--verify-restart");
const successEvent = `${base}-success`;
const room = "synthetic-home-like-room";
const state = async () => (await database.query<Array<{ like_count: bigint; usage_count: bigint; event_count: bigint; operation_count: bigint; outbox_count: bigint }>>(`SELECT (SELECT like_count FROM player_homes WHERE player_id=318002) like_count,(SELECT value FROM player_counters WHERE player_id=318001 AND counter_code='home_like_sent' ORDER BY period_key DESC LIMIT 1) usage_count,(SELECT COUNT(*) FROM home_like_events WHERE actor_player_id=318001) event_count,(SELECT COUNT(*) FROM operations WHERE idempotency_scope='home.like.action' AND idempotency_key=?) operation_count,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='home.like.action' AND operation_row.idempotency_key=?) outbox_count`, [successEvent, successEvent]))[0]!;
try {
  const service = new HomeLikeService(database);
  if (restart) {
    const before = await state();
    const replay = await service.execute({ eventId: successEvent, externalUserId: "home-like-probe-actor", destinationId: room, message: "/좋아홈 합성 좋아홈 대상" });
    assert.equal(replay.replayed, true); assert.deepEqual(await state(), before);
    process.stdout.write(JSON.stringify({ mode: "restart", scenarios: ["actual-restart-replay"], state: before }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  } else {
    await database.execute("INSERT INTO players(id,status,version) VALUES (318001,'active',1),(318002,'active',1)");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (318001,'합성 좋아홈 사용자',1),(318002,'합성 좋아홈 대상',1)");
    await database.execute("INSERT INTO player_homes(player_id,display_name,version) VALUES (318001,'합성 좋아홈 사용자',1),(318002,'합성 좋아홈 대상',1)");
    await database.execute("INSERT INTO player_passes(player_id,pass_code,enabled,permanent) VALUES (318001,'support',TRUE,TRUE),(318002,'beginner',TRUE,TRUE)");
    await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (318001,318001,'kakao','home-like-probe-actor','합성 좋아홈 사용자','linked')");
    await database.execute("INSERT INTO player_pets(player_id,display_name,version) VALUES (318002,'합성 좋아홈 펫',1)");
    await database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','synthetic','incoming',REPEAT('7',64),'parsed','processing',UTC_TIMESTAMP(3))", [successEvent, successEvent]);
    const result = await service.execute({ eventId: successEvent, externalUserId: "home-like-probe-actor", destinationId: room, message: "/좋아홈 합성 좋아홈 대상" });
    assert.deepEqual({ kind: result.kind, replayed: result.replayed, likeCount: result.likeCount }, { kind: "like", replayed: false, likeCount: "1" });
    assert.deepEqual(await service.execute({ eventId: successEvent, externalUserId: "home-like-probe-actor", destinationId: room, message: "/좋아홈 합성 좋아홈 대상" }), { ...result, replayed: true });
    const finalState = await state();
    assert.deepEqual(finalState, { like_count: 1n, usage_count: 1n, event_count: 1n, operation_count: 1n, outbox_count: 1n });
    process.stdout.write(JSON.stringify({ mode: "probe", migrationCount: 318, scenarios: ["stable-player-target", "active-pass", "pet-home-required", "counter-and-like-atomic", "badge-and-alert", "idempotent-replay"], state: finalState, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  }
} finally { await database.close(); }
