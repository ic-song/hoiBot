import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { SpiritInfoService, type SpiritInfoResult } from "../src/pet/spirit-info-service.js";

interface TestState {
  operationResult?: unknown;
  operations: number;
  outboxes: number;
  executions: number;
  audits: number;
  nextId: bigint;
}

const operatorRow = {
  player_id: 22n,
  elemental_name: "피닉스🐦‍🔥", grade_display_name: "정령왕", enhancement_level: 7n,
  battle_exp: "8000", battle_upgrade_exp: "15", raid_exp: "10000", raid_upgrade_exp: "25",
  castle_exp: "8000", castle_upgrade_exp: "15"
};

// 서비스의 실제 SQL·멱등·롤백 계약만 재현하며 운영 스냅샷에는 접근하지 않습니다.
class SpiritInfoDatabase implements DatabaseClient {
  state: TestState = { operations: 0, outboxes: 0, executions: 0, audits: 0, nextId: 100n };
  querySql: string[] = [];
  failAudit = false;
  identityId = 11n;
  outboxProvider = "iris";
  outboxDestination = "room";
  outboxMessageType = "text";

  async ping() {}
  async verifyRollback() { return true; }
  async close() {}
  async query<T>(): Promise<T> { throw new Error("unexpected root query"); }
  async execute(): Promise<DatabaseWriteResult> { throw new Error("unexpected root execute"); }

  async withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    const draft = structuredClone(this.state);
    const transaction: DatabaseTransaction = {
      query: async <R>(sql: string): Promise<R> => {
        this.querySql.push(sql);
        if (sql.includes("FROM external_identities identity")) {
          return [{ identity_id: this.identityId, player_id: 22n }] as R;
        }
        if (sql.includes("FROM operations WHERE idempotency_scope='spirit.info_read'")) {
          return (draft.operationResult === undefined ? [] : [{ id: 100n, actor_type: "external_identity", actor_id: 11n, status: "completed", result_json: JSON.stringify(draft.operationResult) }]) as R;
        }
        if (sql.includes("FROM outbox_messages WHERE operation_id=")) {
          const stored = draft.operationResult as { result: SpiritInfoResult };
          return stored.result.replies.map((reply) => ({ id: BigInt(reply.outboxId), provider_code: this.outboxProvider,
            destination_id: this.outboxDestination, message_type: this.outboxMessageType,
            payload_json: JSON.stringify({ data: reply.data }) })) as R;
        }
        if (sql.includes("FROM players player")) return [operatorRow] as R;
        throw new Error(`unexpected query: ${sql}`);
      },
      execute: async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
        const insertId = draft.nextId++;
        if (sql.startsWith("INSERT INTO operations")) draft.operations += 1;
        else if (sql.startsWith("INSERT INTO outbox_messages")) draft.outboxes += 1;
        else if (sql.startsWith("INSERT INTO command_executions")) draft.executions += 1;
        else if (sql.startsWith("INSERT INTO command_audit")) {
          if (this.failAudit) throw new Error("FORCED_AUDIT_FAILURE");
          draft.audits += 1;
        } else if (sql.startsWith("UPDATE operations")) {
          draft.operationResult = JSON.parse(String(values[0]));
        } else throw new Error(`unexpected execute: ${sql}`);
        return { affectedRows: 1n, insertId };
      }
    };
    const result = await work(transaction);
    this.state = draft;
    return result;
  }
}

