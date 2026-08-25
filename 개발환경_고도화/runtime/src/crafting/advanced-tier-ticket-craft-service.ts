import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const TIER_TICKET_CODE = "tier_promotion_ticket";
const LEGENDARY_STONE_CODE = "legendary_stone";
const PET_ENHANCE_STONE_CODE = "pet_enhance_stone";
const ADVANCED_TIER_TICKET_CODE = "advanced_tier_promotion_ticket";
const TIER_TICKET_RESERVE = 2_550n;
const TIER_TICKET_PER_CRAFT = 250n;
const LEGENDARY_STONE_PER_CRAFT = 2n;
const PET_ENHANCE_STONE_PER_CRAFT = 150n;
const MAX_CRAFT_COUNT = 1_000n;

export interface AdvancedTierTicketCraftCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface AdvancedTierTicketCraftResult {
  status: "crafted" | "blocked_by_castle_siege";
  playerId?: string;
  craftQuantity?: string;
  tierTicketQuantity?: string;
  legendaryStoneQuantity?: string;
  petEnhanceStoneQuantity?: string;
  advancedTicketQuantity?: string;
  outboxId?: string;
  auditId?: string;
  data?: string;
  duplicate?: boolean;
}

interface OwnerRow { identity_id: bigint; player_id: bigint; current_display_name: string; tier_code: string | null; }
interface DefinitionRow { item_id: bigint; code: string; }
interface StackRow { item_id: bigint; quantity: bigint; version: bigint; }

// 인자 없는 명령과 숫자 수량 하나만 허용합니다.
export function isAdvancedTierTicketCraftCommand(message: string | undefined): boolean {
  return message === "/고급티켓조합" || (message !== undefined && /^\/고급티켓조합\s+\d+$/.test(message));
}

// legacy 기본값과 0 보정을 보존하고 안전 상한을 적용합니다.
export function parseAdvancedTierTicketCraftQuantity(message: string): bigint {
  if (message === "/고급티켓조합") return 1n;
  const raw = message.trim().split(/\s+/)[1];
  if (raw === undefined) throw new ApplicationError("INVALID_ADVANCED_TIER_TICKET_CRAFT", "정확한 /고급티켓조합 [수량]을 입력해주세요.", 422);
  const parsed = BigInt(raw);
  const quantity = parsed === 0n ? 1n : parsed;
  if (quantity > MAX_CRAFT_COUNT) throw new ApplicationError("ADVANCED_TIER_TICKET_CRAFT_LIMIT", "한 번에 최대 1,000개까지 조합할 수 있습니다.", 422);
  return quantity;
}

// 긴 event ID를 operations key 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | AdvancedTierTicketCraftResult): AdvancedTierTicketCraftResult {
  return typeof value === "string" ? JSON.parse(value) as AdvancedTierTicketCraftResult : value;
}

// 신규 등급 표시 이름을 legacy 형식으로 복원합니다.
function ranked(owner: OwnerRow): string {
  return `${owner.tier_code === "seedling" || owner.tier_code === "starter" ? "🌱" : ""}${owner.current_display_name}`;
}

// lock 대기 중 snapshot이 낡아진 MariaDB 트랜잭션만 한 번 재시도합니다.
function isRetryableReadConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ER_CHECKREAD";
}

