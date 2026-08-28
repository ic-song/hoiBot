import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { HomeFurnitureDrawService } from "../src/home/home-furniture-draw-service.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_home_furniture_draw(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`Synthetic home furniture draw probe blocked: ${config.database.name}`);
}
let database = createDatabaseClient(config.database);
const service = () => new HomeFurnitureDrawService(database);
const base = process.env.HOME_FURNITURE_DRAW_PROBE_EVENT_ID ?? "home-furniture-draw-g7-20260829-r1";
const restart = process.argv.includes("--verify-restart");
const room = "synthetic-home-furniture-draw-room";
const ticketCode = "ITEM-RWD-001";

async function event(suffix: string, user: string): Promise<string> {
  const id = `${base}-${suffix}`;
  await database.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('d',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
    [id, id, room, user]
  );
  return id;
}

async function addUser(playerId: number, externalUserId: string, nickname: string, ticketQuantity: number): Promise<void> {
  await database.execute("INSERT INTO players(id,status) VALUES (?,'active')", [playerId]);
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,?)", [playerId, nickname]);
  await database.execute(
    "INSERT INTO external_identities(id,player_id,provider_code,external_user_id,status) VALUES (?,?,'kakao',?,'linked')",
    [playerId, playerId, externalUserId]
  );
  const item = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code=?", [ticketCode]))[0]!;
  await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,0)", [playerId, item.id, ticketQuantity]);
}

async function fillBag(playerId: number, count: number): Promise<void> {
  const definition = (await database.query<Array<{ id: bigint }>>("SELECT id FROM furniture_definitions WHERE code='HOME-DRAW-0001'"))[0]!;
  for (let index = 0; index < count; index += 1) {
    await database.execute(
      "INSERT INTO furniture_inventory_instances(player_id,furniture_definition_id,charm_snapshot,grade_display_name,status,version) VALUES (?,?,50,'리브','bag',1)",
      [playerId, definition.id]
    );
  }
}

async function state(playerId: number): Promise<{ tickets: bigint; bag: bigint; inventoryLedgers: bigint; furnitureLedgers: bigint; drawOperations: bigint; drawResults: bigint }> {
  return (await database.query<Array<{ tickets: bigint; bag: bigint; inventoryLedgers: bigint; furnitureLedgers: bigint; drawOperations: bigint; drawResults: bigint }>>(
    "SELECT (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code=?) tickets,(SELECT COUNT(*) FROM furniture_inventory_instances WHERE player_id=? AND status='bag') bag,(SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation ON operation.id=ledger.operation_id WHERE operation.actor_id=(SELECT id FROM external_identities WHERE player_id=? AND provider_code='kakao' LIMIT 1) AND ledger.reason_code='HOME_FURNITURE_DRAW_TICKET') inventoryLedgers,(SELECT COUNT(*) FROM furniture_inventory_ledger ledger WHERE ledger.player_id=? AND ledger.reason_code='HOME_FURNITURE_DRAW') furnitureLedgers,(SELECT COUNT(*) FROM home_furniture_draw_operations WHERE player_id=?) drawOperations,(SELECT COUNT(*) FROM home_furniture_draw_results result JOIN home_furniture_draw_operations operation ON operation.operation_id=result.operation_id WHERE operation.player_id=?) drawResults",
    [playerId, ticketCode, playerId, playerId, playerId, playerId, playerId]
  ))[0]!;
}

