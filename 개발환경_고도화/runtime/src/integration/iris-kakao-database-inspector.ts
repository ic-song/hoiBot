import type { IrisPayload, NormalizedIrisEvent } from "./iris-normalizer.js";

export type KakaoNicknameSource = "open_chat_member" | "friends" | "iris_sender";

export interface IrisQuerySnapshot {
  rows: Array<Record<string, unknown>>;
  error?: string;
}

export interface IrisKakaoDatabaseSnapshot {
  nickname?: string;
  nicknameSource: KakaoNicknameSource;
  db2IdentityTables: IrisQuerySnapshot;
  chatLog: IrisQuerySnapshot;
  chatRoom: IrisQuerySnapshot;
  openChatMember: IrisQuerySnapshot;
  friend: IrisQuerySnapshot;
  openLink: IrisQuerySnapshot;
}

type IrisQueryFetcher = (sql: string, bind: readonly string[]) => Promise<Array<Record<string, unknown>>>;

const MAX_DIAGNOSTIC_VALUE_LENGTH = 1_000;
const DIAGNOSTIC_CHUNK_LENGTH = 3_500;

// Iris `/query` 응답에서 행 배열을 호환성 있게 추출합니다.
function readQueryRows(value: unknown): Array<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Iris query returned an invalid response object.");
  }
  const response = value as { success?: unknown; data?: unknown };
  if (response.success === false) {
    throw new Error("Iris query response reported failure.");
  }
  const candidate = typeof response.data === "object" && response.data !== null && !Array.isArray(response.data)
    && "data" in response.data
    ? (response.data as { data?: unknown }).data
    : response.data;
  if (!Array.isArray(candidate)) {
    throw new Error("Iris query response did not contain a row array.");
  }
  return candidate.filter((row): row is Record<string, unknown> =>
    typeof row === "object" && row !== null && !Array.isArray(row));
}

// Iris의 읽기 전용 `/query` API를 호출합니다.
async function queryIris(
  irisBaseUrl: string,
  sql: string,
  bind: readonly string[]
): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${irisBaseUrl}/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: sql, bind }),
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) {
    throw new Error(`Iris query failed with HTTP ${response.status}.`);
  }
  return readQueryRows(await response.json());
}

// 개별 조회 실패가 전체 진단을 막지 않도록 결과와 오류를 분리합니다.
async function captureQuery(
  fetchRows: IrisQueryFetcher,
  sql: string | undefined,
  bind: readonly string[]
): Promise<IrisQuerySnapshot> {
  if (sql === undefined) {
    return { rows: [], error: "필수 식별자가 Iris 이벤트에 없습니다." };
  }
  try {
    return { rows: await fetchRows(sql, bind) };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : "알 수 없는 조회 오류" };
  }
}

