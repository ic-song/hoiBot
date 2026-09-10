import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { resolve } from "node:path";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { PlayerTitleSelectService } from "../src/player/player-title-select-service.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../src/runtime/environment-context.js";

const root = resolve(import.meta.dirname, "../../..");
const normalize = (sql: string): string => sql.replace(/\s+/gu, " ").trim();

type LegacyObservation = { reply: string; saveCount: number; error: string | null };

function executeLegacy(source: string, message: string, options: { member?: boolean; titleCount?: number; siege?: boolean } = {}): LegacyObservation {
  const start = source.indexOf('if (msg.startsWith("/타이틀 "))');
  const end = source.indexOf('if (msg.startsWith("/펫타이틀 "))', start);
  assert.ok(start >= 0 && end > start, "committed legacy title-select branch missing");
  const sender = "타이틀회원";
  const data = { member: options.member === false ? {} : { [sender]: {} } };
  const titleCount = options.titleCount ?? 2;
  const titleData = { member: { [sender]: { title: { list: Array.from({ length: titleCount }, (_, index) => ({ name: `${index + 1}번 타이틀` })), num: null } } } };
  const replies: string[] = [];
  let saveCount = 0;
  try {
    const run = new Function("msg", "castleSiegeFlag", "data", "sender", "loadJsonFile", "memberTitlePath", "replier", "checkRank", "petData", "guildData", "saveJsonFile", source.slice(start, end));
    run(message, options.siege ?? false, data, sender, () => titleData, "member_title.json", { reply: (value: unknown) => replies.push(String(value)) }, () => "⭐타이틀회원", {}, {}, () => { saveCount += 1; });
    return { reply: replies[0] ?? "NO_REPLY", saveCount, error: null };
  } catch (error) {
    // response(...)의 최상위 catch는 일반 명령 오류를 로그만 남기므로 관찰 가능한 reply는 없습니다.
    return { reply: replies[0] ?? "NO_REPLY", saveCount, error: error instanceof Error ? error.name : String(error) };
  }
}

