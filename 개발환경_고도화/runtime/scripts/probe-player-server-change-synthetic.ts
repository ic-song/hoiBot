import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { IrisAdminCommandService } from "../src/admin/iris-admin-command-service.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic server-change probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const service = new IrisAdminCommandService(database);
const runKey = process.env.PLAYER_SERVER_PROBE_RUN_KEY ?? randomUUID().replaceAll("-", "").slice(0, 12);
if (!/^[a-z0-9]{6,32}$/i.test(runKey)) throw new Error("PLAYER_SERVER_PROBE_RUN_KEY must be 6-32 alphanumeric characters.");
const replayOnly = process.env.PLAYER_SERVER_PROBE_REPLAY_ONLY === "true";
const eventId = `synthetic-server-change-${runKey}`;
const expectedReply = "✅ [테스트베타] 님의 서버가 [합성 테스트 서버 2] 로 이동되었습니다.";

// 거부 응답이 기대한 코드인지 확인합니다.
async function assertApplicationError(work: () => Promise<unknown>, code: string, statusCode: number): Promise<void> {
  await assert.rejects(work, (error: unknown) =>
    error instanceof ApplicationError && error.code === code && error.statusCode === statusCode
  );
}

try {
  if (!replayOnly) {
    const before = await database.query<Array<{ game_server_id: bigint; version: bigint }>>(
      "SELECT game_server_id, version FROM player_profiles WHERE player_id = 900000002"
    );
    assert.equal(before[0]?.game_server_id.toString(), "900000001");
    assert.equal(before[0]?.version.toString(), "1");

    await assertApplicationError(() => service.changePlayerServer({
      externalUserId: "synthetic-non-admin-gamma",
      channelId: "synthetic-room-001",
      message: "/서버이동 테스트베타 합성 테스트 서버 2",
      eventId: `denied-${eventId}`
    }), "FORBIDDEN", 403);

    await assertApplicationError(() => service.changePlayerServer({
      externalUserId: "synthetic-admin-alpha",
      channelId: "synthetic-room-001",
      message: "/서버이동 테스트베타 합성 테스트 서버 2 안내",
      eventId: `invalid-${eventId}`
    }), "INVALID_SERVER", 422);

    await database.execute(
      `INSERT INTO event_inbox
         (event_id, provider_code, provider_event_id, external_channel_id, channel_id,
          external_user_id, external_identity_id, event_kind, event_origin, direction,
          payload_hash, parse_status, processing_status, received_at)
       VALUES (?, 'iris', ?, 'synthetic-room-001', 900000001,
         'synthetic-admin-alpha', 900000004, 'message', 'synthetic_probe', 'incoming',
         REPEAT('0', 64), 'parsed', 'processed', UTC_TIMESTAMP(3))`,
      [eventId, eventId]
    );
  }

  const command = {
    externalUserId: "synthetic-admin-alpha",
    channelId: "synthetic-room-001",
    message: "/서버이동 테스트베타 합성 테스트 서버 2",
    eventId
  };
  const first = await service.changePlayerServer(command);
  const replay = await service.changePlayerServer(command);
  assert.deepEqual(first, replay);
  assert.equal(first.data, expectedReply);

  const profile = await database.query<Array<{ server_code: string; version: bigint }>>(
    `SELECT server.code AS server_code, profile.version
     FROM player_profiles profile JOIN game_servers server ON server.id = profile.game_server_id
     WHERE profile.player_id = 900000002`
  );
  assert.equal(profile[0]?.server_code, "synthetic-server-two");
  assert.equal(profile[0]?.version.toString(), "2");

  const operations = await database.query<Array<{ id: bigint; status: string; result_json: string | Record<string, unknown> }>>(
    `SELECT id, status, result_json FROM operations
     WHERE idempotency_scope = 'player.server.change:900000002' AND idempotency_key = ?`,
    [eventId]
  );
  assert.equal(operations.length, 1);
  assert.equal(operations[0]?.status, "completed");

  const operationId = operations[0]!.id;
  const audits = await database.query<Array<{ action_code: string; result_code: string }>>(
    "SELECT action_code, result_code FROM command_audit WHERE operation_id = ?",
    [operationId]
  );
  assert.deepEqual(audits, [{ action_code: "player.server.change", result_code: "success" }]);

  const executions = await database.query<Array<{ command_code: string; execution_status: string; result_code: string }>>(
    "SELECT command_code, execution_status, result_code FROM command_executions WHERE operation_id = ?",
    [operationId]
  );
  assert.deepEqual(executions, [{ command_code: "change_player_server", execution_status: "completed", result_code: "reply_queued" }]);

  const outbox = await database.query<Array<{ provider_code: string; message_type: string; status: string }>>(
    "SELECT provider_code, message_type, status FROM outbox_messages WHERE operation_id = ? ORDER BY provider_code",
    [operationId]
  );
  assert.deepEqual(outbox, [
    { provider_code: "internal", message_type: "player.server.changed", status: "pending" },
    { provider_code: "iris", message_type: "text", status: "pending" }
  ]);

  process.stdout.write(`${JSON.stringify({
    sliceId: "player-server-change",
    command: "/서버이동",
    deniedPermissionVerified: true,
    suffixGuardVerified: true,
    targetPlayerId: "900000002",
    serverCode: profile[0]?.server_code,
    profileVersion: profile[0]?.version.toString(),
    idempotentReplayVerified: true,
    auditCount: audits.length,
    commandExecutionCount: executions.length,
    outboxCount: outbox.length,
    exactReplyMatched: true,
    restartReplay: replayOnly,
    operationalSnapshotTouched: false
  })}\n`);
} finally {
  await database.close();
}
