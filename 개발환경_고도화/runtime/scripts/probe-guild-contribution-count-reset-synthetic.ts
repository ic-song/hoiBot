import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { GuildContributionCountResetService } from "../src/guild/guild-contribution-count-reset-service.js";

const config = loadConfig();
if (!config.database.enabled || config.database.name !== "hoibot_guild_contribution_count_reset_g7") throw new Error(`Blocked database: ${config.database.name}`);
const database = createDatabaseClient(config.database);
const service = new GuildContributionCountResetService(database);
const base = process.env.GUILD_CONTRIBUTION_COUNT_RESET_EVENT_ID ?? "guild-contribution-count-reset-fixed";
const restart = process.argv.includes("--verify-restart");
const room = "synthetic-guild-contribution-room";
const externalUserId = "guild-contribution-master";
const targetId = 987600002n;
const successId = `${base}-success`;

async function event(id: string, userId = externalUserId): Promise<void> {
  await database.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
    [id, id, room, userId]
  );
}

async function run(id: string, userId = externalUserId) {
  return service.reset({ eventId: id, externalUserId: userId, channelId: room, message: "/공헌구매초기화 합성 길드 회원" });
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, params) => transaction.query(sql, params),
      execute: async (sql, params) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic guild contribution reset audit failure");
        return transaction.execute(sql, params);
      }
    }))
  };
}

async function snapshot() {
  return (await database.query<Array<{ counter: bigint; operations: bigint; outboxes: bigint; audits: bigint; executions: bigint; resets: bigint }>>(
    `SELECT
      (SELECT value FROM player_counters WHERE player_id=? AND counter_code='guild_contribution_medal_purchase_count' AND period_key='lifetime') counter,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='admin.guild_contribution_count.reset') operations,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='admin.guild_contribution_count.reset') outboxes,
      (SELECT COUNT(*) FROM command_audit WHERE action_code='guild.contribution_count.reset') audits,
      (SELECT COUNT(*) FROM command_executions WHERE command_code='GUILD_CONTRIBUTION_COUNT_RESET') executions,
      (SELECT COUNT(*) FROM admin_guild_contribution_count_resets) resets`, [targetId]
  ))[0]!;
}

try {
  const expected = { counter: 0n, operations: 4n, outboxes: 4n, audits: 4n, executions: 4n, resets: 4n };
  if (restart) {
    const before = await snapshot();
    const replay = await run(successId);
    assert.equal(replay.valueBefore, "7");
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(before, expected);
    process.stdout.write(`${JSON.stringify({ mode: "verify-restart", operations: 4, counter: 0, additionalMutation: false, operationalDataTouched: false })}\n`);
  } else {
    await database.execute("INSERT INTO players(id,status,version) VALUES (987600001,'active',1),(987600002,'active',1),(987600003,'active',1)");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (987600001,'합성 총괄 운영자',1),(987600002,'합성 길드 회원',1),(987600003,'합성 일반 회원',1)");
    await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (987600001,987600001,'kakao',?,'합성 총괄 운영자','linked'),(987600003,987600003,'kakao','guild-contribution-member','합성 일반 회원','linked')", [externalUserId]);
    const operator = await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES ('guild-contribution-master','합성 총괄 운영자',REPEAT('a',60),'active')");
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,987600001)", [operator.insertId]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT ?,id FROM admin_roles WHERE code='super_admin'", [operator.insertId]);
    await database.execute("INSERT INTO player_counters(player_id,counter_code,period_key,value) VALUES (?,'guild_contribution_medal_purchase_count','lifetime',7)", [targetId]);
    assert.equal((await database.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='GUILD_CONTRIBUTION_COUNT_RESET'"))[0]!.rollout_state, "SHADOW");
    await event(`${base}-shadow`);
    assert.deepEqual(await service.handleIris({ eventId: `${base}-shadow`, externalUserId, channelId: room, message: "/공헌구매초기화 합성 길드 회원" }), { status: "shadow" });
    assert.equal((await snapshot()).counter, 7n);

    await event(successId);
    const first = await run(successId);
    assert.equal(first.valueBefore, "7");
    assert.equal(first.changed, true);
    assert.deepEqual(await run(successId), first);

    const unchangedId = `${base}-unchanged`;
    await event(unchangedId);
    const unchanged = await run(unchangedId);
    assert.equal(unchanged.valueBefore, "0");
    assert.equal(unchanged.changed, false);

    await database.execute("UPDATE player_counters SET value=9 WHERE player_id=? AND counter_code='guild_contribution_medal_purchase_count' AND period_key='lifetime'", [targetId]);
    const concurrentId = `${base}-concurrent`;
    await event(concurrentId);
    const concurrent = await Promise.all([run(concurrentId), run(concurrentId)]);
    assert.deepEqual(concurrent[0], concurrent[1]);
    assert.equal(concurrent[0].valueBefore, "9");

    await assert.rejects(() => run(`${base}-unknown`, "guild-contribution-member"), /권한이 없습니다/);
    await database.execute("UPDATE player_counters SET value=11 WHERE player_id=? AND counter_code='guild_contribution_medal_purchase_count' AND period_key='lifetime'", [targetId]);
    const rollbackId = `${base}-rollback`;
    await event(rollbackId);
    await assert.rejects(() => new GuildContributionCountResetService(failAudit(database)).reset({
      eventId: rollbackId, externalUserId, channelId: room, message: "/공헌구매초기화 합성 길드 회원"
    }), /synthetic guild contribution reset audit failure/);
    assert.equal((await snapshot()).counter, 11n);
    assert.equal(await database.verifyRollback(), true);

    const recoveryId = `${base}-recovery`;
    await event(recoveryId);
    assert.equal((await run(recoveryId)).valueBefore, "11");
    assert.deepEqual(await snapshot(), expected);
    process.stdout.write(`${JSON.stringify({ mode: "probe", migrationCount: 337, scenarios: ["shadow", "master-rbac", "positive-reset", "already-zero", "event-replay", "concurrent-replay", "unauthorized", "audit-rollback", "recovery"], effects: { operations: 4, outboxes: 4, audits: 4, executions: 4, resets: 4, counter: 0 }, operationalDataTouched: false })}\n`);
  }
} finally {
  await database.close();
}
