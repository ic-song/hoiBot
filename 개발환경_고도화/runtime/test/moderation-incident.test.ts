import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient } from "../src/database.js";
import { formatModerationIncidentReadMessage } from "../src/integration/iris-event-monitor.js";
import {
  ModerationIncidentService,
  readModerationIncidentNumber
} from "../src/integration/moderation-incident-service.js";
import { ProcessIrisEventService } from "../src/integration/event-processing-service.js";
import type { DatabaseTransaction } from "../src/database.js";

function createDatabase(rows: Array<Record<string, unknown>>): DatabaseClient {
  return {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async <T>(_sql: string, values?: readonly unknown[]) => {
      assert.deepEqual(values, ["6455"]);
      return rows as T;
    },
    execute: async () => { throw new Error("Unexpected execute."); },
    withTransaction: async () => { throw new Error("Unexpected transaction."); },
    close: async () => undefined
  };
}

describe("moderation incident lookup", () => {
  it("accepts only the exact /열람 #number command", () => {
    assert.equal(readModerationIncidentNumber("/열람 #6455"), "6455");
    assert.equal(readModerationIncidentNumber("/열람 6455"), null);
    assert.equal(readModerationIncidentNumber("/열람 #6455 보여줘"), null);
    assert.equal(readModerationIncidentNumber(" /열람 #6455"), null);
  });

  it("rebuilds a string-safe live lookup event without storing message content", async () => {
    const service = new ModerationIncidentService(createDatabase([{
      id: 6455n,
      incident_type: "message_deleted",
      target_provider_event_id: "3901229189502478337",
      external_channel_id: "18490428324717856",
      external_user_id: "4809244158090851808",
      provider_event_id: "3901229657230329857",
      event_kind: "0",
      event_origin: "SYNCDLMSG",
      direction: "incoming",
      payload_hash: "hash",
      metadata_json: "{}"
    }]));

    const incident = await service.findByNumber("6455");

    assert.equal(incident?.sourceChannelId, "18490428324717856");
    assert.equal(incident?.sourceUserId, "4809244158090851808");
    assert.equal(incident?.lookupEvent.targetProviderEventId, "3901229189502478337");
    assert.equal("message" in (incident?.lookupEvent ?? {}), false);
  });

  it("formats the verified room, user and recovered body only at read time", () => {
    const message = formatModerationIncidentReadMessage({
      incidentId: "6455",
      incidentType: "message_deleted",
      roomName: "실제 오픈채팅방",
      displayName: "실제 사용자",
      originalMessage: { status: "recovered", message: "삭제된 원문" }
    });

    assert.match(message, /🔎 \[삭제 메시지 열람\]/);
    assert.match(message, /열람 번호: #6455/);
    assert.doesNotMatch(message, /Iris|사건|용의자/);
    assert.match(message, /📍 방: 실제 오픈채팅방/);
    assert.match(message, /👤 사용자: 실제 사용자/);
    assert.match(message, /삭제된 원문/);
  });

  it("returns the persisted incident number for the deletion alert", async () => {
    const transaction: DatabaseTransaction = {
      query: async <T>(sql: string) => {
        if (sql.includes("SELECT id FROM channels")) return [{ id: 1n }] as T;
        if (sql.includes("SELECT id FROM external_identities")) return [{ id: 2n }] as T;
        return [] as T;
      },
      execute: async (sql: string) => ({
        affectedRows: 1n,
        insertId: sql.includes("INSERT INTO moderation_incidents") ? 6455n : 1n
      })
    };
    const database: DatabaseClient = {
      ping: async () => undefined,
      verifyRollback: async () => true,
      query: async () => { throw new Error("Unexpected query."); },
      execute: async () => { throw new Error("Unexpected execute."); },
      withTransaction: async (work) => work(transaction),
      close: async () => undefined
    };

    const result = await new ProcessIrisEventService(database).execute({
      eventId: "iris:delete-event",
      providerEventId: "delete-event",
      providerCode: "iris",
      eventKind: "0",
      origin: "SYNCDLMSG",
      direction: "incoming",
      channelId: "source-room",
      userId: "source-user",
      displayNameSource: "iris_cache",
      displayNameTrust: "untrusted",
      eventCode: "message.deleted",
      eventCategory: "moderation",
      monitoringGroup: "moderation",
      targetProviderEventId: "target-event",
      eventMetadata: {},
      payloadHash: "hash"
    });

    assert.equal(result.incidentId, "6455");
  });

  it("records only minimal incident metadata for a diagnostic-room deletion", async () => {
    const statements: string[] = [];
    const transaction: DatabaseTransaction = {
      query: async <T>() => [] as T,
      execute: async (sql: string) => {
        statements.push(sql);
        return {
          affectedRows: 1n,
          insertId: sql.includes("INSERT INTO moderation_incidents") ? 7001n : 1n
        };
      }
    };
    const database: DatabaseClient = {
      ping: async () => undefined,
      verifyRollback: async () => true,
      query: async () => { throw new Error("Unexpected query."); },
      execute: async () => { throw new Error("Unexpected execute."); },
      withTransaction: async (work) => work(transaction),
      close: async () => undefined
    };

    const result = await new ProcessIrisEventService(database).executeDiagnosticModeration({
      eventId: "iris:diagnostic-delete",
      providerEventId: "diagnostic-delete",
      providerCode: "iris",
      eventKind: "0",
      origin: "SYNCDLMSG",
      direction: "incoming",
      channelId: "monitor-room",
      userId: "source-user",
      displayNameSource: "iris_cache",
      displayNameTrust: "untrusted",
      eventCode: "message.deleted",
      eventCategory: "moderation",
      monitoringGroup: "moderation",
      targetProviderEventId: "target-event",
      eventMetadata: {},
      payloadHash: "hash"
    });

    assert.equal(result.incidentId, "7001");
    assert.equal(statements.some((sql) => sql.includes("INSERT INTO channels")), false);
    assert.equal(statements.some((sql) => sql.includes("external_identities")), false);
    assert.equal(statements.some((sql) => sql.includes("channel_activity_daily")), false);
  });
});
