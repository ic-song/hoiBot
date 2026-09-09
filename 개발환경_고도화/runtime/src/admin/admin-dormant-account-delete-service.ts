import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import {
  logicallyDeletePlayerAccount, resolveAccountDeleteOperator, type AccountDeleteTarget
} from "./admin-account-delete-progress-service.js";

export type AdminDormantAccountCommand =
  | { kind: "usage"; action: "list" | "delete" }
  | { kind: "list" | "delete"; levelThreshold: bigint };
export type AdminDormantAccountResult = {
  message: string; outboxId: string; replayed: boolean; resultCode: string;
  candidatePlayerIds: string[]; deletedPlayerIds: string[];
};
type Candidate = AccountDeleteTarget & {
  level_value: bigint; chat_count: bigint; last_activity_at: Date | string;
};

const SCOPE = "admin.dormant_account_delete";
const INACTIVITY_DAYS = 5;
const CHAT_COUNT_LIMIT = 100n;
const ALLSEE = "​".repeat(500);
const hashText = (value: string): string => createHash("sha256").update(value).digest("hex");
const key = (value: string): string => value.length <= 191 ? value : `sha256:${hashText(value)}`;
const stored = <T>(value: string | T): T => typeof value === "string" ? JSON.parse(value) as T : value;

// 동일 이벤트의 gap lock 교착과 잠금 대기 초과만 제한적으로 재시도합니다.
async function withDormantAccountRetry<T>(work: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await work(); }
    catch (error) {
      lastError = error;
      const code = (error as { code?: unknown }).code;
      const errno = (error as { errno?: unknown }).errno;
      if (attempt === 2 || (code !== "ER_LOCK_DEADLOCK" && code !== "ER_LOCK_WAIT_TIMEOUT" && errno !== 1213 && errno !== 1205)) throw error;
    }
  }
  throw lastError;
}

// 잠수 명단·삭제 명령의 bare usage와 unsigned 레벨 한 개만 허용합니다.
export function parseAdminDormantAccountCommand(message: string | undefined): AdminDormantAccountCommand | null {
  if (message === "/계정잠수명단") return { kind: "usage", action: "list" };
  if (message === "/계정잠수삭제") return { kind: "usage", action: "delete" };
  if (message === undefined || /[\r\n]/.test(message)) return null;
  const matched = message.match(/^\/(계정잠수명단|계정잠수삭제)[ \t]+(\d+)[ \t]*$/);
  if (matched === null) return null;
  const levelThreshold = BigInt(matched[2]!);
  if (levelThreshold > 18446744073709551615n) return null;
  return { kind: matched[1] === "계정잠수명단" ? "list" : "delete", levelThreshold };
}

export function isAdminDormantAccountCommand(message: string | undefined): boolean {
  return parseAdminDormantAccountCommand(message) !== null;
}

export function normalizeAdminDormantAccountDispatchMessage(message: string): string {
  const command = parseAdminDormantAccountCommand(message);
  if (command === null) return message;
  return command.kind === "usage" ? `/${command.action === "list" ? "계정잠수명단" : "계정잠수삭제"}`
    : `/${command.kind === "list" ? "계정잠수명단" : "계정잠수삭제"}`;
}

function formatCandidates(candidates: Candidate[]): string {
  if (candidates.length === 0) return "잠수 계정 후보가 없습니다.";
  const lines = [`잠수 계정 후보 ${candidates.length}명`];
  candidates.forEach((candidate, index) => {
    if (index === 10) lines.push(ALLSEE);
    const date = new Date(candidate.last_activity_at).toISOString().slice(0, 10);
    lines.push(`${index + 1}. ${candidate.display_name} · Lv.${candidate.level_value} · 채팅 ${candidate.chat_count} · 최근 ${date}`);
  });
  return lines.join("\n");
}