function createDatabase(): any {
  const operations = new Map<string, { id: bigint; result: string | null }>();
  const queries: string[] = [];
  const unexpected: string[] = [];
  let nextId = 100n;
  let selectedTitleId = 1n;
  let businessDml = 0;
  let siege = false;
  let failAudit = false;
  let transactionTail = Promise.resolve();
  const keyOf = (scope: unknown, key: unknown) => `${String(scope)}:${String(key)}`;
  const database: any = {
    async ping() {}, async verifyRollback() { return true; }, async close() {},
    async query(sql: string, values: readonly unknown[] = []) {
      const n = normalize(sql); queries.push(n);
      if (n === "SELECT DATABASE() AS database_identity") return [{ database_identity: "wave34_synthetic" }];
      if (n.includes("FROM command_aliases a")) return values[0] === "/타이틀" ? [{ command_code: "PLAYER_TITLE_SELECT", handler_key: "player_title_select", auth_scope: "VERIFIED_USER", rollout_state: "ACTIVE" }] : [];
      if (n.startsWith("SELECT id FROM channels")) return [{ id: 1n }];
      if (n.startsWith("SELECT id FROM external_identities")) return [{ id: 2n }];
      if (n.startsWith("SELECT display_name FROM external_identity_names")) return [];
      if (n === "SELECT id FROM guild_territory_wars WHERE active=TRUE ORDER BY id LIMIT 1 FOR UPDATE") return siege ? [{ id: 90n }] : [];
      if (n.startsWith("SELECT result_json FROM operations")) { const row = operations.get(keyOf(values[0], values[1])); return row === undefined ? [] : [{ result_json: row.result }]; }
      if (n.includes("FROM external_identities identity") && n.includes("JOIN player_profiles profile")) return values[0] === "missing" ? [] : [{ external_identity_id: 2n, player_id: 20n, current_display_name: "타이틀회원", rank_emoji: "⭐" }];
      if (n.startsWith("SELECT id,result_json FROM operations")) { const row = operations.get(keyOf(values[0], values[1])); return row === undefined ? [] : [{ id: row.id, result_json: row.result }]; }
      if (n.startsWith("SELECT instance_row.id instance_id")) return [
        { instance_id: 31n, title_id: 1n, display_name: "1번 타이틀", acquired_display: "2026-09-10 10:00", acquisition_price: "100", equipped: selectedTitleId === 1n ? 1 : 0, display_order: 1n },
        { instance_id: 32n, title_id: 2n, display_name: "2번 타이틀", acquired_display: "2026-09-10 10:01", acquisition_price: "200", equipped: selectedTitleId === 2n ? 1 : 0, display_order: 2n }
      ];
      if (n.includes("FROM player_titles owned JOIN title_definitions")) return [];
      if (n.startsWith("SELECT attempt_count + 1 AS next_attempt FROM outbox_messages")) return [{ next_attempt: 1n }];
      unexpected.push(`SELECT ${n}`); return [];
    },
    async execute(sql: string, values: readonly unknown[] = []) {
      const n = normalize(sql); let insertId = 0n;
      if (n.startsWith("INSERT INTO operations")) {
        const key = keyOf(values[1], values[2]); const prior = operations.get(key);
        if (prior === undefined) { insertId = nextId++; operations.set(key, { id: insertId, result: null }); }
        else insertId = prior.id;
      } else if (n.startsWith("UPDATE player_title_instances SET equipped=")) { if (values[0] !== null) selectedTitleId = BigInt(values[0] as bigint); businessDml += 1; }
      else if (n.startsWith("UPDATE player_titles SET equipped=")) { selectedTitleId = BigInt(values[0] as bigint); businessDml += 1; }
      else if (n.startsWith("INSERT INTO outbox_messages")) insertId = nextId++;
      else if (n.startsWith("INSERT INTO command_audit") && failAudit) throw new Error("WAVE34_SYNTHETIC_AUDIT_FAILURE");
      else if (n.startsWith("UPDATE operations SET status='completed'")) { const row = [...operations.values()].find((candidate) => candidate.id === values[1]); if (row) row.result = String(values[0]); }
      else if (n.startsWith("INSERT INTO command_routing_decisions") || n.startsWith("INSERT INTO command_executions") || n.startsWith("INSERT INTO command_audit")
        || n.startsWith("INSERT INTO delivery_attempts") || n.startsWith("INSERT INTO channels") || n.startsWith("INSERT INTO external_identities")
        || n.startsWith("INSERT INTO channel_memberships") || n.startsWith("INSERT INTO event_inbox") || n.startsWith("INSERT INTO normalized_provider_events")
        || n.startsWith("INSERT INTO external_identity_names") || n.startsWith("INSERT INTO channel_activity_daily") || n.startsWith("UPDATE event_inbox SET processing_status") || n.startsWith("UPDATE outbox_messages SET status")) { /* infrastructure DML */ }
      else unexpected.push(`DML ${n}`);
      return { affectedRows: 1n, insertId };
    },
    async withTransaction<T>(work: (transaction: any) => Promise<T>): Promise<T> {
      const run = async () => {
        const snapshot = { operations: new Map([...operations].map(([key, value]) => [key, { ...value }])), nextId, selectedTitleId, businessDml };
        try { return await work(database); }
        catch (error) {
          operations.clear(); for (const [key, value] of snapshot.operations) operations.set(key, value);
          nextId = snapshot.nextId; selectedTitleId = snapshot.selectedTitleId; businessDml = snapshot.businessDml;
          throw error;
        }
      };
      const current = transactionTail.then(run, run); transactionTail = current.then(() => undefined, () => undefined); return current;
    },
    seedRaw(eventId: string, result: object) { operations.set(`player.title.select:user:${eventId}`, { id: nextId++, result: JSON.stringify(result) }); },
    set siege(value: boolean) { siege = value; }, set failAudit(value: boolean) { failAudit = value; },
    get queries() { return queries; }, get unexpected() { return unexpected; }, get businessDml() { return businessDml; }, get selectedTitleId() { return selectedTitleId; }
  };
  database.withRootTransaction = database.withTransaction;
  return database;
}

