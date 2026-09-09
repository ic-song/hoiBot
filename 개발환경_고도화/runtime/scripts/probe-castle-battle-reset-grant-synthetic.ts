import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { CastleBattleResetGrantService } from "../src/admin/castle-battle-reset-grant-service.js";

const config = loadConfig();
if (!config.database.enabled || config.database.name !== "hoibot_castle_battle_reset_grant_g7") throw new Error(`Blocked database: ${config.database.name}`);
const base = process.env.CASTLE_BATTLE_RESET_GRANT_EVENT_ID ?? "castle-battle-reset-grant-fixed";
const restart = process.argv.includes("--verify-restart");
const database = createDatabaseClient(config.database);
const service = new CastleBattleResetGrantService(database);
const success = `${base}-success`;

async function event(id: string): Promise<void> {
  await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'synthetic-castle-reset-room','grant-master','message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [id, id]);
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params), verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({ query: (sql, params) => transaction.query(sql, params), execute: async (sql, params) => {
      if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic castle reset audit failure");
      return transaction.execute(sql, params);
    } })) };
}

async function snapshot() {
  return (await database.query<Array<{ operations: bigint; outboxes: bigint; audits: bigint; quantity: string; ledgers: bigint }>>(`
    SELECT
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='admin.castle_battle_reset.grant') operations,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='admin.castle_battle_reset.grant') outboxes,
      (SELECT COUNT(*) FROM command_audit WHERE action_code='inventory.castle_battle_reset.grant') audits,
      (SELECT CAST(COALESCE(SUM(stack.quantity),0) AS CHAR) FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE item.code='legacy-castle-battle-reset-ticket') quantity,
      (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation_row ON operation_row.id=ledger.operation_id WHERE operation_row.idempotency_scope='admin.castle_battle_reset.grant') ledgers`))[0]!;
}

try {
  const expected = { operations: 4n, outboxes: 4n, audits: 4n, quantity: "4", ledgers: 2n };
  if (restart) {
    const before = await snapshot();
    await service.grant({ eventId: success, destinationId: "synthetic-castle-reset-room", operatorId: "998300001", message: "/캐대전3, 대상 회원" });
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(before, expected);
    process.stdout.write(`${JSON.stringify({ mode: "verify-restart", operations: 4, quantity: 4, additionalMutation: false, operationalDataTouched: false })}\n`);
  } else {
    await database.execute("INSERT INTO players(id,status) VALUES (988300001,'active')");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (988300001,'대상 회원')");
    assert.equal((await database.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='ADMIN_CASTLE_BATTLE_RESET_GRANT'"))[0]!.rollout_state, "SHADOW");
    for (const [id, message] of [[success, "/캐대전3, 대상 회원"], [`${base}-default`, "/캐대전, 대상 회원"], [`${base}-zero`, "/캐대전0, 대상 회원"], [`${base}-missing`, "/캐대전2, 없는 회원"]] as const) {
      await event(id);
      await service.grant({ eventId: id, destinationId: "synthetic-castle-reset-room", operatorId: "998300001", message });
    }
    const replay = await service.grant({ eventId: success, destinationId: "synthetic-castle-reset-room", operatorId: "998300001", message: "/캐대전3, 대상 회원" });
    assert.deepEqual(await service.grant({ eventId: success, destinationId: "synthetic-castle-reset-room", operatorId: "998300001", message: "/캐대전3, 대상 회원" }), replay);
    const rollback = `${base}-rollback`;
    await event(rollback);
    await assert.rejects(() => new CastleBattleResetGrantService(failAudit(database)).grant({ eventId: rollback, destinationId: "synthetic-castle-reset-room", operatorId: "998300001", message: "/캐대전2, 대상 회원" }), /synthetic castle reset audit failure/);
    assert.deepEqual(await snapshot(), expected);
    assert.equal(await database.verifyRollback(), true);
    process.stdout.write(`${JSON.stringify({ mode: "probe", scenarios: ["shadow-registry", "legacy-default", "explicit-quantity", "zero", "missing-target", "shared-stack-provider", "replay", "rollback"], effects: { operations: 4, outboxes: 4, audits: 4, quantity: 4, ledgers: 2 }, operationalDataTouched: false })}\n`);
  }
} finally {
  await database.close();
}
