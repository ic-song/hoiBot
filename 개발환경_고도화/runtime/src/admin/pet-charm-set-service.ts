import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

const MAX_UNSIGNED_BIGINT = 18446744073709551615n;
const USAGE = "/매력 [유저명] [숫자]로 입력해주세요.";

export interface PetCharmSetCommand {
  targetName: string;
  experience: bigint;
}

interface PetDefinitionRow {
  code: string;
  display_name: string;
  metadata_json: string | { normalEmojis?: string[]; uniqueEmojis?: string[] };
}

interface Appearance {
  petTypeCode: string;
  imageValue: string;
  messages: string[];
  unique: boolean;
}

export interface PetCharmSetResult {
  status: "changed" | "rejected" | "usage";
  data: string;
  targetPlayerId: string | null;
  previousExperience: string | null;
  experience: string | null;
  petTypeCode: string | null;
  imageValue: string | null;
  outboxId: string;
  auditId: string;
}

export function isPetCharmSetCommandCandidate(message: string): boolean {
  return message === "/매력" || message.startsWith("/매력 ");
}

export function parsePetCharmSetCommand(message: string): PetCharmSetCommand | null {
  const match = message.match(/^\/매력\s+(.+?)\s+(\d+)$/);
  if (match === null || match[1]!.trim() === "") return null;
  const experience = BigInt(match[2]!);
  if (experience > MAX_UNSIGNED_BIGINT) return null;
  return { targetName: match[1]!.trim(), experience };
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored<T>(value: string | T): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

function metadata(row: PetDefinitionRow): { normalEmojis: string[]; uniqueEmojis: string[] } {
  const value = typeof row.metadata_json === "string"
    ? JSON.parse(row.metadata_json) as { normalEmojis?: string[]; uniqueEmojis?: string[] }
    : row.metadata_json;
  return { normalEmojis: value.normalEmojis ?? [], uniqueEmojis: value.uniqueEmojis ?? [] };
}

function pick<T>(values: T[], random: () => number): T | undefined {
  if (values.length === 0) return undefined;
  return values[Math.min(values.length - 1, Math.floor(random() * values.length))];
}

// 레거시 updateEmoji의 RNG 순서와 메시지를 보존해 코드화된 펫 외형을 선택합니다.
export function resolvePetCharmAppearance(
  currentTypeCode: string | null,
  definitions: PetDefinitionRow[],
  random: () => number
): Appearance | null {
  const current = definitions.find(row => row.code === currentTypeCode);
  const egg = current === undefined || current.display_name === "알";
  const unique = random() < 0.1;
  const candidates = definitions.filter(row => row.display_name !== "알");
  const selected = egg ? pick(candidates, random) : current;
  if (selected === undefined) return null;
  const pools = metadata(selected);
  const selectedPool = unique && pools.uniqueEmojis.length > 0 ? pools.uniqueEmojis : pools.normalEmojis;
  const image = pick(selectedPool, random);
  if (image === undefined) return null;
  const messages = egg
    ? ["펫이 탄생했습니다!"]
    : ["수술 완료되었습니다.. 마음에 드셨으면 좋겠네요."];
  if (unique) messages.push(egg ? "축하합니다!!\n🎉유니크 펫이 탄생했습니다🎉" : "대성공!!! 🎉 이런 기적이...!");
  return { petTypeCode: selected.code, imageValue: image, messages, unique };
}

// 총괄 운영자의 펫 매력 절대값 변경과 진화 외형을 한 transaction으로 저장합니다.
export class PetCharmSetService {
  constructor(private readonly database: DatabaseClient, private readonly random: () => number = Math.random) {}

  async set(input: {
    message: string;
    idempotencyKey: string;
    sourceEventId: string;
    destinationId: string;
    operatorId: string;
  }): Promise<PetCharmSetResult> {
    return this.database.withTransaction(async transaction => {
      const scope = `admin.pet_charm.set:${input.operatorId}`, key = eventKey(input.idempotencyKey);
      const prior = await transaction.query<Array<{ result_json: string | PetCharmSetResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope,key]);
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return stored(prior[0].result_json);

      const command = parsePetCharmSetCommand(input.message);
      const targets = command === null ? [] : await transaction.query<Array<{
        player_id: bigint; pet_id: bigint | null; experience: bigint | null; pet_type_code: string | null;
        image_value: string | null; version: bigint | null;
      }>>(
        `SELECT profile.player_id,pet.id pet_id,pet.experience,pet.pet_type_code,pet.image_value,pet.version
         FROM player_profiles profile
         JOIN players player ON player.id=profile.player_id AND player.status='active'
         LEFT JOIN player_pets pet ON pet.player_id=player.id
         WHERE profile.current_display_name=? ORDER BY profile.player_id LIMIT 2 FOR UPDATE`, [command?.targetName]);
      const target = targets.length === 1 ? targets[0] : undefined;
      let status: PetCharmSetResult["status"] = command === null ? "usage" : "rejected";
      let data = command === null ? USAGE : "펫이 없습니다..";
      let appearance: Appearance | null = null;
      if (command !== null && target?.pet_id !== null && target?.pet_id !== undefined && target.version !== null) {
        status = "changed";
        data = "수정완료!";
        if (command.experience === 10n) {
          const definitions = await transaction.query<PetDefinitionRow[]>(
            "SELECT code,display_name,metadata_json FROM pet_definitions WHERE active=TRUE AND code IN ('legacy-egg','legacy-sky','legacy-land','legacy-sea') ORDER BY FIELD(code,'legacy-sky','legacy-land','legacy-sea','legacy-egg')");
          appearance = resolvePetCharmAppearance(target.pet_type_code, definitions, this.random);
          if (appearance !== null) data += `\n${appearance.messages.join("\n")}`;
        }
      }

      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(),scope,key,input.operatorId]);
      if (status === "changed" && command !== null && target?.pet_id !== null && target?.pet_id !== undefined && target.version !== null) {
        const update = await transaction.execute(
          `UPDATE player_pets SET experience=?,pet_type_code=?,image_value=?,version=version+1,
             enhancement_updated_at=enhancement_updated_at WHERE id=? AND version=?`,
          [command.experience,appearance?.petTypeCode ?? target.pet_type_code,appearance?.imageValue ?? target.image_value,target.pet_id,target.version]);
        if (update.affectedRows !== 1n) throw new Error("Pet charm version conflict.");
      }
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'admin_pet_charm_set',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.sourceEventId,operation.insertId,status]);
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId,input.destinationId,JSON.stringify({data})]);
      const summary = {
        targetName:command?.targetName ?? null,
        previousExperience:target?.experience?.toString() ?? null,
        experience:command?.experience.toString() ?? null,
        previousPetTypeCode:target?.pet_type_code ?? null,
        petTypeCode:appearance?.petTypeCode ?? target?.pet_type_code ?? null,
        imageChanged:appearance !== null,
        unique:appearance?.unique ?? false
      };
      const audit = await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player',?,'pet.charm.set',?,'Iris /매력',?,UTC_TIMESTAMP(3))",
        [operation.insertId,input.operatorId,target?.player_id ?? null,status,JSON.stringify(summary)]);
      const result: PetCharmSetResult = {
        status,data,targetPlayerId:target?.player_id.toString() ?? null,
        previousExperience:target?.experience?.toString() ?? null,experience:command?.experience.toString() ?? null,
        petTypeCode:appearance?.petTypeCode ?? target?.pet_type_code ?? null,
        imageValue:appearance?.imageValue ?? target?.image_value ?? null,
        outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString()
      };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result),operation.insertId]);
      return result;
    });
  }
}
