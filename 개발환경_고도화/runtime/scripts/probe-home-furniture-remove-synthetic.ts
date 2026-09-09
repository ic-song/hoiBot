import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { HomeFurnitureRemoveService } from "../src/home/home-furniture-remove-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_home_furniture_remove(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic home furniture remove probe blocked: ${config.database.name}`);
const database = createDatabaseClient(config.database);
const service = new HomeFurnitureRemoveService(database);
const base = process.env.HOME_FURNITURE_REMOVE_PROBE_EVENT_ID ?? "home-furniture-remove-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const room = "synthetic-home-furniture-remove-room";
const activeExternal = "home-furniture-remove-active-admin";
const inactiveExternal = "home-furniture-remove-inactive-admin";
const ordinaryExternal = "home-furniture-remove-ordinary-user";

async function addEvent(suffix: string, externalUserId: string): Promise<string> {
  const eventId = `${base}-${suffix}`;
  await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [eventId, eventId, room, externalUserId]);
  return eventId;
}

async function seedPlayer(playerId: number, externalUserId: string, displayName: string): Promise<bigint> {
  await database.execute("INSERT INTO players(id,status) VALUES (?,'active')", [playerId]);
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,?)", [playerId, displayName]);
  return (await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [playerId, externalUserId, displayName])).insertId;
}

async function addFurniture(playerId: number, suffix: string, name: string, charm: bigint, status: "bag" | "placed" | "listed"): Promise<bigint> {
  const definition = await database.execute("INSERT INTO furniture_definitions(code,display_name,charm_value,active) VALUES (?,?,?,TRUE)", [`PROBE-REMOVE-${suffix}`, name, charm]);
  return (await database.execute("INSERT INTO furniture_inventory_instances(player_id,furniture_definition_id,charm_snapshot,grade_display_name,status,version) VALUES (?,?,?,'S',?,1)", [playerId, definition.insertId, charm, status])).insertId;
}

async function effects(): Promise<{ operations: bigint; outboxes: bigint; audits: bigint; executions: bigint; summaries: bigint; ledgers: bigint }> {
  const pattern = `${base}-%`;
  return (await database.query<Array<{ operations: bigint; outboxes: bigint; audits: bigint; executions: bigint; summaries: bigint; ledgers: bigint }>>(`SELECT
    (SELECT COUNT(*) FROM operations WHERE idempotency_scope='home.furniture_remove' AND idempotency_key LIKE ?) operations,
    (SELECT COUNT(*) FROM outbox_messages message JOIN operations operation_row ON operation_row.id=message.operation_id WHERE operation_row.idempotency_scope='home.furniture_remove' AND operation_row.idempotency_key LIKE ?) outboxes,
    (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id=audit.operation_id WHERE operation_row.idempotency_scope='home.furniture_remove' AND operation_row.idempotency_key LIKE ?) audits,
    (SELECT COUNT(*) FROM command_executions WHERE event_id LIKE ?) executions,
    (SELECT COUNT(*) FROM home_furniture_remove_operations summary JOIN operations operation_row ON operation_row.id=summary.operation_id WHERE operation_row.idempotency_key LIKE ?) summaries,
    (SELECT COUNT(*) FROM furniture_inventory_ledger ledger JOIN operations operation_row ON operation_row.id=ledger.operation_id WHERE operation_row.idempotency_scope='home.furniture_remove' AND operation_row.idempotency_key LIKE ?) ledgers`, [pattern, pattern, pattern, pattern, pattern, pattern]))[0]!;
}

