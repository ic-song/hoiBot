import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { generateStarterPet, parsePetCreationCommand } from "./pet-creation-policy.js";

export interface PetCreationCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface PetCreationReply {
  outboxId: string;
  data: string;
}

export interface PetCreationResult {
  status: "created";
  playerId: string;
  petId: string;
  petName: string;
  petTypeCode: string;
  petTypeDisplayName: string;
  imageValue: string;
  personality: string;
  unique: boolean;
  replies: PetCreationReply[];
  auditId: string;
}

interface PetOwnerRow {
  identity_id: bigint;
  player_id: bigint;
  current_display_name: string;
}

// Iris 메시지가 `/펫생성` 명령 후보인지 넓은 실행 없이 판별합니다.
export function isPetCreationCommandCandidate(message: string | undefined): boolean {
  return message === "/펫생성" || message?.startsWith("/펫생성 ") === true;
}

// 긴 event ID를 operations의 idempotency 키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 컬럼에서 재시도 결과를 복원합니다.
function parseStoredResult(value: string | PetCreationResult): PetCreationResult {
  return typeof value === "string" ? JSON.parse(value) as PetCreationResult : value;
}

// 기존 getCurrentDate와 같은 KST 날짜 문자열을 만듭니다.
function formatKstDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(value);
}

// `/펫생성`의 펫·정령·스킬·미니펫·홈 초기값을 한 트랜잭션으로 생성합니다.
export class PetCreationService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly random: () => number = Math.random,
    private readonly now: () => Date = () => new Date()
  ) {}

  async handle(command: PetCreationCommand): Promise<PetCreationResult> {
    const petName = parsePetCreationCommand(command.message);
    if (petName === null) {
      const requestedName = command.message.startsWith("/펫생성 ")
        ? command.message.slice("/펫생성 ".length).trim()
        : "";
      if (requestedName === "") {
        throw new ApplicationError("PET_NAME_REQUIRED", "펫 이름을 입력해주세요.\n예: /펫생성 봉봉", 422);
      }
      if (requestedName.length > 6) {
        throw new ApplicationError("PET_NAME_TOO_LONG", "펫 이름은 6글자 이하로 설정해주세요.", 422);
      }
      throw new ApplicationError("INVALID_PET_CREATE_COMMAND", "펫 이름은 공백 없이 6글자 이하로 입력해주세요.", 422);
    }

    return this.database.withTransaction(async (transaction) => {
      const owners = await transaction.query<PetOwnerRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name
         FROM external_identities identity
         JOIN player_profiles profile ON profile.player_id = identity.player_id
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
           AND identity.status = 'linked' AND identity.player_id IS NOT NULL
         FOR UPDATE`,
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);

      const scope = `pet.create:${owner.identity_id}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PetCreationResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const pets = await transaction.query<Array<{ id: bigint; display_name: string | null }>>(
        "SELECT id, display_name FROM player_pets WHERE player_id = ? FOR UPDATE",
        [owner.player_id]
      );
      const pet = pets[0];
      if (pet === undefined) throw new ApplicationError("PET_ROW_REQUIRED", "회원의 펫 초기 행을 찾을 수 없습니다.", 409);
      if (pet.display_name !== null && pet.display_name !== "") {
        throw new ApplicationError("PET_ALREADY_EXISTS", `[🌱${owner.current_display_name}] 님은 이미 펫이 있습니다.`, 409);
      }

      const generated = generateStarterPet(this.random);
      const createdAt = this.now();
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, owner.identity_id]
      );

      const petUpdate = await transaction.execute(
        `UPDATE player_pets SET display_name = ?, pet_type_code = ?, image_value = ?, joined_on = ?,
           personality_label = ?, experience = 35000, enhancement_level = 90,
           enhancement_updated_at = ?, version = version + 1
         WHERE id = ? AND (display_name IS NULL OR display_name = '')`,
        [petName, generated.typeCode, generated.imageValue, formatKstDate(createdAt), generated.personality, createdAt, pet.id]
      );
      if (petUpdate.affectedRows !== 1n) throw new ApplicationError("PET_CREATE_CONFLICT", "펫 정보가 먼저 변경되었습니다.", 409);
      const starterSkill = await transaction.execute(
        `INSERT INTO player_pet_elementals
          (player_pet_id, display_name, grade_code, grade_display_name, enhancement_level, version)
         VALUES (?, '피닉스🐦‍🔥', 'spirit_king', '정령왕', 80, 1)`,
        [pet.id]
      );
      if (starterSkill.affectedRows !== 1n) throw new ApplicationError("STARTER_SKILL_REQUIRED", "스타터 펫 스킬 설정을 찾을 수 없습니다.", 409);
      const starterMiniPet = await transaction.execute(
        `INSERT INTO pet_skill_inventory (player_pet_id, skill_id, quantity, version, updated_at)
         SELECT ?, id, 1, 1, UTC_TIMESTAMP(3) FROM skill_definitions
         WHERE code = 'legacy-ten-won' AND active = TRUE`,
        [pet.id]
      );
      await transaction.execute(
        `INSERT INTO owned_mini_pets
          (player_id, mini_pet_definition_id, custom_name, progress, battle_experience,
           castle_experience, raid_experience, equipped)
         SELECT ?, id, NULL, 0, 100000, 100000, 100000, TRUE FROM mini_pet_definitions
         WHERE code = 'legacy-starter-mini-pet' AND active = TRUE`,
        [owner.player_id]
      );
      if (starterMiniPet.affectedRows !== 1n) throw new ApplicationError("STARTER_MINI_PET_REQUIRED", "스타터 미니펫 설정을 찾을 수 없습니다.", 409);
      await transaction.execute(
        `INSERT INTO player_homes
          (player_id, display_name, base_experience, like_count, floor_area, version)
         VALUES (?, '산이 보이는 텐트집🏕️', 3510, 0, 18, 1)`,
        [owner.player_id]
      );

      const messages = [
        "펫이 탄생했습니다!",
        ...(generated.unique ? ["축하합니다!!\n🎉유니크 펫이 탄생했습니다🎉"] : []),
        `[🌱${owner.current_display_name}] 님의 펫이 생성되었습니다!\n채팅창에 \"펫정보 가이드\"를 입력하시면 상세가이드 확인이 가능합니다.`
      ];
      const replies: PetCreationReply[] = [];
      for (const data of messages) {
        const outbox = await transaction.execute(
          `INSERT INTO outbox_messages
            (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
           VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [operation.insertId, command.channelId, JSON.stringify({ data })]
        );
        replies.push({ outboxId: outbox.insertId.toString(), data });
      }
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
         VALUES (?, 'pet_create', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [command.eventId, operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
         VALUES (?, 'external_identity', ?, 'player', ?, 'pet.create', 'success', 'Iris /펫생성', ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, owner.identity_id, owner.player_id, JSON.stringify({
          petId: pet.id.toString(), petName, petTypeCode: generated.typeCode, unique: generated.unique,
          starterPet: true, starterElemental: true, starterMiniPet: true, starterSkill: true, starterHome: true
        })]
      );
      const result: PetCreationResult = {
        status: "created", playerId: owner.player_id.toString(), petId: pet.id.toString(), petName,
        petTypeCode: generated.typeCode, petTypeDisplayName: generated.typeDisplayName,
        imageValue: generated.imageValue, personality: generated.personality, unique: generated.unique,
        replies, auditId: audit.insertId.toString()
      };
      await transaction.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}