async function effects(): Promise<{ operations: bigint; outboxes: bigint; audits: bigint; executions: bigint }> {
  const pattern = `${base}-%`;
  return (await database.query<Array<{ operations: bigint; outboxes: bigint; audits: bigint; executions: bigint }>>(
    "SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='home.furniture_draw' AND idempotency_key LIKE ?) operations,(SELECT COUNT(*) FROM outbox_messages message JOIN operations operation ON operation.id=message.operation_id WHERE operation.idempotency_scope='home.furniture_draw' AND operation.idempotency_key LIKE ?) outboxes,(SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id=audit.operation_id WHERE operation.idempotency_scope='home.furniture_draw' AND operation.idempotency_key LIKE ?) audits,(SELECT COUNT(*) FROM command_executions WHERE event_id LIKE ?) executions",
    [pattern, pattern, pattern, pattern]
  ))[0]!;
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(),
    query: (sql, params) => inner.query(sql, params),
    execute: (sql, params) => inner.execute(sql, params),
    verifyRollback: () => inner.verifyRollback(),
    close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, params) => transaction.query(sql, params),
      execute: async (sql, params) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic furniture draw audit failure");
        return transaction.execute(sql, params);
      }
    }))
  };
}

try {
  const successEvent = `${base}-success`;
  if (restart) {
    const before = await state(337001);
    const beforeEffects = await effects();
    const replay = await service().handle({ eventId: successEvent, externalUserId: "furniture-drawer", destinationId: room, message: "/샵오픈 2" });
    assert.equal(replay.status, "drawn");
    assert.deepEqual(await state(337001), before);
    assert.deepEqual(await effects(), beforeEffects);
    process.stdout.write(JSON.stringify({ mode: "restart", scenarios: ["restart-replay"], state: before, effects: beforeEffects }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  } else {
    const registry = (await database.query<Array<{ handler_key: string; rollout_state: string; alias_count: bigint }>>(
      "SELECT registry.handler_key,registry.rollout_state,(SELECT COUNT(*) FROM command_aliases alias WHERE alias.command_code=registry.command_code AND alias.command_text='/샵오픈' AND alias.active=TRUE) alias_count FROM command_registry registry WHERE registry.command_code='HOME_FURNITURE_DRAW'"
    ))[0]!;
    assert.deepEqual(registry, { handler_key: "home_furniture_draw", rollout_state: "SHADOW", alias_count: 1n });
    const catalog = (await database.query<Array<{ source_sha256: string; entry_count: bigint; grade_count: bigint; weight_total: string }>>(
      "SELECT catalog.source_sha256,(SELECT COUNT(*) FROM home_furniture_draw_entries entry WHERE entry.catalog_version_id=catalog.id) entry_count,(SELECT COUNT(*) FROM home_furniture_draw_grade_bands band WHERE band.catalog_version_id=catalog.id) grade_count,CAST((SELECT SUM(weight_scaled) FROM home_furniture_draw_grade_bands band WHERE band.catalog_version_id=catalog.id) AS CHAR) weight_total FROM home_furniture_draw_catalog_versions catalog WHERE catalog.active=TRUE"
    ))[0]!;
    assert.deepEqual(catalog, {
      source_sha256: "73c93af3f0a5d52e4539047a21ce0d08f33603275ca542974eb11f47f93b2195",
      entry_count: 1551n,
      grade_count: 6n,
      weight_total: "100000"
    });

    await addUser(337001, "furniture-drawer", "가구 뽑기 사용자", 5);
    await addUser(337002, "furniture-no-ticket", "티켓 부족 사용자", 0);
    await addUser(337003, "furniture-capacity", "가방 부족 사용자", 10);
    await addUser(337004, "furniture-concurrent", "동시성 사용자", 4);
    await addUser(337005, "furniture-rollback", "롤백 사용자", 2);
    await fillBag(337003, 9);
    await fillBag(337004, 9);

    const invalidZero = await service().handle({ eventId: await event("invalid-zero", "furniture-drawer"), externalUserId: "furniture-drawer", destinationId: room, message: "/샵오픈 0" });
    assert.equal(invalidZero.status, "rejected");
    assert.match(invalidZero.reply, /1개부터 5,000개/);
    const invalidMaximum = await service().handle({ eventId: await event("invalid-max", "furniture-drawer"), externalUserId: "furniture-drawer", destinationId: room, message: "/샵오픈 5001" });
    assert.equal(invalidMaximum.status, "rejected");

    const insufficient = await service().handle({ eventId: await event("insufficient", "furniture-no-ticket"), externalUserId: "furniture-no-ticket", destinationId: room, message: "/샵오픈" });
    assert.equal(insufficient.status, "rejected");
    assert.match(insufficient.reply, /아이템이 부족합니다/);

    const capacity = await service().handle({ eventId: await event("capacity", "furniture-capacity"), externalUserId: "furniture-capacity", destinationId: room, message: "/샵오픈 2" });
    assert.equal(capacity.status, "rejected");
    assert.match(capacity.reply, /가구 가방 공간이 부족합니다/);
    assert.deepEqual(await state(337003), { tickets: 10n, bag: 9n, inventoryLedgers: 0n, furnitureLedgers: 0n, drawOperations: 0n, drawResults: 0n });

    await event("success", "furniture-drawer");
    const success = await service().handle({ eventId: successEvent, externalUserId: "furniture-drawer", destinationId: room, message: "/샵오픈 2" });
    assert.equal(success.status, "drawn");
    assert.equal(success.requestedQuantity, "2");
    assert.equal(success.draws?.length, 2);
    assert.ok(success.draws?.every((draw) => /^[0-9A-Z]{6}$/.test(draw.instanceCode)));
    assert.equal(new Set(success.draws?.map((draw) => draw.instanceCode)).size, 2);
    assert.deepEqual(await state(337001), { tickets: 3n, bag: 2n, inventoryLedgers: 1n, furnitureLedgers: 2n, drawOperations: 1n, drawResults: 2n });
    assert.deepEqual(await service().handle({ eventId: successEvent, externalUserId: "furniture-drawer", destinationId: room, message: "/샵오픈 2" }), success);

    const concurrentEventA = await event("concurrent-a", "furniture-concurrent");
    const concurrentEventB = await event("concurrent-b", "furniture-concurrent");
    const concurrent = await Promise.all([
      service().handle({ eventId: concurrentEventA, externalUserId: "furniture-concurrent", destinationId: room, message: "/샵오픈" }),
      service().handle({ eventId: concurrentEventB, externalUserId: "furniture-concurrent", destinationId: room, message: "/샵오픈" })
    ]);
    assert.deepEqual(concurrent.map((result) => result.status).sort(), ["drawn", "rejected"]);
    assert.deepEqual(await state(337004), { tickets: 3n, bag: 10n, inventoryLedgers: 1n, furnitureLedgers: 1n, drawOperations: 1n, drawResults: 1n });

    const rollbackBefore = await state(337005);
    const rollbackEffects = await effects();
    const rollbackEvent = await event("rollback", "furniture-rollback");
    await assert.rejects(
      () => new HomeFurnitureDrawService(failAudit(database)).handle({ eventId: rollbackEvent, externalUserId: "furniture-rollback", destinationId: room, message: "/샵오픈" }),
      /synthetic furniture draw audit failure/
    );
    assert.deepEqual(await state(337005), rollbackBefore);
    assert.deepEqual(await effects(), rollbackEffects);
    assert.equal(await database.verifyRollback(), true);

    await database.close();
    database = createDatabaseClient(config.database);
    assert.deepEqual(await service().handle({ eventId: successEvent, externalUserId: "furniture-drawer", destinationId: room, message: "/샵오픈 2" }), success);
    process.stdout.write(JSON.stringify({
      mode: "probe",
      migrationCount: 329,
      scenarios: [
        "shadow-registry",
        "catalog-1551-and-six-grade-parity",
        "exact-command-and-quantity-bounds",
        "ticket-insufficient",
        "capacity-before-plus-request",
        "two-stage-stable-rng",
        "six-character-instance-code",
        "ticket-and-furniture-ledgers",
        "same-event-replay",
        "different-event-player-lock",
        "rollback",
        "restart-replay"
      ],
      success,
      state: await state(337001),
      effects: await effects(),
      operationalDataTouched: false
    }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
  }
} finally {
  await database.close();
}