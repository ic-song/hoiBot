import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { GuildTerritoryRankRewardPayoutService } from "../src/guild/guild-territory-rank-reward-payout-service.js";

const config = loadConfig();
if (!config.database.enabled || config.database.name !== "hoibot_guild_territory_rank_reward_payout_g7") throw new Error(`Blocked database: ${config.database.name}`);
const database = createDatabaseClient(config.database);
const restart = process.argv.includes("--verify-restart");
const base = process.env.GUILD_TERRITORY_RANK_REWARD_EVENT_ID ?? "guild-territory-rank-reward-fixed";
const room = "synthetic-guild-rank-reward-operator";
const noticeRoom = "synthetic-guild-rank-reward-notice";
const externalUserId = "synthetic-guild-rank-reward-master";
let period = "2026-08-29";
const service = new GuildTerritoryRankRewardPayoutService(database, () => period);

async function event(id: string, userId = externalUserId, channelId = room): Promise<void> {
  await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [id, id, channelId, userId]);
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params), verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, params) => transaction.query(sql, params),
      execute: async (sql, params) => { if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic territory rank reward audit failure"); return transaction.execute(sql, params); }
    }))
  };
}

async function state() {
  return (await database.query<Array<{ runs: bigint; recipients: bigint; ledgers: bigint; operations: bigint; outboxes: bigint; audits: bigint; executions: bigint; jobs: bigint; balance1: string; balance2: string; balance3: string }>>(
    `SELECT
      (SELECT COUNT(*) FROM guild_territory_rank_reward_runs) runs,
      (SELECT COUNT(*) FROM guild_territory_rank_reward_recipients) recipients,
      (SELECT COUNT(*) FROM guild_resource_ledger WHERE reason_code='guild_territory_rank_reward') ledgers,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='guild.territory.rank_reward.payout') operations,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='guild.territory.rank_reward.payout') outboxes,
      (SELECT COUNT(*) FROM command_audit WHERE action_code='guild.territory.rank_reward.payout') audits,
      (SELECT COUNT(*) FROM command_executions WHERE command_code='GUILD_TERRITORY_RANK_REWARD_PAYOUT') executions,
      (SELECT COUNT(*) FROM guild_territory_rank_reward_schedule_jobs WHERE status='COMPLETED') jobs,
      COALESCE((SELECT balance FROM guild_resource_accounts WHERE guild_id=991100001 AND currency_code='GUILD_FUND'),'0.000') balance1,
      COALESCE((SELECT balance FROM guild_resource_accounts WHERE guild_id=991100002 AND currency_code='GUILD_FUND'),'0.000') balance2,
      COALESCE((SELECT balance FROM guild_resource_accounts WHERE guild_id=991100003 AND currency_code='GUILD_FUND'),'0.000') balance3`
  ))[0]!;
}

async function payout(id: string, alias = "/길드영지보상지급") {
  await event(id);
  return service.payoutManual({ eventId: id, externalUserId, channelId: room, message: alias });
}