// 0 수량은 제거하고 그 외 수량은 version CAS로 갱신합니다.
async function writeExistingStack(transaction: DatabaseTransaction, playerId: bigint, stack: StackRow, after: bigint): Promise<void> {
  const write = after === 0n
    ? await transaction.execute("DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ? AND version = ?", [playerId, stack.item_id, stack.version])
    : await transaction.execute("UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?", [after, playerId, stack.item_id, stack.version]);
  if (write.affectedRows !== 1n) throw new ApplicationError("ADVANCED_TIER_TICKET_CRAFT_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
}

// 세 재료 차감과 고급 티켓 지급을 원장·감사·outbox와 함께 원자적으로 저장합니다.
export class AdvancedTierTicketCraftService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: AdvancedTierTicketCraftCommand): Promise<AdvancedTierTicketCraftResult> {
    if (!isAdvancedTierTicketCraftCommand(command.message)) throw new ApplicationError("INVALID_ADVANCED_TIER_TICKET_CRAFT", "정확한 /고급티켓조합 [수량]을 입력해주세요.", 422);
    const count = parseAdvancedTierTicketCraftQuantity(command.message);
    const tierCost = TIER_TICKET_PER_CRAFT * count;
    const legendaryCost = LEGENDARY_STONE_PER_CRAFT * count;
    const petStoneCost = PET_ENHANCE_STONE_PER_CRAFT * count;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.database.withTransaction(async (transaction) => {
      const siege = await transaction.query<Array<{ active_count: bigint }>>(
        "SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))"
      );
      if ((siege[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };
      const owners = await transaction.query<OwnerRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name, profile.tier_code
         FROM external_identities identity JOIN player_profiles profile ON profile.player_id = identity.player_id
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
           AND identity.player_id IS NOT NULL FOR UPDATE`, [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);
      const scope = `craft.advanced-tier-ticket:${owner.identity_id.toString()}`;
      const key = eventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | AdvancedTierTicketCraftResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, key]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return { ...stored(prior[0].result_json), duplicate: true };
      const codes = [TIER_TICKET_CODE, LEGENDARY_STONE_CODE, PET_ENHANCE_STONE_CODE, ADVANCED_TIER_TICKET_CODE];
      const definitions = await transaction.query<DefinitionRow[]>(
        `SELECT id AS item_id, code FROM item_definitions WHERE code IN (?, ?, ?, ?) AND active = TRUE AND stackable = TRUE ORDER BY code`, codes
      );
      const definitionByCode = new Map(definitions.map((row) => [row.code, row]));
      if (definitionByCode.size !== codes.length) throw new ApplicationError("ADVANCED_TIER_TICKET_CATALOG_REQUIRED", "고급 티켓 조합 아이템 설정을 찾을 수 없습니다.", 409);
      const itemIds = definitions.map((row) => row.item_id);
      const stacks = await transaction.query<StackRow[]>(
        `SELECT item_id, quantity, version FROM inventory_stacks WHERE player_id = ? AND item_id IN (?, ?, ?, ?) ORDER BY item_id FOR UPDATE`,
        [owner.player_id, ...itemIds]
      );
      const stackById = new Map(stacks.map((row) => [row.item_id.toString(), row]));
      const tierDefinition = definitionByCode.get(TIER_TICKET_CODE)!;
      const legendaryDefinition = definitionByCode.get(LEGENDARY_STONE_CODE)!;
      const petStoneDefinition = definitionByCode.get(PET_ENHANCE_STONE_CODE)!;
      const advancedDefinition = definitionByCode.get(ADVANCED_TIER_TICKET_CODE)!;
      const tierStack = stackById.get(tierDefinition.item_id.toString());
      const legendaryStack = stackById.get(legendaryDefinition.item_id.toString());
      const petStoneStack = stackById.get(petStoneDefinition.item_id.toString());
      const advancedStack = stackById.get(advancedDefinition.item_id.toString());
      const requiredTier = TIER_TICKET_RESERVE + tierCost;
      if (tierStack === undefined || tierStack.quantity < requiredTier) throw new ApplicationError("TIER_TICKET_RESERVE_REQUIRED", `티어 승급티켓🎟 ${requiredTier.toString()}개가 필요합니다. 조합 후 2,550개는 남겨야 합니다.`, 409);
      if (legendaryStack === undefined || legendaryStack.quantity < legendaryCost) throw new ApplicationError("LEGENDARY_STONE_REQUIRED", `전설의 돌맹이🗿 ${legendaryCost.toString()}개가 필요합니다.`, 409);
      if (petStoneStack === undefined || petStoneStack.quantity < petStoneCost) throw new ApplicationError("PET_ENHANCE_STONE_REQUIRED", `펫 강화석⭐ ${petStoneCost.toString()}개가 필요합니다.`, 409);
      const operation = await transaction.execute(
        "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, owner.identity_id]
      );
      const tierAfter = tierStack.quantity - tierCost;
      const legendaryAfter = legendaryStack.quantity - legendaryCost;
      const petStoneAfter = petStoneStack.quantity - petStoneCost;
      const advancedAfter = (advancedStack?.quantity ?? 0n) + count;
      await writeExistingStack(transaction, owner.player_id, tierStack, tierAfter);
      await writeExistingStack(transaction, owner.player_id, legendaryStack, legendaryAfter);
      await writeExistingStack(transaction, owner.player_id, petStoneStack, petStoneAfter);
      if (advancedStack === undefined) {
        await transaction.execute("INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, ?, 1)", [owner.player_id, advancedDefinition.item_id, advancedAfter]);
      } else {
        await writeExistingStack(transaction, owner.player_id, advancedStack, advancedAfter);
      }
      await transaction.execute(
        `INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES
         (?, 1, ?, ?, ?, 'advanced_tier_ticket_material'), (?, 2, ?, ?, ?, 'advanced_tier_legendary_stone_material'),
         (?, 3, ?, ?, ?, 'advanced_tier_pet_stone_material'), (?, 4, ?, ?, ?, 'advanced_tier_ticket_crafted')`,
        [operation.insertId, owner.player_id, tierDefinition.item_id, -tierCost,
          operation.insertId, owner.player_id, legendaryDefinition.item_id, -legendaryCost,
          operation.insertId, owner.player_id, petStoneDefinition.item_id, -petStoneCost,
          operation.insertId, owner.player_id, advancedDefinition.item_id, count]
      );
      const data = `[${ranked(owner)}] 님\n고급 티어 승급티켓🎫 ${count.toString()}개 조합이 완료되었습니다!`;
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        "INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, 'advanced_tier_ticket_craft', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [command.eventId, operation.insertId]
      );
      const audit = await transaction.execute(
        "INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'external_identity', ?, 'player', ?, 'craft.advanced_tier_ticket', 'success', 'Iris /고급티켓조합', ?, UTC_TIMESTAMP(3))",
        [operation.insertId, owner.identity_id, owner.player_id, JSON.stringify({ count: count.toString(), reserve: TIER_TICKET_RESERVE.toString(), tierAfter: tierAfter.toString(), legendaryAfter: legendaryAfter.toString(), petStoneAfter: petStoneAfter.toString(), advancedAfter: advancedAfter.toString() })]
      );
      const result: AdvancedTierTicketCraftResult = { status: "crafted", playerId: owner.player_id.toString(), craftQuantity: count.toString(), tierTicketQuantity: tierAfter.toString(), legendaryStoneQuantity: legendaryAfter.toString(), petEnhanceStoneQuantity: petStoneAfter.toString(), advancedTicketQuantity: advancedAfter.toString(), outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), data };
      await transaction.execute("UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [JSON.stringify(result), operation.insertId]);
          return result;
        });
      } catch (error) {
        if (attempt === 0 && isRetryableReadConflict(error)) continue;
        throw error;
      }
    }
    throw new ApplicationError("ADVANCED_TIER_TICKET_CRAFT_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
  }
}
