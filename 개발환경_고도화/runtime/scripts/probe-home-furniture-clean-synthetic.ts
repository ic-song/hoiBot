import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { HomeFurnitureCleanService } from "../src/home/home-furniture-clean-service.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_home_furniture_clean(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic home furniture clean probe blocked: ${config.database.name}`);
let database = createDatabaseClient(config.database);
const service = () => new HomeFurnitureCleanService(database);
const base = process.env.HOME_FURNITURE_CLEAN_PROBE_EVENT_ID ?? "home-furniture-clean-g7-20260828-r1";
const restart = process.argv.includes("--verify-restart");
const room = "synthetic-home-furniture-clean-room";

async function event(suffix: string, user: string): Promise<string> {
  const id = `${base}-${suffix}`;
  await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [id, id, room, user]);
  return id;
}

async function state(): Promise<Record<string, bigint | string | null>> {
  return (await database.query<Array<Record<string, bigint | string | null>>>("SELECT (SELECT COUNT(*) FROM furniture_inventory_instances WHERE player_id=216001 AND status='placed') placed,(SELECT COUNT(*) FROM furniture_inventory_instances WHERE player_id=216001 AND status='sold') sold,(SELECT COUNT(*) FROM furniture_inventory_instances WHERE player_id=216001 AND status='bag') bag,CAST((SELECT balance FROM currency_accounts WHERE player_id=216001 AND currency_code='point') AS CHAR) point,(SELECT COUNT(*) FROM furniture_inventory_ledger WHERE reason_code='HOME_FURNITURE_CLEAN') furniture_ledgers,(SELECT COUNT(*) FROM currency_ledger WHERE reason_code='HOME_FURNITURE_CLEAN_REWARD') currency_ledgers,(SELECT COUNT(*) FROM home_furniture_clean_operations) clean_ops,(SELECT GROUP_CONCAT(CONCAT(id,':',status,':',version) ORDER BY id SEPARATOR '|') FROM furniture_inventory_instances WHERE player_id=216001) signature"))[0]!;
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), query: (sql, params) => inner.query(sql, params), execute: (sql, params) => inner.execute(sql, params), verifyRollback: () => inner.verifyRollback(), close: async () => undefined, withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction(transaction => work({ query: (sql, params) => transaction.query(sql, params), execute: async (sql, params) => { if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic home clean audit failure"); return transaction.execute(sql, params); } })) };
}

async function addFurniture(code: string, name: string, charm: number, status: "bag" | "placed", grade: string): Promise<bigint> {
  const definition = await database.execute("INSERT INTO furniture_definitions(code,display_name,charm_value) VALUES (?,?,?)", [code, name, charm]);
  return (await database.execute("INSERT INTO furniture_inventory_instances(player_id,furniture_definition_id,charm_snapshot,grade_display_name,status,version) VALUES (216001,?,?,?, ?,1)", [definition.insertId, charm, grade, status])).insertId;
}

try {
  const successEvent = `${base}-success`;
  if (restart) {
    const before = await state();
    const replay = await service().handle({ eventId: successEvent, externalUserId: "home-clean-user", destinationId: room, message: "/집청소 2" });
    assert.equal(replay.status, "cleaned");
    assert.deepEqual(await state(), before);
    process.stdout.write(JSON.stringify({ mode: "restart", scenarios: ["restart-replay"], state: before }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  } else {
    await database.execute("INSERT INTO players(id,status) VALUES (216001,'active'),(216002,'active')");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (216001,'집청소 사용자'),(216002,'빈집 사용자')");
    await database.execute("INSERT INTO player_homes(player_id,display_name) VALUES (216001,'합성 집'),(216002,'빈 집')");
    await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,status) VALUES (216001,216001,'kakao','home-clean-user','linked'),(216002,216002,'kakao','empty-home-clean-user','linked')");
    await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (216001,'point',500,0)");
    const high = await addFurniture("clean-high", "높은 침대", 1000, "placed", "왕실");
    const low = await addFurniture("clean-low", "낮은 의자", 100, "placed", "일반");
    await addFurniture("clean-bag", "가방 탁자", 5000, "bag", "왕실");
    assert.deepEqual((await database.query<Array<{ handler_key: string; rollout_state: string; alias_count: bigint }>>("SELECT registry.handler_key,registry.rollout_state,(SELECT COUNT(*) FROM command_aliases alias WHERE alias.command_code=registry.command_code AND alias.command_text='/집청소' AND alias.active=TRUE) alias_count FROM command_registry registry WHERE registry.command_code='HOME_FURNITURE_CLEAN'"))[0], { handler_key: "home_furniture_clean", rollout_state: "SHADOW", alias_count: 1n });
    const emptyEvent = await event("empty", "empty-home-clean-user");
    assert.match((await service().handle({ eventId: emptyEvent, externalUserId: "empty-home-clean-user", destinationId: room, message: "/집청소" })).reply, /배치된 가구가 없습니다/);
    const usageEvent = await event("usage", "home-clean-user");
    assert.match((await service().handle({ eventId: usageEvent, externalUserId: "home-clean-user", destinationId: room, message: "/집청소" })).reply, /현재 배치된 가구 수: 2개/);
    const invalidEvent = await event("invalid", "home-clean-user");
    assert.match((await service().handle({ eventId: invalidEvent, externalUserId: "home-clean-user", destinationId: room, message: "/집청소 0" })).reply, /잘못된 번호/);
    const before = await state();
    await event("success", "home-clean-user");
    const cleaned = await service().handle({ eventId: successEvent, externalUserId: "home-clean-user", destinationId: room, message: "/집청소 2" });
    assert.equal(cleaned.status, "cleaned");
    assert.equal(cleaned.furnitureInstanceId, low.toString());
    assert.equal(cleaned.rewardPoint, "100000");
    assert.deepEqual(await service().handle({ eventId: successEvent, externalUserId: "home-clean-user", destinationId: room, message: "/집청소 2" }), cleaned);
    const after = await state();
    assert.deepEqual({ placed: after.placed, sold: after.sold, bag: after.bag, point: after.point, furniture_ledgers: after.furniture_ledgers, currency_ledgers: after.currency_ledgers, clean_ops: after.clean_ops }, { placed: 1n, sold: 1n, bag: 1n, point: "100500.000", furniture_ledgers: 1n, currency_ledgers: 1n, clean_ops: 1n });
    assert.notEqual(after.signature, before.signature);
    assert.ok(high !== low);
    const rollbackBefore = await state();
    const rollbackEvent = await event("rollback", "home-clean-user");
    await assert.rejects(() => new HomeFurnitureCleanService(failAudit(database)).handle({ eventId: rollbackEvent, externalUserId: "home-clean-user", destinationId: room, message: "/집청소 1" }), /synthetic home clean audit failure/);
    assert.deepEqual(await state(), rollbackBefore);
    assert.equal(await database.verifyRollback(), true);
    await database.close();
    database = createDatabaseClient(config.database);
    assert.deepEqual(await service().handle({ eventId: successEvent, externalUserId: "home-clean-user", destinationId: room, message: "/집청소 2" }), cleaned);
    process.stdout.write(JSON.stringify({ mode: "probe", scenarios: ["shadow-registry", "exact-command", "empty-usage-index-boundaries", "stable-placed-order", "single-instance-sale", "fixed-point-reward", "projection-snapshot", "dual-ledger-evidence", "idempotent-replay", "rollback", "restart-replay"], state: await state(), operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  }
} finally {
  await database.close();
}
