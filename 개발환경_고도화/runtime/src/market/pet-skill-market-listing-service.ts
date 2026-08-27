import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

const MAX_UINT64 = 18_446_744_073_709_551_615n;
const MAX_DECIMAL_30_3_INTEGER = 999_999_999_999_999_999_999_999_999n;
const CARROT_FEE_PER_SKILL = 50n;
const CONFIRM_MINUTES = 5;
const LISTING_DAYS = 30;
const REPRESENTATIVE_ALIAS = "/스킬거래등록 [가방번호] [수량] [판매금액]";

export interface PetSkillMarketListingCommand {
  sourceIndex: bigint;
  quantity: bigint;
  price: bigint;
}

export interface PetSkillMarketListingResult {
  status: "pending" | "registered" | "rejected" | "silent";
  data?: string;
  outboxId?: string;
  listingId?: string;
  skillId?: string;
  quantity?: string;
  price?: string;
  carrotFee?: string;
}

interface OwnerRow {
  identity_id: bigint;
  player_id: bigint;
  current_display_name: string;
  tier_code: string | null;
  rank_emoji: string | null;
}

interface SkillRow {
  player_pet_id: bigint;
  skill_id: bigint;
  display_name: string;
  quantity: bigint;
  version: bigint;
}

interface CarrotRow {
  item_id: bigint;
  quantity: bigint;
  version: bigint;
}

interface ConfirmationRow {
  command_text: string;
  player_pet_id: bigint;
  skill_id: bigint;
  source_index: bigint;
  quantity: bigint;
  source_version: bigint;
  price_amount: string;
  carrot_item_id: bigint;
  carrot_fee: bigint;
}

// 양의 uint64 가방 번호·수량과 DECIMAL(30,3)에 안전한 정수 가격만 해석합니다.
export function parsePetSkillMarketListingCommand(message: string | undefined): PetSkillMarketListingCommand | undefined {
  if (message === undefined) return undefined;
  const match = /^\/스킬거래등록\s+([1-9]\d*)\s+([1-9]\d*)\s+([1-9]\d*)$/.exec(message);
  if (match === null) return undefined;
  const sourceIndex = BigInt(match[1]!);
  const quantity = BigInt(match[2]!);
  const price = BigInt(match[3]!);
  if (sourceIndex > MAX_UINT64 || quantity > MAX_UINT64 || price > MAX_DECIMAL_30_3_INTEGER) return undefined;
  if (quantity > MAX_UINT64 / CARROT_FEE_PER_SKILL) return undefined;
  return { sourceIndex, quantity, price };
}

// 완전한 레거시 실행 형식만 partial dispatch 후보로 허용합니다.
export function isPetSkillMarketListingCandidate(message: string | undefined): boolean {
  return parsePetSkillMarketListingCommand(message) !== undefined;
}

// 유효한 인자형 명령만 DB 대표 alias로 정규화합니다.
export function normalizePetSkillMarketListingDispatchMessage(message: string): string {
  return isPetSkillMarketListingCandidate(message) ? REPRESENTATIVE_ALIAS : message;
}

// 긴 공급자 이벤트 ID를 operation 멱등 키 길이에 맞춥니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// bigint를 레거시 천 단위 구분 형식으로 표시합니다.
function commas(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 펫스킬 이름에 레거시 스킬북 아이콘을 한 번만 붙입니다.
function skillDisplayName(value: string): string {
  return value.endsWith("📙") ? value : `${value}📙`;
}

// 응답·execution·감사·outbox·operation을 현재 transaction에서 완료합니다.
async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint;
  eventId: string;
  destinationId: string;
  owner: OwnerRow;
  resultCode: string;
  actionCode: string;
  data: string;
  result: PetSkillMarketListingResult;
  summary: Record<string, unknown>;
}): Promise<PetSkillMarketListingResult> {
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: input.data })],
  );
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PET_SKILL_MARKET_LISTING',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, input.operationId, input.resultCode],
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,?,?,'Iris /스킬거래등록',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.owner.identity_id, input.owner.player_id, input.actionCode, input.resultCode, JSON.stringify(input.summary)],
  );
  const result = { ...input.result, data: input.data, outboxId: outbox.insertId.toString() };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 펫스킬 시장 등록 확인과 확정을 동일한 원자 transaction 경계에서 처리합니다.
