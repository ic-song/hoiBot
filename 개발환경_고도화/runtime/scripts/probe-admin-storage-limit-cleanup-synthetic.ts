import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { AdminStorageLimitCleanupService } from "../src/admin/admin-storage-limit-cleanup-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_admin_storage_limit_cleanup(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic admin storage cleanup probe blocked: ${config.database.name}`);
const database = createDatabaseClient(config.database);
const service = new AdminStorageLimitCleanupService(database);
const base = process.env.ADMIN_STORAGE_LIMIT_CLEANUP_PROBE_EVENT_ID ?? "admin-storage-limit-cleanup-g7-20260901-r1";
const room = "synthetic-admin-storage-cleanup-room";
const activeExternal = "storage-cleanup-active-admin";
const ordinaryExternal = "storage-cleanup-ordinary-user";
const restart = process.argv.includes("--verify-restart");

function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), query: (sql, parameters) => inner.query(sql, parameters), execute: (sql, parameters) => inner.execute(sql, parameters), verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({ query: (sql, parameters) => transaction.query(sql, parameters), execute: async (sql, parameters) => { if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic admin storage cleanup audit failure"); return transaction.execute(sql, parameters); } })) };
}

async function state() {
  return (await database.query<Array<Record<string, bigint>>>(`SELECT
    (SELECT COUNT(*) FROM owned_mini_pets owned JOIN mini_pet_definitions definition ON definition.id=owned.mini_pet_definition_id WHERE definition.code LIKE 'PROBE-STORAGE-MINI-%') mini,
    (SELECT COUNT(*) FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code LIKE 'PROBE-STORAGE-FURN-%' AND instance.status='bag') furniture_bag,
    (SELECT COUNT(*) FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code LIKE 'PROBE-STORAGE-FURN-%' AND instance.status='removed') furniture_removed,
    (SELECT COUNT(*) FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code LIKE 'PROBE-STORAGE-FURN-%' AND instance.status='placed') furniture_placed,
    (SELECT COUNT(*) FROM inventory_instances instance JOIN item_definitions item ON item.id=instance.item_id WHERE item.code='PROBE-STORAGE-PENDANT' AND instance.status='owned') pendant_owned,
    (SELECT COUNT(*) FROM inventory_instances instance JOIN item_definitions item ON item.id=instance.item_id WHERE item.code='PROBE-STORAGE-PENDANT' AND instance.status='consumed') pendant_consumed,
    (SELECT COUNT(*) FROM inventory_instances instance JOIN item_definitions item ON item.id=instance.item_id WHERE item.code='PROBE-STORAGE-PENDANT' AND instance.status='reserved') pendant_reserved,
    (SELECT COUNT(*) FROM admin_storage_limit_cleanup_runs) runs,
    (SELECT COUNT(*) FROM admin_storage_limit_cleanup_items) items,
    (SELECT COUNT(*) FROM furniture_inventory_ledger WHERE reason_code='ADMIN_STORAGE_LIMIT_CLEANUP') furniture_ledger,
    (SELECT COUNT(*) FROM inventory_ledger WHERE reason_code='ADMIN_STORAGE_LIMIT_CLEANUP') pendant_ledger,
    (SELECT COUNT(*) FROM command_audit WHERE action_code='admin.storage_limit_cleanup') audits,
    (SELECT COUNT(*) FROM outbox_messages message JOIN operations operation_row ON operation_row.id=message.operation_id WHERE operation_row.idempotency_scope='admin.storage_limit_cleanup') outboxes`))[0]!;
}

async function seedPlayer(id: number, external: string, name: string): Promise<bigint> {
  await database.execute("INSERT INTO players(id,status) VALUES (?,'active')", [id]);
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,?)", [id, name]);
  return (await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [id, external, name])).insertId;
}

async function addEvent(eventId: string, externalUserId: string): Promise<void> {
  await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('4',64),'processed',UTC_TIMESTAMP(3))", [eventId, eventId, room, externalUserId]);
}

async function addMini(playerId: number, definitionId: bigint, sequence: number): Promise<bigint> {
  return (await database.execute("INSERT INTO owned_mini_pets(player_id,mini_pet_definition_id,equipped,bag_sequence,version) VALUES (?,?,FALSE,?,1)", [playerId, definitionId, sequence])).insertId;
}
async function addFurniture(playerId: number, sequence: number, status: "bag" | "placed" = "bag"): Promise<bigint> {
  const definition = await database.execute("INSERT INTO furniture_definitions(code,display_name,charm_value,active) VALUES (?,?,?,TRUE)", [`PROBE-STORAGE-FURN-${sequence}-${status}`, `정리가구${sequence}`, 1000 - sequence]);
  return (await database.execute("INSERT INTO furniture_inventory_instances(player_id,furniture_definition_id,charm_snapshot,grade_display_name,status,version) VALUES (?,?,?,'S',?,1)", [playerId, definition.insertId, 1000 - sequence, status])).insertId;
}
async function addPendant(playerId: number, itemId: bigint, sequence: number, status: "owned" | "reserved" = "owned"): Promise<bigint> {
  const grades = ["창조", "창세", "초월", "신화", "최상급+", "최상급", "상급+", "상급", "중급+", "중급", "하급+", "하급", "최하급"];
  return (await database.execute("INSERT INTO inventory_instances(player_id,item_id,status,attributes_json,version) VALUES (?,?,?,?,1)", [playerId, itemId, status, JSON.stringify({ objectType: "pendant", name: `펜던트${String(sequence).padStart(2, "0")}`, icon: "💎", grade: grades[sequence % grades.length], durability: 5, maxDurability: 5, upgrade: 0 })])).insertId;
}