try {
  const expected = { runs: 3n, recipients: 9n, ledgers: 9n, operations: 3n, outboxes: 5n, audits: 3n, executions: 3n, jobs: 1n, balance1: "300.000", balance2: "150.000", balance3: "75.000" };
  if (restart) {
    const before = await state();
    period = "2026-08-29";
    const replay = await payout(`${base}-success-restart`, "/영지순위보상지급");
    assert.equal(replay.periodKey, "2026-08-29");
    assert.deepEqual(await state(), before);
    assert.deepEqual(before, expected);
    process.stdout.write(`${JSON.stringify({ mode: "verify-restart", runs: 3, recipients: 9, ledgers: 9, additionalMutation: false, operationalDataTouched: false })}\n`);
  } else {
    assert.equal((await database.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='GUILD_TERRITORY_RANK_REWARD_PAYOUT'"))[0]!.rollout_state, "SHADOW");
    await event(`${base}-shadow`);
    assert.deepEqual(await service.handleIris({ eventId: `${base}-shadow`, externalUserId, channelId: room, message: "/길드영지보상지급" }), { status: "shadow" });

    await database.execute("INSERT INTO players(id,status,version) VALUES (991000001,'active',1),(991000002,'active',1)");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (991000001,'합성 순위보상 운영자',1),(991000002,'합성 일반 사용자',1)");
    await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (991000001,991000001,'kakao',?,'합성 순위보상 운영자','linked'),(991000002,991000002,'kakao','synthetic-rank-reward-user','합성 일반 사용자','linked')", [externalUserId]);
    const operator = await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES ('synthetic-rank-reward-master','합성 순위보상 운영자',REPEAT('a',60),'active')");
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,991000001)", [operator.insertId]);
    await database.execute("INSERT INTO guild_territory_rank_reward_operator_allowlist(operator_id,active) VALUES (?,TRUE)", [operator.insertId]);
    await database.execute("INSERT INTO guild_territory_rank_reward_destinations(destination_id,destination_kind,display_order,active) VALUES (?,'operator',1,TRUE),(?,'notice',1,TRUE)", [room, noticeRoom]);
    await database.execute("INSERT INTO currency_definitions(code,display_name,scale_digits,active) VALUES ('GUILD_FUND','길드 자금',3,TRUE)");
    await database.execute("UPDATE guild_territory_rank_reward_policies SET currency_code='GUILD_FUND',maximum_rank=3,enabled=TRUE WHERE policy_version=1");
    await database.execute("INSERT INTO guild_territory_rank_reward_rules(policy_version,ordinal_value,reward_amount) VALUES (1,1,100.000),(1,2,50.000),(1,3,25.000)");
    await database.execute("UPDATE guild_territory_rank_reward_schedules SET enabled=TRUE WHERE schedule_key='daily_2205_kst'");
    await database.execute("INSERT INTO guilds(id,code,display_name,level,status,version) VALUES (991100001,'synthetic-rank-guild-1','합성 1위 길드',10,'active',1),(991100002,'synthetic-rank-guild-2','합성 2위 길드',9,'active',1),(991100003,'synthetic-rank-guild-3','합성 3위 길드',8,'active',1)");
    const snapshotOperation = await database.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at,completed_at) VALUES (UUID(),'synthetic.guild.rank.snapshot','snapshot-1','system',NULL,'synthetic','completed',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))");
    const snapshot = await database.execute("INSERT INTO guild_rank_snapshots(operation_id,policy_version,title_definition_version,snapshot_version,input_hash,eligible_guild_count,eligible_member_count,status,published_at) VALUES (?,1,1,9911,REPEAT('a',64),3,3,'published',UTC_TIMESTAMP(3))", [snapshotOperation.insertId]);
    await database.execute("INSERT INTO guild_rank_snapshot_rows(snapshot_id,ordinal_value,guild_id,guild_name_snapshot,guild_level,member_count,total_charm,title_code,title_display_name) VALUES (?,1,991100001,'합성 1위 길드',10,1,300,'rank_1','1위'),(?,2,991100002,'합성 2위 길드',9,1,200,'rank_2','2위'),(?,3,991100003,'합성 3위 길드',8,1,100,'rank_3','3위')", [snapshot.insertId, snapshot.insertId, snapshot.insertId]);
    await database.execute("UPDATE guild_rank_snapshot_current SET snapshot_id=?,version=version+1 WHERE policy_key='default'", [snapshot.insertId]);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='GUILD_TERRITORY_RANK_REWARD_PAYOUT'");

    await event(`${base}-unauthorized`, "synthetic-rank-reward-user");
    await assert.rejects(() => service.payoutManual({ eventId: `${base}-unauthorized`, externalUserId: "synthetic-rank-reward-user", channelId: room, message: "/길드영지보상지급" }), /권한이 없습니다/);
    await event(`${base}-room`, externalUserId, "forbidden-room");
    await assert.rejects(() => service.payoutManual({ eventId: `${base}-room`, externalUserId, channelId: "forbidden-room", message: "/길드영지보상지급" }), /허용된 운영 채널/);

    const first = await payout(`${base}-success`);
    assert.equal(first.snapshotId, snapshot.insertId.toString());
    assert.equal(first.totalRewardAmount, "175.000");
    assert.equal(first.outboxIds.length, 2);
    const replay = await payout(`${base}-alias-replay`, "/영지순위보상지급");
    assert.deepEqual(replay, first);

    period = "2026-08-30";
    const beforeRollback = await state();
    await event(`${base}-rollback`);
    await assert.rejects(() => new GuildTerritoryRankRewardPayoutService(failAudit(database), () => period).payoutManual({ eventId: `${base}-rollback`, externalUserId, channelId: room, message: "/길드영지보상지급" }), /synthetic territory rank reward audit failure/);
    assert.deepEqual(await state(), beforeRollback);
    assert.equal(await database.verifyRollback(), true);
    const recovered = await payout(`${base}-recovery`);
    assert.equal(recovered.periodKey, "2026-08-30");

    const snapshotOperation2 = await database.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at,completed_at) VALUES (UUID(),'synthetic.guild.rank.snapshot','snapshot-2','system',NULL,'synthetic','completed',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))");
    const snapshot2 = await database.execute("INSERT INTO guild_rank_snapshots(operation_id,policy_version,title_definition_version,snapshot_version,input_hash,eligible_guild_count,eligible_member_count,status,published_at) VALUES (?,1,1,9912,REPEAT('b',64),1,1,'published',UTC_TIMESTAMP(3))", [snapshotOperation2.insertId]);
    await database.execute("INSERT INTO guild_rank_snapshot_rows(snapshot_id,ordinal_value,guild_id,guild_name_snapshot,guild_level,member_count,total_charm,title_code,title_display_name) VALUES (?,1,991100003,'합성 3위 길드',8,1,999,'rank_1','1위')", [snapshot2.insertId]);
    const jobId = await service.enqueueDueSchedule("2026-08-31", new Date("2026-08-28T00:00:00Z"));
    const claim = await service.claimDueSchedule("synthetic-worker", 300);
    assert.notEqual(claim, null);
    assert.equal(claim!.jobId, jobId);
    assert.equal(claim!.snapshotId, snapshot.insertId.toString());
    await database.execute("UPDATE guild_rank_snapshot_current SET snapshot_id=?,version=version+1 WHERE policy_key='default'", [snapshot2.insertId]);
    const scheduled = await service.runClaimedSchedule(claim!);
    assert.equal(scheduled.snapshotId, snapshot.insertId.toString());
    assert.equal(scheduled.recipientCount, 3);
    period = "2026-08-31";
    assert.deepEqual(await payout(`${base}-scheduler-alias-replay`, "/영지순위보상지급"), scheduled);
    assert.deepEqual(await state(), expected);
    process.stdout.write(`${JSON.stringify({ mode: "probe", migrationCount: 355, scenarios: ["shadow", "operator-rbac", "room-allowlist", "snapshot-pinned-top3", "alias-period-replay", "audit-rollback", "retry", "durable-schedule-claim", "current-pointer-change", "manual-scheduler-idempotency"], effects: { runs: 3, recipients: 9, ledgers: 9, outboxes: 5, audits: 3, executions: 3, jobs: 1 }, operationalDataTouched: false })}\n`);
  }
} finally {
  await database.close();
}
