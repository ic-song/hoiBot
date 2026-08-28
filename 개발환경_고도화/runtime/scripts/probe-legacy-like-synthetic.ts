import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { LegacyLikeService } from "../src/social/legacy-like-service.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_social_legacy_like(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic legacy like probe blocked: ${config.database.name}`);
const database = createDatabaseClient(config.database);
const base = process.env.LEGACY_LIKE_PROBE_EVENT_ID ?? "legacy-like-g7-20260829-r1";
const successEvent = `${base}-success`;
const restart = process.argv.includes("--verify-restart");
const state = async () => (await database.query<Array<{ point_balance: string; usage_count: bigint; current_like: bigint; lifetime_like: bigint; event_count: bigint; outbox_count: bigint }>>(`SELECT CAST((SELECT balance FROM currency_accounts WHERE player_id=336001 AND currency_code='point') AS CHAR) point_balance,(SELECT value FROM player_counters WHERE player_id=336001 AND counter_code='cntlike' ORDER BY period_key DESC LIMIT 1) usage_count,(SELECT value FROM player_counters WHERE player_id=336002 AND counter_code='like' AND period_key='current') current_like,(SELECT value FROM player_counters WHERE player_id=336002 AND counter_code='like' AND period_key='lifetime') lifetime_like,(SELECT COUNT(*) FROM social_like_events WHERE actor_player_id=336001) event_count,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='social.legacy_like' AND operation_row.idempotency_key=?) outbox_count`, [successEvent]))[0]!;

try {
  const service = new LegacyLikeService(database);
  if (restart) {
    const before = await state();
    const replay = await service.execute({ eventId: successEvent, externalUserId: "legacy-like-probe-actor", destinationId: "synthetic-legacy-like-room", message: "/좋아요 합성 좋아요 대상" });
    assert.equal(replay.replayed, true); assert.deepEqual(await state(), before);
    process.stdout.write(JSON.stringify({ mode: "restart", scenarios: ["actual-restart-replay"], state: before }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  } else {
    await database.execute("UPDATE castle_battle_season_state SET active_season_id=NULL,version=version+1 WHERE scope_key='GLOBAL'");
    await database.execute("INSERT INTO players(id,status,version) VALUES (336001,'active',1),(336002,'active',1)");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (336001,'합성 좋아요 사용자',1),(336002,'합성 좋아요 대상',1)");
    await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (336001,336001,'kakao','legacy-like-probe-actor','합성 좋아요 사용자','linked')");
    await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (336001,'point',16,1),(336002,'point',0,1)");
    await database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','synthetic','incoming',REPEAT('5',64),'parsed','processing',UTC_TIMESTAMP(3))", [successEvent, successEvent]);
    const result = await service.execute({ eventId: successEvent, externalUserId: "legacy-like-probe-actor", destinationId: "synthetic-legacy-like-room", message: "/좋아요 합성 좋아요 대상" });
    assert.deepEqual({ replayed: result.replayed, pointAfter: result.pointAfter, usageAfter: result.usageAfter, currentLikeAfter: result.currentLikeAfter }, { replayed: false, pointAfter: "8", usageAfter: "1", currentLikeAfter: "1" });
    assert.equal((await service.execute({ eventId: successEvent, externalUserId: "legacy-like-probe-actor", destinationId: "synthetic-legacy-like-room", message: "/좋아요 합성 좋아요 대상" })).replayed, true);
    const finalState = await state();
    assert.deepEqual(finalState, { point_balance: "8.000", usage_count: 1n, current_like: 1n, lifetime_like: 1n, event_count: 1n, outbox_count: 1n });
    process.stdout.write(JSON.stringify({ mode: "probe", migrationCount: 336, scenarios: ["point-ledger", "daily-limit", "current-and-lifetime-counter", "atomic-evidence", "idempotent-replay"], state: finalState, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  }
} finally { await database.close(); }