try {
  const successEvent = `${base}-success`;
  if (restart) {
    const before = await state();
    const replay = await service.handle({ eventId: successEvent, externalUserId: activeExternal, destinationId: room, message: "/글자수전체정리" });
    assert.equal(replay.status, "cleaned");
    assert.deepEqual(await state(), before);
    process.stdout.write(JSON.stringify({ mode: "verify-restart", replay, state: before, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  } else {
    assert.deepEqual((await database.query<Array<{ handler_key: string; rollout_state: string; alias_count: bigint }>>("SELECT registry.handler_key,registry.rollout_state,(SELECT COUNT(*) FROM command_aliases alias_row WHERE alias_row.command_code=registry.command_code AND alias_row.command_text='/글자수전체정리' AND alias_row.active=TRUE) alias_count FROM command_registry registry WHERE registry.command_code='ADMIN_STORAGE_LIMIT_CLEANUP'"))[0], { handler_key: "admin_storage_limit_cleanup", rollout_state: "SHADOW", alias_count: 1n });
    const activeIdentity = await seedPlayer(438001, activeExternal, "통합정리 운영자");
    await seedPlayer(438002, ordinaryExternal, "일반 사용자");
    const roleId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='super_admin' AND active=TRUE LIMIT 1"))[0]!.id;
    await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (438901,'storage-cleanup-admin','통합정리 운영자','synthetic','active')");
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (438901,?)", [activeIdentity]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (438901,?)", [roleId]);

    const miniDefinition = (await database.execute("INSERT INTO mini_pet_definitions(code,display_name,grade_code,active) VALUES ('PROBE-STORAGE-MINI-DEF','정리미니펫','S',TRUE)")).insertId;
    const miniIds: bigint[] = [];
    for (let index = 1; index <= 5; index++) miniIds.push(await addMini(438001, miniDefinition, index));
    await database.execute("INSERT INTO mini_pet_inventory_limits(player_id,keep_count,source_code) VALUES (438001,2,'synthetic')");
    await database.execute("INSERT INTO mini_pet_protected_refs(owned_mini_pet_id,ref_type,ref_key,active) VALUES (?,'synthetic','keep',TRUE)", [miniIds[0]]);
    for (let index = 1; index <= 12; index++) await addFurniture(438001, index);
    await addFurniture(438001, 99, "placed");
    const pendantItem = (await database.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active) VALUES ('PROBE-STORAGE-PENDANT','정리펜던트','pendant',FALSE,?,TRUE)", [JSON.stringify({ objectType: "pendant" })])).insertId;
    for (let index = 1; index <= 52; index++) await addPendant(438001, pendantItem, index);
    await addPendant(438001, pendantItem, 99, "reserved");

    await addEvent(`${base}-unauthorized`, ordinaryExternal);
    assert.deepEqual(await service.handle({ eventId: `${base}-unauthorized`, externalUserId: ordinaryExternal, destinationId: room, message: "/글자수전체정리" }), { status: "silent", miniPetRemovedCount: 0, furnitureRemovedCount: 0, pendantRemovedCount: 0 });
    await addEvent(successEvent, activeExternal);
    const cleaned = await service.handle({ eventId: successEvent, externalUserId: activeExternal, destinationId: room, message: "/글자수전체정리" });
    assert.deepEqual({ status: cleaned.status, mini: cleaned.miniPetRemovedCount, furniture: cleaned.furnitureRemovedCount, pendant: cleaned.pendantRemovedCount }, { status: "cleaned", mini: 3, furniture: 2, pendant: 2 });
    assert.ok(cleaned.data?.includes("미니펫 정리: 3마리 삭제"));
    assert.deepEqual(await state(), { mini: 2n, furniture_bag: 10n, furniture_removed: 2n, furniture_placed: 1n, pendant_owned: 50n, pendant_consumed: 2n, pendant_reserved: 1n, runs: 1n, items: 7n, furniture_ledger: 2n, pendant_ledger: 2n, audits: 1n, outboxes: 1n });
    const after = await state();
    assert.deepEqual(await service.handle({ eventId: successEvent, externalUserId: activeExternal, destinationId: room, message: "/글자수전체정리" }), cleaned);
    assert.deepEqual(await state(), after);
    await addEvent(`${base}-no-target`, activeExternal);
    const noTarget = await service.handle({ eventId: `${base}-no-target`, externalUserId: activeExternal, destinationId: room, message: "/글자수전체정리" });
    assert.equal(noTarget.status, "no_target");
    assert.match(noTarget.data ?? "", /정리할 초과 데이터가 없습니다/);

    await addMini(438001, miniDefinition, 3);
    await addFurniture(438001, 100);
    await addPendant(438001, pendantItem, 100);
    const rollbackBefore = await state();
    await addEvent(`${base}-rollback`, activeExternal);
    await assert.rejects(() => new AdminStorageLimitCleanupService(failAudit(database)).handle({ eventId: `${base}-rollback`, externalUserId: activeExternal, destinationId: room, message: "/글자수전체정리" }), /synthetic admin storage cleanup audit failure/);
    assert.deepEqual(await state(), rollbackBefore);
    assert.equal(await database.verifyRollback(), true);
    process.stdout.write(JSON.stringify({ mode: "probe", scenarios: ["exact-command", "permission", "mini-protected", "furniture-stable-limit", "pendant-stable-limit", "atomic-ledger-audit-outbox", "idempotent", "no-target", "rollback"], cleaned, state: await state(), operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  }
} finally { await database.close(); }
