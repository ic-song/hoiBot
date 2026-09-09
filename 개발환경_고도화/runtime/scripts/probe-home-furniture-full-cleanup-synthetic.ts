import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { HomeFurnitureFullCleanupService } from "../src/home/home-furniture-full-cleanup-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_home_furniture_full_cleanup(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`Synthetic home furniture full cleanup probe blocked: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const service = new HomeFurnitureFullCleanupService(database);
const base = process.env.HOME_FURNITURE_FULL_CLEANUP_PROBE_EVENT_ID ?? "home-furniture-full-cleanup-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const room = "synthetic-home-furniture-full-cleanup-room";
const activeExternal = "home-furniture-cleanup-active-admin";
const inactiveExternal = "home-furniture-cleanup-inactive-admin";
const ordinaryExternal = "home-furniture-cleanup-ordinary-user";

async function addEvent(suffix: string, externalUserId: string): Promise<string> {
  const eventId = `${base}-${suffix}`;
  await database.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
    [eventId, eventId, room, externalUserId]
  );
  return eventId;
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(),
    query: (sql, parameters) => inner.query(sql, parameters),
    execute: (sql, parameters) => inner.execute(sql, parameters),
    verifyRollback: () => inner.verifyRollback(),
    close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, parameters) => transaction.query(sql, parameters),
      execute: async (sql, parameters) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic home furniture full cleanup audit failure");
        return transaction.execute(sql, parameters);
      }
    }))
  };
}

async function effectState(): Promise<{
  operations: bigint; outboxes: bigint; audits: bigint; executions: bigint; summaries: bigint; ledgers: bigint;
}> {
  const pattern = `${base}-%`;
  return (await database.query<Array<{
    operations: bigint; outboxes: bigint; audits: bigint; executions: bigint; summaries: bigint; ledgers: bigint;
  }>>(
    `SELECT
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope='home.furniture_full_cleanup' AND idempotency_key LIKE ?) operations,
       (SELECT COUNT(*) FROM outbox_messages message JOIN operations operation_row ON operation_row.id=message.operation_id WHERE operation_row.idempotency_scope='home.furniture_full_cleanup' AND operation_row.idempotency_key LIKE ?) outboxes,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id=audit.operation_id WHERE operation_row.idempotency_scope='home.furniture_full_cleanup' AND operation_row.idempotency_key LIKE ?) audits,
       (SELECT COUNT(*) FROM command_executions WHERE event_id LIKE ?) executions,
       (SELECT COUNT(*) FROM home_furniture_full_cleanup_operations summary JOIN operations operation_row ON operation_row.id=summary.operation_id WHERE operation_row.idempotency_key LIKE ?) summaries,
       (SELECT COUNT(*) FROM furniture_inventory_ledger ledger JOIN operations operation_row ON operation_row.id=ledger.operation_id WHERE operation_row.idempotency_scope='home.furniture_full_cleanup' AND operation_row.idempotency_key LIKE ?) ledgers`,
    [pattern, pattern, pattern, pattern, pattern, pattern]
  ))[0]!;
}

async function furnitureState(): Promise<{
  bag: bigint; removed: bigint; placed: bigint; listed: bigint; point: string; signature: string;
}> {
  return (await database.query<Array<{
    bag: bigint; removed: bigint; placed: bigint; listed: bigint; point: string; signature: string;
  }>>(
    `SELECT
       (SELECT COUNT(*) FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code LIKE 'PROBE-FULL-CLEANUP-%' AND instance.status='bag') bag,
       (SELECT COUNT(*) FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code LIKE 'PROBE-FULL-CLEANUP-%' AND instance.status='removed') removed,
       (SELECT COUNT(*) FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code LIKE 'PROBE-FULL-CLEANUP-%' AND instance.status='placed') placed,
       (SELECT COUNT(*) FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code LIKE 'PROBE-FULL-CLEANUP-%' AND instance.status='listed') listed,
       (SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id=202001 AND currency_code='point') point,
       (SELECT GROUP_CONCAT(CONCAT(instance.id,':',instance.status,':',instance.version) ORDER BY instance.id SEPARATOR '|') FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code LIKE 'PROBE-FULL-CLEANUP-%') signature`
  ))[0]!;
}

