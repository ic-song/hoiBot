import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import type { IrisKakaoDatabaseSnapshot } from "../src/integration/iris-kakao-database-inspector.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../src/runtime/environment-context.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} required`);
  return value;
};
const databaseIdentity = required("DATABASE_NAME");
const token = required("IRIS_SHARED_TOKEN");
const roomId = "990000000000773";
const externalUserId = "wbs773-same-identity";
const eventIds = ["wbs773-concurrent-1", "wbs773-concurrent-2"] as const;
let externalSendCount = 0;
const database = createDatabaseClient({
  enabled: true,
  host: required("DATABASE_HOST"),
  port: Number(required("DATABASE_PORT")),
  user: required("DATABASE_USER"),
  password: required("DATABASE_PASSWORD"),
  name: databaseIdentity,
  connectionLimit: 6,
  connectTimeoutMs: 5_000
});
const snapshot: IrisKakaoDatabaseSnapshot = {
  nickname: "WBS773 합성회원",
  nicknameSource: "open_chat_member",
  roomName: "WBS773 합성 개인방",
  roomNameSource: "chat_room_meta",
  db2IdentityTables: { rows: [] }, chatLog: { rows: [] }, targetChatLog: { rows: [] }, chatRoom: { rows: [] },
  openChatMember: { rows: [] }, friend: { rows: [] }, openLink: { rows: [] }
};

async function main(): Promise<void> {
  process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  try {
    const player = await database.execute("INSERT INTO players(status,version) VALUES('active',1)");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(?,'WBS773 합성회원',1)", [player.insertId]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES(?,'kakao',?,'WBS773 합성회원','linked')", [player.insertId, externalUserId]);
    const environmentContext = await verifyStartupDatabaseIdentity(database, createEnvironmentContext({ environmentCode: "dev", databaseIdentity }));
    const config = loadConfig({
      NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: token,
      USER_VERIFICATION_PEPPER: required("USER_VERIFICATION_PEPPER"), DATABASE_ENABLED: "true",
      DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"),
      DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: databaseIdentity
    });
    const app = buildApp(config, {
      database,
      environmentContext,
      inspectIrisKakaoDatabase: async () => snapshot,
      inspectIrisChannel: async () => ({ mode: "denied", channelClass: "open_direct", reason: "open_direct_unverified", evidence: { roomType: "DirectChat", linkId: "wbs773-direct" } }),
      sendIrisTextReply: async () => { externalSendCount += 1; throw new Error("WBS773_MUST_NOT_SEND_EXTERNALLY"); }
    });
    try {
      const send = (id: string) => app.inject({
        method: "POST",
        url: `/api/v1/integrations/iris/events?token=${token}`,
        payload: { msg: "/펫스킬정보", room: snapshot.roomName, sender: snapshot.nickname, json: { _id: id, chat_id: roomId, user_id: externalUserId } }
      });
      const responses = await Promise.all(eventIds.map(send));
      assert.deepEqual(responses.map((response) => response.statusCode), [202, 202]);
      for (const response of responses) assert.equal((JSON.parse(response.body) as { ignored?: boolean }).ignored, true);
      const rows = await database.query<Array<{
        inbox_count: bigint; claim_count: bigint; operation_count: bigint; execution_count: bigint; outbox_count: bigint;
        min_attempt_count: bigint; max_attempt_count: bigint;
      }>>(`SELECT
        (SELECT COUNT(*) FROM event_inbox WHERE event_id IN ('iris:wbs773-concurrent-1','iris:wbs773-concurrent-2')) inbox_count,
        (SELECT COUNT(*) FROM canonical_app_wiring_operations WHERE command_code='PET_SKILL_INFO' AND claim_state='COMPLETED') claim_count,
        (SELECT COUNT(*) FROM operations WHERE idempotency_scope='app-wiring.read-only-no-reply' AND status='completed') operation_count,
        (SELECT COUNT(*) FROM command_executions WHERE command_code='PET_SKILL_INFO' AND execution_status='completed' AND result_code='ignored') execution_count,
        (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='app-wiring.read-only-no-reply') outbox_count,
        (SELECT MIN(attempt_count) FROM canonical_app_wiring_operations WHERE command_code='PET_SKILL_INFO') min_attempt_count,
        (SELECT MAX(attempt_count) FROM canonical_app_wiring_operations WHERE command_code='PET_SKILL_INFO') max_attempt_count`);
      const actual = rows[0]!;
      assert.deepEqual([actual.inbox_count, actual.claim_count, actual.operation_count, actual.execution_count, actual.outbox_count], [2n, 2n, 2n, 2n, 0n]);
      assert.equal(actual.min_attempt_count, 1n);
      assert.ok(actual.max_attempt_count >= 2n && actual.max_attempt_count <= 3n, `expected bounded check-read retry, got ${actual.max_attempt_count}`);
      assert.equal(externalSendCount, 0);
      process.stdout.write(`WBS773_CHECKREAD_RETRY_PASS both202=true sameChannel=true sameIdentity=true distinctEvents=true minAttempt=${actual.min_attempt_count} maxAttempt=${actual.max_attempt_count} commonOutbox0=true externalSend0=true port=${required("DATABASE_PORT")}\n`);
    } finally {
      await app.close();
    }
  } finally {
    delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
    try {
      await database.close();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("pool is already closed")) throw error;
    }
  }
}

await main();
