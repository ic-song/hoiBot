import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { ConstructionEditService } from "../src/home/construction-edit-service.js";
import {
  buildConstructionEditCompletedMessage,
  findLegacyHomeName
} from "../src/home/construction-edit-policy.js";
import { MariaConstructionEditRepository } from "../src/home/maria-construction-edit-repository.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic construction probe is blocked for database: ${config.database.name}`);
}

const verifyRestart = process.argv.includes("--verify-restart");
const baseEventId = process.env.CONSTRUCTION_EDIT_PROBE_EVENT_ID
  ?? `construction-edit-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
if (verifyRestart && process.env.CONSTRUCTION_EDIT_PROBE_EVENT_ID === undefined) {
  throw new Error("CONSTRUCTION_EDIT_PROBE_EVENT_ID is required with --verify-restart.");
}

const database = createDatabaseClient(config.database);
const replies: Array<{ room: string; data: string }> = [];
const app = buildApp(config, {
  database,
  inspectIrisChannel: async () => ({
    mode: "operational", channelClass: "open_group", reason: "allowed",
    evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false }
  }),
  sendIrisTextReply: async (reply) => { replies.push(reply); }
});

// 비식별 Iris 이벤트를 합성해 app dispatch와 DB transaction을 함께 실행합니다.
async function dispatch(providerEventId: string, userId: string, message: string) {
  return app.inject({
    method: "POST", url: "/api/v1/integrations/iris/events",
    headers: { authorization: `Bearer ${config.irisSharedToken}` },
    payload: {
      msg: message, room: "합성 건설수정 방", sender: "합성 관리자",
      json: { id: providerEventId, chat_id: "synthetic-room-001", user_id: userId, type: 1 }
    }
  });
}

// command_executions FK를 만족하는 비식별 합성 event를 준비합니다.
async function seedEvent(eventId: string): Promise<void> {
  await database.execute(
    `INSERT INTO event_inbox
      (event_id, provider_event_id, external_channel_id, external_user_id, event_kind, direction, payload_hash, processing_status, received_at)
     VALUES (?, ?, 'synthetic-room-001', 'synthetic-admin-alpha', 'message', 'incoming', REPEAT('7', 64), 'processed', UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE processing_status = VALUES(processing_status)`,
    [eventId, eventId]
  );
}

// 감사 기록 직전 실패를 주입해 전체 transaction rollback을 검증합니다.
function failingOnAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(),
    query: (sql, params) => inner.query(sql, params),
    execute: (sql, params) => inner.execute(sql, params),
    verifyRollback: () => inner.verifyRollback(),
    close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) =>
      inner.withTransaction((transaction) => work({
        query: (sql, params) => transaction.query(sql, params),
        execute: async (sql, params) => {
          if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic construction audit failure");
          return transaction.execute(sql, params);
        }
      }))
  };
}

// 저장소 legacy homeInfo의 최초 floor 매핑과 런타임 정책을 전수 대조합니다.
async function verifyLegacyCatalog(): Promise<number> {
  const raw = JSON.parse(await readFile(path.resolve("../../data/petSweetHomeInfo.json"), "utf8")) as {
    homeInfo: Array<{ floor: number; display: string }>;
  };
  const firstByFloor = new Map<number, string>();
  for (const entry of raw.homeInfo) {
    if (!firstByFloor.has(Number(entry.floor))) firstByFloor.set(Number(entry.floor), entry.display);
  }
  for (let floor = 1; floor <= 300; floor++) {
    assert.equal(findLegacyHomeName(floor), firstByFloor.get(floor), `legacy home catalog mismatch at floor ${floor}`);
  }
  assert.equal(buildConstructionEditCompletedMessage({
    targetName: "테스트베타", floorArea: 55, homeName: "마당 있는 이층집🏠", baseExperience: "30"
  }), "✅ 건설 수정 완료\n대상: 테스트베타\n변경 평수: 55평\n집 이름: 마당 있는 이층집🏠\n누적 매력: 30💕");
  return raw.homeInfo.length;
}

try {
  const legacyCatalogEntries = await verifyLegacyCatalog();
  const normalProviderEventId = `${baseEventId}-normal`;
  const normalEventId = `iris:${normalProviderEventId}`;
  const scope = "home.construction-edit:900000001";

  if (verifyRestart) {
    const homeBefore = await database.query<Array<{ display_name: string; floor_area: bigint; version: bigint }>>(
      "SELECT display_name, floor_area, version FROM player_homes WHERE player_id = 900000002"
    );
    const replay = await dispatch(normalProviderEventId, "synthetic-admin-alpha", "/건설수정 테스트베타 55");
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.json().duplicate, true);
    assert.equal(replies.length, 0);
    const homeAfter = await database.query<Array<{ display_name: string; floor_area: bigint; version: bigint }>>(
      "SELECT display_name, floor_area, version FROM player_homes WHERE player_id = 900000002"
    );
    assert.deepEqual(homeAfter, homeBefore);
    const operationCount = await database.query<Array<{ count: bigint }>>(
      "SELECT COUNT(*) AS count FROM operations WHERE idempotency_scope = ? AND idempotency_key = ?",
      [scope, normalEventId]
    );
    assert.equal(operationCount[0]?.count, 1n);
    process.stdout.write(`${JSON.stringify({
      mode: "verify-restart", database: config.database.name, baseEventId,
      legacyCatalogEntries, duplicate: true, additionalReplies: 0, operationCount: 1,
      homeMutationAfterRestart: false, operationalSnapshotTouched: false
    })}\n`);
  } else {
    await database.execute(
      "UPDATE player_homes SET display_name = '베타의 합성 홈', floor_area = 9, base_experience = 30, version = version + 1 WHERE player_id = 900000002"
    );
    const furnitureBefore = await database.query<Array<{ owned: bigint; placed: bigint }>>(
      `SELECT
        (SELECT COUNT(*) FROM owned_furniture WHERE player_id = 900000002) AS owned,
        (SELECT COUNT(*) FROM furniture_placements WHERE player_id = 900000002) AS placed`
    );
    const normal = await dispatch(normalProviderEventId, "synthetic-admin-alpha", "/건설수정 테스트베타 55");
    assert.equal(normal.statusCode, 202);
    assert.equal(normal.json().duplicate, false);
    assert.equal(replies.at(-1)?.data, "✅ 건설 수정 완료\n대상: 테스트베타\n변경 평수: 55평\n집 이름: 마당 있는 이층집🏠\n누적 매력: 30💕");

    const effects = await database.query<Array<{
      operations: bigint; executions: bigint; audits: bigint; outboxes: bigint; deliveries: bigint;
    }>>(
      `SELECT
        (SELECT COUNT(*) FROM operations WHERE idempotency_scope = ? AND idempotency_key = ?) AS operations,
        (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'construction_edit') AS executions,
        (SELECT COUNT(*) FROM command_audit audit JOIN operations operation_row ON operation_row.id = audit.operation_id
          WHERE operation_row.idempotency_scope = ? AND operation_row.idempotency_key = ?) AS audits,
        (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
          WHERE operation_row.idempotency_scope = ? AND operation_row.idempotency_key = ?) AS outboxes,
        (SELECT COUNT(*) FROM delivery_attempts delivery JOIN outbox_messages outbox ON outbox.id = delivery.outbox_message_id
          JOIN operations operation_row ON operation_row.id = outbox.operation_id
          WHERE operation_row.idempotency_scope = ? AND operation_row.idempotency_key = ?) AS deliveries`,
      [scope, normalEventId, normalEventId, scope, normalEventId, scope, normalEventId, scope, normalEventId]
    );
    assert.deepEqual(effects[0], { operations: 1n, executions: 1n, audits: 1n, outboxes: 1n, deliveries: 1n });

    const duplicate = await dispatch(normalProviderEventId, "synthetic-admin-alpha", "/건설수정 테스트베타 55");
    assert.equal(duplicate.statusCode, 202);
    assert.equal(duplicate.json().duplicate, true);
    const replyCountAfterDuplicate = replies.length;

    const forbidden = await dispatch(`${baseEventId}-forbidden`, "synthetic-non-admin-gamma", "/건설수정 테스트베타 60");
    assert.equal(forbidden.statusCode, 202);
    assert.equal(replies.length, replyCountAfterDuplicate);

    const directEventId = `iris:${baseEventId}-direct`;
    await seedEvent(directEventId);
    const service = new ConstructionEditService(new MariaConstructionEditRepository(database));
    const directInput = {
      externalUserId: "synthetic-admin-alpha", channelId: "synthetic-room-001",
      message: "/건설수정 테스트베타 60", eventId: directEventId
    };
    const directFirst = await service.handle(directInput);
    const directReplay = await service.handle(directInput);
    assert.deepEqual(directReplay, directFirst);
    const directCount = await database.query<Array<{ count: bigint }>>(
      "SELECT COUNT(*) AS count FROM operations WHERE idempotency_scope = ? AND idempotency_key = ?",
      [scope, directEventId]
    );
    assert.equal(directCount[0]?.count, 1n);

    const failureEventId = `iris:${baseEventId}-failure`;
    await seedEvent(failureEventId);
    const beforeFailure = await database.query<Array<{ display_name: string; floor_area: bigint; version: bigint }>>(
      "SELECT display_name, floor_area, version FROM player_homes WHERE player_id = 900000002"
    );
    await assert.rejects(
      () => new ConstructionEditService(new MariaConstructionEditRepository(failingOnAudit(database))).handle({
        externalUserId: "synthetic-admin-alpha", channelId: "synthetic-room-001",
        message: "/건설수정 테스트베타 65", eventId: failureEventId
      }),
      /synthetic construction audit failure/
    );
    const afterFailure = await database.query<Array<{ display_name: string; floor_area: bigint; version: bigint }>>(
      "SELECT display_name, floor_area, version FROM player_homes WHERE player_id = 900000002"
    );
    assert.deepEqual(afterFailure, beforeFailure);
    const rollbackEffects = await database.query<Array<{ operations: bigint; executions: bigint; outboxes: bigint }>>(
      `SELECT
        (SELECT COUNT(*) FROM operations WHERE idempotency_scope = ? AND idempotency_key = ?) AS operations,
        (SELECT COUNT(*) FROM command_executions WHERE event_id = ?) AS executions,
        (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id = outbox.operation_id
          WHERE operation_row.idempotency_scope = ? AND operation_row.idempotency_key = ?) AS outboxes`,
      [scope, failureEventId, failureEventId, scope, failureEventId]
    );
    assert.deepEqual(rollbackEffects[0], { operations: 0n, executions: 0n, outboxes: 0n });

    const furnitureAfter = await database.query<Array<{ owned: bigint; placed: bigint }>>(
      `SELECT
        (SELECT COUNT(*) FROM owned_furniture WHERE player_id = 900000002) AS owned,
        (SELECT COUNT(*) FROM furniture_placements WHERE player_id = 900000002) AS placed`
    );
    assert.deepEqual(furnitureAfter, furnitureBefore);

    process.stdout.write(`${JSON.stringify({
      mode: "probe", database: config.database.name, baseEventId, legacyCatalogEntries,
      scenarios: ["normal", "event-duplicate", "forbidden", "direct-replay", "mid-write-rollback"],
      effects: { operation: 1, execution: 1, audit: 1, outbox: 1, delivery: 1 },
      directReplayOperationCount: 1, rollbackEffects: { operation: 0, execution: 0, outbox: 0 },
      furnitureRelationsPreserved: true, operationalSnapshotTouched: false
    })}\n`);
  }
} finally {
  await app.close();
}
