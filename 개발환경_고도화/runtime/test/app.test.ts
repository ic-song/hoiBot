import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildApp as buildRuntimeApp, dispatchPetDataCompareCommand, dispatchPetTitleCommand, type AppDependencies } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import type { IrisKakaoDatabaseSnapshot } from "../src/integration/iris-kakao-database-inspector.js";
import type { NormalizedIrisEvent } from "../src/integration/iris-normalizer.js";
import { ApplicationError } from "../src/shared/application-error.js";

const TEST_TOKEN = "test-shared-token-1234";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 3000,
    irisSharedToken: TEST_TOKEN,
    userVerificationPepper: "test-user-verification-pepper-123456",
    irisBaseUrl: "http://127.0.0.1:3000",
    irisAllowedOpenChatIds: ["123", "monitor-room", "source-room"],
    irisOpenChatObservationMode: "designated_only",
    irisImageForwardRoomId: "",
    irisEventMonitorRoomId: "",
    irisEventMonitorRoomLabel: "",
    imageMaxBytes: 10_485_760,
    imageDownloadTimeoutMs: 10_000,
    retainedEventContentEnabled: false,
    retainedEventContentDays: 7,
    retainedEventContentStorageDirectory: "./var/test-retained-event-content",
    retainedEventContentChannelIds: ["123"],
    retainedEventContentScope: "designated_only",
    bodyLimitBytes: 1_048_576,
    rawPayloadLogging: true,
    recentEventsEnabled: true,
    recentEventLimit: 2,
    database: {
      enabled: false,
      host: "",
      port: 3306,
      user: "",
      password: "",
      name: "",
      connectionLimit: 2,
      connectTimeoutMs: 1_000
    },
    version: "0.1.0-test",
    ...overrides
  };
}

function createDatabaseStub(overrides: Partial<DatabaseClient> = {}): DatabaseClient {
  return {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected query in test stub."); },
    execute: async () => { throw new Error("Unexpected execute in test stub."); },
    withTransaction: async () => { throw new Error("Unexpected transaction in test stub."); },
    close: async () => undefined,
    ...overrides
  };
}

function createKakaoSnapshot(overrides: Partial<IrisKakaoDatabaseSnapshot> = {}): IrisKakaoDatabaseSnapshot {
  return {
    nickname: "테스 남",
    nicknameSource: "open_chat_member",
    roomName: "테스트 오픈채팅",
    roomNameSource: "open_link",
    db2IdentityTables: { rows: [{ name: "open_chat_member" }] },
    chatLog: { rows: [{ id: "9001", chat_id: "123", user_id: "456", type: "1" }] },
    targetChatLog: { rows: [] },
    chatRoom: { rows: [{ id: "123", link_id: "789", type: "OM" }] },
    openChatMember: { rows: [{ user_id: "456", link_id: "789", nickname: "테스 남", enc: "0" }] },
    friend: { rows: [] },
    openLink: { rows: [{ id: "789", name: "테스트 오픈채팅", active: "1", expired: "0" }] },
    ...overrides
  };
}

function createPetDataCompareEvent(overrides: Partial<NormalizedIrisEvent> = {}): NormalizedIrisEvent {
  return {
    eventId: "iris:pet-data-compare-app-1",
    providerEventId: "pet-data-compare-app-1",
    providerCode: "iris",
    eventKind: "1",
    direction: "incoming",
    channelId: "123",
    userId: "456",
    displayName: "관리자",
    displayNameSource: "iris_cache",
    displayNameTrust: "untrusted",
    message: "/펫데이터비교",
    eventCode: "message.created",
    eventCategory: "message",
    monitoringGroup: "text",
    eventMetadata: {},
    payloadHash: "a".repeat(64),
    ...overrides,
  };
}

function createEventProcessingDatabase(duplicate = false): DatabaseClient {
  let nextId = 10n;
  const transaction: DatabaseTransaction = {
    query: async <T>(sql: string): Promise<T> => {
      if (sql.includes("SELECT id FROM channels")) return [{ id: 1n }] as T;
      if (sql.includes("SELECT id FROM external_identities")) return [{ id: 2n }] as T;
      if (sql.includes("FROM external_identity_names")) return [] as T;
      return [] as T;
    },
    execute: async (): Promise<DatabaseWriteResult> => ({ affectedRows: 1n, insertId: nextId++ }),
  };
  return createDatabaseStub({
    withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> => {
      if (duplicate) throw Object.assign(new Error("duplicate event"), { code: "ER_DUP_ENTRY" });
      return work(transaction);
    },
  });
}

function petDataComparePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    msg: "/펫데이터비교",
    sender: "관리자",
    json: {
      id: "pet-data-compare-http-1",
      chat_id: "123",
      user_id: "456",
      type: "1",
      v: JSON.stringify({ origin: "MSG", isMine: false }),
    },
    ...overrides,
  };
}

