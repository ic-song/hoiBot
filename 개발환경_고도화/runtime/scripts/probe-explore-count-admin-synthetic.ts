import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { ExploreCountAdminService, parseExploreCountAdminCommand } from "../src/admin/explore-count-admin-service.js";

const config = loadConfig();
if (!config.database.enabled || config.database.name !== "hoibot_explore_count_admin_g7") throw new Error(`Blocked database: ${config.database.name}`);
const base = process.env.EXPLORE_COUNT_ADMIN_EVENT_ID ?? "explore-count-admin-fixed";
const restart = process.argv.includes("--verify-restart");
const database = createDatabaseClient(config.database);
const service = new ExploreCountAdminService(database);
const success = `${base}-success`;

async function event(id: string): Promise<void> {
  await database.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'synthetic-explore-count-room','explore-master','message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
    [id, id]
  );
}

async function update(id: string, message: string) {
  return service.update({
    command: parseExploreCountAdminCommand(message),
    idempotencyKey: id,
    sourceEventId: id,
    destinationId: "synthetic-explore-count-room",
    operatorId: "998400001"
  });
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, params) => transaction.query(sql, params),
      execute: async (sql, params) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic explore count audit failure");
        return transaction.execute(sql, params);
      }
    }))
  };
}

async function snapshot() {
  return (await database.query<Array<{ operations: bigint; outboxes: bigint; audits: bigint; mutations: bigint; attempts: string; version: string }>>(`
    SELECT
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='admin.explore_count.update') operations,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='admin.explore_count.update') outboxes,
      (SELECT COUNT(*) FROM command_audit WHERE action_code='admin.explore_count.update') audits,
      (SELECT COUNT(*) FROM admin_explore_count_mutations) mutations,
      (SELECT CAST(explore_attempts AS CHAR) FROM player_pet_daily_records WHERE player_id=988400001 AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))) attempts,
      (SELECT CAST(version AS CHAR) FROM player_pet_daily_records WHERE player_id=988400001 AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))) version`))[0]!;
}

try {
  const expected = { operations: 2n, outboxes: 2n, audits: 2n, mutations: 2n, attempts: "4", version: "2" };
  if (restart) {
    const before = await snapshot();
    await update(success, "/탐험횟수수정 합성 회원 4");
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(before, expected);
    process.stdout.write(`${JSON.stringify({ mode: "verify-restart", operations: 2, attempts: 4, additionalMutation: false, operationalDataTouched: false })}\n`);
  } else {
    await database.execute("INSERT INTO players(id,status) VALUES (988400001,'active')");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (988400001,'합성 회원')");
    assert.equal((await database.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='ADMIN_EXPLORE_COUNT_UPDATE'"))[0]!.rollout_state, "SHADOW");
    await event(success);
    const first = await update(success, "/탐험횟수수정 합성 회원 4");
    assert.equal(first.changed, true);
    assert.deepEqual(await update(success, "/탐험횟수수정 합성 회원 4"), first);
    const same = `${base}-same`;
    await event(same);
    assert.equal((await update(same, "/탐험횟수수정 합성 회원 4")).changed, false);
    await assert.rejects(() => update(`${base}-missing`, "/탐험횟수수정 없는 회원 3"), /존재하지 않는 유저/);
    const rollback = `${base}-rollback`;
    await event(rollback);
    const rollbackService = new ExploreCountAdminService(failAudit(database));
    await assert.rejects(() => rollbackService.update({
      command: parseExploreCountAdminCommand("/탐험횟수수정 합성 회원 9"), idempotencyKey: rollback,
      sourceEventId: rollback, destinationId: "synthetic-explore-count-room", operatorId: "998400001"
    }), /synthetic explore count audit failure/);
    assert.deepEqual(await snapshot(), expected);
    assert.equal(await database.verifyRollback(), true);
    process.stdout.write(`${JSON.stringify({ mode: "probe", scenarios: ["shadow-registry", "update", "unchanged", "missing-target", "replay", "rollback"], effects: { operations: 2, outboxes: 2, audits: 2, mutations: 2, attempts: 4 }, operationalDataTouched: false })}\n`);
  }
} finally {
  await database.close();
}
