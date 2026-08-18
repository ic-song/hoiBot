import type { NormalizedIrisEvent } from "./iris-normalizer.js";

export type IrisChannelClass = "open_group" | "open_direct" | "unsupported" | "unknown";
export type IrisChannelAccessMode = "operational" | "observation" | "diagnostic" | "denied";

export interface IrisChannelEvidence {
  roomType?: string;
  linkId?: string;
  openLinkId?: string;
  openLinkActive?: boolean;
  openLinkExpired?: boolean;
}

export interface IrisChannelAccessDecision {
  mode: IrisChannelAccessMode;
  channelClass: IrisChannelClass;
  reason: "allowed" | "observation_period" | "diagnostic_channel" | "missing_channel_id" | "query_failed"
    | "not_open_chat" | "open_direct_unverified" | "inactive_open_link" | "not_designated";
  evidence: IrisChannelEvidence;
}

type IrisQueryFetcher = (sql: string, bind: readonly string[]) => Promise<Array<Record<string, unknown>>>;

// Iris `/query` 응답에서 호환 가능한 행 배열을 추출합니다.
function readQueryRows(value: unknown): Array<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Iris query returned an invalid response object.");
  }
  const response = value as { success?: unknown; data?: unknown };
  if (response.success === false) throw new Error("Iris query response reported failure.");
  const candidate = typeof response.data === "object" && response.data !== null && !Array.isArray(response.data)
    && "data" in response.data
    ? (response.data as { data?: unknown }).data
    : response.data;
  if (!Array.isArray(candidate)) throw new Error("Iris query response did not contain rows.");
  return candidate.filter((row): row is Record<string, unknown> =>
    typeof row === "object" && row !== null && !Array.isArray(row));
}

// 외부 식별자는 숫자로 변환하지 않고 문자열로 읽습니다.
function readString(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

// SQLite boolean 값을 명시적으로 해석합니다.
function readBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return undefined;
}

// 현재 검증된 물리 증거만 논리 채널 유형으로 변환합니다.
export function classifyIrisChannel(evidence: IrisChannelEvidence): IrisChannelClass {
  if (evidence.roomType === undefined) return "unknown";
  if (evidence.roomType === "OM" && evidence.linkId !== undefined && evidence.openLinkId !== undefined) {
    return "open_group";
  }
  if (evidence.roomType === "DirectChat" && evidence.linkId !== undefined) {
    return "open_direct";
  }
  return "unsupported";
}

// 오픈채팅 확인 후 지정 채널과 개발 진단 예외를 순서대로 판정합니다.
export function decideIrisChannelAccess(input: {
  channelId?: string;
  evidence: IrisChannelEvidence;
  designatedChannelIds: ReadonlySet<string>;
  diagnosticChannelIds: ReadonlySet<string>;
  observationMode?: "observe_all_open" | "designated_only";
}): IrisChannelAccessDecision {
  const channelClass = classifyIrisChannel(input.evidence);
  if (input.channelId === undefined) {
    return { mode: "denied", channelClass, reason: "missing_channel_id", evidence: input.evidence };
  }
  if (channelClass === "open_direct") {
    return { mode: "denied", channelClass, reason: "open_direct_unverified", evidence: input.evidence };
  }
  if (channelClass !== "open_group") {
    return { mode: "denied", channelClass, reason: "not_open_chat", evidence: input.evidence };
  }
  if (input.evidence.openLinkActive !== true || input.evidence.openLinkExpired !== false) {
    return { mode: "denied", channelClass, reason: "inactive_open_link", evidence: input.evidence };
  }
  if (input.designatedChannelIds.has(input.channelId)) {
    return { mode: "operational", channelClass, reason: "allowed", evidence: input.evidence };
  }
  if (input.diagnosticChannelIds.has(input.channelId)) {
    return { mode: "diagnostic", channelClass, reason: "diagnostic_channel", evidence: input.evidence };
  }
  if (input.observationMode === "observe_all_open") {
    return { mode: "observation", channelClass, reason: "observation_period", evidence: input.evidence };
  }
  return { mode: "denied", channelClass, reason: "not_designated", evidence: input.evidence };
}

export class IrisChannelPolicyInspector {
  private readonly fetchRows: IrisQueryFetcher;

  constructor(irisBaseUrl: string, fetchRows?: IrisQueryFetcher) {
    this.fetchRows = fetchRows ?? (async (sql, bind) => {
      const response = await fetch(`${irisBaseUrl}/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: sql, bind }),
        signal: AbortSignal.timeout(5_000)
      });
      if (!response.ok) throw new Error(`Iris query failed with HTTP ${response.status}.`);
      return readQueryRows(await response.json());
    });
  }

  // 방 유형과 open_link 활성 상태만 읽어 개인정보 없이 채널 접근을 판정합니다.
  async inspect(
    event: NormalizedIrisEvent,
    designatedChannelIds: ReadonlySet<string>,
    diagnosticChannelIds: ReadonlySet<string>,
    observationMode: "observe_all_open" | "designated_only" = "designated_only"
  ): Promise<IrisChannelAccessDecision> {
    if (event.channelId === undefined) {
      return decideIrisChannelAccess({
        channelId: undefined,
        evidence: {},
        designatedChannelIds,
        diagnosticChannelIds,
        observationMode
      });
    }
    try {
      const rows = await this.fetchRows(
        `SELECT room.type AS room_type, room.link_id,
                link.id AS open_link_id, link.active AS open_link_active, link.expired AS open_link_expired
           FROM db1.chat_rooms AS room
           LEFT JOIN db2.open_link AS link ON link.id = room.link_id
          WHERE room.id = ?
          LIMIT 2`,
        [event.channelId]
      );
      const row = rows.length === 1 ? rows[0] : undefined;
      const evidence: IrisChannelEvidence = {
        roomType: readString(row?.room_type),
        linkId: readString(row?.link_id),
        openLinkId: readString(row?.open_link_id),
        openLinkActive: readBoolean(row?.open_link_active),
        openLinkExpired: readBoolean(row?.open_link_expired)
      };
      return decideIrisChannelAccess({
        channelId: event.channelId,
        evidence,
        designatedChannelIds,
        diagnosticChannelIds,
        observationMode
      });
    } catch {
      return { mode: "denied", channelClass: "unknown", reason: "query_failed", evidence: {} };
    }
  }
}
