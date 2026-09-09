import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { AdminGuildResetAllService } from "../src/admin/admin-guild-reset-all-service.js";

const config = loadConfig();
if (!config.database.enabled || config.database.name !== "hoibot_admin_guild_reset_all_g7") throw new Error(`Blocked database: ${config.database.name}`);
const database = createDatabaseClient(config.database);
const service = new AdminGuildResetAllService(database);
const restart = process.argv.includes("--verify-restart");
const base = process.env.ADMIN_GUILD_RESET_EVENT_ID ?? "admin-guild-reset-fixed";
const room = "synthetic-admin-guild-reset-room";
const externalUserId = "synthetic-admin-guild-reset-master";

async function event(id: string, userId = externalUserId, channelId = room): Promise<void> {
  await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [id, id, channelId, userId]);
}

async function reset(id: string) { await event(id); return service.reset({ eventId: id, externalUserId, channelId: room, message: "/길드전체초기화" }); }

function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params), verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({ query: (sql, params) => transaction.query(sql, params), execute: async (sql, params) => { if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic admin guild reset audit failure"); return transaction.execute(sql, params); } })) };
}

async function state() {
  return (await database.query<Array<{ active_guilds: bigint; reset_guilds: bigint; members: bigint; names: bigint; snapshots: bigint; snapshot_rows: bigint; runs: bigint; restores: bigint; operations: bigint; outboxes: bigint; audits: bigint; executions: bigint; generation: bigint }>>(`SELECT
    (SELECT COUNT(*) FROM guilds WHERE status='active') active_guilds,(SELECT COUNT(*) FROM guilds WHERE status='reset') reset_guilds,
    (SELECT COUNT(*) FROM guild_members) members,(SELECT COUNT(*) FROM guild_name_registry) names,
    (SELECT COUNT(*) FROM admin_guild_reset_snapshots) snapshots,(SELECT COUNT(*) FROM admin_guild_reset_snapshot_rows) snapshot_rows,
    (SELECT COUNT(*) FROM admin_guild_reset_runs) runs,(SELECT COUNT(*) FROM admin_guild_reset_restore_runs) restores,
    (SELECT COUNT(*) FROM operations WHERE idempotency_scope IN('admin.guild.reset_all','admin.guild.reset_all.restore')) operations,
    (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope IN('admin.guild.reset_all','admin.guild.reset_all.restore')) outboxes,
    (SELECT COUNT(*) FROM command_audit WHERE action_code IN('admin.guild.reset_all','admin.guild.reset_all.restore')) audits,
    (SELECT COUNT(*) FROM command_executions WHERE command_code IN('ADMIN_GUILD_RESET_ALL','ADMIN_GUILD_RESET_ALL_RESTORE')) executions,
    (SELECT generation FROM admin_guild_reset_state WHERE state_key='guild_reset_all') generation`))[0]!;
}

try {
  const expected = { active_guilds: 0n, reset_guilds: 3n, members: 0n, names: 0n, snapshots: 3n, snapshot_rows: 18n, runs: 3n, restores: 1n, operations: 4n, outboxes: 4n, audits: 4n, executions: 4n, generation: 4n };
  if (restart) {
    const before = await state();
    const replay = await reset(`${base}-success`);
    assert.equal(replay.resetGuildCount, 3);
    assert.deepEqual(await state(), before);
    assert.deepEqual(before, expected);
    process.stdout.write(`${JSON.stringify({ mode: "verify-restart", runs: 3, snapshots: 3, snapshotRows: 18, additionalMutation: false, operationalDataTouched: false })}\n`);
  } else {
    assert.equal((await database.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='ADMIN_GUILD_RESET_ALL'"))[0]!.rollout_state, "SHADOW");
    assert.deepEqual(await service.handleIris({ eventId: `${base}-shadow`, externalUserId: "nobody", channelId: "nowhere", message: "/길드전체초기화" }), { status: "shadow" });
    await database.execute("INSERT INTO players(id,status,version) VALUES (992000001,'active',1),(992000002,'active',1),(992000003,'active',1),(992000004,'active',1)");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (992000001,'합성 길드초기화 운영자',1),(992000002,'합성 길드원1',1),(992000003,'합성 길드원2',1),(992000004,'합성 일반 사용자',1)");
    await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (992000001,992000001,'kakao',?,'합성 길드초기화 운영자','linked'),(992000004,992000004,'kakao','synthetic-guild-reset-user','합성 일반 사용자','linked')", [externalUserId]);
    const operator = await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES ('synthetic-guild-reset-master','합성 길드초기화 운영자',REPEAT('a',60),'active')");
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,992000001)", [operator.insertId]);
    await database.execute("INSERT INTO admin_guild_reset_operator_allowlist(operator_id,external_channel_id,active) VALUES (?,?,TRUE)", [operator.insertId, room]);
    await database.execute("INSERT INTO guilds(id,code,display_name,level,status,version) VALUES (992100001,'synthetic-reset-guild-1','합성 초기화 길드1',10,'active',1),(992100002,'synthetic-reset-guild-2','합성 초기화 길드2',9,'active',1),(992100003,'synthetic-reset-guild-3','합성 초기화 길드3',8,'active',1)");
    await database.execute("INSERT INTO guild_name_registry(guild_id,normalized_name,display_name,version) VALUES (992100001,'합성 초기화 길드1','합성 초기화 길드1',1),(992100002,'합성 초기화 길드2','합성 초기화 길드2',1),(992100003,'합성 초기화 길드3','합성 초기화 길드3',1)");
    await database.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (992100001,992000001,'master',UTC_TIMESTAMP(3)),(992100002,992000002,'member',UTC_TIMESTAMP(3)),(992100003,992000003,'member',UTC_TIMESTAMP(3))");
    await database.execute("INSERT INTO guild_territory_wars(war_key,active,lifecycle_state,start_ready,rift_event_history_json,version) VALUES ('synthetic-admin-reset-war',FALSE,'READY',FALSE,JSON_ARRAY(),1)");
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_GUILD_RESET_ALL'");

    await event(`${base}-unauthorized`, "synthetic-guild-reset-user");
    await assert.rejects(() => service.reset({ eventId: `${base}-unauthorized`, externalUserId: "synthetic-guild-reset-user", channelId: room, message: "/길드전체초기화" }), /권한이 없습니다/);
    await event(`${base}-room`, externalUserId, "forbidden-room");
    await assert.rejects(() => service.reset({ eventId: `${base}-room`, externalUserId, channelId: "forbidden-room", message: "/길드전체초기화" }), /허용된 운영 채널/);
    await database.execute("UPDATE guild_territory_wars SET active=TRUE,lifecycle_state='ACTIVE_READY' WHERE war_key='synthetic-admin-reset-war'");
    await event(`${base}-active-war`);
    await assert.rejects(() => service.reset({ eventId: `${base}-active-war`, externalUserId, channelId: room, message: "/길드전체초기화" }), /영지전/);
    await database.execute("UPDATE guild_territory_wars SET active=FALSE,lifecycle_state='READY' WHERE war_key='synthetic-admin-reset-war'");

    await event(`${base}-rollback`);
    await assert.rejects(() => new AdminGuildResetAllService(failAudit(database)).reset({ eventId: `${base}-rollback`, externalUserId, channelId: room, message: "/길드전체초기화" }), /synthetic admin guild reset audit failure/);
    assert.equal((await state()).active_guilds, 3n);
    assert.equal(await database.verifyRollback(), true);

    const successId = `${base}-success`;
    await event(successId);
    const concurrent = await Promise.all([service.reset({ eventId: successId, externalUserId, channelId: room, message: "/길드전체초기화" }), service.reset({ eventId: successId, externalUserId, channelId: room, message: "/길드전체초기화" })]);
    assert.deepEqual(concurrent[0], concurrent[1]);
    assert.equal(concurrent[0].resetGuildCount, 3);
    assert.equal((await state()).active_guilds, 0n);

    const restoreId = `${base}-restore`;
    await event(restoreId);
    const restored = await service.restore({ eventId: restoreId, externalUserId, channelId: room, snapshotId: concurrent[0].snapshotId });
    assert.equal(restored.restoredGuildCount, 3);
    assert.equal((await state()).active_guilds, 3n);

    const second = await reset(`${base}-second-reset`);
    assert.equal(second.resetGuildCount, 3);
    await database.execute("INSERT INTO guilds(id,code,display_name,status,version) VALUES (992100004,'synthetic-reset-conflict','합성 복구 충돌 길드','active',1)");
    await event(`${base}-restore-conflict`);
    await assert.rejects(() => service.restore({ eventId: `${base}-restore-conflict`, externalUserId, channelId: room, snapshotId: second.snapshotId }), /활성 길드/);
    await database.execute("DELETE FROM guilds WHERE id=992100004 AND code='synthetic-reset-conflict'");
    const empty = await reset(`${base}-empty-reset`);
    assert.equal(empty.resetGuildCount, 0);
    assert.deepEqual(await state(), expected);
    process.stdout.write(`${JSON.stringify({ mode: "probe", migrationCount: 356, scenarios: ["shadow", "operator-rbac", "room-allowlist", "active-war-fail-closed", "audit-rollback", "concurrent-event-replay", "sealed-snapshot", "atomic-reset", "snapshot-restore", "restore-conflict", "empty-reset"], effects: { runs: 3, snapshots: 3, snapshotRows: 18, restores: 1, operations: 4, outboxes: 4, audits: 4, executions: 4 }, operationalDataTouched: false })}\n`);
  }
} finally { await database.close(); }