async function seedOwner(playerId: number, externalUserId: string, displayName: string): Promise<bigint> {
  await database.execute("INSERT INTO players(id,status) VALUES (?,'active')", [playerId]);
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,?)", [playerId, displayName]);
  const identity = await database.execute(
    "INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?, 'linked')",
    [playerId, externalUserId, displayName]
  );
  return identity.insertId;
}

async function addFurniture(playerId: number, suffix: string, name: string, charm: bigint, status: "bag" | "placed" | "listed"): Promise<bigint> {
  const definition = await database.execute(
    "INSERT INTO furniture_definitions(code,display_name,charm_value,active) VALUES (?,?,?,TRUE)",
    [`PROBE-FULL-CLEANUP-${suffix}`, name, charm]
  );
  const instance = await database.execute(
    "INSERT INTO furniture_inventory_instances(player_id,furniture_definition_id,charm_snapshot,grade_display_name,status,version) VALUES (?,?,?,'S',?,1)",
    [playerId, definition.insertId, charm, status]
  );
  return instance.insertId;
}

try {
  const successEvent = `${base}-success`;
  if (restart) {
    const effectsBefore = await effectState();
    const furnitureBefore = await furnitureState();
    const replay = await service.handle({ eventId: successEvent, externalUserId: activeExternal, destinationId: room });
    assert.equal(replay.status, "cleaned");
    assert.equal(replay.totalRemovedCount, "4");
    assert.deepEqual(await effectState(), effectsBefore);
    assert.deepEqual(await furnitureState(), furnitureBefore);
    process.stdout.write(JSON.stringify({ mode: "verify-restart", scenarios: ["restart-replay"], effects: effectsBefore, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  } else {
    assert.deepEqual(
      (await database.query<Array<{ handler_key: string; rollout_state: string; alias_count: bigint }>>(
        "SELECT registry.handler_key,registry.rollout_state,(SELECT COUNT(*) FROM command_aliases alias_row WHERE alias_row.command_code=registry.command_code AND alias_row.command_text='/가구전체정리' AND alias_row.active=TRUE) alias_count FROM command_registry registry WHERE registry.command_code='HOME_FURNITURE_FULL_CLEANUP'"
      ))[0],
      { handler_key: "home_furniture_full_cleanup", rollout_state: "SHADOW", alias_count: 1n }
    );

    const activeIdentity = await seedOwner(202001, activeExternal, "정리 운영자");
    const inactiveIdentity = await seedOwner(202002, inactiveExternal, "비활성 운영자");
    await seedOwner(202003, ordinaryExternal, "일반 사용자");
    await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (202901,'cleanup-active','정리 운영자','synthetic','active'),(202902,'cleanup-inactive','비활성 운영자','synthetic','inactive')");
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (202901,?),(202902,?)", [activeIdentity, inactiveIdentity]);
    await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (202001,'point',123456,1)");

    for (const [playerId, prefix, highCount] of [[202001, "STANDARD", 8], [202002, "PREMIUM", 13]] as const) {
      for (let index = 1; index <= highCount; index += 1) {
        await addFurniture(playerId, `${prefix}-HIGH-${index}`, `상위가구${String(index).padStart(2, "0")}`, BigInt(2000 - index), "bag");
      }
      await addFurniture(playerId, `${prefix}-TIE-A1`, "가구가", 100n, "bag");
      await addFurniture(playerId, `${prefix}-TIE-A2`, "가구가", 100n, "bag");
      await addFurniture(playerId, `${prefix}-TIE-B`, "가구나", 100n, "bag");
      await addFurniture(playerId, `${prefix}-TIE-C`, "가구다", 100n, "bag");
    }
    await database.execute("INSERT INTO player_passes(player_id,pass_code,enabled,permanent) VALUES (202002,'premium',TRUE,TRUE)");
    const placedId = await addFurniture(202001, "PLACED", "배치가구", 1n, "placed");
    const listedId = await addFurniture(202002, "LISTED", "등록가구", 1n, "listed");

    for (const [suffix, external] of [["ordinary", ordinaryExternal], ["inactive", inactiveExternal]] as const) {
      const eventId = await addEvent(suffix, external);
      assert.deepEqual(await service.handle({ eventId, externalUserId: external, destinationId: room }), { status: "ignored" });
    }
    assert.deepEqual(await effectState(), { operations: 0n, outboxes: 0n, audits: 0n, executions: 0n, summaries: 0n, ledgers: 0n });

    await addEvent("success", activeExternal);
    const cleaned = await service.handle({ eventId: successEvent, externalUserId: activeExternal, destinationId: room });
    assert.equal(cleaned.status, "cleaned");
    assert.equal(cleaned.totalUserCount, "2");
    assert.equal(cleaned.totalRemovedCount, "4");
    assert.ok(cleaned.reply && cleaned.reply.length > 0);
    assert.ok(cleaned.outboxId);
    const afterCleanup = await furnitureState();
    assert.deepEqual({ bag: afterCleanup.bag, removed: afterCleanup.removed, placed: afterCleanup.placed, listed: afterCleanup.listed, point: afterCleanup.point }, { bag: 25n, removed: 4n, placed: 1n, listed: 1n, point: "123456.000" });
    const removedNames = await database.query<Array<{ display_name: string }>>(
      "SELECT definition.display_name FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE instance.status='removed' AND definition.code LIKE 'PROBE-FULL-CLEANUP-%' ORDER BY definition.code"
    );
    assert.deepEqual(removedNames.map((row) => row.display_name).sort(), ["가구나", "가구나", "가구다", "가구다"].sort());
    assert.deepEqual(
      await database.query<Array<{ id: bigint; status: string }>>("SELECT id,status FROM furniture_inventory_instances WHERE id IN (?,?) ORDER BY id", [placedId, listedId]),
      [{ id: placedId, status: "placed" }, { id: listedId, status: "listed" }]
    );
    assert.deepEqual(await effectState(), { operations: 1n, outboxes: 1n, audits: 1n, executions: 1n, summaries: 1n, ledgers: 4n });
    assert.deepEqual(await service.handle({ eventId: successEvent, externalUserId: activeExternal, destinationId: room }), cleaned);
    assert.deepEqual(await effectState(), { operations: 1n, outboxes: 1n, audits: 1n, executions: 1n, summaries: 1n, ledgers: 4n });

    const noTargetEvent = await addEvent("no-target", activeExternal);
    const noTarget = await service.handle({ eventId: noTargetEvent, externalUserId: activeExternal, destinationId: room });
    assert.equal(noTarget.status, "no_target");
    assert.equal(noTarget.totalRemovedCount, "0");
    assert.deepEqual(await furnitureState(), afterCleanup);
    assert.deepEqual(await effectState(), { operations: 2n, outboxes: 2n, audits: 2n, executions: 2n, summaries: 2n, ledgers: 4n });

    await addFurniture(202001, "ROLLBACK-EXTRA", "롤백가구", 0n, "bag");
    const rollbackBefore = await furnitureState();
    const rollbackEvent = await addEvent("rollback", activeExternal);
    await assert.rejects(
      () => new HomeFurnitureFullCleanupService(failAudit(database)).handle({ eventId: rollbackEvent, externalUserId: activeExternal, destinationId: room }),
      /synthetic home furniture full cleanup audit failure/
    );
    assert.deepEqual(await furnitureState(), rollbackBefore);
    assert.deepEqual(await effectState(), { operations: 2n, outboxes: 2n, audits: 2n, executions: 2n, summaries: 2n, ledgers: 4n });
    assert.equal(await database.verifyRollback(), true);

    process.stdout.write(JSON.stringify({
      mode: "probe",
      migrationCount: 202,
      scenarios: ["shadow-registry", "active-admin-only", "unauthorized-silent", "standard-keep-10", "premium-keep-15", "stable-korean-order", "placed-listed-point-immutable", "summary-ledger-audit-outbox", "idempotent-no-target", "rollback-restart"],
      effects: await effectState(),
      operationalDataTouched: false
    }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  }
} finally {
  await database.close();
}
