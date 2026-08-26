import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

const MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615n;

export interface TrialTowerAdminModifyResult {
  status: "changed" | "rejected";
  data: string;
  outboxId: string;
  auditId: string;
  targetPlayerId?: string;
  previousFloor?: string;
  adjustedFloor?: string;
}

// 레거시 startsWith 외부 guard를 보존하되 실제 변경은 전체 명령 파싱 후에만 허용합니다.
export function isTrialTowerAdminModifyCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && message.startsWith("/시련의탑수정");
}

// 띄어쓰기가 포함된 닉네임과 마지막 정수 층수를 분리합니다.
export function parseTrialTowerAdminModifyCommand(message: string): { targetName: string; floor: bigint } | null {
  const match = /^\/시련의탑수정\s+(.+?)\s+(\d+)$/.exec(message);
  if (match === null) return null;
  const floor = BigInt(match[2]!);
  if (floor > MAX_UNSIGNED_BIGINT) return null;
  return { targetName: match[1]!, floor };
}

// 긴 Iris event ID를 operations의 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function parseStoredResult(value: string | TrialTowerAdminModifyResult): TrialTowerAdminModifyResult {
  return typeof value === "string" ? JSON.parse(value) as TrialTowerAdminModifyResult : value;
}

// 현재 시즌 진행도를 잠그고 이전 층 snapshot·감사·응답을 한 transaction으로 저장합니다.
export class TrialTowerAdminModifyService {
  constructor(private readonly database: DatabaseClient) {}

  async modify(input: { message: string; idempotencyKey: string; sourceEventId: string; destinationId: string; operatorId: string }): Promise<TrialTowerAdminModifyResult> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `admin.trial_tower.modify:${input.operatorId}`, eventKey = normalizeEventKey(input.idempotencyKey);
      const prior = await transaction.query<Array<{ result_json: string | TrialTowerAdminModifyResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, eventKey],
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const parsed = parseTrialTowerAdminModifyCommand(input.message);
      let targetRows: Array<{ player_id: bigint; floor: bigint; season_key: string }> = [];
      if (parsed !== null && parsed.floor >= 1n) {
        targetRows = await transaction.query<Array<{ player_id: bigint; floor: bigint; season_key: string }>>(
          `SELECT progress.player_id,progress.floor,progress.season_key
           FROM player_profiles profile
           JOIN trial_tower_progress progress ON progress.player_id=profile.player_id
           JOIN trial_tower_seasons season ON season.season_key=progress.season_key AND season.active=TRUE
           WHERE profile.current_display_name=? ORDER BY progress.player_id LIMIT 2 FOR UPDATE`, [parsed.targetName],
        );
      }
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,? ,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, input.operatorId],
      );

      let data: string, resultCode: string, status: "changed" | "rejected" = "rejected";
      if (parsed === null) {
        data = "잘못된 명령어 형식입니다. 사용법: /시련의탑수정 {닉네임} {층수}";
        resultCode = "invalid_format";
      } else if (parsed.floor < 1n) {
        data = "층수는 1 이상의 숫자로 입력해야 합니다.";
        resultCode = "invalid_floor";
      } else if (targetRows.length === 0) {
        data = parsed.targetName + "님의 시련의 탑 데이터가 존재하지 않습니다.";
        resultCode = "target_not_found";
      } else if (targetRows.length > 1) {
        data = parsed.targetName + "님의 시련의 탑 데이터가 존재하지 않습니다.";
        resultCode = "target_ambiguous";
      } else {
        const target = targetRows[0]!;
        await transaction.execute(
          "INSERT INTO trial_tower_progress_adjustments(operation_id,season_key,player_id,previous_floor,adjusted_floor) VALUES (?,?,?,?,?)",
          [operation.insertId, target.season_key, target.player_id, target.floor, parsed.floor],
        );
        await transaction.execute(
          "UPDATE trial_tower_progress SET floor=?,version=version+1 WHERE season_key=? AND player_id=?",
          [parsed.floor, target.season_key, target.player_id],
        );
        data = parsed.targetName + "[님의 시련의 탑 층수가 " + parsed.floor.toString() + "층으로 변경되었습니다.";
        resultCode = "reply_queued";
        status = "changed";
      }
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })],
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'trial_tower_admin_modify',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId, resultCode],
      );
      const target = targetRows.length === 1 ? targetRows[0] : undefined;
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'trial_tower_progress',?,'trial_tower.progress.adjust',?,'Iris /시련의탑수정',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, target?.player_id ?? null, status === "changed" ? "success" : resultCode,
          JSON.stringify({ targetName: parsed?.targetName, previousFloor: target?.floor.toString(), adjustedFloor: parsed?.floor.toString() })],
      );
      const result: TrialTowerAdminModifyResult = {
        status, data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(),
        targetPlayerId: target?.player_id.toString(), previousFloor: target?.floor.toString(), adjustedFloor: status === "changed" ? parsed!.floor.toString() : undefined,
      };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