// 조회 행에서 비어 있지 않은 문자열 필드를 읽습니다.
function readText(row: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = row?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export class IrisKakaoDatabaseInspector {
  private readonly fetchRows: IrisQueryFetcher;

  constructor(irisBaseUrl: string, fetchRows?: IrisQueryFetcher) {
    this.fetchRows = fetchRows ?? ((sql, bind) => queryIris(irisBaseUrl, sql, bind));
  }

  // 현재 Iris 이벤트와 연결되는 카카오톡 DB 행을 읽고 닉네임 출처를 결정합니다.
  async inspect(event: NormalizedIrisEvent): Promise<IrisKakaoDatabaseSnapshot> {
    const chatId = event.channelId;
    const userId = event.userId;
    const providerEventId = event.providerEventId;
    const hasProviderEventId = providerEventId !== event.payloadHash;

    const db2IdentityTables = await captureQuery(
      this.fetchRows,
      "SELECT name FROM db2.sqlite_master WHERE type = 'table' AND name IN ('open_chat_member', 'friends') ORDER BY name",
      []
    );
    const availableDb2Tables = new Set(db2IdentityTables.rows.map((row) => readText(row, "name")));
    const [chatLog, chatRoom, openChatMember, friend, openLink] = await Promise.all([
      captureQuery(
        this.fetchRows,
        chatId !== undefined && hasProviderEventId
          ? "SELECT * FROM chat_logs WHERE id = ? AND chat_id = ? LIMIT 2"
          : undefined,
        [providerEventId, chatId ?? ""]
      ),
      captureQuery(
        this.fetchRows,
        chatId !== undefined ? "SELECT * FROM chat_rooms WHERE id = ? LIMIT 2" : undefined,
        [chatId ?? ""]
      ),
      captureQuery(
        this.fetchRows,
        chatId !== undefined && userId !== undefined
          ? `SELECT member.*
               FROM db2.open_chat_member AS member
               JOIN chat_rooms AS room ON room.link_id = member.link_id
              WHERE room.id = ? AND member.user_id = ?
              LIMIT 2`
          : undefined,
        [chatId ?? "", userId ?? ""]
      ),
      availableDb2Tables.has("friends")
        ? captureQuery(
            this.fetchRows,
            userId !== undefined ? "SELECT * FROM db2.friends WHERE id = ? LIMIT 2" : undefined,
            [userId ?? ""]
          )
        : Promise.resolve({ rows: [], error: "db2.friends 테이블이 현재 KakaoTalk DB에 없습니다." }),
      captureQuery(
        this.fetchRows,
        chatId !== undefined
          ? "SELECT * FROM db2.open_link WHERE id = (SELECT link_id FROM chat_rooms WHERE id = ?) LIMIT 2"
          : undefined,
        [chatId ?? ""]
      )
    ]);

    const openChatNickname = openChatMember.rows.length === 1
      ? readText(openChatMember.rows[0], "nickname")
      : undefined;
    const friendNickname = friend.rows.length === 1 ? readText(friend.rows[0], "name") : undefined;
    return {
      nickname: openChatNickname ?? friendNickname ?? event.displayName,
      nicknameSource: openChatNickname !== undefined
        ? "open_chat_member"
        : friendNickname !== undefined ? "friends" : "iris_sender",
      db2IdentityTables,
      chatLog,
      chatRoom,
      openChatMember,
      friend,
      openLink
    };
  }
}

// JSON 문자열은 원문과 파싱 결과를 함께 볼 수 있도록 한 단계만 해석합니다.
function formatValue(value: unknown): string {
  let formatted: string;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}"))
      || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const stringSafeJson = value.replace(
          /(^|[:,\[]\s*)(-?\d{16,})(?=\s*[,}\]])/g,
          (_match, prefix: string, integer: string) => `${prefix}"${integer}"`
        );
        formatted = `${value}  → parsed (큰 정수는 문자열 유지): ${JSON.stringify(JSON.parse(stringSafeJson), null, 2)}`;
      } catch {
        formatted = value;
      }
    } else {
      formatted = value;
    }
  } else if (typeof value === "object") {
    formatted = JSON.stringify(value, null, 2);
  } else {
    formatted = String(value);
  }
  return formatted.length > MAX_DIAGNOSTIC_VALUE_LENGTH
    ? `${formatted.slice(0, MAX_DIAGNOSTIC_VALUE_LENGTH)}… [값 ${formatted.length}자 중 일부 표시]`
    : formatted;
}

// 객체의 모든 필드명을 유지한 채 사람이 읽기 쉬운 진단 목록으로 변환합니다.
function formatRecord(record: Record<string, unknown>): string {
  const entries = Object.entries(record);
  return entries.length === 0
    ? "(필드 없음)"
    : entries.map(([key, value]) => `• ${key}: ${formatValue(value)}`).join("\n");
}

