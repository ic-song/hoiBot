import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const PACKAGE_CODE = "bag_11319869697c3c00";
const TICKET_CODE = "bag_3241894752b82f7a";
const MINI_PET_CODE = "mini_pet_f879f4cf45f6a74d";
const PACKAGE_NAME = "컬렉션창조패키지🐹(/컬렉션창조오픈)";
const TICKET_NAME = "미니펫뽑기🐹(/미니펫오픈)";
const MINI_PET_NAME = "컬렉션창조 미니펫";
const TICKET_REWARD = 2000n;
const MINI_PET_BAG_CAPACITY = 8n;

export interface CollectionCreationOpenCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface CollectionCreationOpenResult {
  status: "opened" | "blocked_by_castle_siege" | "ignored_missing_member";
  playerId?: string;
  packageQuantity?: string;
  ticketQuantity?: string;
  ownedMiniPetId?: string;
  outboxId?: string;
  auditId?: string;
  data?: string;
}

interface OwnerRow {
  identity_id: bigint;
  player_id: bigint;
  current_display_name: string;
  tier_code: string | null;
}

interface ItemRow {
  item_id: bigint;
  code: string;
  quantity: bigint | null;
  version: bigint | null;
}

// 인자나 접미사 없는 컬렉션 창조 패키지 명령만 허용합니다.
export function isCollectionCreationOpenCommand(message: string | undefined): boolean {
  return message === "/컬렉션창조오픈";
}

// event ID를 operations key 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | CollectionCreationOpenResult): CollectionCreationOpenResult {
  return typeof value === "string" ? JSON.parse(value) as CollectionCreationOpenResult : value;
}

// 기존 등급 표시의 씨앗 이모지와 회원명을 결합합니다.
function ranked(owner: OwnerRow): string {
  return `${owner.tier_code === "seedling" || owner.tier_code === "starter" ? "🌱" : ""}${owner.current_display_name}`;
}

// 컬렉션 창조 패키지를 소비하고 미니펫과 뽑기권을 원자적으로 지급합니다.
export class CollectionCreationOpenService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: CollectionCreationOpenCommand): Promise<CollectionCreationOpenResult> {
    if (!isCollectionCreationOpenCommand(command.message)) {
      throw new ApplicationError("INVALID_COLLECTION_CREATION_OPEN_COMMAND", "정확한 /컬렉션창조오픈을 입력해주세요.", 422);
    }

