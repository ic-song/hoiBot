import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { GRADE_COMBINE_REWARDS, type GradeCombineReward } from "./grade-combine-rewards.js";

const GRADE_ORDER = ["일반","고급","희귀","영웅","전설","전설+","신화","신화+","초월","초월+","태초","태초+","창세","창조"] as const;

interface CombinePolicy { label: "태초+" | "창세" | "창조"; inputGrade: string; outputGrade: string; successRate: number; commandCode: string; }
const POLICIES: Readonly<Record<string, CombinePolicy>> = {
  "태초+": { label: "태초+", inputGrade: "태초", outputGrade: "태초+", successRate: 0.5, commandCode: "mini_pet_combine_primordial_plus" },
  "창세": { label: "창세", inputGrade: "태초+", outputGrade: "창세", successRate: 0.3, commandCode: "mini_pet_combine_genesis" },
  "창조": { label: "창조", inputGrade: "창세", outputGrade: "창조", successRate: 1, commandCode: "mini_pet_combine_creation" }
};

export interface GradeCombineCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface ParsedGradeCombineCommand { policy: CombinePolicy; firstIndex?: number; secondIndex?: number; automatic: boolean; }
export interface GradeCombineResult {
  status: "succeeded" | "failed" | "blocked_by_castle_siege" | "ignored_missing_member";
  playerId?: string; consumedOwnedMiniPetIds?: string[]; ownedMiniPetId?: string;
  reward?: { name: string; emoji: string; grade: string; experience: string };
  outboxId?: string; auditId?: string; data?: string;
}
interface OwnerRow { identity_id: bigint; player_id: bigint; current_display_name: string; tier_code: string | null; }
interface PetRow {
  id: bigint; definition_id: bigint; display_name: string; custom_name: string | null;
  grade_name: string; emoji_value: string | null; battle_experience: bigint;
}

export function isGradeCombineCommand(message: string | undefined): boolean {
  return message?.startsWith("/미니펫조합태초+") === true || message?.startsWith("/미니펫조합창세") === true || message?.startsWith("/미니펫조합창조") === true;
}

// Rhino의 startsWith 범위와 parseInt 접미 허용을 의도적으로 보존합니다.
export function parseGradeCombineCommand(message: string): ParsedGradeCombineCommand {
  const type = message.startsWith("/미니펫조합태초+") ? "태초+" : message.startsWith("/미니펫조합창세") ? "창세" : message.startsWith("/미니펫조합창조") ? "창조" : undefined;
  if (type === undefined) throw new ApplicationError("INVALID_GRADE_COMBINE_COMMAND", "❌ 조합 설정을 찾을 수 없습니다.", 422);
  const policy = POLICIES[type]!;
  const args = message.trim().split(/\s+/);
  if (type === "창조" && args.length === 1) return { policy, automatic: true };
  if (args.length !== 3) throw new ApplicationError("GRADE_COMBINE_USAGE", `❌ 사용법:\n/미니펫조합${type} [번호] [번호]`, 422);
  const firstIndex = Number.parseInt(args[1]!, 10);
  const secondIndex = Number.parseInt(args[2]!, 10);
  if (Number.isNaN(firstIndex) || Number.isNaN(secondIndex)) throw new ApplicationError("GRADE_COMBINE_INDEX_NUMBER_REQUIRED", "❌ 미니펫가방 번호는 숫자로 입력해주세요.", 422);
  if (firstIndex === secondIndex) throw new ApplicationError("GRADE_COMBINE_DISTINCT_INDEX_REQUIRED", "❌ 동일한 번호의 미니펫은 조합할 수 없습니다.", 422);
  return { policy, firstIndex, secondIndex, automatic: false };
}

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | GradeCombineResult): GradeCombineResult { return typeof value === "string" ? JSON.parse(value) as GradeCombineResult : value; }
function ranked(owner: OwnerRow): string { return `${owner.tier_code === "seedling" || owner.tier_code === "starter" ? "🌱" : ""}${owner.current_display_name}`; }
function petName(pet: PetRow): string { return pet.custom_name || pet.display_name; }
function sortedBag(rows: PetRow[]): PetRow[] {
  return [...rows].sort((first, second) => {
    const experience = Number(second.battle_experience - first.battle_experience);
    if (experience !== 0) return experience;
    const grade = GRADE_ORDER.indexOf(second.grade_name as typeof GRADE_ORDER[number]) - GRADE_ORDER.indexOf(first.grade_name as typeof GRADE_ORDER[number]);
    return grade !== 0 ? grade : petName(first).localeCompare(petName(second), "ko");
  });
}
function rewardInfo(reward: GradeCombineReward, grade: string): string { return `${reward.name}${reward.emoji}(+${reward.experience}💕)[${grade}]`; }

