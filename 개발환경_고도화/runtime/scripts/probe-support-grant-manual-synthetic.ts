import assert from "node:assert/strict";
import { SupportGrantManualService } from "../src/admin/support-grant-manual-service.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const config = loadConfig(process.env);
const database = createDatabaseClient(config.database);
const eventId = "probe:support-grant-manual:fixed";
const targetName = "합성 후원지급 재시작 회원";

try {
  await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='SUPPORT_GRANT_MANUAL'");
  await database.execute(
    "INSERT IGNORE INTO admin_operators(login_id,display_name,password_hash,status) VALUES ('probe-support-grant-admin','합성 후원 관리자','synthetic','active')"
  );
  const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id='probe-support-grant-admin'"))[0]!;
  let target = (await database.query<Array<{ player_id: bigint }>>("SELECT player_id FROM player_profiles WHERE current_display_name=? ORDER BY player_id LIMIT 1", [targetName]))[0];
  if (target === undefined) {
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.id, targetName]);
    target = { player_id: player.id };
  }
  await database.execute(
    "INSERT IGNORE INTO event_inbox(event_id,event_kind,processing_status,received_at) VALUES (?,'command','processed',UTC_TIMESTAMP(3))", [eventId]
  );
  const result = await new SupportGrantManualService(database).grant({
    message: `/후원지급 ${targetName}/ITEM-RWD-001/4`, idempotencyKey: eventId, sourceEventId: eventId,
    destinationId: "probe-support-grant-room", operatorId: operator.id.toString(), operatorDisplayName: "합성 후원 관리자"
  });
  const state = (await database.query<Array<{ quantity: bigint; ledger_count: bigint; event_count: bigint; audit_count: bigint; execution_count: bigint; outbox_count: bigint }>>(
    `SELECT stack.quantity,
       (SELECT COUNT(*) FROM inventory_ledger ledger WHERE ledger.player_id=? AND ledger.reason_code='SUPPORT_GRANT_MANUAL') ledger_count,
       (SELECT COUNT(*) FROM admin_support_grant_events event JOIN operations operation ON operation.id=event.operation_id WHERE operation.idempotency_scope='inventory.support.grant' AND operation.idempotency_key=?) event_count,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id=audit.operation_id WHERE operation.idempotency_scope='inventory.support.grant' AND operation.idempotency_key=?) audit_count,
       (SELECT COUNT(*) FROM command_executions execution WHERE execution.event_id=? AND execution.command_code='SUPPORT_GRANT_MANUAL') execution_count,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='inventory.support.grant' AND operation.idempotency_key=?) outbox_count
     FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
     WHERE stack.player_id=? AND item.code='ITEM-RWD-001'`,
    [target.player_id, eventId, eventId, eventId, eventId, target.player_id]
  ))[0]!;
  assert.deepEqual(
    [Number(state.quantity), Number(state.ledger_count), Number(state.event_count), Number(state.audit_count), Number(state.execution_count), Number(state.outbox_count)],
    [4, 1, 1, 1, 1, 1]
  );
  console.log(JSON.stringify({ status: "PASS", command: "/후원지급", itemCode: result.itemCode, quantity: state.quantity.toString(), ledgerCount: state.ledger_count.toString(), outboxId: result.outboxId }));
} finally {
  await database.close();
}
