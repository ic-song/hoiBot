import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic construction Shadow is blocked for database: ${config.database.name}`);
}

const baseEventId = process.env.CONSTRUCTION_EDIT_SHADOW_EVENT_ID
  ?? `construction-edit-shadow-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
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

// 비식별 rehearsal 이벤트를 Shadow app dispatch에 전달합니다.
async function dispatch(suffix: string, message: string, userId = "synthetic-admin-alpha") {
  return app.inject({
    method: "POST", url: "/api/v1/integrations/iris/events",
    headers: { authorization: `Bearer ${config.irisSharedToken}` },
    payload: {
      msg: message, room: "합성 건설수정 Shadow 방", sender: "합성 관리자",
      json: { id: `${baseEventId}-${suffix}`, chat_id: "synthetic-room-001", user_id: userId, type: 1 }
    }
  });
}

// 대상 주택의 변경 감지용 스냅샷을 읽습니다.
async function readHome() {
  return database.query<Array<{ display_name: string; base_experience: bigint; floor_area: bigint; version: bigint }>>(
    "SELECT display_name, base_experience, floor_area, version FROM player_homes WHERE player_id = 900000002"
  );
}

// 기존 가구 소유·배치 관계의 건수를 읽습니다.
async function readFurniture() {
  return database.query<Array<{ owned: bigint; placed: bigint }>>(
    `SELECT
      (SELECT COUNT(*) FROM owned_furniture WHERE player_id = 900000002) AS owned,
      (SELECT COUNT(*) FROM furniture_placements WHERE player_id = 900000002) AS placed`
  );
}

// 주택을 바꾸지 않아야 하는 Shadow 시나리오를 실행합니다.
async function verifyNoMutation(
  suffix: string,
  message: string,
  expectedReply: string | undefined,
  userId = "synthetic-admin-alpha"
): Promise<void> {
  const homeBefore = await readHome();
  const replyCount = replies.length;
  const response = await dispatch(suffix, message, userId);
  assert.equal(response.statusCode, 202);
  assert.equal(response.json().duplicate, false);
  assert.deepEqual(await readHome(), homeBefore);
  if (expectedReply === undefined) assert.equal(replies.length, replyCount);
  else assert.equal(replies.at(-1)?.data, expectedReply);
}

try {
  await database.execute(
    "UPDATE player_homes SET display_name = 'Shadow 시작 주택', floor_area = 9, base_experience = 30, version = version + 1 WHERE player_id = 900000002"
  );
  const furnitureBefore = await readFurniture();

  await verifyNoMutation("usage", "/건설수정", "사용법: /건설수정 닉네임 [평수]\n예) /건설수정 🏆호이 남 5");
  await verifyNoMutation("numeric", "/건설수정 테스트베타 55 해봐", "평수는 숫자로 입력해주세요.\n예) /건설수정 🏆호이 남 5");
  await verifyNoMutation("gap", "/건설수정 테스트베타 189", "해당 평수의 집 정보가 없습니다.\n가능한 평수: 1 ~ 300");
  await verifyNoMutation("missing", "/건설수정 없는대상 60", "❌ 대상 유저 [없는대상]님이 존재하지 않습니다.");
  await verifyNoMutation("prefix", "/건설수정테스트베타 60", undefined);
  await verifyNoMutation("forbidden", "/건설수정 테스트베타 60", undefined, "synthetic-non-admin-gamma");

  const normalEvent = `${baseEventId}-normal`;
  const normal = await dispatch("normal", "/건설수정 테스트베타 190");
  assert.equal(normal.statusCode, 202);
  assert.equal(normal.json().duplicate, false);
  assert.equal(replies.at(-1)?.data, "✅ 건설 수정 완료\n대상: 테스트베타\n변경 평수: 190평\n집 이름: 갤러리아 호레🏠\n누적 매력: 30💕");
  const completedHome = await readHome();
  assert.equal(completedHome[0]?.floor_area, 190n);
  assert.equal(completedHome[0]?.display_name, "갤러리아 호레🏠");

  const replyCount = replies.length;
  const duplicate = await dispatch("normal", "/건설수정 테스트베타 190");
  assert.equal(duplicate.statusCode, 202);
  assert.equal(duplicate.json().duplicate, true);
  assert.equal(replies.length, replyCount);
  assert.deepEqual(await readHome(), completedHome);
  assert.deepEqual(await readFurniture(), furnitureBefore);

  const eventId = `iris:${normalEvent}`;
  const scope = "home.construction-edit:900000001";
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
    [scope, eventId, eventId, scope, eventId, scope, eventId, scope, eventId]
  );
  assert.deepEqual(effects[0], { operations: 1n, executions: 1n, audits: 1n, outboxes: 1n, deliveries: 1n });

  process.stdout.write(`${JSON.stringify({
    mode: "shadow", database: config.database.name, baseEventId,
    scenarios: ["usage", "numeric-suffix", "legacy-gap", "missing-player", "prefix-collision", "forbidden", "normal", "duplicate"],
    effects: { operation: 1, execution: 1, audit: 1, outbox: 1, delivery: 1 },
    homeMutationCount: 1, furnitureRelationsPreserved: true, operationalSnapshotTouched: false
  })}\n`);
} finally {
  await app.close();
}
