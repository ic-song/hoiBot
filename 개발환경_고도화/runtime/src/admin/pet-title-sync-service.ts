import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

export interface PetTitleSyncInput {
  idempotencyKey: string;
  sourceEventId: string;
  destinationId: string;
  operatorId: string;
}

export interface PetTitleSyncResult {
  status: "synced";
  removedCount: number;
  removedTitleCount: number;
  removedMemberKeys: string[];
  data: string;
  outboxId: string;
  auditId: string;
}

interface OrphanPetTitleRow {
  pet_id: bigint;
  player_id: bigint;
  member_key: string;
  title_count: bigint;
}

// `/펫타이틀동기화`는 인자나 접미 문구가 없는 정확 명령만 후보로 허용합니다.
export function isPetTitleSyncCommand(message: string | undefined): boolean {
  return message === "/펫타이틀동기화";
}

// 긴 Iris event ID를 operations의 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function parseStoredResult(value: string | PetTitleSyncResult): PetTitleSyncResult {
  return typeof value === "string" ? JSON.parse(value) as PetTitleSyncResult : value;
}

// 회원 원장에 남아 있지 않은 사용자의 펫 타이틀만 원자적으로 정리합니다.
export class PetTitleSyncService {
  constructor(private readonly database: DatabaseClient) {}

  async sync(input: PetTitleSyncInput): Promise<PetTitleSyncResult> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `admin.pet_title.sync:${input.operatorId}`;
      const eventKey = normalizeEventKey(input.idempotencyKey);
      const prior = await transaction.query<Array<{ result_json: string | PetTitleSyncResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, eventKey],
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const orphanTitles = await transaction.query<OrphanPetTitleRow[]>(
        `SELECT pet.id AS pet_id,pet.player_id,
           COALESCE(profile.current_display_name,
             (SELECT MAX(identity.display_name) FROM external_identities identity WHERE identity.player_id=pet.player_id),
             CAST(pet.player_id AS CHAR)) AS member_key,
           COUNT(assignment.title_id) AS title_count
         FROM pet_titles assignment
         JOIN player_pets pet ON pet.id=assignment.player_pet_id
         LEFT JOIN players player ON player.id=pet.player_id
         LEFT JOIN player_profiles profile ON profile.player_id=pet.player_id
         WHERE player.id IS NULL OR player.status<>'active' OR profile.player_id IS NULL
         GROUP BY pet.id,pet.player_id,profile.current_display_name
         ORDER BY pet.id FOR UPDATE`,
      );
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?, ?, ?, 'admin_operator', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, input.operatorId],
      );
      for (const orphan of orphanTitles) {
        await transaction.execute("DELETE FROM pet_titles WHERE player_pet_id=?", [orphan.pet_id]);
      }

      const removedMemberKeys = orphanTitles.map((row) => row.member_key);
      const removedTitleCount = orphanTitles.reduce((sum, row) => sum + Number(row.title_count), 0);
      const data = `펫타이틀데이터 동기화완료 (${removedMemberKeys.length})${"\u200b".repeat(500)}${removedMemberKeys.toString()}`;
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })],
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'admin_pet_title_sync',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId],
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'pet_title_data',NULL,'pet_title.sync','success','Iris /펫타이틀동기화',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, JSON.stringify({
          removedCount: removedMemberKeys.length,
          removedTitleCount,
          removedPlayerIds: orphanTitles.map((row) => row.player_id.toString()),
          removedMemberKeys,
        })],
      );
      const result: PetTitleSyncResult = {
        status: "synced", removedCount: removedMemberKeys.length, removedTitleCount, removedMemberKeys, data,
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