export class PetSkillMarketListingService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PetSkillMarketListingResult> {
    const command = parsePetSkillMarketListingCommand(input.message);
    if (command === undefined) return { status: "silent" };
    return this.database.withTransaction(async (transaction) => {
      const owner = (await transaction.query<OwnerRow[]>(
        `SELECT identity.id identity_id,identity.player_id,profile.current_display_name,profile.tier_code,rank_profile.rank_emoji
         FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active'
         JOIN player_profiles profile ON profile.player_id=player.id
         LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE`,
        [input.externalUserId],
      ))[0];
      if (owner === undefined) return { status: "silent" };

      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PetSkillMarketListingResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='market.pet_skill.register' AND idempotency_key=? FOR UPDATE", [key],
      );
      if (prior[0]?.result_json != null) return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'market.pet_skill.register',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, owner.identity_id],
      );

      const eligible = await transaction.query<Array<{ allowed: bigint }>>(
        "SELECT COUNT(*) allowed FROM market_registration_tier_policies WHERE tier_code=? AND tier_code IN ('king','emperor','god') AND can_register=TRUE", [owner.tier_code],
      );
      if ((eligible[0]?.allowed ?? 0n) === 0n) return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, owner,
        resultCode: "tier_required", actionCode: "market.pet_skill.register.reject",
        data: `❌ [${owner.rank_emoji ?? ""}${owner.current_display_name}]님 거래등록은 티어 \"킹\" 이상만 가능합니다.`,
        result: { status: "rejected" }, summary: { mutation: false, tierCode: owner.tier_code },
      });

      const limit = await this.registrationLimit(transaction, owner.player_id);
      const active = await transaction.query<Array<{ count_value: bigint }>>(
        "SELECT COUNT(*) count_value FROM market_listings WHERE seller_player_id=? AND status='open' AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3)) FOR UPDATE", [owner.player_id],
      );
      if ((active[0]?.count_value ?? 0n) + 1n > limit) return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, owner,
        resultCode: "listing_limit", actionCode: "market.pet_skill.register.reject",
        data: `❌ 자유시장 등록 가능 건수를 초과했습니다.\n현재: ${active[0]?.count_value ?? 0n}/${limit}건\n요청: +1건`,
        result: { status: "rejected" }, summary: { mutation: false, active: (active[0]?.count_value ?? 0n).toString(), limit: limit.toString() },
      });

      const skill = await this.resolveSkill(transaction, owner.player_id, command.sourceIndex);
      if (skill === undefined) return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, owner,
        resultCode: "invalid_skill_index", actionCode: "market.pet_skill.register.reject",
        data: "❌ 유효하지 않은 스킬가방 번호입니다.", result: { status: "rejected" },
        summary: { mutation: false, sourceIndex: command.sourceIndex.toString() },
      });
      if (skill.quantity < command.quantity) return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, owner,
        resultCode: "insufficient_skill", actionCode: "market.pet_skill.register.reject",
        data: "❌ 스킬북 수량이 부족합니다.", result: { status: "rejected" },
        summary: { mutation: false, skillId: skill.skill_id.toString(), requested: command.quantity.toString(), owned: skill.quantity.toString() },
      });

      const carrotFee = command.quantity * CARROT_FEE_PER_SKILL;
      const carrot = (await transaction.query<CarrotRow[]>(
        `SELECT stack.item_id,stack.quantity,stack.version FROM inventory_stacks stack
         JOIN item_definitions item ON item.id=stack.item_id AND item.active=TRUE
         WHERE stack.player_id=? AND item.code='ITEM-RWD-044' ORDER BY item.id LIMIT 1 FOR UPDATE`, [owner.player_id],
      ))[0];
      if (carrot === undefined || carrot.quantity < carrotFee) return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, owner,
        resultCode: "insufficient_carrot", actionCode: "market.pet_skill.register.reject",
        data: `❌ 자유시장 등록 수수료 당근🥕이 부족합니다.\n필요: ${commas(carrotFee)}개`, result: { status: "rejected" },
        summary: { mutation: false, requiredCarrot: carrotFee.toString() },
      });

      const pending = (await transaction.query<ConfirmationRow[]>(
        `SELECT command_text,player_pet_id,skill_id,source_index,quantity,source_version,price_amount,carrot_item_id,carrot_fee
         FROM market_skill_registration_confirmations WHERE player_id=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE`, [owner.player_id],
      ))[0];
      const same = pending !== undefined
        && pending.command_text === input.message
        && pending.player_pet_id === skill.player_pet_id
        && pending.skill_id === skill.skill_id
        && pending.source_index === command.sourceIndex
        && pending.quantity === command.quantity
        && pending.source_version === skill.version
        && BigInt(pending.price_amount.split(".")[0]!) === command.price
        && pending.carrot_item_id === carrot.item_id
        && pending.carrot_fee === carrotFee;

      if (!same) {
        await transaction.execute(
          `INSERT INTO market_skill_registration_confirmations(player_id,command_text,player_pet_id,skill_id,source_index,quantity,source_version,price_amount,carrot_item_id,carrot_fee,expires_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? MINUTE),UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE command_text=VALUES(command_text),player_pet_id=VALUES(player_pet_id),skill_id=VALUES(skill_id),source_index=VALUES(source_index),quantity=VALUES(quantity),source_version=VALUES(source_version),price_amount=VALUES(price_amount),carrot_item_id=VALUES(carrot_item_id),carrot_fee=VALUES(carrot_fee),expires_at=VALUES(expires_at),updated_at=VALUES(updated_at)`,
          [owner.player_id, input.message, skill.player_pet_id, skill.skill_id, command.sourceIndex, command.quantity, skill.version, command.price.toString(), carrot.item_id, carrotFee, CONFIRM_MINUTES],
        );
        const data = `[${owner.rank_emoji ?? ""}${owner.current_display_name}] 님\n🏪 자유시장 등록 확인\n━━━━━━━━━━━━\n[${skillDisplayName(skill.display_name)}] ${commas(command.quantity)}개\n🅟${commas(command.price)}에 등록하시겠습니까?\n\n※ 등록 수수료 [당근🥕 ${commas(carrotFee)}개]가 차감됩니다.\n※ 5분 안에 같은 명령어를 다시 입력하면 등록됩니다.`;
        return complete(transaction, {
          operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, owner,
          resultCode: "confirmation_pending", actionCode: "market.pet_skill.register.confirm", data,
          result: { status: "pending", skillId: skill.skill_id.toString(), quantity: command.quantity.toString(), price: command.price.toString(), carrotFee: carrotFee.toString() },
          summary: { mutation: false, skillId: skill.skill_id.toString(), sourceIndex: command.sourceIndex.toString(), quantity: command.quantity.toString(), sourceVersion: skill.version.toString(), price: command.price.toString(), carrotFee: carrotFee.toString() },
        });
      }

      const skillAfter = skill.quantity - command.quantity;
      const skillChanged = await transaction.execute(
        "UPDATE pet_skill_inventory SET quantity=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_pet_id=? AND skill_id=? AND quantity>=? AND version=?",
        [skillAfter, skill.player_pet_id, skill.skill_id, command.quantity, skill.version],
      );
      if (skillChanged.affectedRows !== 1n) throw new Error("펫스킬가방이 먼저 변경되었습니다.");
      const carrotChanged = await transaction.execute(
        "UPDATE inventory_stacks SET quantity=quantity-?,version=version+1 WHERE player_id=? AND item_id=? AND quantity>=? AND version=?",
        [carrotFee, owner.player_id, carrot.item_id, carrotFee, carrot.version],
      );
      if (carrotChanged.affectedRows !== 1n) throw new Error("당근 보유량이 먼저 변경되었습니다.");

      const expiresAt = new Date(Date.now() + LISTING_DAYS * 86_400_000);
      const listing = await transaction.execute(
        "INSERT INTO market_listings(seller_player_id,asset_type_code,item_id,inventory_instance_id,quantity,price_currency_code,price_amount,expires_at) VALUES (?,'pet_skill',NULL,NULL,?,'point',?,?)",
        [owner.player_id, command.quantity, command.price.toString(), expiresAt],
      );
      await transaction.execute(
        "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'PET_SKILL_MARKET_LISTING_FEE')",
        [operation.insertId, owner.player_id, carrot.item_id, -carrotFee],
      );
      await transaction.execute(
        "INSERT INTO market_events(listing_id,operation_id,event_code,detail_json) VALUES (?,?,'created',?)",
        [listing.insertId, operation.insertId, JSON.stringify({ assetType: "pet_skill", skillId: skill.skill_id.toString(), sourceIndex: command.sourceIndex.toString(), quantity: command.quantity.toString(), price: command.price.toString(), carrotFee: carrotFee.toString() })],
      );
      await transaction.execute(
        `INSERT INTO market_skill_registration_ledger(operation_id,listing_id,player_id,player_pet_id,skill_id,source_index,quantity,price_amount,carrot_item_id,carrot_fee,skill_quantity_before,skill_quantity_after,source_version_before,source_version_after,carrot_version_before,carrot_version_after)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [operation.insertId, listing.insertId, owner.player_id, skill.player_pet_id, skill.skill_id, command.sourceIndex, command.quantity, command.price.toString(), carrot.item_id, carrotFee, skill.quantity, skillAfter, skill.version, skill.version + 1n, carrot.version, carrot.version + 1n],
      );
      await transaction.execute("DELETE FROM market_skill_registration_confirmations WHERE player_id=?", [owner.player_id]);

      const data = `[${owner.rank_emoji ?? ""}${owner.current_display_name}] 님\n🏪 자유시장 등록 완료\n━━━━━━━━━━━━\n[${skillDisplayName(skill.display_name)}] ${commas(command.quantity)}개가\n🅟${commas(command.price)}에 등록되었습니다.\n\n※ 등록 수수료 [당근🥕 ${commas(carrotFee)}개]가 차감되었습니다.\n※ 거래수수료는 판매자에게 10% 부담됩니다.`;
      return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, owner,
        resultCode: "registered", actionCode: "market.pet_skill.register", data,
        result: { status: "registered", listingId: listing.insertId.toString(), skillId: skill.skill_id.toString(), quantity: command.quantity.toString(), price: command.price.toString(), carrotFee: carrotFee.toString() },
        summary: { listingId: listing.insertId.toString(), skillId: skill.skill_id.toString(), sourceIndex: command.sourceIndex.toString(), quantity: command.quantity.toString(), sourceVersionBefore: skill.version.toString(), sourceVersionAfter: (skill.version + 1n).toString(), price: command.price.toString(), carrotFee: carrotFee.toString() },
      });
    });
  }

  // 표시명·stable skill ID 순서로 가방 순번을 고정하고 해당 row를 잠급니다.
  private async resolveSkill(transaction: DatabaseTransaction, playerId: bigint, sourceIndex: bigint): Promise<SkillRow | undefined> {
    const rows = await transaction.query<SkillRow[]>(
      `SELECT inventory.player_pet_id,inventory.skill_id,definition.display_name,inventory.quantity,inventory.version
       FROM player_pets pet JOIN pet_skill_inventory inventory ON inventory.player_pet_id=pet.id
       JOIN skill_definitions definition ON definition.id=inventory.skill_id AND definition.active=TRUE
       WHERE pet.player_id=? AND inventory.quantity>0
       ORDER BY definition.display_name,definition.id,inventory.player_pet_id FOR UPDATE`, [playerId],
    );
    return sourceIndex > BigInt(rows.length) ? undefined : rows[Number(sourceIndex - 1n)];
  }

  // 기본 1건에 자유시장회원권 7건과 타고난 장사꾼 스킬 2건을 합산합니다.
  private async registrationLimit(transaction: DatabaseTransaction, playerId: bigint): Promise<bigint> {
    const benefits = await transaction.query<Array<{ ticket: bigint; merchant: bigint }>>(
      `SELECT
       EXISTS(SELECT 1 FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND stack.quantity>0 AND item.display_name='자유시장회원권🏪') ticket,
       EXISTS(SELECT 1 FROM player_pets pet JOIN pet_skills owned ON owned.player_pet_id=pet.id JOIN skill_definitions skill ON skill.id=owned.skill_id WHERE pet.player_id=? AND skill.display_name='타고난 장사꾼') merchant`,
      [playerId, playerId],
    );
    return 1n + ((benefits[0]?.ticket ?? 0n) > 0n ? 7n : 0n) + ((benefits[0]?.merchant ?? 0n) > 0n ? 2n : 0n);
  }
}
