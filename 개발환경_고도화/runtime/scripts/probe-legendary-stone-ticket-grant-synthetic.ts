import assert from "node:assert/strict";
import { LegendaryStoneTicketGrantService } from "../src/admin/legendary-stone-ticket-grant-service.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const config = loadConfig(process.env);
const database = createDatabaseClient(config.database);
const eventId = "probe:admin-legendary-stone-ticket-grant:fixed";
const targetName = "합성 전돌 재시작 회원";
const amount = 3n;

try {
  await database.execute("INSERT IGNORE INTO admin_operators(login_id,display_name,password_hash,status) VALUES ('probe-legendary-ticket-admin','합성 전돌 관리자','synthetic','active')");
  const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id='probe-legendary-ticket-admin'"))[0]!;
  const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='super_admin'"))[0]!;
  await database.execute("INSERT IGNORE INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
  let identity = (await database.query<Array<{ external_user_id: string }>>("SELECT identity.external_user_id FROM admin_operator_external_identities mapping JOIN external_identities identity ON identity.id=mapping.external_identity_id WHERE mapping.operator_id=? LIMIT 1", [operator.id]))[0];
  if (identity === undefined) {
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao','probe-legendary-ticket-admin-external','합성 전돌 관리자','linked')", [player.id]);
    const externalIdentity = (await database.query<Array<{ id: bigint; external_user_id: string }>>("SELECT id,external_user_id FROM external_identities WHERE provider_code='kakao' AND external_user_id='probe-legendary-ticket-admin-external'"))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, externalIdentity.id]);
    identity = { external_user_id: externalIdentity.external_user_id };
  }

  let target = (await database.query<Array<{ player_id: bigint }>>("SELECT player_id FROM player_profiles WHERE current_display_name=? ORDER BY player_id LIMIT 1", [targetName]))[0];
  if (target === undefined) {
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.id, targetName]);
    target = { player_id: player.id };
  }
  await database.execute("INSERT IGNORE INTO event_inbox(event_id,event_kind,processing_status,received_at) VALUES (?,'command','processed',UTC_TIMESTAMP(3))", [eventId]);
  const priorOperation = Number((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM operations WHERE idempotency_scope='admin.legendary_stone_ticket.grant' AND idempotency_key=?", [eventId]))[0]!.count);
  const before = (await database.query<Array<{ quantity: bigint }>>(`SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code='ITEM-LEGENDARY-STONE-DRAW-TICKET'`, [target.player_id]))[0]?.quantity ?? 0n;
  const service = new LegendaryStoneTicketGrantService(database);
  const input = { eventId, destinationId: "probe-legendary-ticket-room", externalUserId: identity.external_user_id, message: `/전돌${amount.toString()}, ${targetName}` };
  const first = await service.grant(input);
  const replay = await service.grant(input);
  assert.deepEqual(replay, first);
  const after = (await database.query<Array<{ quantity: bigint }>>(`SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code='ITEM-LEGENDARY-STONE-DRAW-TICKET'`, [target.player_id]))[0]!.quantity;
  assert.equal(after - before, priorOperation === 0 ? amount : 0n);
  const evidence = (await database.query<Array<{ operation_count: bigint; ledger_count: bigint; audit_count: bigint; execution_count: bigint; outbox_count: bigint }>>(`SELECT
    (SELECT COUNT(*) FROM operations WHERE idempotency_scope='admin.legendary_stone_ticket.grant' AND idempotency_key=?) operation_count,
    (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation ON operation.id=ledger.operation_id WHERE operation.idempotency_scope='admin.legendary_stone_ticket.grant' AND operation.idempotency_key=?) ledger_count,
    (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id=audit.operation_id WHERE operation.idempotency_scope='admin.legendary_stone_ticket.grant' AND operation.idempotency_key=?) audit_count,
    (SELECT COUNT(*) FROM command_executions WHERE event_id=? AND command_code='ADMIN_LEGENDARY_STONE_TICKET_GRANT') execution_count,
    (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='admin.legendary_stone_ticket.grant' AND operation.idempotency_key=?) outbox_count`, [eventId, eventId, eventId, eventId, eventId]))[0]!;
  assert.deepEqual([Number(evidence.operation_count), Number(evidence.ledger_count), Number(evidence.audit_count), Number(evidence.execution_count), Number(evidence.outbox_count)], [1, 1, 1, 1, 1]);
  console.log(JSON.stringify({ status: "PASS", command: "/전돌", quantity: after.toString(), replay: replay?.status, outboxId: replay?.outboxId }));
} finally {
  await database.close();
}
