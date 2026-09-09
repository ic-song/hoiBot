import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

export interface PetDataSyncInput {
  idempotencyKey: string;
  sourceEventId: string;
  destinationId: string;
  operatorId: string;
}

export interface PetDataSyncResult {
  status: "synced";
  removedCount: number;
  removedMemberKeys: string[];
  data: string;
  outboxId: string;
  auditId: string;
}

interface OrphanPetRow {
  pet_id: bigint;
  player_id: bigint;
  member_key: string;
}

// `/펫데이터동기화`는 인자나 접미 문구가 없는 정확 명령만 후보로 허용합니다.
export function isPetDataSyncCommand(message: string | undefined): boolean {
  return message === "/펫데이터동기화";
}

// 긴 Iris event ID를 operations의 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function parseStoredResult(value: string | PetDataSyncResult): PetDataSyncResult {
  return typeof value === "string" ? JSON.parse(value) as PetDataSyncResult : value;
}

// member_pet.json 한 회원 레코드에 대응하는 펫 하위 관계를 FK 순서대로 제거합니다.
async function deletePetAggregate(transaction: DatabaseTransaction, petId: bigint): Promise<void> {
  for (const table of [
    "pet_titles", "pet_skills", "pet_equipment", "player_pet_elementals", "pet_skill_inventory",
    "player_pet_pendants", "player_pet_intimacy", "pet_expedition_runs",
  ]) {
    await transaction.execute(`DELETE FROM ${table} WHERE player_pet_id = ?`, [petId]);
  }
  await transaction.execute("DELETE FROM player_pets WHERE id = ?", [petId]);
}

// 비활성·프로필 소실 회원의 펫 집합을 멱등 operation과 같은 transaction에서 정리합니다.
export class PetDataSyncService {
  constructor(private readonly database: DatabaseClient) {}

  async sync(input: PetDataSyncInput): Promise<PetDataSyncResult> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `admin.pet_data.sync:${input.operatorId}`;
      const eventKey = normalizeEventKey(input.idempotencyKey);
      const prior = await transaction.query<Array<{ result_json: string | PetDataSyncResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, eventKey],
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const orphanPets = await transaction.query<OrphanPetRow[]>(
        `SELECT pet.id AS pet_id,pet.player_id,
           COALESCE(profile.current_display_name,
             (SELECT MAX(identity.display_name) FROM external_identities identity WHERE identity.player_id=pet.player_id),
             CAST(pet.player_id AS CHAR)) AS member_key
         FROM player_pets pet
         LEFT JOIN players player ON player.id=pet.player_id
         LEFT JOIN player_profiles profile ON profile.player_id=pet.player_id
         WHERE player.id IS NULL OR player.status<>'active' OR profile.player_id IS NULL
         ORDER BY pet.id FOR UPDATE`,
      );
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?, ?, ?, 'admin_operator', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, input.operatorId],
      );
      for (const orphan of orphanPets) await deletePetAggregate(transaction, orphan.pet_id);

      const removedMemberKeys = orphanPets.map((row) => row.member_key);
      const data = `펫데이터 동기화완료 (${removedMemberKeys.length})${"\u200b".repeat(500)}${removedMemberKeys.toString()}`;
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })],
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'admin_pet_data_sync',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId],
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'pet_data',NULL,'pet_data.sync','success','Iris /펫데이터동기화',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, JSON.stringify({
          removedCount: removedMemberKeys.length,
          removedPlayerIds: orphanPets.map((row) => row.player_id.toString()),
          removedMemberKeys,
        })],
      );
      const result: PetDataSyncResult = {
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
