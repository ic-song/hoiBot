import assert from "node:assert/strict";
import { createDatabaseClient } from "../src/database.js";
import { isPunchRankResetCommand, PunchRankResetService } from "../src/admin/punch-rank-reset-service.js";

const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const db = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: process.env.DATABASE_PASSWORD ?? "", name: required("DATABASE_NAME"), connectionLimit: 8, connectTimeoutMs: 5_000 });
const restart = process.argv.includes("--verify-restart"), base = "punch-rank-reset-g7", room = "990000000000369", external = "punch-rank-reset-operator", denied = "punch-rank-reset-denied", operatorId = 990369001n, identityId = 990369002n, deniedPlayer = 990369003n, deniedIdentity = 990369004n, players = [990369101n,990369102n,990369103n];
const service = new PunchRankResetService(db);

// FK와 command execution 근거를 갖춘 비식별 합성 event를 준비합니다.
async function event(eventId: string, externalUserId = external): Promise<void> { await db.execute("INSERT IGNORE INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3))", [eventId,eventId,room,externalUserId]); }

// 펀치 순위 projection을 결정적 합성 값으로 다시 채웁니다.
async function seedStats(count = players.length): Promise<void> { for (let index = 0; index < count; index += 1) { const id = players[index]!; await db.execute("INSERT INTO player_punch_rank_stats(player_id,best_score,best_rank,total_play,total_reward,legend_count,last_score,last_rank,source_order,version) VALUES (?,?,?,4,3,1,900,'고수',?,1) ON DUPLICATE KEY UPDATE best_score=VALUES(best_score),best_rank=VALUES(best_rank),total_play=4,total_reward=3,legend_count=1,last_score=900,last_rank='고수',source_order=VALUES(source_order),version=1", [id,1000+index,'전설',index+1]); } }

// reset의 실제 행·run·snapshot·outbox 수를 한번에 조회합니다.
async function counts(): Promise<Record<string,bigint>> { return (await db.query<Array<Record<string,bigint>>>("SELECT (SELECT COUNT(*) FROM player_punch_rank_stats) stats,(SELECT COUNT(*) FROM punch_rank_reset_runs) runs,(SELECT COUNT(*) FROM punch_rank_reset_snapshots) snapshots,(SELECT COUNT(*) FROM punch_rank_reset_snapshot_rows) snapshot_rows,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='admin.punch_rank.reset') outboxes,(SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id=audit.operation_id WHERE operation.idempotency_scope='admin.punch_rank.reset') audits"))[0]!; }

try {
  if (restart) {
    const before = await counts();
    const replay = await service.reset({ eventId: `${base}-normal`, externalUserId: external, channelId: room, message: "/펀치순위초기화" });
    const concurrentReplay = await service.reset({ eventId: `${base}-concurrent`, externalUserId: external, channelId: room, message: "/펀치순위초기화" });
    assert.deepEqual(await counts(), before);
    process.stdout.write(JSON.stringify({ mode: "verify-restart", replayStatus: replay.status, concurrentReplayStatus: concurrentReplay.status, additionalMutation: false, counts: before, operationalDataTouched: false }, (_key,value) => typeof value === "bigint" ? Number(value) : value) + "\n");
  } else {
    assert.equal(isPunchRankResetCommand("/펀치순위초기화"), true); assert.equal(isPunchRankResetCommand("/펀치순위초기화 1"), false);
    for (const id of [...players,deniedPlayer]) await db.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1) ON DUPLICATE KEY UPDATE status='active'", [id]);
    await db.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES (?,'kakao',?,?, 'linked') ON DUPLICATE KEY UPDATE external_user_id=VALUES(external_user_id),player_id=VALUES(player_id),status='linked'", [identityId,external,players[0]]);
    await db.execute("INSERT INTO external_identities(id,provider_code,external_user_id,player_id,status) VALUES (?,'kakao',?,?, 'linked') ON DUPLICATE KEY UPDATE external_user_id=VALUES(external_user_id),player_id=VALUES(player_id),status='linked'", [deniedIdentity,denied,deniedPlayer]);
    await db.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (?,'punch-rank-reset-g7','합성 운영자','synthetic','active') ON DUPLICATE KEY UPDATE status='active'", [operatorId]);
    await db.execute("INSERT IGNORE INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operatorId,identityId]);
    await db.execute("INSERT IGNORE INTO admin_operator_roles(operator_id,role_id) SELECT ?,id FROM admin_roles WHERE code='super_admin'", [operatorId]);
    assert.deepEqual(await service.handleIris({ eventId: `${base}-shadow`, externalUserId: external, channelId: room, message: "/펀치순위초기화" }), { status: "shadow" });
    await db.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=TRUE WHERE command_code='ADMIN_PUNCH_RANK_RESET'");
    assert.deepEqual(await service.handleIris({ eventId: `${base}-denied`, externalUserId: denied, channelId: room, message: "/펀치순위초기화" }), { status: "handled_no_reply" });

    await seedStats(3); const rollbackEvent = `${base}-rollback`; await event(rollbackEvent);
    const rollbackBefore = await counts();
    await db.execute("CREATE TRIGGER fail_punch_rank_reset_audit BEFORE INSERT ON command_audit FOR EACH ROW BEGIN IF NEW.action_code='admin.punch_rank.reset' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced punch rank reset audit failure'; END IF; END");
    try { await assert.rejects(() => service.reset({ eventId: rollbackEvent, externalUserId: external, channelId: room, message: "/펀치순위초기화" }), /forced punch rank reset audit failure/); } finally { await db.execute("DROP TRIGGER IF EXISTS fail_punch_rank_reset_audit"); }
    assert.deepEqual(await counts(), rollbackBefore);

    const normalEvent = `${base}-normal`; await event(normalEvent);
    const normal = await service.reset({ eventId: normalEvent, externalUserId: external, channelId: room, message: "/펀치순위초기화" });
    assert.equal(normal.resetRowCount, 3); assert.equal((await counts()).stats, 0n); assert.deepEqual(await service.reset({ eventId: normalEvent, externalUserId: external, channelId: room, message: "/펀치순위초기화" }), normal);

    await seedStats(2); const concurrentEvent = `${base}-concurrent`; await event(concurrentEvent);
    const concurrent = await Promise.all([1,2,3,4].map(() => service.reset({ eventId: concurrentEvent, externalUserId: external, channelId: room, message: "/펀치순위초기화" })));
    concurrent.forEach((result) => assert.deepEqual(result, concurrent[0])); assert.equal(concurrent[0]!.resetRowCount, 2);
    const effects = await counts(); assert.deepEqual(effects, { stats: 0n, runs: 2n, snapshots: 2n, snapshot_rows: 5n, outboxes: 2n, audits: 2n });
    process.stdout.write(JSON.stringify({ mode: "probe", migrationCount: Number((await db.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM schema_migrations"))[0]!.count_value), scenarios: ["shadow","exact-boundary","rbac","normal","immutable-snapshot","same-event-replay","four-way-concurrency","audit-outbox-rollback","restart-ready"], effects, operationalDataTouched: false }, (_key,value) => typeof value === "bigint" ? Number(value) : value) + "\n");
  }
} finally { await db.close(); }