// 카카오톡 DB 테이블별 조회 결과를 행 단위로 출력합니다.
function formatQuerySection(title: string, snapshot: IrisQuerySnapshot): string {
  if (snapshot.error !== undefined) {
    return `[${title}]\n• 조회 상태: 실패\n• 사유: ${snapshot.error}`;
  }
  if (snapshot.rows.length === 0) {
    return `[${title}]\n• 조회 상태: 성공\n• 행 수: 0`;
  }
  return `[${title}]\n• 조회 상태: 성공\n• 행 수: ${snapshot.rows.length}\n${snapshot.rows
    .map((row, index) => `\n- 행 ${index + 1}\n${formatRecord(row)}`)
    .join("\n")}`;
}

// `/info`용 Iris 원문·정규화 값·카카오톡 DB 전체 진단 메시지를 만듭니다.
export function formatIrisKakaoDiagnostic(
  payload: IrisPayload,
  rawEvent: NormalizedIrisEvent,
  snapshot: IrisKakaoDatabaseSnapshot
): string {
  const topLevel = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "json"));
  const normalized = {
    eventId: rawEvent.eventId,
    providerEventId: rawEvent.providerEventId,
    providerCode: rawEvent.providerCode,
    eventKind: rawEvent.eventKind,
    origin: rawEvent.origin ?? null,
    direction: rawEvent.direction,
    isMine: rawEvent.direction === "outgoing",
    channelId: rawEvent.channelId ?? null,
    userId: rawEvent.userId ?? null,
    displayName: rawEvent.displayName ?? null,
    message: rawEvent.message ?? null,
    payloadHash: rawEvent.payloadHash
  };
  return [
    "🔎 Iris · KakaoTalk DB 전체 진단",
    "",
    "[Iris 원문: 최상위 필드]",
    formatRecord(topLevel),
    "",
    "[Iris 원문: json = 전달된 chat_logs 필드]",
    formatRecord(payload.json ?? {}),
    "",
    "[서버 정규화 결과]",
    formatRecord(normalized),
    "",
    formatQuerySection("KakaoTalk DB: chat_logs 현재 행", snapshot.chatLog),
    "",
    formatQuerySection("KakaoTalk DB: chat_rooms", snapshot.chatRoom),
    "",
    formatQuerySection("KakaoTalk DB: 사용 가능한 신원 테이블", snapshot.db2IdentityTables),
    "",
    formatQuerySection("KakaoTalk DB: db2.open_chat_member", snapshot.openChatMember),
    "",
    formatQuerySection("KakaoTalk DB: db2.friends", snapshot.friend),
    "",
    formatQuerySection("KakaoTalk DB: db2.open_link", snapshot.openLink),
    "",
    "[서버 최종 판정]",
    `• Iris sender: ${rawEvent.displayName ?? "없음"}`,
    `• DB 우선 닉네임: ${snapshot.nickname ?? "없음"}`,
    `• 닉네임 출처: ${snapshot.nicknameSource}`,
    `• /ping 응답 이름: ${snapshot.nickname ?? rawEvent.displayName ?? "결정 불가"}`,
    `• Iris/DB 이름 일치: ${rawEvent.displayName === snapshot.nickname ? "예" : "아니요"}`
  ].join("\n");
}

// 긴 `/info` 진단을 카카오톡에서 안정적으로 받을 수 있는 여러 메시지로 나눕니다.
export function splitIrisKakaoDiagnostic(message: string): string[] {
  if (message.length <= DIAGNOSTIC_CHUNK_LENGTH) return [message];
  const chunks: string[] = [];
  let remaining = message;
  while (remaining.length > 0) {
    if (remaining.length <= DIAGNOSTIC_CHUNK_LENGTH) {
      chunks.push(remaining);
      break;
    }
    const newlineIndex = remaining.lastIndexOf("\n", DIAGNOSTIC_CHUNK_LENGTH);
    const splitAt = newlineIndex > DIAGNOSTIC_CHUNK_LENGTH / 2 ? newlineIndex : DIAGNOSTIC_CHUNK_LENGTH;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
  return chunks.map((chunk, index) => `[진단 ${index + 1}/${chunks.length}]\n${chunk}`);
}