// 잠수 후보 snapshot과 삭제 결과를 같은 transaction·operation에 고정합니다.
export class AdminDormantAccountDeleteService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<{
    status: "changed"; data: string; outboxId: string;
  }> {
    const result = await this.execute({ eventId: input.eventId, externalUserId: input.externalUserId, destinationId: input.channelId, message: input.message });
    return { status: "changed", data: result.message, outboxId: result.outboxId };
  }

  async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<AdminDormantAccountResult> {
    const command = parseAdminDormantAccountCommand(input.message);
    if (command === null) throw new ApplicationError("ADMIN_DORMANT_COMMAND_INVALID", "잠수 계정 명령 형식을 확인해 주세요.", 422);
    const operator = await resolveAccountDeleteOperator(this.database, input.externalUserId);
    if (operator === null) throw new ApplicationError("ADMIN_DORMANT_FORBIDDEN", "잠수 계정 관리 권한이 없습니다.", 403);
    const levelThreshold = command.kind === "usage" ? 0n : command.levelThreshold;
    const requestHash = hashText(JSON.stringify({ kind: command.kind, action: command.kind === "usage" ? command.action : command.kind, levelThreshold: levelThreshold.toString() }));
    return withDormantAccountRetry(() => this.database.withTransaction(async (tx) => {
      const eventKey = key(input.eventId);
      const previous = (await tx.query<Array<{ result_json: string | AdminDormantAccountResult | null; request_hash: string | null }>>(
        `SELECT operation.result_json,run_row.request_hash FROM operations operation
         LEFT JOIN admin_dormant_account_runs run_row ON run_row.operation_id=operation.id
         WHERE operation.idempotency_scope=? AND operation.idempotency_key=? FOR UPDATE`, [SCOPE, eventKey]
      ))[0];
      if (previous?.result_json != null) {
        if (previous.request_hash !== requestHash) throw new ApplicationError("ADMIN_DORMANT_EVENT_CONFLICT", "같은 이벤트의 잠수 계정 요청 내용이 다릅니다.", 409);
        return { ...stored<AdminDormantAccountResult>(previous.result_json), replayed: true };
      }
      const operationId = (await tx.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), SCOPE, eventKey, operator.operator_id]
      )).insertId;
      const candidates = command.kind === "usage" ? [] : await tx.query<Candidate[]>(
        `SELECT player.id player_id,profile.current_display_name display_name,profile.level level_value,
                COALESCE(MAX(chat_counter.value),0) chat_count,
                profile.updated_at last_activity_at
           FROM players player
           JOIN player_profiles profile ON profile.player_id=player.id
           LEFT JOIN player_counters chat_counter ON chat_counter.player_id=player.id
            AND chat_counter.counter_code='chat_count' AND chat_counter.period_key='lifetime'
           LEFT JOIN user_accounts account_row ON account_row.player_id=player.id AND account_row.status<>'deleted'
          WHERE player.status='active' AND player.deleted_at IS NULL AND profile.level<=?
            AND (? IS NULL OR player.id<>?)
            AND COALESCE(account_row.account_type,'normal')<>'test'
            AND NOT EXISTS (
              SELECT 1 FROM external_identities admin_identity
              JOIN admin_operator_external_identities operator_identity ON operator_identity.external_identity_id=admin_identity.id
              JOIN admin_operators protected_operator ON protected_operator.id=operator_identity.operator_id AND protected_operator.status='active'
              WHERE admin_identity.player_id=player.id
            )
          GROUP BY player.id,profile.current_display_name,profile.level,profile.updated_at
         HAVING chat_count<=? AND last_activity_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ${INACTIVITY_DAYS} DAY)
          ORDER BY profile.level,profile.current_display_name COLLATE utf8mb4_unicode_ci,player.id`,
        [levelThreshold.toString(), operator.actor_player_id, operator.actor_player_id, CHAT_COUNT_LIMIT.toString()]
      );
      for (const candidate of candidates) await tx.query("SELECT id FROM players WHERE id=? FOR UPDATE", [candidate.player_id]);
      const candidatePlayerIds = candidates.map((candidate) => candidate.player_id.toString());
      const deletedPlayerIds: string[] = [];
      for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index]!;
        await tx.execute(
          "INSERT INTO admin_dormant_account_candidates(operation_id,sequence_no,player_id,display_name_snapshot,level_snapshot,chat_count_snapshot,last_activity_at_snapshot,action_code) VALUES (?,?,?,?,?,?,?,?)",
          [operationId, index + 1, candidate.player_id, candidate.display_name, candidate.level_value, candidate.chat_count,
            candidate.last_activity_at, command.kind === "delete" ? "deleted" : "listed"]
        );
        if (command.kind === "delete") {
          await logicallyDeletePlayerAccount(tx, operationId, operator.operator_id, index + 1, candidate);
          deletedPlayerIds.push(candidate.player_id.toString());
        }
      }
      const resultCode = command.kind === "usage" ? "usage" : command.kind === "list" ? "listed" : "deleted";
      const message = command.kind === "usage"
        ? `사용법: /계정잠수${command.action === "list" ? "명단" : "삭제"} [최대레벨]`
        : command.kind === "list" ? formatCandidates(candidates)
          : `잠수 계정 삭제 완료: ${deletedPlayerIds.length}명\n${formatCandidates(candidates)}`;
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operationId, input.destinationId, JSON.stringify({ data: message })]
      );
      const result: AdminDormantAccountResult = { message, outboxId: outbox.insertId.toString(), replayed: false, resultCode, candidatePlayerIds, deletedPlayerIds };
      await tx.execute(
        `INSERT INTO admin_dormant_account_runs
          (operation_id,operator_id,command_kind,level_threshold,inactivity_days,chat_count_limit,request_hash,candidate_count,deleted_count,result_json)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [operationId, operator.operator_id, command.kind, levelThreshold.toString(), INACTIVITY_DAYS, CHAT_COUNT_LIMIT.toString(), requestHash, candidates.length, deletedPlayerIds.length, JSON.stringify(result)]
      );
      const commandCode = command.kind === "delete" ? "ADMIN_DORMANT_ACCOUNT_DELETE" : "ADMIN_DORMANT_ACCOUNT_LIST";
      await tx.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [eventKey, commandCode, operationId, resultCode]
      );
      await tx.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player',NULL,'account.delete.dormant',?,?,UTC_TIMESTAMP(3))",
        [operationId, operator.operator_id, resultCode, JSON.stringify({ levelThreshold: levelThreshold.toString(), candidatePlayerIds, deletedPlayerIds })]
      );
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
      return result;
    }));
  }
}
