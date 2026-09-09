import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { HappyFoundationTransferFeeService } from "../src/foundation/happy-foundation-transfer-fee-service.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_happy_foundation(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error("Happy foundation probe requires an isolated database.");
const db = createDatabaseClient(config.database);
const room = "synthetic-happy-foundation";
const senderExternal = "happy-foundation-sender";
const recipientExternal = "happy-foundation-recipient";
const outsiderExternal = "happy-foundation-outsider";
const senderId = 998_100_001n;
const recipientId = 998_100_002n;
const outsiderId = 998_100_003n;

async function event(id: string, externalUserId = senderExternal): Promise<void> {
  await db.execute("INSERT IGNORE INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES(?,?,?,?,'message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3))", [id, id, room, externalUserId]);
}

async function state(): Promise<Record<string, string>> {
  return (await db.query<Array<Record<string, string>>>(`SELECT
    CAST((SELECT balance FROM currency_accounts WHERE player_id=${senderId} AND currency_code='point') AS CHAR) sender,
    CAST((SELECT balance FROM currency_accounts WHERE player_id=${recipientId} AND currency_code='point') AS CHAR) recipient,
    CAST((SELECT total_amount FROM foundation_states WHERE foundation_code='happy') AS CHAR) foundation,
    CAST((SELECT fee_rate FROM foundation_states WHERE foundation_code='happy') AS CHAR) fee_rate,
    CAST((SELECT COUNT(*) FROM foundation_transfers WHERE sender_player_id=${senderId}) AS CHAR) transfers,
    CAST((SELECT COUNT(*) FROM currency_ledger ledger JOIN operations operation ON operation.id=ledger.operation_id WHERE operation.idempotency_scope LIKE 'foundation.happy.transfer:%') AS CHAR) ledgers,
    CAST((SELECT COUNT(*) FROM command_audit WHERE action_code LIKE 'foundation.happy.%') AS CHAR) audits,
    CAST((SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope LIKE 'foundation.happy.%') AS CHAR) outboxes`))[0]!;
}

function failTransferLedger(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params), verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (tx: DatabaseTransaction) => Promise<T>) => inner.withTransaction((tx) => work({ query: (sql, params) => tx.query(sql, params), execute: async (sql, params) => {
      if (sql.includes("INSERT INTO foundation_transfers")) throw new Error("synthetic foundation transfer failure");
      return tx.execute(sql, params);
    } })) };
}

async function seed(): Promise<void> {
  for (const [id, name, external] of [[senderId, "합성보낸회원 남", senderExternal], [recipientId, "합성받는회원 여", recipientExternal], [outsiderId, "합성외부회원 남", outsiderExternal]] as const) {
    await db.execute("INSERT IGNORE INTO players(id,status,version) VALUES (?,'active',1)", [id]);
    await db.execute("INSERT IGNORE INTO player_profiles(player_id,current_display_name,tier_code,version) VALUES (?,?,'king',1)", [id, name]);
    await db.execute("INSERT IGNORE INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (?,?, 'kakao',?,?, 'linked')", [id + 10_000n, id, external, name]);
    await db.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',?,1)", [id, id === senderId ? 100_000n : 1_000n]);
  }
  await db.execute("UPDATE foundation_states SET captain_player_id=?,total_amount=0,fee_rate=20.00,version=version+1 WHERE foundation_code='happy'", [senderId]);
  await db.execute("INSERT INTO guild_territory_wars(war_key,active,rift_event_history_json) VALUES ('synthetic-happy-foundation',FALSE,JSON_ARRAY()) ON DUPLICATE KEY UPDATE active=FALSE");
}

async function probe(): Promise<void> {
  await seed();
  const service = new HappyFoundationTransferFeeService(db);
  await event("foundation-read");
  assert.equal((await service.handle({ eventId: "foundation-read", externalUserId: senderExternal, destinationId: room, message: "/호이행복재단" })).status, "foundation_read");
  await event("foundation-fee");
  assert.equal((await service.handle({ eventId: "foundation-fee", externalUserId: senderExternal, destinationId: room, message: "/이체수수료변경 10" })).status, "fee_changed");
  await event("foundation-fee-denied", outsiderExternal);
  await assert.rejects(() => service.handle({ eventId: "foundation-fee-denied", externalUserId: outsiderExternal, destinationId: room, message: "/이체수수료변경 30" }), (error: unknown) => error instanceof ApplicationError && error.statusCode === 403);
  await event("foundation-transfer");
  const normal = await service.handle({ eventId: "foundation-transfer", externalUserId: senderExternal, destinationId: room, message: "/이체 합성받는회원 여 10000" });
  assert.deepEqual({ status: normal.status, amount: normal.amount, fee: normal.feeAmount }, { status: "transferred", amount: "10000", fee: "1000" });
  assert.equal((await service.handle({ eventId: "foundation-transfer", externalUserId: senderExternal, destinationId: room, message: "/이체 합성받는회원 여 10000" })).replayed, true);

  const membership = (await db.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='HAPPY_FOUNDATION_MEMBERSHIP'"))[0]!;
  await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,1,1) ON DUPLICATE KEY UPDATE quantity=1,version=version+1", [senderId, membership.id]);
  await event("foundation-member-transfer");
  assert.equal((await service.handle({ eventId: "foundation-member-transfer", externalUserId: senderExternal, destinationId: room, message: "/이체 합성받는회원 여 10000" })).feeAmount, "500");

  await db.execute("UPDATE guild_territory_wars SET active=TRUE WHERE war_key='synthetic-happy-foundation'");
  await event("foundation-siege");
  assert.equal((await service.handle({ eventId: "foundation-siege", externalUserId: senderExternal, destinationId: room, message: "/이체 합성받는회원 여 1" })).status, "blocked_by_castle_siege");
  await db.execute("UPDATE guild_territory_wars SET active=FALSE WHERE war_key='synthetic-happy-foundation'");

  await event("foundation-rollback");
  const before = await state();
  await assert.rejects(() => new HappyFoundationTransferFeeService(failTransferLedger(db)).handle({ eventId: "foundation-rollback", externalUserId: senderExternal, destinationId: room, message: "/이체 합성받는회원 여 1000" }), /synthetic foundation transfer failure/);
  assert.deepEqual(await state(), before);
  assert.equal(await db.verifyRollback(), true);
  assert.equal((await service.handle({ eventId: "foundation-rollback", externalUserId: senderExternal, destinationId: room, message: "/이체 합성받는회원 여 1000" })).status, "transferred");
  const migrationCount = (await db.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM schema_migrations"))[0]!.count;
  process.stdout.write(JSON.stringify({ mode: "probe", migrationCount, scenarios: ["read", "captain-fee", "authority", "tier", "safe-amount", "normal-transfer", "member-half-fee", "siege", "ledger", "rollback", "replay", "restart"], state: await state() }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
}

async function restart(): Promise<void> {
  const before = await state();
  const result = await new HappyFoundationTransferFeeService(db).handle({ eventId: "foundation-transfer", externalUserId: senderExternal, destinationId: room, message: "/이체 합성받는회원 여 10000" });
  assert.equal(result.replayed, true);
  assert.deepEqual(await state(), before);
  process.stdout.write(JSON.stringify({ mode: "verify-restart", additionalMutation: false, state: before }) + "\n");
}

try { if (process.argv.includes("--verify-restart")) await restart(); else await probe(); } finally { await db.close(); }
