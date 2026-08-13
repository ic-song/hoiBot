import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const SHOP_TICKET_CODE = "legacy-pet-home-interior-shop-ticket";
const BOUTIQUE_BOX_CODE = "legacy-furniture-boutique-box";
const SHOP_TICKETS_PER_BOX = 5000n;

export interface FurnitureBoutiqueBoxCraftCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface FurnitureBoutiqueBoxCraftResult {
  status: "crafted" | "blocked_by_castle_siege";
  playerId?: string;
  craftQuantity?: string;
  shopTicketQuantity?: string;
  boutiqueBoxQuantity?: string;
  outboxId?: string;
  data?: string;
  auditId?: string;
}

interface OwnerRow {
  identity_id: bigint;
  player_id: bigint;
  current_display_name: string;
  tier_code: string | null;
}

// 인자 없는 명령과 숫자 수량 하나만 허용합니다.
export function isFurnitureBoutiqueBoxCraftCommand(message: string | undefined): boolean {
  return message === "/부띠끄조합" || (message !== undefined && /^\/부띠끄조합\s+\d+$/.test(message));
}

// legacy 기본 수량 1과 숫자 0 허용 동작을 보존합니다.
function craftQuantity(message: string): bigint {
  if (message === "/부띠끄조합") return 1n;
  const raw = message.trim().split(/\s+/)[1];
  if (raw === undefined) throw new ApplicationError("INVALID_BOUTIQUE_BOX_CRAFT_COMMAND", "정확한 /부띠끄조합 [수량]을 입력해주세요.", 422);
  const value = BigInt(raw);
  if (value > 1000000n) throw new ApplicationError("BOUTIQUE_BOX_CRAFT_LIMIT", "한 번에 조합할 수 있는 수량을 초과했습니다.", 422);
  return value;
}

// event ID를 operations key 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | FurnitureBoutiqueBoxCraftResult): FurnitureBoutiqueBoxCraftResult {
  return typeof value === "string" ? JSON.parse(value) as FurnitureBoutiqueBoxCraftResult : value;
}

// 신규 등급의 씨앗 이모지와 일반 표시 이름을 만듭니다.
function ranked(owner: OwnerRow): string {
  return `${owner.tier_code === "seedling" || owner.tier_code === "starter" ? "🌱" : ""}${owner.current_display_name}`;
}

// 인테리어샵 이용권 차감과 가구 부띠끄상자 지급을 한 트랜잭션과 원장에 저장합니다.
export class FurnitureBoutiqueBoxCraftService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: FurnitureBoutiqueBoxCraftCommand): Promise<FurnitureBoutiqueBoxCraftResult> {
    if (!isFurnitureBoutiqueBoxCraftCommand(command.message)) {
      throw new ApplicationError("INVALID_BOUTIQUE_BOX_CRAFT_COMMAND", "정확한 /부띠끄조합 [수량]을 입력해주세요.", 422);
    }
    const count = craftQuantity(command.message);
    const requiredShopTickets = SHOP_TICKETS_PER_BOX * count;

    return this.database.withTransaction(async (tx) => {
      const siege = await tx.query<Array<{ active_count: bigint }>>(
        "SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))"
      );
      if ((siege[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };

      const owners = await tx.query<OwnerRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name, profile.tier_code
         FROM external_identities identity JOIN player_profiles profile ON profile.player_id = identity.player_id
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked' AND identity.player_id IS NOT NULL FOR UPDATE`,
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);

      const scope = `craft.furniture-boutique-box:${owner.identity_id}`;
      const key = eventKey(command.eventId);
      const prior = await tx.query<Array<{ result_json: string | FurnitureBoutiqueBoxCraftResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, key]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return stored(prior[0].result_json);

      const stacks = await tx.query<Array<{ item_id: bigint; code: string; quantity: bigint; version: bigint }>>(
        `SELECT stack.item_id, item.code, stack.quantity, stack.version FROM item_definitions item
         JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
         WHERE item.code IN (?, ?) AND item.active = TRUE AND item.stackable = TRUE ORDER BY item.code FOR UPDATE`,
        [owner.player_id, SHOP_TICKET_CODE, BOUTIQUE_BOX_CODE]
      );
      const shopTickets = stacks.find((row) => row.code === SHOP_TICKET_CODE);
      const boutiqueBox = stacks.find((row) => row.code === BOUTIQUE_BOX_CODE);
      if (shopTickets === undefined || shopTickets.quantity === 0n || shopTickets.quantity < requiredShopTickets) {
        throw new ApplicationError("PET_HOME_SHOP_TICKET_REQUIRED", `펫스윗홈인테리어샵🖼️(/샵오픈) ${requiredShopTickets}개가 필요해요!`, 409);
      }
      if (boutiqueBox === undefined) throw new ApplicationError("BOUTIQUE_BOX_ITEM_REQUIRED", "가구 부띠끄상자 설정을 찾을 수 없습니다.", 409);

      const operation = await tx.execute(
        "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, owner.identity_id]
      );
      const shopTicketAfter = shopTickets.quantity - requiredShopTickets;
      const boutiqueBoxAfter = boutiqueBox.quantity + count;
      const shopWrite = await tx.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [shopTicketAfter, owner.player_id, shopTickets.item_id, shopTickets.version]
      );
      const boxWrite = await tx.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [boutiqueBoxAfter, owner.player_id, boutiqueBox.item_id, boutiqueBox.version]
      );
      if (shopWrite.affectedRows !== 1n || boxWrite.affectedRows !== 1n) {
        throw new ApplicationError("BOUTIQUE_BOX_CRAFT_CONFLICT", "아이템 정보가 먼저 변경되었습니다.", 409);
      }

      await tx.execute(
        "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, ?, 'boutique_box_craft_material'), (?, 2, ?, ?, ?, 'boutique_box_crafted')",
        [operation.insertId, owner.player_id, shopTickets.item_id, (-requiredShopTickets).toString(), operation.insertId, owner.player_id, boutiqueBox.item_id, count.toString()]
      );
      const data = `${count}개를 조합합니다\n[${ranked(owner)}] 님\n가구 부띠끄상자🧳(/부띠끄오픈) ${count}개 생성 완료! 🧳✨`;
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await tx.execute(
        "INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, 'furniture_boutique_box_craft', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [command.eventId, operation.insertId]
      );
      const audit = await tx.execute(
        "INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'external_identity', ?, 'player', ?, 'craft.furniture_boutique_box', 'success', 'Iris /부띠끄조합', ?, UTC_TIMESTAMP(3))",
        [operation.insertId, owner.identity_id, owner.player_id, JSON.stringify({ count: count.toString(), shopTicketAfter: shopTicketAfter.toString(), boutiqueBoxAfter: boutiqueBoxAfter.toString() })]
      );
      const result: FurnitureBoutiqueBoxCraftResult = {
        status: "crafted",
        playerId: owner.player_id.toString(),
        craftQuantity: count.toString(),
        shopTicketQuantity: shopTicketAfter.toString(),
        boutiqueBoxQuantity: boutiqueBoxAfter.toString(),
        outboxId: outbox.insertId.toString(),
        data,
        auditId: audit.insertId.toString()
      };
      await tx.execute("UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
