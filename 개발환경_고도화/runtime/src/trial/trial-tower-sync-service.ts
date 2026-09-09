import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

export interface TrialTowerSyncInput {
  idempotencyKey: string;
  sourceEventId: string;
  destinationId: string;
  operatorId: string;
}

export interface TrialTowerSyncResult {
  status: "synced";
  removedCount: number;
  removedMemberKeys: string[];
  data: string;
  outboxId: string;
  auditId: string;
}

interface OrphanProgressRow {
  season_key: string;
  player_id: bigint;
  member_key: string;
  floor: bigint;
  last_win_at: Date | null;
  version: bigint;
}

// 레거시 실행 명령과 완전히 일치하는 입력만 시련의 탑 동기화 후보로 허용합니다.
export function isTrialTowerSyncCommand(message: string | undefined): boolean {
  return message === "/시련의탑동기화";
}

// 긴 Iris event ID를 operations의 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function parseStoredResult(value: string | TrialTowerSyncResult): TrialTowerSyncResult {
  return typeof value === "string" ? JSON.parse(value) as TrialTowerSyncResult : value;
}

// 활성 회원 원본에 없는 시련의 탑 진행을 삭제 전 스냅샷과 함께 원자적으로 정리합니다.
export class TrialTowerSyncService {
  constructor(private readonly database: DatabaseClient) {}

  async sync(input: TrialTowerSyncInput): Promise<TrialTowerSyncResult> {
    return this.database.withTransaction(async (transaction: DatabaseTransaction) => {
      const scope = `admin.trial_tower.sync:${input.operatorId}`;
      const eventKey = normalizeEventKey(input.idempotencyKey);
      const prior = await transaction.query<Array<{ result_json: string | TrialTowerSyncResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, eventKey],
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const orphanProgress = await transaction.query<OrphanProgressRow[]>(
        `SELECT progress.season_key,progress.player_id,
           COALESCE(profile.current_display_name,
             (SELECT MAX(identity.display_name) FROM external_identities identity WHERE identity.player_id=progress.player_id),
             CAST(progress.player_id AS CHAR)) AS member_key,
           progress.floor,progress.last_win_at,progress.version
         FROM trial_tower_progress progress
         LEFT JOIN players player ON player.id=progress.player_id
         LEFT JOIN player_profiles profile ON profile.player_id=progress.player_id
         WHERE player.id IS NULL OR player.status<>'active'
         ORDER BY progress.season_key,progress.player_id FOR UPDATE`,
      );
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,? ,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, input.operatorId],
      );
      for (const row of orphanProgress) {
        await transaction.execute(
          `INSERT INTO trial_tower_sync_removals
            (operation_id,season_key,player_id,member_key,floor,last_win_at,progress_version,removed_at)
           VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,
          [operation.insertId, row.season_key, row.player_id, row.member_key, row.floor, row.last_win_at, row.version],
        );
        await transaction.execute("DELETE FROM trial_tower_progress WHERE season_key=? AND player_id=?", [row.season_key, row.player_id]);
      }

      const removedMemberKeys = [...new Set(orphanProgress.map((row) => row.member_key))];
      const data = `시련의탑동기화데이터 동기화완료 (${removedMemberKeys.length})${"\u200b".repeat(500)}${removedMemberKeys.toString()}`;
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })],
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'trial_tower_sync',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId],
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'trial_tower_progress',NULL,'trial_tower.sync','success','Iris /시련의탑동기화',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, JSON.stringify({
          removedCount: removedMemberKeys.length,
          removedProgressCount: orphanProgress.length,
          removedPlayerIds: orphanProgress.map((row) => row.player_id.toString()),
          removedMemberKeys,
        })],
      );
      const result: TrialTowerSyncResult = {
        status: "synced", removedCount: removedMemberKeys.length, removedMemberKeys, data,
        outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(),
      };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId],
      );
      return result;
    });
  }
}