async function findRewardDefinition(tx: DatabaseTransaction, reward: GradeCombineReward, grade: string): Promise<bigint> {
  const rows = await tx.query<Array<{ id: bigint }>>(
    `SELECT id FROM mini_pet_definitions
     WHERE display_name = ? AND emoji_value = ? AND COALESCE(grade_display_name, grade_code) = ? AND active = TRUE
     ORDER BY id LIMIT 1 FOR UPDATE`, [reward.name, reward.emoji, grade]
  );
  if (rows[0] === undefined) throw new ApplicationError("GRADE_COMBINE_REWARD_DEFINITION_REQUIRED", "❌ 조합 보상 데이터를 불러오지 못했습니다.", 409);
  return rows[0].id;
}

export class GradeCombineService {
  constructor(private readonly database: DatabaseClient, private readonly random: () => number = Math.random) {}

  async handle(command: GradeCombineCommand): Promise<GradeCombineResult> {
    const parsed = parseGradeCombineCommand(command.message);
    return this.database.withTransaction(async (tx) => {
      const siege = await tx.query<Array<{ active_count: bigint }>>(
        "SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))"
      );
      if ((siege[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };
      const owners = await tx.query<OwnerRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name, profile.tier_code
         FROM external_identities identity JOIN player_profiles profile ON profile.player_id = identity.player_id
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
           AND identity.player_id IS NOT NULL FOR UPDATE`, [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) return { status: "ignored_missing_member" };
      const scope = `mini-pet.grade-combine:${owner.identity_id}`;
      const key = eventKey(command.eventId);
      const prior = await tx.query<Array<{ result_json: string | GradeCombineResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, key]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return stored(prior[0].result_json);

      const bag = sortedBag(await tx.query<PetRow[]>(
        `SELECT owned.id, owned.mini_pet_definition_id AS definition_id, definition.display_name,
                owned.custom_name, COALESCE(definition.grade_display_name, definition.grade_code) AS grade_name,
                definition.emoji_value, owned.battle_experience
         FROM owned_mini_pets owned JOIN mini_pet_definitions definition ON definition.id = owned.mini_pet_definition_id
         WHERE owned.player_id = ? AND owned.equipped = FALSE FOR UPDATE`, [owner.player_id]
      ));
      const nickname = ranked(owner);
      if (bag.length < 2) throw new ApplicationError("GRADE_COMBINE_MATERIAL_SHORTAGE", `❌ [${nickname}] 님\n미니펫가방에 조합할 미니펫이 부족합니다.`, 409);

      let firstIndex = parsed.firstIndex;
      let secondIndex = parsed.secondIndex;
      if (parsed.automatic) {
        const indexes = bag.map((pet, index) => ({ pet, index: index + 1 })).filter(({ pet }) => pet.grade_name === parsed.policy.inputGrade).slice(0, 2).map(({ index }) => index);
        if (indexes.length < 2) throw new ApplicationError("GRADE_COMBINE_AUTO_MATERIAL_REQUIRED", `❌ [${nickname}] 님\n창조 조합에는 ${parsed.policy.inputGrade} 등급 미니펫 2마리가 필요합니다.`, 409);
        [firstIndex, secondIndex] = indexes;
      }
      const first = bag[(firstIndex ?? 0) - 1];
      const second = bag[(secondIndex ?? 0) - 1];
      if (first === undefined || second === undefined) throw new ApplicationError("GRADE_COMBINE_INDEX_NOT_FOUND", "❌ 존재하지 않는 미니펫가방 번호입니다.", 409);
      if (first.grade_name !== parsed.policy.inputGrade || second.grade_name !== parsed.policy.inputGrade) {
        throw new ApplicationError("GRADE_COMBINE_GRADE_MISMATCH", `❌ [${nickname}] 님\n${parsed.policy.label} 조합에는 ${parsed.policy.inputGrade} 등급 미니펫 2마리만 사용할 수 있습니다.`, 409);
      }

      const success = parsed.policy.successRate >= 1 || this.random() < parsed.policy.successRate;
      let reward: GradeCombineReward | undefined;
      if (success) {
        const pool = GRADE_COMBINE_REWARDS[parsed.policy.outputGrade] ?? [];
        reward = pool[Math.floor(this.random() * pool.length)];
        if (reward === undefined) throw new ApplicationError("GRADE_COMBINE_REWARD_REQUIRED", "❌ 조합 보상 데이터를 불러오지 못했습니다.", 409);
      }

      const operation = await tx.execute(
        "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, owner.identity_id]
      );
      const consumedIds = [first.id, second.id];
      const consumed = await tx.execute("DELETE FROM owned_mini_pets WHERE player_id = ? AND equipped = FALSE AND id IN (?, ?)", [owner.player_id, first.id, second.id]);
      if (consumed.affectedRows !== 2n) throw new ApplicationError("GRADE_COMBINE_CONFLICT", "미니펫 정보가 먼저 변경되었습니다.", 409);

      let ownedMiniPetId: bigint | undefined;
      if (success && reward !== undefined) {
        const rewardDefinitionId = await findRewardDefinition(tx, reward, parsed.policy.outputGrade);
        const inserted = await tx.execute(
          `INSERT INTO owned_mini_pets
           (player_id, mini_pet_definition_id, custom_name, progress, enhancement_level,
            battle_experience, castle_experience, raid_experience, equipped)
           VALUES (?, ?, ?, 0, 0, ?, ?, ?, FALSE)`,
          [owner.player_id, rewardDefinitionId, reward.name, reward.experience, reward.experience, reward.experience]
        );
        ownedMiniPetId = inserted.insertId;
      }

      const attempt = `[${nickname}]님이 ${parsed.policy.label} 조합에 도전합니다!\n재료: ${parsed.policy.inputGrade} 2마리\n성공 확률: ${Math.round(parsed.policy.successRate * 100)}%`;
      const data = success && reward !== undefined
        ? `${attempt}\n━━━━━━━━━━━━━━━\n${parsed.policy.label === "창조" ? "✅ 창조 조합 성공!" : "✅ 조합 성공!"}\n획득: ${rewardInfo(reward, parsed.policy.outputGrade)}`
        : `${attempt}\n━━━━━━━━━━━━━━━\n❌ 조합 실패...\n재료로 사용한 미니펫이 사라졌습니다.`;
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await tx.execute(
        "INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, ?, ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [command.eventId, parsed.policy.commandCode, operation.insertId]
      );
      const audit = await tx.execute(
        "INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'external_identity', ?, 'player', ?, 'mini_pet.grade_combine', ?, ?, ?, UTC_TIMESTAMP(3))",
        [operation.insertId, owner.identity_id, owner.player_id, success ? "success" : "failed", `Iris /미니펫조합${parsed.policy.label}`, JSON.stringify({ consumedOwnedMiniPetIds: consumedIds.map(String), outputGrade: parsed.policy.outputGrade, ownedMiniPetId: ownedMiniPetId?.toString() })]
      );
      const result: GradeCombineResult = {
        status: success ? "succeeded" : "failed", playerId: owner.player_id.toString(), consumedOwnedMiniPetIds: consumedIds.map(String),
        ownedMiniPetId: ownedMiniPetId?.toString(), reward: reward === undefined ? undefined : { name: reward.name, emoji: reward.emoji, grade: parsed.policy.outputGrade, experience: reward.experience.toString() },
        outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), data
      };
      await tx.execute("UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
