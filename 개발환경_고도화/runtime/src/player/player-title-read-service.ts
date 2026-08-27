import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

const ALLSEE = "\u200b".repeat(500);

export interface PlayerTitleReadRow {
  titleId: string;
  displayName: string;
  acquiredDisplay: string;
  acquisitionPrice: string;
  equipped: boolean;
}

export interface PlayerTitleReadResult {
  status: "listed" | "empty" | "info" | "invalid_format" | "player_not_found" | "title_not_found";
  data: string;
  targetPlayerId: string | null;
  rowCount: number;
  outboxId: string;
}

type ParsedTitleRead =
  | { kind: "self_list" }
  | { kind: "target_list"; targetKey: string | null }
  | { kind: "info"; index: number | null };

// 자기 목록과 공백 인자형 운영 조회만 후보로 허용합니다.
export function isPlayerTitleListReadCandidate(message: string | undefined): boolean {
  return message === "/타이틀목록" || (message !== undefined && message.startsWith("/타이틀목록 "));
}

// 레거시 startsWith 분기와 동일하게 타이틀정보 접두 명령을 후보로 허용합니다.
export function isPlayerTitleInfoReadCandidate(message: string | undefined): boolean {
  return message !== undefined && message.startsWith("/타이틀정보");
}

// 인자형 목록 명령을 공용 DB 별칭으로 정규화합니다.
export function normalizePlayerTitleListReadDispatchMessage(message: string): string {
  return isPlayerTitleListReadCandidate(message) ? "/타이틀목록" : message;
}

// 번호형 상세 명령을 공용 DB 별칭으로 정규화합니다.
export function normalizePlayerTitleInfoReadDispatchMessage(message: string): string {
  return isPlayerTitleInfoReadCandidate(message) ? "/타이틀정보" : message;
}

// 레거시 목록·상세 입력에서 자기 조회, 4글자 대상 키, 번호를 추출합니다.
export function parsePlayerTitleReadCommand(message: string): ParsedTitleRead | null {
  if (message === "/타이틀목록") return { kind: "self_list" };
  if (message.startsWith("/타이틀목록 ")) {
    const match = message.match(/^\/타이틀목록\s+(.+)$/u);
    return { kind: "target_list", targetKey: match === null ? null : match[1]!.slice(0, 4) };
  }
  if (message.startsWith("/타이틀정보")) {
    const match = message.match(/^\/타이틀정보\s+(\d+)\s*$/u);
    if (match === null) return { kind: "info", index: null };
    const index = Number(match[1]);
    return { kind: "info", index: Number.isSafeInteger(index) ? index : null };
  }
  return null;
}

// 보유 순서와 현재 선택 표시를 레거시 자기·운영 목록 UI로 변환합니다.
export function formatPlayerTitleList(ownerLabel: string, titles: readonly PlayerTitleReadRow[], includeDetails: boolean): string {
  let output = `[${ownerLabel}]님의 타이틀 목록\n\n`;
  if (titles.length > 10) output += `타이틀 10개 이상 보유자\n${ALLSEE}`;
  titles.forEach((title, index) => {
    if (title.equipped) output += "☞ ";
    output += `${index + 1}. ${title.displayName}`;
    if (includeDetails) output += `/획득일:${title.acquiredDisplay}/가격: 🅟${commas(integerText(title.acquisitionPrice))}`;
    output += "\n";
  });
  return output.trim();
}

// 타이틀 구매액과 레거시 판매가 규칙을 상세정보 UI로 변환합니다.
export function formatPlayerTitleInfo(ownerLabel: string, title: PlayerTitleReadRow): string {
  const price = BigInt(integerText(title.acquisitionPrice));
  const salePrice = price < 10000n ? 1000000n : price * 3n / 10n;
  return `[${ownerLabel}] 님의 타이틀 [${title.displayName}] 상세정보\n획득일:${title.acquiredDisplay}\n구매액: 🅟${commas(price.toString())}\n판매가: 🅟${commas(salePrice.toString())}`;
}