// 앱 테스트의 기본 채널은 검증·지정된 오픈채팅으로 처리합니다.
function buildApp(config: AppConfig, dependencies: AppDependencies = {}) {
  return buildRuntimeApp(config, {
    inspectIrisChannel: async () => ({
      mode: "operational",
      channelClass: "open_group",
      reason: "allowed",
      evidence: {
        roomType: "OM",
        linkId: "789",
        openLinkId: "789",
        openLinkActive: true,
        openLinkExpired: false
      }
    }),
    ...dependencies
  });
}

describe("hoiBot Lite server", () => {
  it("returns health and request id", async () => {
    const app = buildApp(createConfig());
    const response = await app.inject({ method: "GET", url: "/health/live" });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "alive");
    assert.equal(response.headers["x-request-id"], response.json().requestId);
    await app.close();
  });

  it("starts account and retained-content maintenance only after listen", async () => {
    let accountRuns = 0;
    let retainedRuns = 0;
    const app = buildApp(createConfig({
      nodeEnv: "development",
      retainedEventContentEnabled: true
    }), {
      database: createDatabaseStub(),
      runAccountCleanupMaintenance: async () => {
        accountRuns += 1;
        return { pending: { processed: 0, failed: 0 }, deleted: { processed: 0, failed: 0 } };
      },
      purgeRetainedEventContent: async () => {
        retainedRuns += 1;
        return 0;
      }
    });

    await app.ready();
    assert.deepEqual({ accountRuns, retainedRuns }, { accountRuns: 0, retainedRuns: 0 });
    await app.listen({ host: "127.0.0.1", port: 0 });
    assert.deepEqual({ accountRuns, retainedRuns }, { accountRuns: 1, retainedRuns: 1 });
    await app.close();
  });

  it("serves the admin web shell from the runtime entrypoint", async () => {
    const app = buildApp(createConfig());
    const [page, styles, client] = await Promise.all([
      app.inject({ method: "GET", url: "/admin" }),
      app.inject({ method: "GET", url: "/admin/assets/admin.css" }),
      app.inject({ method: "GET", url: "/admin/assets/admin.js" })
    ]);

    assert.equal(page.statusCode, 200);
    assert.match(page.headers["content-type"] ?? "", /^text\/html/);
    assert.equal(page.headers["cache-control"], "no-store");
    assert.equal(styles.statusCode, 200);
    assert.match(styles.headers["content-type"] ?? "", /^text\/css/);
    assert.equal(client.statusCode, 200);
    assert.match(client.headers["content-type"] ?? "", /^text\/javascript/);
    await app.close();
  });

  it("serves the public signup shell from the runtime entrypoint", async () => {
    const app = buildApp(createConfig());
    const [page, styles, client] = await Promise.all([
      app.inject({ method: "GET", url: "/signup" }),
      app.inject({ method: "GET", url: "/signup/assets/signup.css" }),
      app.inject({ method: "GET", url: "/signup/assets/signup.js" })
    ]);

    assert.equal(page.statusCode, 200);
    assert.match(page.headers["content-type"] ?? "", /^text\/html/);
    assert.equal(page.headers["cache-control"], "no-store");
    assert.match(page.headers["content-security-policy"] ?? "", /default-src 'self'/);
    assert.match(page.body, /호이월드 계정 만들기/);
    assert.equal(styles.statusCode, 200);
    assert.match(styles.body, /min-height: 48px/);
    assert.equal(client.statusCode, 200);
    assert.match(client.body, /\/api\/v1\/user-accounts/);
    await app.close();
  });

  it("returns pong", async () => {
    const app = buildApp(createConfig());
    const response = await app.inject({ method: "GET", url: "/api/v1/ping" });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().message, "pong");
    await app.close();
  });

  it("rejects an Iris event without a shared token", async () => {
    const app = buildApp(createConfig());
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/iris/events",
      payload: { msg: "/핑", room: "테스트방", sender: "테스터", json: {} }
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "UNAUTHORIZED");
    await app.close();
  });

  it("accepts and stores an authenticated Iris event", async () => {
    const app = buildApp(createConfig());
    const payload = {
      msg: "/핑",
      room: "테스트방",
      sender: "테스터",
      json: { _id: "1", chat_id: "2", user_id: "3" }
    };
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/iris/events",
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload
    });
    const recent = await app.inject({
      method: "GET",
      url: "/api/v1/debug/recent-events",
      headers: { "x-iris-token": TEST_TOKEN }
    });

    assert.equal(accepted.statusCode, 202);
    assert.equal(recent.statusCode, 200);
    assert.deepEqual(recent.json().events[0].payload, payload);
    await app.close();
  });

  it("supports a query token for Iris endpoint compatibility", async () => {
    const app = buildApp(createConfig());
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: { msg: "/핑" }
    });

    assert.equal(response.statusCode, 202);
    await app.close();
  });

  it("acknowledges but does not retain an event denied by channel policy", async () => {
    const app = buildRuntimeApp(createConfig(), {
      inspectIrisChannel: async () => ({
        mode: "denied",
        channelClass: "unsupported",
        reason: "not_open_chat",
        evidence: { roomType: "MultiChat" }
      })
    });
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/iris/events",
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { msg: "민감한 원문", json: { id: "denied-1", chat_id: "room-1", type: 1 } }
    });
    const recent = await app.inject({
      method: "GET",
      url: "/api/v1/debug/recent-events",
      headers: { "x-iris-token": TEST_TOKEN }
    });

    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.json().ignored, true);
    assert.equal(accepted.json().ignoreReason, "not_open_chat");
    assert.equal(recent.json().events.length, 0);
    await app.close();
  });

  it("observes an active open-chat command without executing or replying to it", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = buildRuntimeApp(createConfig({ irisOpenChatObservationMode: "observe_all_open" }), {
      inspectIrisChannel: async () => ({
        mode: "observation",
        channelClass: "open_group",
        reason: "observation_period",
        evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false }
      }),
      sendIrisTextReply: async (reply) => { replies.push(reply); }
    });
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: { msg: "/ping", sender: "미신뢰 이름", json: { id: "observe-1", chat_id: "room-2", type: 1 } }
    });
    const recent = await app.inject({
      method: "GET",
      url: "/api/v1/debug/recent-events",
      headers: { "x-iris-token": TEST_TOKEN }
    });

    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.json().ignored, false);
    assert.equal(recent.json().events.length, 1);
    assert.deepEqual(replies, []);
    await app.close();
  });

  it("reports ready when the enabled database responds", async () => {
    let closed = false;
    const app = buildApp(createConfig({
      database: { ...createConfig().database, enabled: true }
    }), {
      database: createDatabaseStub({
        ping: async () => undefined,
        verifyRollback: async () => true,
        close: async () => { closed = true; }
      })
    });
    const response = await app.inject({ method: "GET", url: "/health/ready" });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().database, "ready");
    await app.close();
    assert.equal(closed, true);
  });

  it("reports not ready when the enabled database is unavailable", async () => {
    const app = buildApp(createConfig({
      database: { ...createConfig().database, enabled: true }
    }), {
      database: createDatabaseStub({
        ping: async () => { throw new Error("offline"); },
        verifyRollback: async () => false,
        close: async () => undefined
      })
    });
    const response = await app.inject({ method: "GET", url: "/health/ready" });

    assert.equal(response.statusCode, 503);
    assert.equal(response.json().database, "unavailable");
    await app.close();
  });

  it("returns only live aggregate data for the public homepage", async () => {
    const app = buildApp(createConfig({
      database: { ...createConfig().database, enabled: true }
    }), {
      database: createDatabaseStub({
        query: async <T>(sql: string) => {
          assert.match(sql, /COUNT\(\*\).*players/s);
          assert.match(sql, /COUNT\(\*\).*channels/s);
          assert.match(sql, /event_inbox/s);
          return [{
            active_players: 7n,
            active_channels: 3n,
            events_last_24_hours: 42n,
            last_event_at: new Date("2026-08-07T03:00:00.000Z")
          }] as T;
        }
      })
    });
    const response = await app.inject({ method: "GET", url: "/api/v1/public/overview" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().service, { api: "ready", database: "ready" });
    assert.deepEqual(response.json().metrics, {
      activePlayers: "7",
      activeChannels: "3",
      eventsLast24Hours: "42",
      lastEventAt: "2026-08-07T03:00:00.000Z"
    });
    await app.close();
  });

  it("does not trust the Iris sender fallback for an exact /ping event", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = buildApp(createConfig(), {
      sendIrisTextReply: async (reply) => {
        replies.push(reply);
      }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "/ping",
        room: "테스트방",
        sender: "테스터",
        json: { chat_id: "123" }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(replies, [{ room: "123", data: "미확인 사용자 pong" }]);
    await app.close();
  });

  it("prefers the KakaoTalk database nickname for an exact /ping event", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = buildApp(createConfig(), {
      inspectIrisKakaoDatabase: async () => createKakaoSnapshot({ roomName: "모니터링" }),
      sendIrisTextReply: async (reply) => {
        replies.push(reply);
      }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "/ping",
        room: "테스트방",
        sender: "오래된 Iris 이름",
        json: { id: "9001", chat_id: "123", user_id: "456", type: "1" }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(replies, [{ room: "123", data: "테스 남 pong" }]);
    await app.close();
  });

  it("shows all Iris fields and related KakaoTalk database rows for /info", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = buildApp(createConfig(), {
      inspectIrisKakaoDatabase: async () => createKakaoSnapshot(),
      sendIrisTextReply: async (reply) => {
        replies.push(reply);
      }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "/info",
        room: "테스트방",
        sender: "오래된 Iris 이름",
        json: {
          id: "9001",
          chat_id: "123",
          user_id: "456",
          type: "1",
          attachment: "{}",
          meta: "{\"revision\":3900550890436530177}",
          v: "{\"origin\":\"MSG\",\"isMine\":false}"
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.equal(replies.length, 1);
    assert.match(replies[0]!.data, /\[Iris 원문: 최상위 필드\]/);
    assert.match(replies[0]!.data, /• sender: 오래된 Iris 이름/);
    assert.match(replies[0]!.data, /\[Iris 원문: json = 전달된 chat_logs 필드\]/);
    assert.match(replies[0]!.data, /• attachment: \{\}/);
    assert.match(replies[0]!.data, /"revision": "3900550890436530177"/);
    assert.doesNotMatch(replies[0]!.data, /3900550890436530000/);
    assert.match(replies[0]!.data, /\[KakaoTalk DB: chat_logs 현재 행\]/);
    assert.match(replies[0]!.data, /\[KakaoTalk DB: db2\.open_chat_member\]/);
    assert.match(replies[0]!.data, /• nickname: 테스 남/);
    assert.match(replies[0]!.data, /• 닉네임 출처: open_chat_member/);
    assert.match(replies[0]!.data, /• \/ping 응답 이름: 테스 남/);
    await app.close();
  });

  it("does not reply when text is appended to /ping", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = buildApp(createConfig(), {
      sendIrisTextReply: async (reply) => {
        replies.push(reply);
      }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "/ping 설명",
        sender: "테스터",
        json: { chat_id: "123" }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(replies, []);
    await app.close();
  });

  it("does not mirror an ordinary text event", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = buildApp(createConfig({ irisEventMonitorRoomId: "monitor-room" }), {
      sendIrisTextReply: async (reply) => { replies.push(reply); }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "이벤트 테스트",
        room: "원본방",
        sender: "테스터",
        json: {
          id: "event-monitor-1",
          chat_id: "source-room",
          user_id: "user-1",
          type: "1",
          attachment: "{\"mentions\":[]}",
          v: "{\"origin\":\"MSG\",\"isMine\":false}"
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(replies, []);
    await app.close();
  });

  it("mirrors a type=1 mention event to the configured TEST room", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = buildApp(createConfig({
      irisEventMonitorRoomId: "monitor-room",
      irisEventMonitorRoomLabel: "모니터링"
    }), {
      inspectIrisKakaoDatabase: async () => createKakaoSnapshot({ roomName: "모니터링" }),
      sendIrisTextReply: async (reply) => { replies.push(reply); }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "@봇 테스트",
        room: "TEST",
        sender: "테스터",
        json: {
          id: "event-monitor-mention-1",
          chat_id: "monitor-room",
          user_id: "user-1",
          type: "1",
          attachment: "{\"mentions\":[{\"user_id\":\"bot\",\"at\":[1],\"len\":1}]}",
          v: "{\"origin\":\"MSG\",\"isMine\":false}"
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.equal(replies.length, 1);
    assert.equal(replies[0]!.room, "monitor-room");
    assert.match(replies[0]!.data, /📣 멘션/);
    assert.match(replies[0]!.data, /🔔 \[호월봇 이벤트 감지\]/);
    assert.match(replies[0]!.data, /📍 방: 모니터링/);
    assert.doesNotMatch(replies[0]!.data, /TEST/);
    assert.match(replies[0]!.data, /📣 멘션 수: 1/);
    assert.match(replies[0]!.data, /👤 사용자: 테스 남/);
    assert.doesNotMatch(replies[0]!.data, /테스터/);
    assert.doesNotMatch(replies[0]!.data, /사용자 ID|기술:|이벤트 ID|채팅방 ID|attachment keys/);
    await app.close();
  });

  it("reports an image detection as text without forwarding image data", async () => {
    const textReplies: Array<{ room: string; data: string }> = [];
    const imageReplies: Array<{ room: string; imageUrl: string }> = [];
    const app = buildApp(createConfig({ irisEventMonitorRoomId: "monitor-room" }), {
      inspectIrisKakaoDatabase: async () => createKakaoSnapshot({
        nickname: "잘못된 Iris 이름",
        nicknameSource: "iris_sender"
      }),
      sendIrisTextReply: async (reply) => { textReplies.push(reply); },
      sendIrisImageReply: async (reply) => { imageReplies.push(reply); }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "사진",
        room: "원본방",
        sender: "테스터",
        json: {
          id: "event-monitor-image-1",
          chat_id: "source-room",
          user_id: "user-1",
          type: "2",
          attachment: "{\"url\":\"https://p.kakaocdn.net/private-image\",\"w\":100,\"h\":100}",
          v: "{\"origin\":\"MSG\",\"isMine\":false}"
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.equal(textReplies.length, 1);
    assert.match(textReplies[0]!.data, /🖼️ \[이미지\]/);
    assert.match(textReplies[0]!.data, /👤 사용자: 확인되지 않음/);
    assert.doesNotMatch(textReplies[0]!.data, /테스터|잘못된 Iris 이름/);
    assert.doesNotMatch(textReplies[0]!.data, /사용자 ID|기술:|이벤트 ID|채팅방 ID|attachment keys/);
    assert.doesNotMatch(textReplies[0]!.data, /private-image/);
    assert.deepEqual(imageReplies, []);
    await app.close();
  });

  it("retains approved content only in a designated operational room", async () => {
    const retained: string[] = [];
    const app = buildApp(createConfig({ retainedEventContentEnabled: true }), {
      retainIrisEventContent: async (_payload, event) => { retained.push(event.eventCode); return 1; }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/iris/events",
      headers: { "x-iris-token": TEST_TOKEN },
      payload: {
        msg: "사진",
        json: {
          id: "retained-image-1", chat_id: "123", user_id: "456", type: "2",
          attachment: "{\"url\":\"https://example.kakaocdn.net/image.png\"}",
          v: "{\"origin\":\"MSG\",\"isMine\":false}"
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(retained, ["media.image"]);
    await app.close();
  });

  it("does not retain content from an observation-only open room", async () => {
    const retained: string[] = [];
    const app = buildRuntimeApp(createConfig({
      retainedEventContentEnabled: true,
      irisOpenChatObservationMode: "observe_all_open"
    }), {
      inspectIrisChannel: async () => ({
        mode: "observation", channelClass: "open_group", reason: "observation_period",
        evidence: { roomType: "OM", linkId: "789", openLinkId: "789", openLinkActive: true, openLinkExpired: false }
      }),
      retainIrisEventContent: async (_payload, event) => { retained.push(event.eventCode); return 1; }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/iris/events",
      headers: { "x-iris-token": TEST_TOKEN },
      payload: {
        msg: "사진",
        json: {
          id: "observed-image-1", chat_id: "room-2", user_id: "456", type: "2",
          attachment: "{\"url\":\"https://example.kakaocdn.net/image.png\"}",
          v: "{\"origin\":\"MSG\",\"isMine\":false}"
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(retained, []);
    await app.close();
  });

  it("retains approved content from every verified open room in first-stage scope", async () => {
    const retained: string[] = [];
    const app = buildRuntimeApp(createConfig({
      retainedEventContentEnabled: true,
      retainedEventContentScope: "all_verified_open",
      retainedEventContentChannelIds: []
    }), {
      inspectIrisChannel: async () => ({
        mode: "observation", channelClass: "open_group", reason: "observation_period",
        evidence: { roomType: "OM", linkId: "789", openLinkId: "789", openLinkActive: true, openLinkExpired: false }
      }),
      retainIrisEventContent: async (_payload, event) => { retained.push(event.eventCode); return 1; }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/iris/events",
      headers: { "x-iris-token": TEST_TOKEN },
      payload: {
        msg: "사진",
        json: {
          id: "all-open-image-1", chat_id: "unlisted-open-room", user_id: "456", type: "2",
          attachment: "{\"url\":\"https://example.kakaocdn.net/image.png\"}",
          v: "{\"origin\":\"MSG\",\"isMine\":false}"
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(retained, ["media.image"]);
    await app.close();
  });

  it("formats an animated sticker with the operator-facing monitoring layout", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = buildApp(createConfig({
      irisEventMonitorRoomId: "monitor-room",
      irisEventMonitorRoomLabel: "모니터링"
    }), {
      inspectIrisKakaoDatabase: async () => createKakaoSnapshot({ roomName: "모니터링" }),
      sendIrisTextReply: async (reply) => { replies.push(reply); }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "이모티콘",
        room: "TEST",
        sender: "잘못된 캐시 이름",
        json: {
          id: "3901828791926216705",
          chat_id: "monitor-room",
          user_id: "4809244158090851808",
          type: "20",
          attachment: "{\"type\":\"animated-sticker/digital-item\"}",
          v: "{\"origin\":\"MSG\",\"isMine\":false}"
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.equal(replies.length, 1);
    assert.equal(replies[0]!.data, [
      "🔔 [호월봇 이벤트 감지]",
      "🎞️ [움직이는 이모티콘]",
      "",
      "📍 방: 모니터링",
      "👤 사용자: 테스 남",
      "🔄 방향: 수신"
    ].join("\n"));
    assert.doesNotMatch(replies[0]!.data, /Iris|사용자 ID|기술:|이벤트 ID|채팅방 ID|TEST|잘못된 캐시 이름/);
    await app.close();
  });

  it("announces a deleted-message incident without exposing the original text", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = buildApp(createConfig({ irisEventMonitorRoomId: "monitor-room" }), {
      inspectIrisKakaoDatabase: async () => createKakaoSnapshot({
        targetChatLog: { rows: [{ id: "target-1", message: "삭제 전 원본입니다." }] }
      }),
      sendIrisTextReply: async (reply) => { replies.push(reply); }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "{\"logId\":\"target-1\"}",
        room: "원본방",
        sender: "테스터",
        json: {
          id: "delete-event-1",
          chat_id: "source-room",
          user_id: "user-1",
          type: "0",
          message: "{\"logId\":\"target-1\"}",
          v: "{\"origin\":\"SYNCDLMSG\",\"isMine\":false}"
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.equal(replies.length, 1);
    assert.match(replies[0]!.data, /🗑️ \[메시지 삭제 감지\]/);
    assert.doesNotMatch(replies[0]!.data, /Iris|사건|용의자/);
    assert.match(replies[0]!.data, /📍 방: 테스트 오픈채팅/);
    assert.match(replies[0]!.data, /👤 사용자: 테스 남/);
    assert.match(replies[0]!.data, /열람 번호: 미발급/);
    assert.doesNotMatch(replies[0]!.data, /삭제 전 원본입니다/);
    await app.close();
  });

  it("does not expose an outgoing deleted message before incident read", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    let inspected = false;
    const app = buildApp(createConfig({ irisEventMonitorRoomId: "monitor-room" }), {
      inspectIrisKakaoDatabase: async () => {
        inspected = true;
        return createKakaoSnapshot({
          targetChatLog: { rows: [{ id: "target-outgoing", message: "내가 삭제한 원본" }] }
        });
      },
      sendIrisTextReply: async (reply) => { replies.push(reply); }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "{\"logId\":\"target-outgoing\"}",
        room: "원본방",
        sender: "봇 계정",
        json: {
          id: "delete-event-outgoing",
          chat_id: "source-room",
          user_id: "bot-user",
          type: "0",
          message: "{\"logId\":\"target-outgoing\"}",
          v: "{\"origin\":\"SYNCDLMSG\",\"isMine\":true}"
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.equal(inspected, true);
    assert.match(replies[0]!.data, /🗑️ \[메시지 삭제 감지\]/);
    assert.doesNotMatch(replies[0]!.data, /내가 삭제한 원본/);
    await app.close();
  });

  it("reads a numbered deletion incident from the monitoring room with live DB labels", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const database = createDatabaseStub({
      query: async <T>() => [{
        id: 6455n,
        incident_type: "message_deleted",
        target_provider_event_id: "target-6455",
        external_channel_id: "source-room",
        external_user_id: "source-user",
        provider_event_id: "delete-6455",
        event_kind: "0",
        event_origin: "SYNCDLMSG",
        direction: "incoming",
        payload_hash: "hash",
        metadata_json: "{}"
      }] as T
    });
    const app = buildRuntimeApp(createConfig({ irisEventMonitorRoomId: "monitor-room" }), {
      database,
      inspectIrisChannel: async () => ({
        mode: "diagnostic",
        channelClass: "open_group",
        reason: "diagnostic_channel",
        evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false }
      }),
      inspectIrisKakaoDatabase: async () => createKakaoSnapshot({
        nickname: "실제 사용자",
        nicknameSource: "open_chat_member",
        roomName: "실제 삭제 방",
        targetChatLog: { rows: [{ id: "target-6455", message: "실시간 복원 원문" }] }
      }),
      sendIrisTextReply: async (reply) => { replies.push(reply); }
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "/열람 #6455",
        room: "오래된 Iris 방 이름",
        sender: "오래된 Iris 사용자 이름",
        json: {
          id: "read-command-6455",
          chat_id: "monitor-room",
          user_id: "operator-user",
          type: "1",
          message: "/열람 #6455",
          v: "{\"origin\":\"MSG\",\"isMine\":false}"
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.equal(replies.length, 1);
    assert.match(replies[0]!.data, /🔎 \[삭제 메시지 열람\]/);
    assert.match(replies[0]!.data, /열람 번호: #6455/);
    assert.doesNotMatch(replies[0]!.data, /Iris|사건|용의자/);
    assert.match(replies[0]!.data, /📍 방: 실제 삭제 방/);
    assert.match(replies[0]!.data, /👤 사용자: 실제 사용자/);
    assert.match(replies[0]!.data, /실시간 복원 원문/);
    assert.doesNotMatch(replies[0]!.data, /오래된 Iris/);
    await app.close();
  });

  it("does not mirror the event monitor's own outgoing message", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = buildApp(createConfig({ irisEventMonitorRoomId: "monitor-room" }), {
      sendIrisTextReply: async (reply) => { replies.push(reply); }
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "🔭 [Iris 이벤트 감지]\n• type: 1",
        room: "TEST",
        sender: "봇",
        json: {
          id: "event-monitor-loop-1",
          chat_id: "monitor-room",
          user_id: "bot-user",
          type: "1",
          v: "{\"origin\":\"WRITE\",\"isMine\":true}"
        }
      }
    });

    assert.deepEqual(replies, []);
    await app.close();
  });

  it("forwards a single image from any sender to the configured test room", async () => {
    const forwards: Array<{ room: string; imageUrl: string }> = [];
    const app = buildApp(createConfig({ irisImageForwardRoomId: "test-room-id" }), {
      sendIrisImageReply: async (input) => {
        forwards.push(input);
      }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        msg: "image",
        json: {
          type: 2,
          chat_id: "source-room-id",
          user_id: "allowed-user-id",
          v: JSON.stringify({ isMine: true }),
          attachment: JSON.stringify({ url: "https://talk.kakaocdn.net/example.png" })
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(forwards, [{
      room: "test-room-id",
      imageUrl: "https://talk.kakaocdn.net/example.png"
    }]);
    await app.close();
  });

  it("does not forward an image observed in the target room again", async () => {
    const forwards: Array<{ room: string; imageUrl: string }> = [];
    const app = buildApp(createConfig({ irisImageForwardRoomId: "test-room-id" }), {
      sendIrisImageReply: async (input) => {
        forwards.push(input);
      }
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`,
      payload: {
        json: {
          type: 2,
          chat_id: "test-room-id",
          user_id: "allowed-user-id",
          v: JSON.stringify({ isMine: true }),
          attachment: JSON.stringify({ url: "https://talk.kakaocdn.net/example.png" })
        }
      }
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(forwards, []);
    await app.close();
  });

  it("rejects a payload over the configured size", async () => {
    const app = buildApp(createConfig({ bodyLimitBytes: 128 }));
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/iris/events",
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { msg: "가".repeat(200) }
    });

    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error.code, "PAYLOAD_TOO_LARGE");
    await app.close();
  });

  it("blocks the real callback legacy service after one SHADOW or REJECT ingress claim", async () => {
    for (const result of [
      { status: "shadow", replayed: false, resultFingerprint: "c".repeat(64) } as const,
      { status: "rejected", replayed: false, reasonCode: "AUTH_SCOPE_NOT_SATISFIED" } as const,
    ]) {
      let ingressCalls = 0;
      let legacyCalls = 0;
      const app = buildApp(createConfig(), {
        database: createEventProcessingDatabase(),
        petDataCompareAppWiringIngress: { handle: async () => { ingressCalls += 1; return result; } },
        irisAdminCommandService: { changePlayerPoint: async () => { legacyCalls += 1; return { status: "shadow" }; } },
      });
      const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`, payload: petDataComparePayload() });
      assert.equal(response.statusCode, 202);
      assert.equal(ingressCalls, 1);
      assert.equal(legacyCalls, 0);
      await app.close();
    }
  });

  it("preserves the real callback legacy service for LEGACY_FALLBACK and ignored ingress", async () => {
    for (const result of [{ status: "legacy_fallback" } as const, { status: "ignored" } as const]) {
      let ingressCalls = 0;
      let legacyCalls = 0;
      const app = buildApp(createConfig(), {
        database: createEventProcessingDatabase(),
        petDataCompareAppWiringIngress: { handle: async () => { ingressCalls += 1; return result; } },
        irisAdminCommandService: { changePlayerPoint: async () => { legacyCalls += 1; return { status: "shadow" }; } },
      });
      const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`, payload: petDataComparePayload() });
      assert.equal(response.statusCode, 202);
      assert.equal(ingressCalls, 1);
      assert.equal(legacyCalls, 1);
      await app.close();
    }
  });

  it("keeps a non-target point edit on the legacy service without calling pet-data ingress", async () => {
    let ingressCalls = 0;
    let legacyCalls = 0;
    const app = buildApp(createConfig(), {
      database: createEventProcessingDatabase(),
      petDataCompareAppWiringIngress: { handle: async () => { ingressCalls += 1; return { status: "shadow", replayed: false, resultFingerprint: "c".repeat(64) }; } },
      irisAdminCommandService: { changePlayerPoint: async () => { legacyCalls += 1; return { status: "shadow" }; } },
    });
    const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`, payload: petDataComparePayload({ msg: "/포인트수정 이름 1" }) });
    assert.equal(response.statusCode, 202);
    assert.equal(ingressCalls, 0);
    assert.equal(legacyCalls, 1);
    await app.close();
  });

  it("does not re-run either path when event processing reports a duplicate", async () => {
    let ingressCalls = 0;
    let legacyCalls = 0;
    const app = buildApp(createConfig(), {
      database: createEventProcessingDatabase(true),
      petDataCompareAppWiringIngress: { handle: async () => { ingressCalls += 1; return { status: "shadow", replayed: false, resultFingerprint: "c".repeat(64) }; } },
      irisAdminCommandService: { changePlayerPoint: async () => { legacyCalls += 1; return { status: "shadow" }; } },
    });
    const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`, payload: petDataComparePayload() });
    assert.equal(response.statusCode, 202);
    assert.equal(ingressCalls, 0);
    assert.equal(legacyCalls, 0);
    await app.close();
  });

  it("does not invoke pet-data app wiring outside the exact operational first-delivery identity boundary", async () => {
    let ingressCalls = 0;
    const ingress = { handle: async () => { ingressCalls += 1; return { status: "shadow", replayed: false, resultFingerprint: "c".repeat(64) } as const; } };
    const cases: Array<{ operational: boolean; duplicate: boolean | undefined; event: NormalizedIrisEvent }> = [
      { operational: true, duplicate: false, event: createPetDataCompareEvent({ message: "/펫데이터비교 " }) },
      { operational: true, duplicate: true, event: createPetDataCompareEvent() },
      { operational: true, duplicate: undefined, event: createPetDataCompareEvent() },
      { operational: true, duplicate: false, event: createPetDataCompareEvent({ direction: "outgoing" }) },
      { operational: false, duplicate: false, event: createPetDataCompareEvent() },
      { operational: true, duplicate: false, event: createPetDataCompareEvent({ userId: undefined }) },
      { operational: true, duplicate: false, event: createPetDataCompareEvent({ channelId: undefined }) },
    ];
    for (const candidate of cases) {
      assert.equal(await dispatchPetDataCompareCommand(
        ingress, candidate.operational, candidate.duplicate, candidate.event,
      ), "not_applicable");
    }
    assert.equal(ingressCalls, 0);
  });

  it("fails the real callback closed for MODERN and ingress errors without running legacy", async () => {
    for (const [failure, statusCode] of [
      [new ApplicationError("PET_DATA_COMPARE_MODERN_MUTATION_NOT_ADOPTED", "modern disabled", 503), 503],
      [new Error("ingress fault"), 500],
    ] as const) {
      let legacyCalls = 0;
      const app = buildApp(createConfig(), {
        database: createEventProcessingDatabase(),
        petDataCompareAppWiringIngress: { handle: async () => { throw failure; } },
        irisAdminCommandService: { changePlayerPoint: async () => { legacyCalls += 1; return { status: "shadow" }; } },
      });
      const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${TEST_TOKEN}`, payload: petDataComparePayload() });
      assert.equal(response.statusCode, statusCode);
      assert.equal(legacyCalls, 0);
      await app.close();
    }
  });

  it("wires the pet-data ingress into the callback once and gates the existing point-edit block by disposition", () => {
    const source = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
    assert.equal(source.match(/await dispatchPetDataCompareCommand\(/g)?.length, 1);
    assert.match(source, /new PetDataCompareAppWiringIngress\(\s*appWiringOperationProvider,\s*new CommandDispatcher\(new MariaCommandRouteReader\(database\)/s);
    assert.match(source, /petDataCompareDisposition !== "claimed"\s*&& isPointEditCommandCandidate\(normalizedEvent\.message\)/s);
  });

  it("claims only a MODERN pet-title reply and leaves SHADOW or fallback to the legacy boundary",async()=>{
    const event=createPetDataCompareEvent({message:"/펫타이틀목록"});
    const modernReplies:Array<{outboxId:string;room:string;data:string}>=[];
    assert.equal(await dispatchPetTitleCommand({handle:async()=>({status:"modern",replayed:false,resultFingerprint:"a".repeat(64),reply:{outboxId:"21",room:"room-a",data:"목록"}})},true,false,event,modernReplies),"claimed");
    assert.deepEqual(modernReplies,[{outboxId:"21",room:"room-a",data:"목록"}]);
    const shadowReplies:Array<{outboxId:string;room:string;data:string}>=[];
    assert.equal(await dispatchPetTitleCommand({handle:async()=>({status:"shadow",replayed:false,resultFingerprint:"b".repeat(64)})},true,false,event,shadowReplies),"shadow");
    assert.deepEqual(shadowReplies,[]);
    const silentReplies:typeof modernReplies=[];
    assert.equal(await dispatchPetTitleCommand({handle:async()=>({status:"handled_no_reply",replayed:false,resultFingerprint:"c".repeat(64)})},true,false,event,silentReplies),"claimed");
    assert.deepEqual(silentReplies,[]);
    assert.equal(await dispatchPetTitleCommand({handle:async()=>({status:"legacy_fallback"})},true,false,event,[]),"legacy_fallback");
    assert.equal(await dispatchPetTitleCommand({handle:async()=>({status:"rejected",replayed:false,reasonCode:"AUTH_SCOPE_NOT_SATISFIED"})},true,false,event,[]),"claimed");
  });

  it("does not invoke pet-title ingress for duplicate or incomplete events",async()=>{
    let calls=0;
    const ingress={handle:async()=>{calls+=1;return {status:"shadow",replayed:false,resultFingerprint:"c".repeat(64)} as const;}};
    const event=createPetDataCompareEvent({message:"/펫타이틀목록"});
    assert.equal(await dispatchPetTitleCommand(ingress,true,true,event,[]),"not_applicable");
    assert.equal(await dispatchPetTitleCommand(ingress,true,false,{...event,userId:undefined},[]),"not_applicable");
    assert.equal(calls,0);
  });

  it("wires pet-title ingress once and gates the existing lifecycle block by claim disposition",()=>{
    const source=readFileSync(new URL("../src/app.ts",import.meta.url),"utf8");
    assert.equal(source.match(/await dispatchPetTitleCommand\(/g)?.length,1);
    assert.match(source,/new PetTitleAppWiringIngress\(\s*appWiringOperationProvider,\s*new CommandDispatcher\(new MariaCommandRouteReader\(database\)/s);
    assert.match(source,/petTitleDisposition!=="claimed"&&isOperationalChannel[\s\S]*isPetTitleCommandCandidate\(normalizedEvent\.message\)/);
  });
});
