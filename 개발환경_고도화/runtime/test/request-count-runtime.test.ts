import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient } from "../src/database.js";
import type { NormalizedIrisEvent } from "../src/integration/iris-normalizer.js";
import { isRequestCountCommandCandidate, normalizeRequestCountDispatchMessage, parseRequestCountCommand, RequestCountRuntime } from "../src/admin/request-count-runtime.js";

const event = (id: string, sender: string, message: string): NormalizedIrisEvent => ({
  eventId: id, providerEventId: id, providerCode: "iris", eventKind: "1", direction: "incoming", channelId: "room-1", userId: `user-${sender}`,
  displayName: sender, displayNameSource: "iris_cache", displayNameTrust: "untrusted", message, eventCode: "message.created", eventCategory: "message", monitoringGroup: "text", eventMetadata: {}, payloadHash: id.padEnd(64, "0")
});

describe("request count runtime", () => {
  it("parses exact and free-form target commands without accepting empty suffixes", () => {
    assert.deepEqual(parseRequestCountCommand("/요청횟수"), { target: null });
    assert.deepEqual(parseRequestCountCommand("/요청횟수 홍 길동"), { target: "홍 길동" });
    assert.equal(parseRequestCountCommand("/요청횟수 "), null);
    assert.equal(isRequestCountCommandCandidate("/요청횟수 홍 길동"), true);
    assert.equal(normalizeRequestCountDispatchMessage("/요청횟수 홍 길동"), "/요청횟수");
  });
  it("keeps a process-local sliding window, exclusions and event replay guard", async () => {
    let now = 1_000;
    const runtime = new RequestCountRuntime(() => now);
    const database = { query: async () => [{ window_ms: 2_000n, excluded_commands_json: '["/제외"]', excluded_rooms_json: '["제외방"]' }] } as unknown as DatabaseClient;
    await runtime.observe(database, event("event-1", "사용자", "/가방"), "일반방");
    await runtime.observe(database, event("event-1", "사용자", "/가방"), "일반방");
    await runtime.observe(database, event("event-2", "사용자", "/제외 1"), "일반방");
    await runtime.observe(database, event("event-3", "사용자", "/상점"), "제외방");
    assert.equal(runtime.count("사용자", 2_000), 1);
    now = 3_001;
    assert.equal(runtime.count("사용자", 2_000), 0);
    assert.equal(new RequestCountRuntime(() => now).count("사용자", 2_000), 0);
  });
});
