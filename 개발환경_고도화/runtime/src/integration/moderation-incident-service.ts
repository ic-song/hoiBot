import type { DatabaseClient } from "../database.js";
import { randomUUID } from "node:crypto";
import type { NormalizedIrisEvent } from "./iris-normalizer.js";

export interface ModerationIncidentLookup {
  incidentId: string;
  incidentType: "message_deleted" | "message_hidden_by_host" | "message_edited";
  sourceChannelId: string;
  sourceUserId?: string;
  targetProviderEventId: string;
  lookupEvent: NormalizedIrisEvent;
}

// 정확한 `/열람 #번호` 명령에서 문자열 사건번호만 추출합니다.
export function readModerationIncidentNumber(message: string | undefined): string | null {
  if (message === undefined) return null;
  return message.match(/^\/열람\s+#([1-9]\d{0,19})$/)?.[1] ?? null;
}

// 저장된 사건 메타데이터를 원문 실시간 조회에 필요한 Iris 이벤트 형태로 복원합니다.
export class ModerationIncidentService {
  constructor(private readonly database: DatabaseClient) {}

  async findByNumber(incidentId: string): Promise<ModerationIncidentLookup | null> {
    const rows = await this.database.query<Array<{
      id: bigint;
      incident_type: ModerationIncidentLookup["incidentType"];
      target_provider_event_id: string | null;
      external_channel_id: string | null;
      external_user_id: string | null;
      provider_event_id: string;
      event_kind: string;
      event_origin: string | null;
      direction: "incoming" | "outgoing";
      payload_hash: string;
      metadata_json: string | Record<string, unknown> | null;
    }>>(
      `SELECT incident.id, incident.incident_type, incident.target_provider_event_id,
              COALESCE(channel.external_channel_id, inbox.external_channel_id) AS external_channel_id,
              inbox.external_user_id, inbox.provider_event_id,
              inbox.event_kind, inbox.event_origin, inbox.direction, inbox.payload_hash,
              normalized.metadata_json
         FROM moderation_incidents AS incident
         JOIN event_inbox AS inbox ON inbox.event_id = incident.event_id
         JOIN normalized_provider_events AS normalized ON normalized.event_id = incident.event_id
         LEFT JOIN channels AS channel ON channel.id = incident.channel_id
        WHERE incident.id = ?
        LIMIT 1`,
      [incidentId]
    );
    const row = rows[0];
    if (row === undefined || row.external_channel_id === null
      || row.target_provider_event_id === null) return null;
    const metadata = readMetadata(row.metadata_json);
    const eventCode = row.incident_type === "message_deleted"
      ? "message.deleted"
      : row.incident_type === "message_hidden_by_host"
        ? "message.hidden_by_host"
        : "message.edited";
    return {
      incidentId: row.id.toString(),
      incidentType: row.incident_type,
      sourceChannelId: row.external_channel_id,
      sourceUserId: row.external_user_id ?? undefined,
      targetProviderEventId: row.target_provider_event_id,
      lookupEvent: {
        eventId: `incident:${row.id.toString()}`,
        providerEventId: row.provider_event_id,
        providerCode: "iris",
        eventKind: row.event_kind,
        origin: row.event_origin ?? undefined,
        direction: row.direction,
        channelId: row.external_channel_id,
        userId: row.external_user_id ?? undefined,
        displayNameSource: "iris_cache",
        displayNameTrust: "untrusted",
        eventCode,
        eventCategory: "moderation",
        monitoringGroup: "moderation",
        eventMetadata: metadata,
        targetProviderEventId: row.target_provider_event_id,
        payloadHash: row.payload_hash
      }
    };
  }

  // 관리자 원문 열람 사실만 감사하고 조회한 원문 자체는 저장하지 않습니다.
  async recordContentRead(incidentId: string, actorId: string, resultCode: string): Promise<void> {
    await this.database.withTransaction(async (transaction) => {
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, actor_type, actor_id, source_code, status, created_at, completed_at)
         VALUES (?, 'admin_operator', ?, 'admin_api', 'completed', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [randomUUID(), actorId]
      );
      await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, created_at)
         VALUES (?, 'admin_operator', ?, 'moderation_incident', ?, 'incident.content.read', ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, actorId, incidentId, resultCode]
      );
    });
  }
}

// Connector가 JSON 문자열 또는 객체로 반환하는 사건 메타데이터를 안전하게 읽습니다.
function readMetadata(
  value: string | Record<string, unknown> | null
): Record<string, string | number | boolean | null> {
  let source: Record<string, unknown>;
  if (typeof value === "object" && value !== null) {
    source = value;
  } else if (typeof value !== "string" || value.trim() === "") {
    return {};
  } else {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
      source = parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string | number | boolean | null] =>
    entry[1] === null || ["string", "number", "boolean"].includes(typeof entry[1])));
}