async function state(): Promise<{ bag: bigint; removed: bigint; placed: bigint; listed: bigint; signature: string }> {
  return (await database.query<Array<{ bag: bigint; removed: bigint; placed: bigint; listed: bigint; signature: string }>>(`SELECT
    (SELECT COUNT(*) FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code LIKE 'PROBE-REMOVE-%' AND instance.status='bag') bag,
    (SELECT COUNT(*) FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code LIKE 'PROBE-REMOVE-%' AND instance.status='removed') removed,
    (SELECT COUNT(*) FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code LIKE 'PROBE-REMOVE-%' AND instance.status='placed') placed,
    (SELECT COUNT(*) FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code LIKE 'PROBE-REMOVE-%' AND instance.status='listed') listed,
    (SELECT GROUP_CONCAT(CONCAT(instance.id,':',instance.status,':',instance.version) ORDER BY instance.id SEPARATOR '|') FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code LIKE 'PROBE-REMOVE-%') signature`))[0]!;
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), query: (sql, parameters) => inner.query(sql, parameters), execute: (sql, parameters) => inner.execute(sql, parameters), verifyRollback: () => inner.verifyRollback(), close: async () => undefined, withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction(transaction => work({ query: (sql, parameters) => transaction.query(sql, parameters), execute: async (sql, parameters) => { if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic home furniture remove audit failure"); return transaction.execute(sql, parameters); } })) };
}

try {
  const successEvent = `${base}-success`;
  if (restart) {
    const beforeEffects = await effects();
    const beforeState = await state();
    const replay = await service.handle({ eventId: successEvent, externalUserId: activeExternal, destinationId: room, message: "/가구제거 삭제 대상 2" });
    assert.equal(replay.status, "removed");
    assert.deepEqual(await effects(), beforeEffects);
    assert.deepEqual(await state(), beforeState);
    process.stdout.write(JSON.stringify({ mode: "restart", scenarios: ["restart-replay"], effects: beforeEffects }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  } else {
    assert.deepEqual((await database.query<Array<{ handler_key: string; rollout_state: string; alias_count: bigint }>>("SELECT registry.handler_key,registry.rollout_state,(SELECT COUNT(*) FROM command_aliases alias_row WHERE alias_row.command_code=registry.command_code AND alias_row.command_text='/가구제거' AND alias_row.active=TRUE) alias_count FROM command_registry registry WHERE registry.command_code='HOME_FURNITURE_REMOVE'"))[0], { handler_key: "home_furniture_remove", rollout_state: "SHADOW", alias_count: 1n });
    const activeIdentity = await seedPlayer(204001, activeExternal, "삭제 운영자");
    const inactiveIdentity = await seedPlayer(204002, inactiveExternal, "비활성 운영자");
    await seedPlayer(204003, ordinaryExternal, "일반 사용자");
    await seedPlayer(204004, "home-furniture-remove-target", "삭제 대상");
    await seedPlayer(204005, "home-furniture-remove-empty", "빈 대상");
    await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (204901,'remove-active','삭제 운영자','synthetic','active'),(204902,'remove-inactive','비활성 운영자','synthetic','inactive')");
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (204901,?),(204902,?)", [activeIdentity, inactiveIdentity]);
    const high = await addFurniture(204004, "HIGH", "나가구", 200n, "bag");
    const selected = await addFurniture(204004, "TIE-A1", "가가구", 100n, "bag");
    await addFurniture(204004, "TIE-A2", "가가구", 100n, "bag");
    const placed = await addFurniture(204004, "PLACED", "배치가구", 50n, "placed");
    const listed = await addFurniture(204004, "LISTED", "등록가구", 40n, "listed");

    for (const [suffix, external] of [["ordinary", ordinaryExternal], ["inactive", inactiveExternal]] as const) {
      const eventId = await addEvent(suffix, external);
      assert.deepEqual(await service.handle({ eventId, externalUserId: external, destinationId: room, message: "/가구제거 삭제 대상 1" }), { status: "ignored" });
    }
    assert.deepEqual(await effects(), { operations: 0n, outboxes: 0n, audits: 0n, executions: 0n, summaries: 0n, ledgers: 0n });

    const rejected: Array<[string, string, string]> = [
      ["usage", "/가구제거 대상", "명령어 형식이 잘못되었습니다."],
      ["invalid", "/가구제거 삭제 대상 0", "가구가방 번호가 올바르지 않습니다."],
      ["missing", "/가구제거 없는 대상 1", "해당 유저를 찾을 수 없습니다."],
      ["empty", "/가구제거 빈 대상 1", "해당 유저의 가구가방이 비어있거나 존재하지 않습니다."],
      ["not-found", "/가구제거 삭제 대상 9", "해당 번호의 가구가 존재하지 않습니다."]
    ];
    for (const [suffix, message, reply] of rejected) {
      const eventId = await addEvent(suffix, activeExternal);
      const result = await service.handle({ eventId, externalUserId: activeExternal, destinationId: room, message });
      assert.equal(result.status, "rejected");
      assert.ok(result.reply?.includes(reply));
    }
    const beforeSuccess = await state();
    await addEvent("success", activeExternal);
    const removed = await service.handle({ eventId: successEvent, externalUserId: activeExternal, destinationId: room, message: "/가구제거 삭제 대상 2" });
    assert.equal(removed.status, "removed");
    assert.equal(removed.furnitureInstanceId, selected.toString());
    assert.ok(removed.reply?.includes("삭제 번호: 2번"));
    assert.deepEqual(await database.query<Array<{ id: bigint; status: string }>>("SELECT id,status FROM furniture_inventory_instances WHERE id IN (?,?,?) ORDER BY id", [high, placed, listed]), [{ id: high, status: "bag" }, { id: placed, status: "placed" }, { id: listed, status: "listed" }]);
    const afterSuccess = await state();
    assert.deepEqual({ bag: afterSuccess.bag, removed: afterSuccess.removed, placed: afterSuccess.placed, listed: afterSuccess.listed }, { bag: 2n, removed: 1n, placed: 1n, listed: 1n });
    assert.notDeepEqual(afterSuccess, beforeSuccess);
    assert.deepEqual(await effects(), { operations: 6n, outboxes: 6n, audits: 6n, executions: 6n, summaries: 1n, ledgers: 1n });
    assert.deepEqual(await service.handle({ eventId: successEvent, externalUserId: activeExternal, destinationId: room, message: "/가구제거 삭제 대상 2" }), removed);
    assert.deepEqual(await effects(), { operations: 6n, outboxes: 6n, audits: 6n, executions: 6n, summaries: 1n, ledgers: 1n });

    await addFurniture(204004, "ROLLBACK", "롤백가구", 300n, "bag");
    const rollbackBefore = await state();
    const rollbackEvent = await addEvent("rollback", activeExternal);
    await assert.rejects(() => new HomeFurnitureRemoveService(failAudit(database)).handle({ eventId: rollbackEvent, externalUserId: activeExternal, destinationId: room, message: "/가구제거 삭제 대상 1" }), /synthetic home furniture remove audit failure/);
    assert.deepEqual(await state(), rollbackBefore);
    assert.deepEqual(await effects(), { operations: 6n, outboxes: 6n, audits: 6n, executions: 6n, summaries: 1n, ledgers: 1n });
    assert.equal(await database.verifyRollback(), true);
    process.stdout.write(JSON.stringify({ mode: "probe", migrationCount: 204, scenarios: ["shadow-registry", "active-admin-only", "unauthorized-silent", "legacy-usage-invalid", "missing-empty-not-found", "stable-bag-order", "single-instance-remove", "placed-listed-immutable", "summary-ledger-audit-outbox", "idempotent-rollback-restart"], effects: await effects(), operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  }
} finally {
  await database.close();
}