describe("WBS801 Wave34 player title select correction", () => {
  it("fixes observable legacy boundaries from the committed response source", () => {
    const source = execFileSync("git", ["show", "HEAD:main.js"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    assert.deepEqual(executeLegacy(source, "/타이틀 2"), { reply: "[⭐타이틀회원] 님의 타이틀이\n[2번 타이틀] (으)로 적용되었습니다.", saveCount: 1, error: null });
    assert.deepEqual(executeLegacy(source, "/타이틀 0"), { reply: "NO_REPLY", saveCount: 0, error: "TypeError" });
    assert.deepEqual(executeLegacy(source, "/타이틀 9007199254740993"), { reply: "해당 번호의 타이틀이 존재하지 않습니다.", saveCount: 0, error: null });
    assert.deepEqual(executeLegacy(source, "/타이틀 abc"), { reply: "올바른 타이틀 설정 명령어 형식을 사용해주세요. 예: /타이틀 [번호]", saveCount: 0, error: null });
    assert.deepEqual(executeLegacy(source, "/타이틀 1", { member: false }), { reply: "타이틀회원는(은) 존재하지 않는 사용자입니다.", saveCount: 0, error: null });
    assert.deepEqual(executeLegacy(source, "/타이틀 3"), { reply: "해당 번호의 타이틀이 존재하지 않습니다.", saveCount: 0, error: null });
    assert.deepEqual(executeLegacy(source, "/타이틀 1", { siege: true }), { reply: "NO_REPLY", saveCount: 0, error: null });
  });

  it("uses the siege lock as the transaction first query and returns no result with DML0", async () => {
    const database = createDatabase(); database.siege = true;
    const result = await new PlayerTitleSelectService(database).select({ eventId: "siege", externalUserId: "user", destinationId: "room", message: "/타이틀 2", senderDisplayName: "타이틀회원" });
    assert.equal(result, null); assert.equal(database.businessDml, 0);
    assert.equal(database.queries[0], "SELECT id FROM guild_territory_wars WHERE active=TRUE ORDER BY id LIMIT 1 FOR UPDATE");
  });

  it("matches success, overflow, malformed, missing member/title, and zero no-reply", async () => {
    const service = new PlayerTitleSelectService(createDatabase());
    const success = await service.select({ eventId: "success", externalUserId: "user", destinationId: "room", message: "/타이틀 2", senderDisplayName: "타이틀회원" });
    assert.equal(success?.data, "[⭐타이틀회원] 님의 타이틀이\n[2번 타이틀] (으)로 적용되었습니다.", JSON.stringify({ success, queries: (service as any).database.queries }));
    assert.equal((await service.select({ eventId: "overflow", externalUserId: "user", destinationId: "room", message: "/타이틀 9007199254740993", senderDisplayName: "타이틀회원" }))?.data, "해당 번호의 타이틀이 존재하지 않습니다.");
    assert.equal((await service.select({ eventId: "malformed", externalUserId: "user", destinationId: "room", message: "/타이틀 abc", senderDisplayName: "타이틀회원" }))?.data, "올바른 타이틀 설정 명령어 형식을 사용해주세요. 예: /타이틀 [번호]");
    assert.equal((await service.select({ eventId: "missing", externalUserId: "missing", destinationId: "room", message: "/타이틀 1", senderDisplayName: "타이틀회원" }))?.data, "타이틀회원는(은) 존재하지 않는 사용자입니다.");
    assert.equal((await service.select({ eventId: "title-missing", externalUserId: "user", destinationId: "room", message: "/타이틀 3", senderDisplayName: "타이틀회원" }))?.data, "해당 번호의 타이틀이 존재하지 않습니다.");
    assert.equal(await service.select({ eventId: "zero", externalUserId: "user", destinationId: "room", message: "/타이틀 0", senderDisplayName: "타이틀회원" }), null);
  });

  it("replays exact duplicate after service restart and rejects changed index and raw result with DML0", async () => {
    const database = createDatabase(); const input = { eventId: "replay", externalUserId: "user", destinationId: "room", message: "/타이틀 2", senderDisplayName: "타이틀회원" };
    const first = await new PlayerTitleSelectService(database).select(input); const dml = database.businessDml;
    assert.deepEqual(await new PlayerTitleSelectService(database).select(input), first); assert.equal(database.businessDml, dml);
    await assert.rejects(new PlayerTitleSelectService(database).select({ ...input, message: "/타이틀 1" }), /PLAYER_TITLE_SELECT_PAYLOAD_DRIFT/); assert.equal(database.businessDml, dml);
    const raw = createDatabase(); raw.seedRaw("raw", { status: "selected", data: "과거", outboxId: "1" });
    await assert.rejects(new PlayerTitleSelectService(raw).select({ ...input, eventId: "raw" }), /PLAYER_TITLE_SELECT_PAYLOAD_DRIFT/); assert.equal(raw.businessDml, 0);
  });

  it("rolls back audit failure and serializes concurrent duplicate writers", async () => {
    const rollback = createDatabase(); rollback.failAudit = true;
    await assert.rejects(new PlayerTitleSelectService(rollback).select({ eventId: "rollback", externalUserId: "user", destinationId: "room", message: "/타이틀 2", senderDisplayName: "타이틀회원" }), /WAVE34_SYNTHETIC_AUDIT_FAILURE/);
    assert.equal(rollback.businessDml, 0); assert.equal(rollback.selectedTitleId, 1n);
    const database = createDatabase(); const input = { eventId: "concurrent", externalUserId: "user", destinationId: "room", message: "/타이틀 2", senderDisplayName: "타이틀회원" };
    const results = await Promise.all([new PlayerTitleSelectService(database).select(input), new PlayerTitleSelectService(database).select(input)]);
    assert.deepEqual(results[1], results[0]); assert.equal(database.businessDml, 2); assert.equal(database.selectedTitleId, 2n);
  });

  it("keeps buildApp silent during an active siege", async () => {
    const database = createDatabase(); database.siege = true;
    const token = "wave34-synthetic-token"; const previous = process.env.PARTIAL_COMMAND_DISPATCH_ENABLED; process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    const config = loadConfig({ NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "wave34-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: "127.0.0.1", DATABASE_PORT: "3334", DATABASE_USER: "unused", DATABASE_PASSWORD: "unused", DATABASE_NAME: "wave34_synthetic" });
    const environmentContext = await verifyStartupDatabaseIdentity(database, createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "wave34_synthetic" }));
    const replies: unknown[] = []; const app = buildApp(config, { database, environmentContext, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: {} }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    try {
      const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: "/타이틀 2", room: "합성방", sender: "타이틀회원", json: { _id: "app-siege", chat_id: "wave34-room", user_id: "user", type: 1, v: { origin: "MSG", isMine: false } } } });
      assert.equal(response.statusCode, 202, response.body); assert.deepEqual(replies, []); assert.equal(database.businessDml, 0);
    } finally { await app.close(); if (previous === undefined) delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED; else process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = previous; }
  });

  it("executes the committed legacy and actual buildApp success with identical output", async () => {
    const source = execFileSync("git", ["show", "HEAD:main.js"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const legacy = executeLegacy(source, "/타이틀 2");
    const database = createDatabase(); const token = "wave34-success-token";
    const previous = process.env.PARTIAL_COMMAND_DISPATCH_ENABLED; process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    const config = loadConfig({ NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "wave34-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: "127.0.0.1", DATABASE_PORT: "3334", DATABASE_USER: "unused", DATABASE_PASSWORD: "unused", DATABASE_NAME: "wave34_synthetic" });
    const environmentContext = await verifyStartupDatabaseIdentity(database, createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "wave34_synthetic" }));
    const replies: Array<{ data: string }> = []; const app = buildApp(config, { database, environmentContext, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: {} }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    try {
      const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: "/타이틀 2", room: "합성방", sender: "타이틀회원", json: { _id: "app-success", chat_id: "wave34-room", user_id: "user", type: 1, v: { origin: "MSG", isMine: false } } } });
      assert.equal(response.statusCode, 202, response.body); assert.equal(replies[0]?.data, legacy.reply); assert.equal(database.selectedTitleId, 2n); assert.deepEqual(database.unexpected, []);
    } finally { await app.close(); if (previous === undefined) delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED; else process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = previous; }
  });
});
