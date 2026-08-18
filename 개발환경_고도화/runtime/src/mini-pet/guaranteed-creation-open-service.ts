import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const PACKAGE_CODE = "bag_a0f887c7ace600cd";
const MINI_PET_CODE = "mini_pet_4c88c9497b1022a1";
const PACKAGE_NAME = "[🐹미니펫]창조패키지 확정(/창조오픈)";
const MINI_PET_NAME = "호이빛";
const MINI_PET_BAG_CAPACITY = 8n;
const REWARD_EXPERIENCE = 1350000n;

export interface GuaranteedCreationOpenCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface GuaranteedCreationOpenResult {
  status: "opened" | "ignored_missing_member";
  playerId?: string;
  packageQuantity?: string;
  ownedMiniPetId?: string;
  outboxId?: string;
  auditId?: string;
  data?: string;
}

interface OwnerRow {
  identity_id: bigint;
  player_id: bigint;
}

interface PackageRow {
  item_id: bigint;
  quantity: bigint | null;
  version: bigint | null;
}

// 인자나 접미사 없는 창조 확정 패키지 명령만 허용합니다.
export function isGuaranteedCreationOpenCommand(message: string | undefined): boolean {
  return message === "/창조오픈";
}

// event ID를 operations key 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | GuaranteedCreationOpenResult): GuaranteedCreationOpenResult {
  return typeof value === "string" ? JSON.parse(value) as GuaranteedCreationOpenResult : value;
}

// 창조 확정 패키지를 소비하고 호이빛 미니펫을 원자적으로 지급합니다.
export class GuaranteedCreationOpenService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: GuaranteedCreationOpenCommand): Promise<GuaranteedCreationOpenResult> {
    if (!isGuaranteedCreationOpenCommand(command.message)) {
      throw new ApplicationError("INVALID_GUARANTEED_CREATION_OPEN_COMMAND", "정확한 /창조오픈을 입력해주세요.", 422);
    }

    return this.database.withTransaction(async (tx) => {
      const owners = await tx.query<OwnerRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id
         FROM external_identities identity
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
           AND identity.player_id IS NOT NULL FOR UPDATE`,
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) return { status: "ignored_missing_member" };

      const scope = `mini-pet.guaranteed-creation-open:${owner.identity_id}`;
      const key = eventKey(command.eventId);
      const prior = await tx.query<Array<{ result_json: string | GuaranteedCreationOpenResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, key]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return stored(prior[0].result_json);

      const packages = await tx.query<PackageRow[]>(
        `SELECT item.id AS item_id, stack.quantity, stack.version
         FROM item_definitions item
         LEFT JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
         WHERE item.code = ? AND item.active = TRUE AND item.stackable = TRUE FOR UPDATE`,
        [owner.player_id, PACKAGE_CODE]
      );
      const packageItem = packages[0];
      const packageQuantity = packageItem?.quantity ?? 0n;
      if (packageItem === undefined || packageItem.version === null || packageQuantity < 1n) {
        throw new ApplicationError(
          "GUARANTEED_CREATION_PACKAGE_REQUIRED",
          "해당 확정 패키지를 보유하고 있지 않습니다.",
          409
        );
      }

      const bagCounts = await tx.query<Array<{ bag_count: bigint }>>(
        "SELECT COUNT(*) AS bag_count FROM owned_mini_pets WHERE player_id = ? AND equipped = FALSE FOR UPDATE",
        [owner.player_id]
      );
      if ((bagCounts[0]?.bag_count ?? 0n) >= MINI_PET_BAG_CAPACITY) {
        throw new ApplicationError(
          "MINI_PET_BAG_FULL",
          "보관함 공간이 부족합니다.\n공간을 확보한 후 다시 시도해 주세요.",
          409
        );
      }

      const definitions = await tx.query<Array<{ id: bigint }>>(
        "SELECT id FROM mini_pet_definitions WHERE code = ? AND active = TRUE FOR UPDATE",
        [MINI_PET_CODE]
      );
      const definition = definitions[0];
      if (definition === undefined) {
        throw new ApplicationError(
          "GUARANTEED_CREATION_MINI_PET_DEFINITION_REQUIRED",
          `${MINI_PET_NAME} 설정을 찾을 수 없습니다.`,
          409
        );
      }

      const operation = await tx.execute(
        "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, owner.identity_id]
      );
      const packageAfter = packageQuantity - 1n;
      const packageWrite = await tx.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [packageAfter, owner.player_id, packageItem.item_id, packageItem.version]
      );
      if (packageWrite.affectedRows !== 1n) {
        throw new ApplicationError("GUARANTEED_CREATION_OPEN_CONFLICT", "아이템 정보가 먼저 변경되었습니다.", 409);
      }

      const ownedMiniPet = await tx.execute(
        `INSERT INTO owned_mini_pets
          (player_id, mini_pet_definition_id, custom_name, progress, enhancement_level,
           battle_experience, castle_experience, raid_experience, equipped)
         VALUES (?, ?, ?, 0, 0, ?, ?, ?, FALSE)`,
        [owner.player_id, definition.id, MINI_PET_NAME, REWARD_EXPERIENCE, REWARD_EXPERIENCE, REWARD_EXPERIENCE]
      );
      await tx.execute(
        "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, -1, 'guaranteed_creation_package_open')",
        [operation.insertId, owner.player_id, packageItem.item_id]
      );

      const data = "🐹 창조패키지 확정 오픈!\n\n호이빛💖(+1350000💕)[창조]을(를) 획득했습니다.";
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await tx.execute(
        "INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, 'guaranteed_creation_open', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [command.eventId, operation.insertId]
      );
      const audit = await tx.execute(
        "INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'external_identity', ?, 'player', ?, 'mini_pet.guaranteed_creation_open', 'success', 'Iris /창조오픈', ?, UTC_TIMESTAMP(3))",
        [operation.insertId, owner.identity_id, owner.player_id, JSON.stringify({
          packageName: PACKAGE_NAME,
          packageAfter: packageAfter.toString(),
          ownedMiniPetId: ownedMiniPet.insertId.toString(),
          battleExperience: REWARD_EXPERIENCE.toString(),
          castleExperience: REWARD_EXPERIENCE.toString(),
          raidExperience: REWARD_EXPERIENCE.toString()
        })]
      );
      const result: GuaranteedCreationOpenResult = {
        status: "opened",
        playerId: owner.player_id.toString(),
        packageQuantity: packageAfter.toString(),
        ownedMiniPetId: ownedMiniPet.insertId.toString(),
        outboxId: outbox.insertId.toString(),
        auditId: audit.insertId.toString(),
        data
      };
      await tx.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}