    return this.database.withTransaction(async (tx) => {
      const siege = await tx.query<Array<{ active_count: bigint }>>(
        "SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))"
      );
      if ((siege[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };

      const owners = await tx.query<OwnerRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name, profile.tier_code
         FROM external_identities identity JOIN player_profiles profile ON profile.player_id = identity.player_id
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
           AND identity.player_id IS NOT NULL FOR UPDATE`,
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) return { status: "ignored_missing_member" };

      const scope = `mini-pet.collection-creation-open:${owner.identity_id}`;
      const key = eventKey(command.eventId);
      const prior = await tx.query<Array<{ result_json: string | CollectionCreationOpenResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, key]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return stored(prior[0].result_json);

      const bagCounts = await tx.query<Array<{ bag_count: bigint }>>(
        "SELECT COUNT(*) AS bag_count FROM owned_mini_pets WHERE player_id = ? AND equipped = FALSE FOR UPDATE",
        [owner.player_id]
      );
      if ((bagCounts[0]?.bag_count ?? 0n) >= MINI_PET_BAG_CAPACITY) {
        throw new ApplicationError(
          "MINI_PET_BAG_FULL",
          `[${ranked(owner)}] 님의\n미니펫 가방이 가득 찼습니다.\n오픈을 진행할 수 없습니다.\n[최대 8개 소지가능]`,
          409
        );
      }

      const items = await tx.query<ItemRow[]>(
        `SELECT item.id AS item_id, item.code, stack.quantity, stack.version
         FROM item_definitions item
         LEFT JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
         WHERE item.code IN (?, ?) AND item.active = TRUE AND item.stackable = TRUE
         ORDER BY item.code FOR UPDATE`,
        [owner.player_id, PACKAGE_CODE, TICKET_CODE]
      );
      const packageItem = items.find((row) => row.code === PACKAGE_CODE);
      const ticketItem = items.find((row) => row.code === TICKET_CODE);
      const packageQuantity = packageItem?.quantity ?? 0n;
      if (packageItem === undefined || packageItem.version === null || packageQuantity < 1n) {
        throw new ApplicationError(
          "COLLECTION_CREATION_PACKAGE_REQUIRED",
          `❌ [${ranked(owner)}] 님\n${PACKAGE_NAME} 아이템이 없습니다.\n(보유: ${packageQuantity}개)`,
          409
        );
      }
      if (ticketItem === undefined) {
        throw new ApplicationError("MINI_PET_TICKET_DEFINITION_REQUIRED", `${TICKET_NAME} 설정을 찾을 수 없습니다.`, 409);
      }

      const miniPetDefinitions = await tx.query<Array<{ id: bigint }>>(
        "SELECT id FROM mini_pet_definitions WHERE code = ? AND active = TRUE FOR UPDATE",
        [MINI_PET_CODE]
      );
      const miniPetDefinition = miniPetDefinitions[0];
      if (miniPetDefinition === undefined) {
        throw new ApplicationError("COLLECTION_CREATION_MINI_PET_DEFINITION_REQUIRED", `${MINI_PET_NAME} 설정을 찾을 수 없습니다.`, 409);
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
        throw new ApplicationError("COLLECTION_CREATION_OPEN_CONFLICT", "아이템 정보가 먼저 변경되었습니다.", 409);
      }

      const ticketBefore = ticketItem.quantity ?? 0n;
      const ticketAfter = ticketBefore + TICKET_REWARD;
      if (ticketItem.version === null) {
        const ticketWrite = await tx.execute(
          "INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, ?, 1)",
          [owner.player_id, ticketItem.item_id, ticketAfter]
        );
        if (ticketWrite.affectedRows !== 1n) {
          throw new ApplicationError("COLLECTION_CREATION_OPEN_CONFLICT", "아이템 정보가 먼저 변경되었습니다.", 409);
        }
      } else {
        const ticketWrite = await tx.execute(
          "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
          [ticketAfter, owner.player_id, ticketItem.item_id, ticketItem.version]
        );
        if (ticketWrite.affectedRows !== 1n) {
          throw new ApplicationError("COLLECTION_CREATION_OPEN_CONFLICT", "아이템 정보가 먼저 변경되었습니다.", 409);
        }
      }

      const ownedMiniPet = await tx.execute(
        `INSERT INTO owned_mini_pets
          (player_id, mini_pet_definition_id, custom_name, progress, enhancement_level,
           battle_experience, castle_experience, raid_experience, equipped)
         VALUES (?, ?, ?, 0, 0, 1, 0, 0, FALSE)`,
        [owner.player_id, miniPetDefinition.id, MINI_PET_NAME]
      );
      await tx.execute(
        "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, -1, 'collection_creation_package_open'), (?, 2, ?, ?, ?, 'collection_creation_ticket_reward')",
        [operation.insertId, owner.player_id, packageItem.item_id, operation.insertId, owner.player_id, ticketItem.item_id, TICKET_REWARD]
      );

      const data = `🐹 컬렉션창조패키지 오픈 완료!\n\n🎁 지급: [컬렉션창조 미니펫🐹] (창조 / 매력+1💕)\n🎟️ 추가지급: 미니펫뽑기🐹(/미니펫오픈) 2000개\n\n👉 /미니펫가방 으로 확인해주세요.`;
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await tx.execute(
        "INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, 'collection_creation_open', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [command.eventId, operation.insertId]
      );
      const audit = await tx.execute(
        "INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'external_identity', ?, 'player', ?, 'mini_pet.collection_creation_open', 'success', 'Iris /컬렉션창조오픈', ?, UTC_TIMESTAMP(3))",
        [operation.insertId, owner.identity_id, owner.player_id, JSON.stringify({ packageAfter: packageAfter.toString(), ticketAfter: ticketAfter.toString(), ownedMiniPetId: ownedMiniPet.insertId.toString() })]
      );
      const result: CollectionCreationOpenResult = {
        status: "opened",
        playerId: owner.player_id.toString(),
        packageQuantity: packageAfter.toString(),
        ticketQuantity: ticketAfter.toString(),
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
