import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { InventoryCleanupOrchestrationService } from "../src/inventory/inventory-cleanup-orchestration-service.js";
import { InventoryCleanupIrisHandler } from "../src/inventory/inventory-cleanup-iris-handler.js";
import { OPEN_ALL_ITEMS } from "../src/inventory/open-all-policy.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_inventory_cleanup(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Blocked database: ${config.database.name}`);
const db = createDatabaseClient(config.database), base = process.env.INVENTORY_CLEANUP_EVENT_ID ?? "inventory-cleanup-v2400-g7-r1", restart = process.argv.includes("--verify-restart");
const playerId = 989920011n, externalUserId = "inventory-cleanup-user", room = "inventory-cleanup-origin";
function failParentAudit(inner: DatabaseClient): DatabaseClient { return { ping: () => inner.ping(), query: (sql, values) => inner.query(sql, values), execute: (sql, values) => inner.execute(sql, values), verifyRollback: () => inner.verifyRollback(), close: async () => undefined, withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction(transaction => work({ query: (sql, values) => transaction.query(sql, values), execute: (sql, values) => { if (sql.includes("INSERT INTO command_audit") && sql.includes("inventory.cleanup.orchestration")) throw new Error("synthetic cleanup parent audit failure"); return transaction.execute(sql, values); } })) }; }
async function snapshot() { const pattern = `${base}%`; return (await db.query<Array<{ parent_runs: bigint; parent_outboxes: bigint; operations: bigint; executions: bigint; audits: bigint; inventory_ledgers: bigint; currency_ledgers: bigint; medal: bigint; point: string; quest_runs: bigint }>>(`SELECT (SELECT COUNT(*) FROM inventory_cleanup_orchestration_runs) parent_runs,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope LIKE 'inventory.cleanup:%') parent_outboxes,(SELECT COUNT(*) FROM operations WHERE idempotency_key LIKE ?) operations,(SELECT COUNT(*) FROM command_executions WHERE event_id LIKE ?) executions,(SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id=audit.operation_id WHERE operation.idempotency_key LIKE ?) audits,(SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation ON operation.id=ledger.operation_id WHERE operation.idempotency_key LIKE ?) inventory_ledgers,(SELECT COUNT(*) FROM currency_ledger ledger JOIN operations operation ON operation.id=ledger.operation_id WHERE operation.idempotency_key LIKE ?) currency_ledgers,(SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code='guild_contribution_medal') medal,(SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id=? AND currency_code='point') point,(SELECT COUNT(*) FROM quest_reward_claim_runs) quest_runs`, [pattern, pattern, pattern, pattern, pattern, playerId, playerId]))[0]!; }
try {
  const service = new InventoryCleanupOrchestrationService(db), input = { externalUserId, channelId: room, message: "/정리", eventId: base };
  if (!restart) {
    await db.execute("UPDATE castle_battle_seasons SET status='closed',ends_at=UTC_TIMESTAMP(3),version=version+1 WHERE status='active'");
    const rollbackBase = `${base}-rollback`, shadowBase = `${base}-shadow`;
    for (const eventId of [shadowBase, base, `${base}:cleanup:open`, `${base}:cleanup:combine`, `${base}:cleanup:sell`, `${base}:cleanup:booster`, `${base}:cleanup:medal`, `${base}:cleanup:quest`, rollbackBase, `${rollbackBase}:cleanup:open`, `${rollbackBase}:cleanup:combine`, `${rollbackBase}:cleanup:sell`, `${rollbackBase}:cleanup:booster`, `${rollbackBase}:cleanup:medal`, `${rollbackBase}:cleanup:quest`]) {
      await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3))", [eventId, eventId, room, externalUserId]);
    }
    await db.execute("INSERT INTO players(id,status) VALUES (?,'active')", [playerId]);
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'정리 회원')", [playerId]);
    await db.execute("INSERT INTO external_identities(provider_code,external_user_id,player_id,status) VALUES ('kakao',?,?,'linked')", [externalUserId, playerId]);
    for (const code of [...new Set(OPEN_ALL_ITEMS.map(item => item.code))]) await db.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES (?,?,'ITEM',TRUE,JSON_OBJECT('fixture',TRUE),TRUE,1) ON DUPLICATE KEY UPDATE active=TRUE", [code, `합성 ${code}`]);
    await db.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',1000000,1)", [playerId]);
    const medal = (await db.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='guild_contribution_medal'"))[0]!;
    await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,1)", [playerId, medal.id]);
    await db.execute("INSERT INTO guild_shop_items(product_id,item_id,display_name,price,daily_limit,display_order,enabled,version) VALUES ('98992000-0000-4000-8000-000000000001',?,'길드공헌훈장🌟(/길드공헌 숫자)',1000,1,98992,TRUE,1)", [medal.id]);
    const date = (await db.query<Array<{ value: string }>>("SELECT DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d') value"))[0]!.value;
    await db.execute("INSERT INTO player_pet_daily_records(player_id,record_date,tower_attempts,castle_battle_attempts,mini_battle_attempts,explore_attempts,weekly_quest_count) VALUES (?,?,15,15,15,10,0)", [playerId, date]);
    const handler = new InventoryCleanupIrisHandler(db);
    assert.equal(await handler.execute({ ...input, userId: externalUserId, message: "/정리", eventId: shadowBase }, async () => { throw new Error("unexpected shadow error reply"); }), null);
    await db.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='INVENTORY_CLEANUP_ORCHESTRATION'");
    const reply = await handler.execute({ ...input, userId: externalUserId }, async () => { throw new Error("unexpected active error reply"); });
    assert.ok(reply); assert.match(reply.data, /가방정리 완료/); assert.match(reply.data, /자동 구매 완료/); assert.match(reply.data, /일일퀘스트 보상 지급 완료/);
    const result = await service.handle(input);
    assert.equal(result.status, "completed"); assert.equal(result.replayed, true); assert.equal(result.data, reply.data);
    assert.deepEqual(await service.handle(input), result);
    const state = await snapshot(); assert.equal(state.parent_runs, 1n); assert.equal(state.parent_outboxes, 1n); assert.equal(state.medal, 1n); assert.equal(state.quest_runs, 1n); assert.equal(BigInt(state.point.split(".")[0]!), 999000n);
    await assert.rejects(() => new InventoryCleanupOrchestrationService(failParentAudit(db)).handle({ ...input, eventId: rollbackBase }), /synthetic cleanup parent audit failure/);
    assert.deepEqual(await snapshot(), state);
    assert.equal(await db.verifyRollback(), true);
  } else {
    const before = await snapshot(); await service.handle(input); assert.deepEqual(await snapshot(), before);
  }
  process.stdout.write(JSON.stringify({ mode: restart ? "verify-restart" : "probe", sourceContract: "v2.400", effects: await snapshot(), operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? Number(value) : value) + "\n");
} finally { await db.close(); }
