import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { HomeFurnitureRankReadService } from "../src/home/home-furniture-rank-read-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_home_furniture_rank(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`Synthetic home furniture rank probe blocked: ${config.database.name}`);
}

const base = process.env.HOME_FURNITURE_RANK_PROBE_EVENT_ID ?? "home-furniture-rank-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const destinationId = "synthetic-home-furniture-rank-room";
const externalUserId = "home-furniture-rank-viewer";
const database = createDatabaseClient(config.database);
const service = new HomeFurnitureRankReadService(database);

async function addEvent(eventId: string): Promise<void> {
  await database.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,\'message\',\'incoming\',REPEAT(\'2\',64),\'processed\',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
    [eventId, eventId, destinationId, externalUserId]
  );
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
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic home furniture rank audit failure");
        return transaction.execute(sql, parameters);
      }
    }))
  };
}

async function operationState(eventId: string): Promise<{ operations: bigint; outboxes: bigint; audits: bigint; executions: bigint }> {
  return (await database.query<Array<{ operations: bigint; outboxes: bigint; audits: bigint; executions: bigint }>>(
    `SELECT
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope='home.furniture_rank_read' AND idempotency_key=?) operations,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='home.furniture_rank_read' AND operation_row.idempotency_key=?) outboxes,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id=audit.operation_id WHERE operation_row.idempotency_scope='home.furniture_rank_read' AND operation_row.idempotency_key=?) audits,
       (SELECT COUNT(*) FROM command_executions execution JOIN operations operation_row ON operation_row.id=execution.operation_id WHERE operation_row.idempotency_scope='home.furniture_rank_read' AND operation_row.idempotency_key=?) executions`,
    [eventId, eventId, eventId, eventId]
  ))[0]!;
}

async function domainState(): Promise<{ players: bigint; definitions: bigint; instances: bigint; placed: bigint; bag: bigint; versions: string }> {
  return (await database.query<Array<{ players: bigint; definitions: bigint; instances: bigint; placed: bigint; bag: bigint; versions: string }>>(
    `SELECT
       (SELECT COUNT(*) FROM players WHERE id BETWEEN 200001 AND 200200) players,
       (SELECT COUNT(*) FROM furniture_definitions WHERE code LIKE 'PROBE-HOME-RANK-%') definitions,
       (SELECT COUNT(*) FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code LIKE 'PROBE-HOME-RANK-%') instances,
       (SELECT COUNT(*) FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code LIKE 'PROBE-HOME-RANK-%' AND instance.status='placed') placed,
       (SELECT COUNT(*) FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code LIKE 'PROBE-HOME-RANK-%' AND instance.status='bag') bag,
       (SELECT GROUP_CONCAT(CONCAT(instance.id,':',instance.status,':',instance.version) ORDER BY instance.id SEPARATOR '|') FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code LIKE 'PROBE-HOME-RANK-%') versions`
  ))[0]!;
}