describe("spirit info canonical elemental-grade consumer", () => {
  it("routes the exact command through partial dispatch and keeps the existing MODERN handler", () => {
    const source = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
    const candidate = source.slice(source.indexOf("const partialDispatchCandidate"), source.indexOf("const partialDispatchEnabled"));
    assert.match(candidate, /isSpiritInfoCommand\(normalizedEvent\.message\)/);
    assert.match(source, /isSpiritInfoCommand\(normalizedEvent\.message\)[\s\S]*partialDispatchDecision\?\.route === "MODERN"[\s\S]*handlerKey === "spirit_info_read"/);
  });

  it("reads numeric policy through the stable CUID bridge and preserves two ordered replies", async () => {
    const database = new SpiritInfoDatabase();
    const result = await new SpiritInfoService(database).read({ eventId: "event-1", externalUserId: "operator", destinationId: "room", displayName: "호이 남", displayNameTrust: "trusted" });
    assert.deepEqual(result.replies.map((reply) => reply.data), [
      '{"upgrade":7,"name":"피닉스🐦‍🔥","grade":"정령왕"}',
      '{"battleExp":8105,"raidExp":10175,"castleExp":8105,"message":""}'
    ]);
    const sql = database.querySql.find((statement) => statement.includes("canonical_elemental_grade_definition_bridges"))!;
    assert.match(sql, /grade_bridge\.elemental_grade_order=legacy_grade\.grade_order/);
    assert.match(sql, /canonical_grade\.equipment_grade_definition_id=grade_bridge\.equipment_grade_definition_id/);
    assert.match(sql, /canonical_grade\.equipment_family='elemental'/);
    assert.doesNotMatch(sql, /canonical_item_definitions/);
    assert.doesNotMatch(sql, /canonical_grade\.(?:equipment_grade_name|equipment_grade_emoji)\s*=/);
    assert.deepEqual({ operations: database.state.operations, outboxes: database.state.outboxes, executions: database.state.executions, audits: database.state.audits, nextId: database.state.nextId }, { operations: 1, outboxes: 2, executions: 1, audits: 1, nextId: 106n });
  });

  it("is silent with zero DML for non-operator and exact-replays without duplicate outbox", async () => {
    const database = new SpiritInfoDatabase();
    assert.deepEqual(await new SpiritInfoService(database).read({ eventId: "silent", externalUserId: "user", destinationId: "room", displayName: "다른 사용자", displayNameTrust: "trusted" }), { status: "silent", replies: [] });
    assert.equal(database.state.operations + database.state.outboxes + database.state.executions + database.state.audits, 0);

    const service = new SpiritInfoService(database);
    const input = { eventId: "replay", externalUserId: "operator", destinationId: "room", displayName: "호이 남", displayNameTrust: "trusted" as const };
    const first = await service.read(input);
    const beforeReplay = structuredClone(database.state);
    assert.deepEqual(await service.read(input), first);
    assert.deepEqual(database.state, beforeReplay);
    for (const drift of ["provider", "destination", "messageType"] as const) {
      if (drift === "provider") database.outboxProvider = "other";
      if (drift === "destination") database.outboxDestination = "other-room";
      if (drift === "messageType") database.outboxMessageType = "image";
      await assert.rejects(() => service.read(input), /SPIRIT_INFO_REPLAY_OUTBOX_DRIFT/);
      database.outboxProvider = "iris";
      database.outboxDestination = "room";
      database.outboxMessageType = "text";
      assert.deepEqual(database.state, beforeReplay);
    }
    await assert.rejects(() => service.read({ ...input, destinationId: "other-room" }), /payload drift/);
    database.identityId = 99n;
    await assert.rejects(() => service.read(input), /actor drift/);
  });

  it("rolls back operation and both outboxes when audit fails", async () => {
    const database = new SpiritInfoDatabase();
    database.failAudit = true;
    const before = structuredClone(database.state);
    await assert.rejects(() => new SpiritInfoService(database).read({ eventId: "failure", externalUserId: "operator", destinationId: "room", displayName: "호이 남", displayNameTrust: "trusted" }), /FORCED_AUDIT_FAILURE/);
    assert.deepEqual(database.state, before);
  });

  it("uses the trusted event name instead of the stored profile name and fails closed on provenance drift", async () => {
    const database = new SpiritInfoDatabase();
    assert.equal((operatorRow as { current_display_name?: string }).current_display_name, undefined);
    const accepted = await new SpiritInfoService(database).read({ eventId: "profile-mismatch", externalUserId: "operator", destinationId: "room", displayName: "호이 남", displayNameTrust: "trusted" });
    assert.equal(accepted.status, "replied");
    const rejected = new SpiritInfoDatabase();
    assert.deepEqual(await new SpiritInfoService(rejected).read({ eventId: "event-mismatch", externalUserId: "operator", destinationId: "room", displayName: "다른 사용자", displayNameTrust: "trusted" }), { status: "silent", replies: [] });
    await assert.rejects(() => new SpiritInfoService(new SpiritInfoDatabase()).read({ eventId: "untrusted", externalUserId: "operator", destinationId: "room", displayName: "호이 남", displayNameTrust: "untrusted" }), /provenance/);
  });
});
