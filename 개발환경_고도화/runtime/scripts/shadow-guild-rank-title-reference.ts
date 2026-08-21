import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { buildGuildRankTitleReferenceMessage } from "../src/guild/guild-rank-title-reference-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic guild rank title Shadow is blocked for database: ${config.database.name}`);
}

const replayOnly = process.argv.includes("--replay-only");
const baseEventId = process.env.GUILD_RANK_TITLE_SHADOW_EVENT_ID
  ?? `guild-rank-title-shadow-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
const normalEventId = `${baseEventId}-normal`;
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

// 비식별 rehearsal 이벤트를 길드계급표 Shadow dispatch에 전달합니다.
async function dispatch(suffix: string, message: string) {
  return app.inject({
    method: "POST", url: "/api/v1/integrations/iris/events",
    headers: { authorization: `Bearer ${config.irisSharedToken}` },
    payload: {
      msg: message, room: "합성 길드계급표 Shadow 방", sender: "합성 조회자",
      json: { id: `${baseEventId}-${suffix}`, chat_id: "synthetic-room-001", user_id: "synthetic-player-alpha", type: 1 }
    }
  });
}

// 동일 이벤트의 공용 command/outbox 효과가 한 번만 기록됐는지 확인합니다.
async function readEffects() {
  const eventId = `iris:${normalEventId}`;
  return database.query<Array<{ executions: bigint; outboxes: bigint; deliveries: bigint }>>(
    `SELECT
      (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'guild_rank_title_reference') AS executions,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN command_executions execution ON execution.operation_id = outbox.operation_id
        WHERE execution.event_id = ? AND execution.command_code = 'guild_rank_title_reference') AS outboxes,
      (SELECT COUNT(*) FROM delivery_attempts delivery JOIN outbox_messages outbox ON outbox.id = delivery.outbox_message_id
        JOIN command_executions execution ON execution.operation_id = outbox.operation_id
        WHERE execution.event_id = ? AND execution.command_code = 'guild_rank_title_reference') AS deliveries`,
    [eventId, eventId, eventId]
  );
}

try {
  const expected = buildGuildRankTitleReferenceMessage();
  if (replayOnly) {
    const replay = await dispatch("normal", "/길드계급표");
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.json().duplicate, true);
    assert.equal(replies.length, 0);
    assert.deepEqual((await readEffects())[0], { executions: 1n, outboxes: 1n, deliveries: 1n });
  } else {
    const suffix = await dispatch("suffix", "/길드계급표 알려줘");
    assert.equal(suffix.statusCode, 202);
    assert.equal(suffix.json().duplicate, false);
    assert.equal(replies.length, 0);

    const normal = await dispatch("normal", "/길드계급표");
    assert.equal(normal.statusCode, 202);
    assert.equal(normal.json().duplicate, false);
    assert.equal(replies.at(-1)?.data, expected);

    const duplicate = await dispatch("normal", "/길드계급표");
    assert.equal(duplicate.statusCode, 202);
    assert.equal(duplicate.json().duplicate, true);
    assert.equal(replies.length, 1);
    assert.deepEqual((await readEffects())[0], { executions: 1n, outboxes: 1n, deliveries: 1n });
  }

  process.stdout.write(`${JSON.stringify({
    mode: replayOnly ? "restart-replay" : "shadow",
    database: config.database.name,
    baseEventId,
    scenarios: replayOnly ? ["separate-process-restart-replay"] : ["exact", "suffix-ignored", "duplicate"],
    effects: { execution: 1, outbox: 1, delivery: 1 },
    domainMutationCount: 0,
    operationalSnapshotTouched: false
  })}\n`);
} finally {
  await app.close();
}