try {
  const successEvent = `${base}-success`;
  if (restart) {
    const before = await operationState(successEvent);
    const domainBefore = await domainState();
    const result = await service.read({ eventId: successEvent, externalUserId, destinationId });
    const after = await operationState(successEvent);
    assert.equal(result.rowCount, 100);
    assert.deepEqual(after, before);
    assert.deepEqual(after, { operations: 1n, outboxes: 1n, audits: 1n, executions: 1n });
    assert.deepEqual(await domainState(), domainBefore);
    process.stdout.write(JSON.stringify({ mode: "verify-restart", scenarios: ["restart-replay"], operationState: after, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  } else {
    assert.deepEqual(
      (await database.query<Array<{ handler_key: string; auth_scope: string; rollout_state: string; alias_count: bigint }>>(
        "SELECT registry.handler_key,registry.auth_scope,registry.rollout_state,(SELECT COUNT(*) FROM command_aliases alias_row WHERE alias_row.command_code=registry.command_code AND alias_row.command_text='/가구순위' AND alias_row.active=TRUE) alias_count FROM command_registry registry WHERE registry.command_code='HOME_FURNITURE_RANK_READ'"
      ))[0],
      { handler_key: "home_furniture_rank_read", auth_scope: "TRUSTED_DISPLAY_NAME", rollout_state: "SHADOW", alias_count: 1n }
    );

    for (let index = 1; index <= 103; index += 1) {
      const playerId = 200000 + index;
      const code = `PROBE-HOME-RANK-${String(index).padStart(3, "0")}`;
      const name = index === 2 ? "가구가" : index === 3 ? "가구나" : index === 4 || index === 5 ? "같은가구" : `순위가구${String(index).padStart(3, "0")}`;
      const charm = index === 1 ? 9007199254740993n : index === 2 || index === 3 ? 900n : index === 4 || index === 5 ? 800n : BigInt(700 - index);
      await database.execute("INSERT INTO players(id,status) VALUES (?,'active')", [playerId]);
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,?)", [playerId, `가구주인${String(index).padStart(3, "0")}`]);
      const definition = await database.execute("INSERT INTO furniture_definitions(code,display_name,charm_value,active) VALUES (?,?,?,TRUE)", [code, name, charm]);
      await database.execute("INSERT INTO furniture_inventory_instances(player_id,furniture_definition_id,charm_snapshot,grade_display_name,status,version) VALUES (?,?,?,'S','placed',1)", [playerId, definition.insertId, charm]);
    }
    const bagOwner = 200150;
    await database.execute("INSERT INTO players(id,status) VALUES (?,'active')", [bagOwner]);
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'가방주인')", [bagOwner]);
    const bagDefinition = await database.execute("INSERT INTO furniture_definitions(code,display_name,charm_value,active) VALUES ('PROBE-HOME-RANK-BAG','가방전용가구',9999999999999999,TRUE)");
    await database.execute("INSERT INTO furniture_inventory_instances(player_id,furniture_definition_id,charm_snapshot,grade_display_name,status,version) VALUES (?,?,9999999999999999,'SS','bag',1)", [bagOwner, bagDefinition.insertId]);

    const sameIds = await database.query<Array<{ id: bigint }>>(
      "SELECT instance.id FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE definition.code IN ('PROBE-HOME-RANK-004','PROBE-HOME-RANK-005') ORDER BY instance.id"
    );
    const domainBefore = await domainState();
    await addEvent(successEvent);
    const result = await service.read({ eventId: successEvent, externalUserId, destinationId });
    assert.equal(result.rowCount, 100);
    assert.ok(result.data.startsWith("🛌 펫스윗홈 배치가구 순위 🛌\n(펫하우스 배치 가구매력 기준입니다.)\n\n"));
    assert.match(result.data, /🥇\. \[가구주인001\] : 순위가구001\(\+9,007,199,254,740,993💕\)\[S\]/);
    assert.doesNotMatch(result.data, /가방전용가구/);
    assert.ok(result.data.indexOf("가구가") < result.data.indexOf("가구나"));
    const ownerFirst = sameIds[0]!.id < sameIds[1]!.id ? "가구주인004" : "가구주인005";
    const ownerSecond = ownerFirst === "가구주인004" ? "가구주인005" : "가구주인004";
    assert.ok(result.data.indexOf(ownerFirst) < result.data.indexOf(ownerSecond));
    assert.equal((result.data.match(/\u200b/g) ?? []).length, 500);
    assert.ok(result.data.indexOf("10. [") < result.data.indexOf("\u200b"));
    assert.ok(result.data.indexOf("\u200b") < result.data.indexOf("11. ["));
    assert.doesNotMatch(result.data, /가구주인103/);
    assert.deepEqual(await domainState(), domainBefore);
    assert.deepEqual(await operationState(successEvent), { operations: 1n, outboxes: 1n, audits: 1n, executions: 1n });
    assert.deepEqual(await service.read({ eventId: successEvent, externalUserId, destinationId }), result);
    assert.deepEqual(await operationState(successEvent), { operations: 1n, outboxes: 1n, audits: 1n, executions: 1n });
    assert.deepEqual(await domainState(), domainBefore);

    const rollbackEvent = `${base}-rollback`;
    await addEvent(rollbackEvent);
    await assert.rejects(
      () => new HomeFurnitureRankReadService(failAudit(database)).read({ eventId: rollbackEvent, externalUserId, destinationId }),
      /synthetic home furniture rank audit failure/
    );
    assert.deepEqual(await operationState(rollbackEvent), { operations: 0n, outboxes: 0n, audits: 0n, executions: 0n });
    assert.deepEqual(await domainState(), domainBefore);
    assert.equal(await database.verifyRollback(), true);

    process.stdout.write(JSON.stringify({
      mode: "probe",
      scenarios: ["shadow-registry-alias", "placed-only", "charm-desc-bigint", "korean-name-order", "stable-owned-id-order", "top-100", "allsee-before-eleven", "read-only-domain", "audit-idempotent", "rollback"],
      result: { rows: result.rowCount, sameStableIds: sameIds.map((row) => row.id.toString()) },
      operationalDataTouched: false
    }) + "\n");
  }
} finally {
  await database.close();
}