// 회원 타이틀 목록·상세를 고정 표시 순서로 읽고 감사·outbox를 원자 기록합니다.
export class PlayerTitleReadService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PlayerTitleReadResult | null> {
    const parsed = parsePlayerTitleReadCommand(input.message);
    if (parsed === null) return null;
    return this.database.withTransaction(async (transaction) => {
      const actor = (await transaction.query<Array<{ external_identity_id: bigint; player_id: bigint; display_name: string; rank_emoji: string | null }>>(
        `SELECT identity.id external_identity_id,player.id player_id,profile.current_display_name display_name,rank_profile.rank_emoji
           FROM external_identities identity
           JOIN players player ON player.id=identity.player_id
           JOIN player_profiles profile ON profile.player_id=player.id
      LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
          WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
            AND player.status='active' AND player.deleted_at IS NULL LIMIT 1 FOR UPDATE`,
        [input.externalUserId]
      ))[0];
      if (actor === undefined) return null;

      if (parsed.kind === "target_list") {
        const allowed = (await transaction.query<Array<{ allowed: number }>>(
          `SELECT 1 allowed FROM player_title_read_delegates delegate
            WHERE delegate.external_identity_id=? AND delegate.active=TRUE
          UNION
          SELECT 1 allowed FROM admin_operator_external_identities mapping
            JOIN admin_operators operator ON operator.id=mapping.operator_id
            JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
            JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
            JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='player.title.read_any'
           WHERE mapping.external_identity_id=? AND operator.status='active'
          LIMIT 1`,
          [actor.external_identity_id, actor.external_identity_id]
        ))[0];
        if (allowed === undefined) return null;
      }

      const commandCode = parsed.kind === "info" ? "PLAYER_TITLE_INFO_READ" : "PLAYER_TITLE_LIST_READ";
      const actionCode = parsed.kind === "info" ? "player.title.info_read" : "player.title.list_read";
      const scope = `${actionCode}:${input.externalUserId}`;
      const idempotencyKey = input.eventId.length <= 191 ? input.eventId : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",
        [randomUUID(), scope, idempotencyKey, actor.external_identity_id]
      );
      const operation = (await transaction.query<Array<{ id: bigint; result_json: string | PlayerTitleReadResult | null }>>(
        "SELECT id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, idempotencyKey]
      ))[0];
      if (operation === undefined) throw new Error("Player title read operation claim failed.");
      if (operation.result_json !== null) return typeof operation.result_json === "string" ? JSON.parse(operation.result_json) : operation.result_json;

      let target: { player_id: bigint; display_name: string; rank_emoji: string | null } | undefined;
      if (parsed.kind === "target_list" && parsed.targetKey !== null) {
        target = (await transaction.query<Array<{ player_id: bigint; display_name: string; rank_emoji: string | null }>>(
          `SELECT player.id player_id,profile.current_display_name display_name,rank_profile.rank_emoji
             FROM players player JOIN player_profiles profile ON profile.player_id=player.id
        LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
            WHERE player.status='active' AND player.deleted_at IS NULL
              AND BINARY profile.current_display_name=BINARY ? LIMIT 1 FOR UPDATE`,
          [parsed.targetKey]
        ))[0];
      } else if (parsed.kind !== "target_list") {
        target = { player_id: actor.player_id, display_name: actor.display_name, rank_emoji: actor.rank_emoji };
      }

      let status: PlayerTitleReadResult["status"];
      let data: string;
      let titles: PlayerTitleReadRow[] = [];
      if (parsed.kind === "target_list" && parsed.targetKey === null) {
        status = "invalid_format";
        data = "올바른 사용법은 /타이틀목록 [유저명] 입니다.";
      } else if (target === undefined) {
        status = "player_not_found";
        data = `${parsed.kind === "target_list" ? parsed.targetKey : actor.display_name}는(은) 존재하지 않는 사용자입니다.`;
      } else {
        const rows = await transaction.query<Array<{ title_id: bigint; display_name: string; acquired_display: string | null; acquisition_price: string; equipped: number }>>(
          `SELECT owned.title_id,definition.display_name,
                  DATE_FORMAT(CONVERT_TZ(owned.acquired_at,'+00:00','+09:00'),'%Y-%m-%d %H:%i') acquired_display,
                  CAST(owned.acquisition_price AS CHAR) acquisition_price,owned.equipped
             FROM player_titles owned JOIN title_definitions definition ON definition.id=owned.title_id
            WHERE owned.player_id=? AND definition.active=TRUE
            ORDER BY owned.display_order IS NULL,owned.display_order,owned.acquired_at IS NULL,owned.acquired_at,owned.title_id FOR UPDATE`,
          [target.player_id]
        );
        titles = rows.map((row) => ({ titleId: row.title_id.toString(), displayName: row.display_name, acquiredDisplay: row.acquired_display ?? "-", acquisitionPrice: row.acquisition_price, equipped: Boolean(row.equipped) }));
        const ownerLabel = `${target.rank_emoji ?? ""}${target.display_name}`;
        if (parsed.kind === "info") {
          if (parsed.index === null) {
            status = "invalid_format";
            data = "올바른 타이틀 명령어 형식을 사용해주세요. 예: /타이틀정보 [번호]";
          } else {
            const title = titles[parsed.index - 1];
            if (title === undefined) {
              status = "title_not_found";
              data = "해당 번호의 타이틀이 존재하지 않습니다.";
            } else {
              status = "info";
              data = formatPlayerTitleInfo(ownerLabel, title);
            }
          }
        } else if (titles.length === 0) {
          status = "empty";
          data = "보유 타이틀이 없습니다.";
        } else {
          status = "listed";
          data = formatPlayerTitleList(ownerLabel, titles, parsed.kind === "target_list");
        }
      }

      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.id, input.destinationId, JSON.stringify({ data })]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, commandCode, operation.id, status]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,?,?,'Iris 타이틀 조회',?,UTC_TIMESTAMP(3))", [operation.id, actor.external_identity_id, target?.player_id ?? null, actionCode, status, JSON.stringify({ readOnly: true, mode: parsed.kind, targetKey: parsed.kind === "target_list" ? parsed.targetKey : null, rowCount: titles.length, stableTitleIds: titles.map((title) => title.titleId) })]);
      const result: PlayerTitleReadResult = { status, data, targetPlayerId: target?.player_id.toString() ?? null, rowCount: titles.length, outboxId: outbox.insertId.toString() };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.id]);
      return result;
    });
  }
}

function integerText(value: string): string {
  const match = value.match(/^-?\d+/u);
  return match?.[0] ?? "0";
}

function commas(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
