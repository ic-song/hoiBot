import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult, ReadOnlySnapshotTransaction } from "../src/database.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../src/runtime/environment-context.js";

const token = "wave14b-shadow-token";
const roomId = "990000000000762";

describe("Wave14B pet skill info actual HTTP ingress", () => {
  it("routes only the legacy startsWith family through buildApp.inject and keeps the SHADOW read DML-zero", async () => {
    const trace = createTraceDatabase();
    const context = await verifyStartupDatabaseIdentity(trace.database, createEnvironmentContext({
      environmentCode: "dev",
      databaseIdentity: "wave14b_shadow"
    }));
    const config = loadConfig({
      NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: token,
      USER_VERIFICATION_PEPPER: "wave14b-shadow-pepper", DATABASE_ENABLED: "true",
      DATABASE_HOST: "127.0.0.1", DATABASE_PORT: "3332", DATABASE_USER: "unused",
      DATABASE_PASSWORD: "unused", DATABASE_NAME: "wave14b_shadow"
    });
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    const app = buildApp(config, {
      database: trace.database,
      environmentContext: context,
      inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
        evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }),
      sendIrisTextReply: async () => { throw new Error("SHADOW_MUST_NOT_SEND"); }
    });
    try {
      const first = await send(app, "info-1", "/펫스킬정보청룡언월도");
      assert.equal(first.statusCode, 202, `${first.body}\nroute=${JSON.stringify(trace.routeMessages)}\nwrites=${JSON.stringify(trace.writes.map(({sql})=>sql.slice(0,80)))}\nsnapshot=${JSON.stringify(trace.snapshotSql)}`);
      assert.equal(trace.snapshotCount, 1);
      assert.equal(trace.infoReply, "청룡언월도📙\n등급: S\n확률: 100.0%\n효과: 삼국지 관우의 전설적인 무기입니다.");
      assert.equal(trace.routeMessages.at(-1), "/펫스킬정보 [조회값]");
      assert.ok(trace.writes.some(({ sql }) => sql.includes("command_routing_decisions")));
      assert.ok(trace.writes.some(({ sql }) => sql.includes("event_inbox")));
      assert.ok(trace.snapshotSql.every((sql) => sql.startsWith("SELECT ")));
      assert.ok(trace.writes.every(({ sql }) => !/canonical_pet_skill_(?:definitions|aliases|draw_grade_policies)/.test(sql)));
      assert.ok(trace.writes.every(({ sql }) => !/outbox_messages|command_executions|command_audit/.test(sql)));

      assert.equal((await send(app, "info-2", "/펫스킬정보   ")).statusCode, 202);
      assert.equal(trace.infoReply, "사용법:\n/펫스킬정보 [펫스킬이름] — 펫스킬 효과 조회\n/펫스킬정보 [유저닉네임] — 유저 펫스킬가방 조회 (관리자 전용)");
      const beforeSibling = trace.snapshotCount;
      assert.equal((await send(app, "sibling-1", "/펫스킬")).statusCode, 202);
      assert.equal(trace.snapshotCount, beforeSibling);

      assert.equal((await send(app, "long-1", "/펫스킬정보 청룡언월도", "다섯글자임")).statusCode, 202);
      assert.equal(trace.snapshotCount, beforeSibling);
      assert.equal((await send(app, "info-1", "/펫스킬정보청룡언월도")).statusCode, 202);
      assert.equal(trace.snapshotCount, beforeSibling);
    } finally {
      delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
      await app.close();
    }
  });
});

function send(app: ReturnType<typeof buildApp>, id: string, message: string, sender = "호이 남") {
  return app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
    payload: { msg: message, room: "Wave14B 펫스킬방", sender,
      json: { _id: id, chat_id: roomId, user_id: "wave14b-user" } } });
}

function createTraceDatabase() {
  let nextId = 1n;
  const events = new Set<string>();
  const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
  const routeMessages: string[] = [];
  const snapshotSql: string[] = [];
  let snapshotCount = 0;
  let infoReply = "";
  const write = async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
    writes.push({ sql, values });
    if (sql.includes("INSERT INTO event_inbox")) {
      const eventId = String(values[0]);
      if (events.has(eventId)) throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
      events.add(eventId);
    }
    return { affectedRows: 1n, insertId: nextId++ };
  };
  const transaction: DatabaseTransaction = {
    execute: write,
    query: async <T>(sql: string): Promise<T> => {
      if (sql.includes("SELECT id FROM channels")) return [{ id: 11n }] as T;
      if (sql.includes("SELECT id FROM external_identities")) return [{ id: 12n }] as T;
      return [] as T;
    }
  };
  const snapshot: ReadOnlySnapshotTransaction = { query: async <T>(sql: string): Promise<T> => {
    snapshotSql.push(sql);
    if (sql.includes("FROM external_identities identity")) return [{ player_status: "active", is_operator: 0 }] as T;
    if (sql.includes("FROM player_profiles profile")) return [] as T;
    if (sql.includes("FROM canonical_pet_skill_aliases")) return [] as T;
    if (sql.includes("FROM canonical_pet_skill_draw_grade_policies")) return [] as T;
    if (sql.includes("CAST(raid_charm_bonus")) return [{ pet_skill_id: "skill001", raid_charm_bonus: "0", castle_charm_bonus: "0" }] as T;
    if (sql.includes("FROM canonical_pet_skill_definitions")) return [{
      pet_skill_id: "skill001", pet_skill_name: "청룡언월도", pet_skill_description: "삼국지 관우의 전설적인 무기입니다.",
      pet_skill_grade: "S", legacy_source_key: "skill_000", display_order: 1, base_draw_rate: "100",
      fixed_draw_rate_flag: 1, openable_flag: 1, pet_skill_grade_emoji: "📙", required_tier_name: null,
      tier_exclusive_flag: 0, equip_description: null, handler_key: "presentation_only", options_json: {}, active_flag: 1
    }] as T;
    throw new Error(`UNEXPECTED_SNAPSHOT_SQL:${sql}`);
  }};
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    close: async () => undefined,
    execute: write,
    query: async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
      if (sql === "SELECT DATABASE() AS database_identity") return [{ database_identity: "wave14b_shadow" }] as T;
      if (sql.includes("FROM command_aliases a")) {
        routeMessages.push(String(values[0]));
        if (String(values[0]).startsWith("/펫스킬정보")) return [{ command_code: "PET_SKILL_INFO", handler_key: "pet_skill_info", auth_scope: "VERIFIED_USER", rollout_state: "SHADOW" }] as T;
        return [] as T;
      }
      return [] as T;
    },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    withReadOnlySnapshot: async <T>(work: (value: ReadOnlySnapshotTransaction) => Promise<T>) => {
      snapshotCount += 1;
      const result = await work(snapshot);
      if (result && typeof result === "object" && "reply" in result) infoReply = String((result as { reply: unknown }).reply);
      return result;
    },
    withControlledTransaction: async <T>(work: (value: DatabaseTransaction & { withSavepoint<R>(nested: (value: DatabaseTransaction) => Promise<R>): Promise<R> }) => Promise<T>) => {
      const controlled = { ...transaction, withSavepoint: async <R>(nested: (value: DatabaseTransaction) => Promise<R>) => nested(transaction) };
      return work(controlled);
    }
  } as DatabaseClient;
  return { database, writes, routeMessages, snapshotSql,
    get snapshotCount() { return snapshotCount; }, get infoReply() { return infoReply; } };
}
