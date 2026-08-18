import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const TICKET_CODE = "bag_3241894752b82f7a";
const MINI_PET_CODE = "mini_pet_83a8d8d4c759c2a6";
const TICKET_NAME = "미니펫뽑기🐹(/미니펫오픈)";
const MINI_PET_NAME = "컬렉션창세 미니펫";
const TICKET_COST = 10000n;
const MINI_PET_BAG_CAPACITY = 8n;

export interface GenesisTicketCraftCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface GenesisTicketCraftResult {
  status: "crafted" | "blocked_by_castle_siege" | "ignored_missing_member";
  playerId?: string;
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

interface TicketRow {
  item_id: bigint;
  quantity: bigint | null;
  version: bigint | null;
}

// 인자나 접미사 없는 미니펫 창세 조합 명령만 허용합니다.
export function isGenesisTicketCraftCommand(message: string | undefined): boolean {
  return message === "/미니펫창세조합";
}

// event ID를 operations key 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | GenesisTicketCraftResult): GenesisTicketCraftResult {
  return typeof value === "string" ? JSON.parse(value) as GenesisTicketCraftResult : value;
}

// 기존 등급 표시의 씨앗 이모지와 회원명을 결합합니다.
function ranked(owner: OwnerRow): string {
  return `${owner.tier_code === "seedling" || owner.tier_code === "starter" ? "🌱" : ""}${owner.current_display_name}`;
}

// 미니펫 뽑기권을 소비하고 창세 미니펫을 원자적으로 지급합니다.
export class GenesisTicketCraftService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: GenesisTicketCraftCommand): Promise<GenesisTicketCraftResult> {
    if (!isGenesisTicketCraftCommand(command.message)) {
      throw new ApplicationError("INVALID_GENESIS_TICKET_CRAFT_COMMAND", "정확한 /미니펫창세조합을 입력해주세요.", 422);
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

      const scope = `mini-pet.genesis-ticket-craft:${owner.identity_id}`;
      const key = eventKey(command.eventId);
      const prior = await tx.query<Array<{ result_json: string | GenesisTicketCraftResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, key]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return stored(prior[0].result_json);

      const bagCounts = await tx.query<Array<{ bag_count: bigint }>>(
        "SELECT COUNT(*) AS bag_count FROM owned_mini_pets WHERE player_id = ? AND equipped = FALSE FOR UPDATE", [owner.player_id]
      );
      if ((bagCounts[0]?.bag_count ?? 0n) >= MINI_PET_BAG_CAPACITY) {
        throw new ApplicationError(
          "MINI_PET_BAG_FULL",
          `[${ranked(owner)}] 님의\n미니펫 가방이 가득 찼습니다.\n조합을 진행할 수 없습니다.\n[최대 8개 소지가능]`, 409
        );
      }

      const tickets = await tx.query<TicketRow[]>(
        `SELECT item.id AS item_id, stack.quantity, stack.version
         FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
         WHERE item.code = ? AND item.active = TRUE AND item.stackable = TRUE FOR UPDATE`,
        [owner.player_id, TICKET_CODE]
      );
      const ticket = tickets[0];
      const ticketQuantity = ticket?.quantity ?? 0n;
      if (ticket === undefined || ticket.version === null || ticketQuantity < TICKET_COST) {
        throw new ApplicationError(
          "MINI_PET_TICKET_REQUIRED",
          `❌ [${ranked(owner)}] 님\n${TICKET_NAME} ${TICKET_COST}개가 필요해.\n(보유: ${ticketQuantity}개)`, 409
        );
      }

      const definitions = await tx.query<Array<{ id: bigint }>>(
        "SELECT id FROM mini_pet_definitions WHERE code = ? AND active = TRUE FOR UPDATE", [MINI_PET_CODE]
      );
      const definition = definitions[0];
      if (definition === undefined) {
        throw new ApplicationError("COLLECTION_GENESIS_MINI_PET_DEFINITION_REQUIRED", `${MINI_PET_NAME} 설정을 찾을 수 없습니다.`, 409);
      }

      const operation = await tx.execute(
        "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, owner.identity_id]
      );
      const ticketAfter = ticketQuantity - TICKET_COST;
      const ticketWrite = await tx.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [ticketAfter, owner.player_id, ticket.item_id, ticket.version]
      );
      if (ticketWrite.affectedRows !== 1n) {
        throw new ApplicationError("GENESIS_TICKET_CRAFT_CONFLICT", "아이템 정보가 먼저 변경되었습니다.", 409);
      }

      const ownedMiniPet = await tx.execute(
        `INSERT INTO owned_mini_pets
          (player_id, mini_pet_definition_id, custom_name, progress, enhancement_level,
           battle_experience, castle_experience, raid_experience, equipped)
         VALUES (?, ?, ?, 0, 0, 1, 0, 0, FALSE)`,
        [owner.player_id, definition.id, MINI_PET_NAME]
      );
      await tx.execute(
        "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, ?, 'genesis_ticket_craft')",
        [operation.insertId, owner.player_id, ticket.item_id, -TICKET_COST]
      );

      const data = `🐹 /미니펫창세조합 완료!\n\n${TICKET_NAME} ${TICKET_COST}개 소모\n🎁 지급: [컬렉션창세 미니펫🐹] (창세 / 매력+1💕)\n\n👉 /미니펫가방 으로 확인해주세요.`;
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await tx.execute(
        "INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, 'genesis_ticket_craft', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [command.eventId, operation.insertId]
      );
      const audit = await tx.execute(
        "INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'external_identity', ?, 'player', ?, 'mini_pet.genesis_ticket_craft', 'success', 'Iris /미니펫창세조합', ?, UTC_TIMESTAMP(3))",
        [operation.insertId, owner.identity_id, owner.player_id, JSON.stringify({ ticketAfter: ticketAfter.toString(), ownedMiniPetId: ownedMiniPet.insertId.toString(), legacyTicketCost: TICKET_COST.toString() })]
      );
      const result: GenesisTicketCraftResult = {
        status: "crafted", playerId: owner.player_id.toString(), ticketQuantity: ticketAfter.toString(),
        ownedMiniPetId: ownedMiniPet.insertId.toString(), outboxId: outbox.insertId.toString(),
        auditId: audit.insertId.toString(), data
      };
      await tx.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}
