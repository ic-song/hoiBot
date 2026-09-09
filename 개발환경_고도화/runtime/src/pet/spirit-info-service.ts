import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

const OPERATOR_NAME = "호이 남";

interface SpiritInfoRow {
  identity_id: bigint;
  player_id: bigint;
  current_display_name: string;
  elemental_name: string | null;
  grade_display_name: string | null;
  enhancement_level: bigint | null;
  battle_exp: bigint | null;
  battle_upgrade_exp: bigint | null;
  raid_exp: bigint | null;
  raid_upgrade_exp: bigint | null;
  castle_exp: bigint | null;
  castle_upgrade_exp: bigint | null;
}

export interface SpiritInfoState {
  upgrade: bigint;
  name: string;
  grade: string;
  battleExp: bigint;
  battleUpgradeExp: bigint;
  raidExp: bigint;
  raidUpgradeExp: bigint;
  castleExp: bigint;
  castleUpgradeExp: bigint;
}

export interface SpiritInfoResult {
  status: "replied" | "silent";
  replies: Array<{ data: string; outboxId: string }>;
}

// `/정령정보` 정확 일치만 현대화 후보로 허용합니다.
export function isSpiritInfoCommand(message: string | undefined): boolean {
  return message === "/정령정보";
}

// 레거시 전용 조회 사용자의 표시 이름을 그대로 확인합니다.
export function isSpiritInfoOperator(displayName: string): boolean {
  return displayName === OPERATOR_NAME;
}

// 레거시 JSON.stringify 속성 순서와 정령 경험치 계산 결과를 그대로 렌더링합니다.
export function formatSpiritInfoReplies(state: SpiritInfoState): [string, string] {
  const raw = JSON.stringify({ upgrade: Number(state.upgrade), name: state.name, grade: state.grade });
  const projection = JSON.stringify({
    battleExp: Number(state.battleExp + state.upgrade * state.battleUpgradeExp),
    raidExp: Number(state.raidExp + state.upgrade * state.raidUpgradeExp),
    castleExp: Number(state.castleExp + state.upgrade * state.castleUpgradeExp),
    message: ""
  });
  return [raw, projection];
}

// 긴 이벤트 ID를 operations 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function parseStoredResult(value: string | SpiritInfoResult): SpiritInfoResult {
  return typeof value === "string" ? JSON.parse(value) as SpiritInfoResult : value;
}

// 정령 원본과 계산 projection을 읽기 전용 transaction으로 제공합니다.
export class SpiritInfoService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<SpiritInfoResult> {
    return this.database.withTransaction(async (transaction) => {
      const rows = await transaction.query<SpiritInfoRow[]>(`SELECT identity.id identity_id,profile.player_id,profile.current_display_name,
          elemental.display_name elemental_name,elemental.grade_display_name,elemental.enhancement_level,
          grade.battle_exp,grade.battle_upgrade_exp,grade.raid_exp,grade.raid_upgrade_exp,grade.castle_exp,grade.castle_upgrade_exp
        FROM external_identities identity
        JOIN players player ON player.id=identity.player_id AND player.status='active'
        JOIN player_profiles profile ON profile.player_id=player.id
        LEFT JOIN player_pets pet ON pet.player_id=player.id
        LEFT JOIN player_pet_elementals elemental ON elemental.player_pet_id=pet.id
        LEFT JOIN elemental_enhancement_grades grade ON grade.grade_code=elemental.grade_code AND grade.active=TRUE
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
        LIMIT 1 FOR UPDATE`, [input.externalUserId]);
      const row = rows[0];
      if (row === undefined || !isSpiritInfoOperator(row.current_display_name)) return { status: "silent", replies: [] };
      if (row.elemental_name === null || row.grade_display_name === null || row.enhancement_level === null
        || row.battle_exp === null || row.battle_upgrade_exp === null || row.raid_exp === null
        || row.raid_upgrade_exp === null || row.castle_exp === null || row.castle_upgrade_exp === null) {
        throw new Error("Spirit info consistency violation: elemental or grade policy is missing.");
      }

      const key = normalizeEventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | SpiritInfoResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='spirit.info_read' AND idempotency_key=? FOR UPDATE", [key]);
      if (prior[0]?.result_json != null) return parseStoredResult(prior[0].result_json);

      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'spirit.info_read',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, row.identity_id]);
      const data = formatSpiritInfoReplies({
        upgrade: BigInt(row.enhancement_level), name: row.elemental_name, grade: row.grade_display_name,
        battleExp: BigInt(row.battle_exp), battleUpgradeExp: BigInt(row.battle_upgrade_exp),
        raidExp: BigInt(row.raid_exp), raidUpgradeExp: BigInt(row.raid_upgrade_exp),
        castleExp: BigInt(row.castle_exp), castleUpgradeExp: BigInt(row.castle_upgrade_exp)
      });
      const replies: Array<{ data: string; outboxId: string }> = [];
      for (const message of data) {
        const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
          [operation.insertId, input.destinationId, JSON.stringify({ data: message })]);
        replies.push({ data: message, outboxId: outbox.insertId.toString() });
      }
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'SPIRIT_INFO_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operation.insertId]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'spirit.info_read','success','Iris /정령정보',?,UTC_TIMESTAMP(3))",
        [operation.insertId, row.identity_id, row.player_id, JSON.stringify({ replyCount: replies.length, readOnly: true })]);
      const result: SpiritInfoResult = { status: "replied", replies };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
