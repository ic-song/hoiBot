import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

const OPERATOR_NAME = "호이 남";

interface SpiritInfoRow {
  player_id: bigint;
  elemental_name: string | null;
  grade_display_name: string | null;
  enhancement_level: bigint | null;
  battle_exp: bigint | string | null;
  battle_upgrade_exp: bigint | string | null;
  raid_exp: bigint | string | null;
  raid_upgrade_exp: bigint | string | null;
  castle_exp: bigint | string | null;
  castle_upgrade_exp: bigint | string | null;
}

interface SpiritInfoStoredResult {
  contractVersion: 1;
  requestFingerprint: string;
  result: SpiritInfoResult;
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
function parseJson<T>(value: string | T): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

function requestFingerprint(input: { externalUserId: string; destinationId: string; displayName?: string; displayNameTrust: "trusted" | "untrusted" }): string {
  return createHash("sha256").update(JSON.stringify({ command: "/정령정보", externalUserId: input.externalUserId,
    destinationId: input.destinationId, displayName: input.displayName ?? null, displayNameTrust: input.displayNameTrust })).digest("hex");
}

// 레거시 grade_code는 순서 브리지 탐색에만 쓰고 계산값은 canonical CUID 정의에서 읽습니다.
export class SpiritInfoService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string; displayName?: string; displayNameTrust: "trusted" | "untrusted" }): Promise<SpiritInfoResult> {
    return this.database.withTransaction(async (transaction) => {
      const identities = await transaction.query<Array<{ identity_id: bigint; player_id: bigint }>>(
        `SELECT identity.id identity_id,identity.player_id
         FROM external_identities identity
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND identity.player_id IS NOT NULL
         ORDER BY identity.id LIMIT 2 FOR UPDATE`, [input.externalUserId]);
      if (identities.length !== 1) throw new Error("Spirit info caller identity consistency violation.");
      const identity = identities[0]!;
      const key = normalizeEventKey(input.eventId);
      const prior = (await transaction.query<Array<{ id: bigint; actor_type: string; actor_id: bigint | null; status: string; result_json: string | SpiritInfoStoredResult | null }>>(
        "SELECT id,actor_type,actor_id,status,result_json FROM operations WHERE idempotency_scope='spirit.info_read' AND idempotency_key=? FOR UPDATE", [key]))[0];
      if (prior !== undefined) {
        if (prior.status !== "completed" || prior.result_json === null) throw new Error("Spirit info terminal operation consistency violation.");
        if (prior.actor_type !== "external_identity" || prior.actor_id !== identity.identity_id) throw new Error("Spirit info replay actor drift.");
        const stored = parseJson<SpiritInfoStoredResult>(prior.result_json);
        if (stored.contractVersion !== 1 || stored.requestFingerprint !== requestFingerprint(input)) throw new Error("Spirit info replay payload drift.");
        const outboxes = await transaction.query<Array<{ id: bigint; provider_code: string; destination_id: string; message_type: string; payload_json: string | { data?: unknown } }>>(
          "SELECT id,provider_code,destination_id,message_type,payload_json FROM outbox_messages WHERE operation_id=? ORDER BY id FOR UPDATE", [prior.id]);
        if (outboxes.length !== stored.result.replies.length || outboxes.some((outbox, index) => {
          const reply = stored.result.replies[index];
          const payload = parseJson<{ data?: unknown }>(outbox.payload_json);
          return reply === undefined || outbox.id.toString() !== reply.outboxId || outbox.provider_code !== "iris"
            || outbox.destination_id !== input.destinationId || outbox.message_type !== "text" || payload.data !== reply.data;
        })) throw new Error("SPIRIT_INFO_REPLAY_OUTBOX_DRIFT");
        return stored.result;
      }
      if (input.displayNameTrust !== "trusted") throw new Error("Spirit info display-name provenance is not trusted.");
      if (input.displayName === undefined || !isSpiritInfoOperator(input.displayName)) return { status: "silent", replies: [] };

      const rows = await transaction.query<SpiritInfoRow[]>(`SELECT profile.player_id,
          elemental.display_name elemental_name,elemental.grade_display_name,elemental.enhancement_level,
          canonical_grade.battle_base_experience_amount battle_exp,
          canonical_grade.battle_experience_per_enhancement_amount battle_upgrade_exp,
          canonical_grade.raid_base_experience_amount raid_exp,
          canonical_grade.raid_experience_per_enhancement_amount raid_upgrade_exp,
          canonical_grade.castle_base_experience_amount castle_exp,
          canonical_grade.castle_experience_per_enhancement_amount castle_upgrade_exp
        FROM players player
        JOIN player_profiles profile ON profile.player_id=player.id
        LEFT JOIN player_pets pet ON pet.player_id=player.id
        LEFT JOIN player_pet_elementals elemental ON elemental.player_pet_id=pet.id
        LEFT JOIN elemental_enhancement_grades legacy_grade ON legacy_grade.grade_code=elemental.grade_code AND legacy_grade.active=TRUE
        LEFT JOIN canonical_elemental_grade_definition_bridges grade_bridge ON grade_bridge.elemental_grade_order=legacy_grade.grade_order
        LEFT JOIN canonical_equipment_grade_definitions canonical_grade
          ON canonical_grade.equipment_grade_definition_id=grade_bridge.equipment_grade_definition_id
          AND canonical_grade.equipment_family='elemental' AND canonical_grade.active_flag=TRUE
        WHERE player.id=? AND player.status='active'
        LIMIT 1 FOR UPDATE`, [identity.player_id]);
      const row = rows[0];
      if (row === undefined || row.elemental_name === null || row.grade_display_name === null || row.enhancement_level === null
        || row.battle_exp === null || row.battle_upgrade_exp === null || row.raid_exp === null
        || row.raid_upgrade_exp === null || row.castle_exp === null || row.castle_upgrade_exp === null) {
        throw new Error("Spirit info consistency violation: elemental or grade policy is missing.");
      }

      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'spirit.info_read',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, identity.identity_id]);
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
        [operation.insertId, identity.identity_id, row.player_id, JSON.stringify({ replyCount: replies.length, readOnly: true })]);
      const result: SpiritInfoResult = { status: "replied", replies };
      const stored: SpiritInfoStoredResult = { contractVersion: 1, requestFingerprint: requestFingerprint(input), result };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(stored), operation.insertId]);
      return result;
    });
  }
}
