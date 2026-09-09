import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { createHomeBadgeGachaSeed, HomeBadgeGachaService, planHomeBadgeGachaDraws, type HomeBadgeGachaDefinition, type HomeBadgeGachaGradeWeight } from "../src/home/home-badge-gacha-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_home_badge_gacha(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic home badge gacha probe blocked: ${config.database.name}`);
const base = process.env.HOME_BADGE_GACHA_PROBE_EVENT_ID ?? "home-badge-gacha-g7-20260830-r1";
const restart = process.argv.includes("--verify-restart");
const db = createDatabaseClient(config.database);
const room = "synthetic-home-badge-gacha-room";
const broadcastRooms = ["synthetic-home-badge-notice-1", "synthetic-home-badge-notice-2"];
const actor = "home-badge-gacha-actor";
const playerId = 995000000n;
const successEvent = `${base}-open2-success`;

// command execution 외래 키용 비식별 합성 event를 준비합니다.
async function event(id: string): Promise<void> {
  await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('b',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [id, id, room, actor]);
}

// 감사 직전 실패를 주입해 모든 상태의 원자 rollback을 검증합니다.
function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params), verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction(transaction => work({ query: (sql, params) => transaction.query(sql, params), execute: async (sql, params) => { if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic home badge gacha audit failure"); return transaction.execute(sql, params); } })) };
}

// 재시작 전후 변이 수를 비교할 합성 스냅샷을 만듭니다.
async function snapshot(): Promise<Array<{ tickets: bigint; points: string; assignments: bigint; draws: bigint; operations: bigint; ledgers: bigint; outboxes: bigint }>> {
  return db.query(`SELECT
    (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=${playerId} AND item.code='ITEM-HOME-BADGE-GACHA-TICKET-2') tickets,
    (SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id=${playerId} AND currency_code='point') points,
    (SELECT COUNT(*) FROM player_badge_assignments WHERE player_id=${playerId}) assignments,
    (SELECT COUNT(*) FROM home_badge_gacha_draw_results WHERE player_id=${playerId}) draws,
    (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'home.badge.gacha:%') operations,
    (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation ON operation.id=ledger.operation_id WHERE operation.idempotency_scope LIKE 'home.badge.gacha:%') ledgers,
    (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope LIKE 'home.badge.gacha:%') outboxes`);
}

try {
  if (restart) {
    const before = await snapshot();
    const replay = await new HomeBadgeGachaService(db, broadcastRooms).execute({ eventId: successEvent, externalUserId: actor, destinationId: room, message: "/홈뱃지오픈2 3" });
    assert.equal(replay.replayed, true);
    assert.deepEqual(await snapshot(), before);
    process.stdout.write(JSON.stringify({ mode: "verify-restart", additionalMutation: false, operationalDataTouched: false }) + "\n");
  } else {
    await db.execute("INSERT INTO players(id,status) VALUES (?,'active')", [playerId]);
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'홈뱃지검증자')", [playerId]);
    await db.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES (995100000,'kakao',?,?,'linked')", [actor, playerId]);
    await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT ?,id,20,1 FROM item_definitions WHERE code LIKE 'ITEM-HOME-BADGE-GACHA-TICKET-%'", [playerId]);
    await db.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,0)", [playerId]);
    const registry = await db.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code LIKE 'HOME_BADGE_GACHA_OPEN_%'");
    assert.equal(registry.length, 3); assert.ok(registry.every(row => row.rollout_state === "SHADOW"));
    const rollbackEvent = `${base}-rollback`; await event(rollbackEvent);
    const beforeRollback = await snapshot();
    await assert.rejects(() => new HomeBadgeGachaService(failAudit(db), broadcastRooms).execute({ eventId: rollbackEvent, externalUserId: actor, destinationId: room, message: "/홈뱃지오픈3 2" }), /synthetic home badge gacha audit failure/);
    assert.deepEqual(await snapshot(), beforeRollback); assert.equal(await db.verifyRollback(), true);
    await event(successEvent);
    const [first, concurrent] = await Promise.all([
      new HomeBadgeGachaService(db, broadcastRooms).execute({ eventId: successEvent, externalUserId: actor, destinationId: room, message: "/홈뱃지오픈2 3" }),
      new HomeBadgeGachaService(db, broadcastRooms).execute({ eventId: successEvent, externalUserId: actor, destinationId: room, message: "/홈뱃지오픈2 3" })
    ]);
    assert.equal(first.status, "success"); assert.equal(concurrent.status, "success"); assert.ok(first.replayed === true || concurrent.replayed === true);
    assert.equal(first.openCount, 3); assert.equal(first.replies?.length, 1);
    const effects = await snapshot();
    assert.equal(effects[0]!.tickets, 17n); assert.equal(effects[0]!.draws, 3n); assert.equal(effects[0]!.operations, 1n); assert.equal(effects[0]!.ledgers, 1n); assert.equal(effects[0]!.outboxes, 1n);
    const suffixEvent = `${base}-suffix`; await event(suffixEvent);
    assert.equal((await new HomeBadgeGachaService(db).execute({ eventId: suffixEvent, externalUserId: actor, destinationId: room, message: "/홈뱃지오픈2 1 해봐" })).status, "usage");
    await db.execute("INSERT INTO player_home_badge_exclusions(player_id,badge_code,reason_code) SELECT ?,badge_code,'synthetic_permanent_delete' FROM home_badge_definitions WHERE definition_version_id=930000002 AND source_code='gacha'", [playerId]);
    const gachaDefinitions = await db.query<HomeBadgeGachaDefinition[]>("SELECT badge_code,source_code,grade_code,emoji_value,display_name,detail_text,ordinal FROM home_badge_definitions WHERE definition_version_id=930000002 AND source_code='gacha' ORDER BY ordinal");
    const gradeWeights = await db.query<HomeBadgeGachaGradeWeight[]>("SELECT grade_code,grade_ordinal,weight_value FROM home_badge_gacha_grade_weights WHERE variant_code='open1' ORDER BY grade_ordinal");
    const contentHash = (await db.query<Array<{ content_hash: string }>>("SELECT content_hash FROM home_badge_definition_versions WHERE id=930000002"))[0]!.content_hash;
    let deletedSEvent = ""; let sCount = 0;
    for (let attempt = 0; attempt < 1000; attempt++) {
      const candidate = `${base}-deleted-s-${attempt}`;
      const plans = planHomeBadgeGachaDraws(createHomeBadgeGachaSeed(contentHash, candidate, playerId.toString(), "open1", 10n), gachaDefinitions, gradeWeights, 10, true);
      sCount = plans.filter(plan => plan.definition.grade_code === "S").length;
      if (sCount > 0) { deletedSEvent = candidate; break; }
    }
    assert.notEqual(deletedSEvent, ""); await event(deletedSEvent);
    const deletedS = await new HomeBadgeGachaService(db, broadcastRooms).execute({ eventId: deletedSEvent, externalUserId: actor, destinationId: room, message: "/홈뱃지오픈 10" });
    assert.equal(deletedS.status, "success"); assert.equal(deletedS.pointReward, "0"); assert.ok(deletedS.draws?.every(draw => draw.resultKind === "deleted"));
    assert.equal(deletedS.replies?.length, 1 + sCount * broadcastRooms.length);
    assert.deepEqual(deletedS.replies?.slice(1).map(reply => reply.room), Array.from({ length: sCount }, () => broadcastRooms).flat());
    process.stdout.write(JSON.stringify({ mode: "probe", scenarios: ["v2.400-policy", "shadow-registry", "guard-usage", "rollback", "deterministic-draw", "same-event-concurrency", "same-batch-duplicate", "permanent-delete-no-regrant", "deleted-s-ordered-notice", "ordered-outbox"], effects: effects[0], deletedSNoticeCount: sCount, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? Number(value) : value) + "\n");
  }
} finally { await db.close(); }
