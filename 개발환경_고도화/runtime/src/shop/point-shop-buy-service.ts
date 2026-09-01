import { createHash, randomUUID } from "node:crypto";

import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { generateStarterPet, LEGACY_PET_PERSONALITIES } from "../pet/pet-creation-policy.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/구매";
const MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615n;
const KST_PERIOD_SQL = "DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d')";
const PET_ELEMENT_CODES = ["legacy-sky", "legacy-land", "legacy-sea"] as const;

export type PointShopBuyCommand = { kind: "USAGE" } | { kind: "BUY"; listNumber: number; quantity: bigint };
export type PointShopBuyStatus = "usage" | "purchased" | "insufficient_point" | "unavailable" | "quantity_limit" | "daily_limit" | "pet_required" | "confirmation_required" | "ignored_unregistered";
export interface PointShopBuyInput { eventId: string; externalUserId: string; destinationId: string; message: string; }
export interface PointShopBuyResult {
  status: PointShopBuyStatus;
  data?: string;
  playerId?: string;
  productId?: string;
  quantity?: string;
  pointSpent?: string;
  taxAmount?: string;
  pointBalanceAfter?: string;
  effect?: Record<string, unknown>;
  outboxId?: string;
  auditId?: string;
  replayed?: boolean;
}

interface OwnerRow { identity_id: bigint; player_id: bigint; display_name: string | null; }
interface ProductRow {
  product_id: string; display_name: string; price: string; reward_item_id: bigint | null; effect_type: "STACK_ITEM" | "PET_PERSONALITY_RANDOM" | "PET_APPEARANCE_RANDOM" | "PET_ELEMENT_RANDOM";
  effect_config_json: string | Record<string, unknown>; max_quantity: bigint | null; daily_limit: bigint | null; catalog_version: bigint;
}
interface PetRow { id: bigint; display_name: string | null; pet_type_code: string | null; image_value: string | null; version: bigint; }

// `/구매` 또는 양의 정수 상품 번호·선택 수량만 허용합니다.
export function parsePointShopBuyCommand(message: string): PointShopBuyCommand | undefined {
  if (message === COMMAND) return { kind: "USAGE" };
  const match = /^\/구매\s+([1-9]\d*)(?:\s+([1-9]\d*))?$/.exec(message);
  if (!match) return undefined;
  const listNumber = Number(match[1]);
  if (!Number.isSafeInteger(listNumber)) return undefined;
  return { kind: "BUY", listNumber, quantity: BigInt(match[2] ?? "1") };
}

// 공용 dispatch가 인자형 구매를 stable alias로 찾도록 정규화합니다.
export function normalizePointShopBuyDispatchMessage(message: string): string { return parsePointShopBuyCommand(message) ? COMMAND : message; }

// 접미 문구·0·음수·소수를 제외한 구매 후보만 반환합니다.
export function isPointShopBuyCommandCandidate(message: string | undefined): boolean { return message !== undefined && parsePointShopBuyCommand(message) !== undefined; }

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function executionEventId(value: string): string { return value.startsWith("iris:") ? value : `iris:${value}`; }
function whole(value: string): bigint { const match = /^(\d+)(?:\.0+)?$/.exec(value); if (!match) throw new ApplicationError("POINT_SHOP_NON_INTEGER", "포인트 상점 금액을 정수로 확인할 수 없습니다.", 409); return BigInt(match[1]!); }
function stored(value: string | PointShopBuyResult): PointShopBuyResult { return typeof value === "string" ? JSON.parse(value) as PointShopBuyResult : value; }
function isDuplicate(error: unknown): boolean { return typeof error === "object" && error !== null && (("errno" in error && error.errno === 1062) || ("code" in error && error.code === "ER_DUP_ENTRY")); }
function config(value: ProductRow["effect_config_json"]): Record<string, unknown> { return typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value; }

// 포인트 차감·세금·아이템/펫 효과·원장·감사·outbox를 한 트랜잭션으로 처리합니다.
export class PointShopBuyService {
  public constructor(private readonly database: DatabaseClient, private readonly random: () => number = Math.random) {}

  public async handle(input: PointShopBuyInput): Promise<PointShopBuyResult> {
    const command = parsePointShopBuyCommand(input.message);
    if (!command) throw new ApplicationError("INVALID_POINT_SHOP_BUY", "정확한 /구매 [번호] [수량]을 입력해주세요.", 422);
    const scopeKey = eventKey(executionEventId(input.eventId));
    let replayScope: string | undefined;
    try {
      return await this.database.withTransaction(async (tx) => {
        const owner = await this.owner(tx, input.externalUserId);
        if (!owner) return { status: "ignored_unregistered" };
        replayScope = `point.shop.buy:${owner.identity_id}`;
        const prior = await tx.query<Array<{ result_json: string | PointShopBuyResult | null }>>(
          "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [replayScope, scopeKey]);
        if (prior[0]?.result_json !== null && prior[0]?.result_json !== undefined) return { ...stored(prior[0].result_json), replayed: true };
        if (command.kind === "USAGE") return this.finishSimple(tx, input, owner, replayScope, scopeKey, "usage", "사용법: /구매 [번호] [수량]");
        const product = (await tx.query<ProductRow[]>(
          `SELECT product_id,display_name,CAST(price AS CHAR) price,reward_item_id,effect_type,effect_config_json,max_quantity,daily_limit,catalog_version
             FROM point_shop_catalog WHERE enabled=TRUE AND deleted_at IS NULL ORDER BY display_order,product_id LIMIT 1 OFFSET ? FOR UPDATE`, [command.listNumber - 1]))[0];
        if (!product) return this.finishSimple(tx, input, owner, replayScope, scopeKey, "unavailable", "유효하지 않은 상품 번호입니다. 다시 확인해주세요.", command.quantity);
        if (product.max_quantity !== null && command.quantity > product.max_quantity) {
          return this.finishSimple(tx, input, owner, replayScope, scopeKey, "quantity_limit", `${product.display_name}는 한 번에 ${product.max_quantity}개까지만 구매할 수 있습니다.`, command.quantity, product);
        }
        const pet = product.effect_type.startsWith("PET_") ? await this.pet(tx, owner.player_id) : undefined;
        if (product.effect_type.startsWith("PET_") && (!pet || !pet.display_name)) {
          return this.finishSimple(tx, input, owner, replayScope, scopeKey, "pet_required", "펫을 먼저 생성해 주세요", command.quantity, product);
        }
        if (product.effect_type === "PET_APPEARANCE_RANDOM" && pet && !PET_ELEMENT_CODES.includes(pet.pet_type_code as typeof PET_ELEMENT_CODES[number])) {
          const confirmed = (await tx.query<Array<{ confirmed: number }>>(
            "SELECT 1 confirmed FROM point_shop_purchase_confirmations WHERE player_id=? AND product_id=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE", [owner.player_id, product.product_id]))[0];
          if (!confirmed) {
            await tx.execute(`INSERT INTO point_shop_purchase_confirmations(player_id,product_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE))
              ON DUPLICATE KEY UPDATE expires_at=VALUES(expires_at),created_at=UTC_TIMESTAMP(3)`, [owner.player_id, product.product_id]);
            return this.finishSimple(tx, input, owner, replayScope, scopeKey, "confirmation_required", "리미티드 펫입니다. 변경하시겠습니까?\n다시 실행하면 변경이 완료됩니다.", command.quantity, product);
          }
          await tx.execute("DELETE FROM point_shop_purchase_confirmations WHERE player_id=? AND product_id=?", [owner.player_id, product.product_id]);
        }
        const daily = product.daily_limit === null ? undefined : await this.dailyAllowance(tx, owner, product, command.quantity);
        if (daily !== undefined && daily < command.quantity) {
          return this.finishSimple(tx, input, owner, replayScope, scopeKey, "daily_limit", `❌ ${product.display_name}은 하루 ${product.daily_limit}개까지만 구매 가능합니다.\n남은 구매 가능 수량: ${daily}개`, command.quantity, product);
        }
        const unitPrice = whole(product.price);
        if (unitPrice * command.quantity > MAX_UNSIGNED_BIGINT) throw new ApplicationError("POINT_SHOP_TOTAL_OVERFLOW", "구매 금액이 처리 가능한 범위를 초과합니다.", 422);
        const shoppingDiscount = await this.hasSkill(tx, pet?.id, "쇼핑광");
        const taxReduction = await this.hasSkill(tx, pet?.id, "탈세자");
        const basePrice = unitPrice * command.quantity;
        const discountedPrice = shoppingDiscount ? basePrice * 80n / 100n : basePrice;
        const castle = (await tx.query<Array<{ tax_rate_basis_points: number; lord_guild_name: string | null }>>(
          "SELECT tax_rate_basis_points,lord_guild_name FROM castle_state WHERE state_code='HOI_CASTLE' FOR UPDATE"))[0];
        const baseTaxBps = BigInt(castle?.tax_rate_basis_points ?? 0);
        const taxBps = taxReduction ? baseTaxBps * 30n / 100n : baseTaxBps;
        const taxAmount = (discountedPrice * taxBps + 5_000n) / 10_000n;
        const totalCost = discountedPrice + taxAmount;
        await tx.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,1)", [owner.player_id]);
        const account = (await tx.query<Array<{ balance: string; version: bigint }>>(
          "SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE", [owner.player_id]))[0]!;
        const balanceBefore = whole(account.balance);
        if (balanceBefore < totalCost) return this.finishSimple(tx, input, owner, replayScope, scopeKey, "insufficient_point", `❌ 포인트가 부족합니다.\n필요: 🅟${totalCost}`, command.quantity, product, balanceBefore);
        const operation = await this.begin(tx, owner, replayScope, scopeKey);
        const effect = await this.applyEffect(tx, operation, owner, product, command.quantity, pet);
        const balanceAfter = balanceBefore - totalCost;
        const updated = await tx.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?", [balanceAfter.toString(), owner.player_id, account.version]);
        if (updated.affectedRows !== 1n) throw new ApplicationError("POINT_SHOP_CONFLICT", "포인트 정보가 먼저 변경되었습니다.", 409);
        await tx.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?,'POINT_SHOP_PURCHASE')", [operation, owner.player_id, (-totalCost).toString(), balanceAfter.toString()]);
        if (taxAmount > 0n && castle?.lord_guild_name) await this.applyGuildTax(tx, operation, castle.lord_guild_name, taxAmount);
        if (product.daily_limit !== null) await tx.execute(`INSERT INTO player_counters(player_id,counter_code,period_key,value) VALUES (?,'point_shop_carrot_buy',${KST_PERIOD_SQL},?) ON DUPLICATE KEY UPDATE value=value+VALUES(value),updated_at=UTC_TIMESTAMP(3)`, [owner.player_id, command.quantity.toString()]);
        const skillNotes = [shoppingDiscount ? "쇼핑광 20% 할인" : "", taxReduction && baseTaxBps > 0n ? "탈세자 세금 70% 면제" : ""].filter(Boolean);
        const data = `✅ 포인트 상점 구매 완료\n상품: ${product.display_name} x${command.quantity}\n사용 포인트: 🅟${totalCost}\n남은 포인트: 🅟${balanceAfter}${skillNotes.length ? `\n${skillNotes.join(" · ")}` : ""}${typeof effect.message === "string" ? `\n${effect.message}` : ""}`;
        return this.finish(tx, input, owner, operation, product, command.quantity, totalCost, taxAmount, balanceAfter, effect, data);
      });
    } catch (error) {
      if (!isDuplicate(error) || replayScope === undefined) throw error;
      const prior = await this.database.query<Array<{ result_json: string | PointShopBuyResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [replayScope, scopeKey]);
      if (prior[0]?.result_json === null || prior[0]?.result_json === undefined) throw error;
      return { ...stored(prior[0].result_json), replayed: true };
    }
  }

  private async owner(tx: DatabaseTransaction, externalUserId: string): Promise<OwnerRow | undefined> {
    return (await tx.query<OwnerRow[]>(`SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name FROM external_identities identity
      JOIN players player ON player.id=identity.player_id AND player.status='active' LEFT JOIN player_profiles profile ON profile.player_id=player.id
      WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND identity.player_id IS NOT NULL FOR UPDATE`, [externalUserId]))[0];
  }

  private async pet(tx: DatabaseTransaction, playerId: bigint): Promise<PetRow | undefined> { return (await tx.query<PetRow[]>("SELECT id,display_name,pet_type_code,image_value,version FROM player_pets WHERE player_id=? FOR UPDATE", [playerId]))[0]; }

  private async hasSkill(tx: DatabaseTransaction, petId: bigint | undefined, displayName: string): Promise<boolean> {
    if (petId === undefined) return false;
    return (await tx.query<Array<{ found: number }>>(`SELECT 1 found FROM pet_skills equipped JOIN skill_definitions definition ON definition.id=equipped.skill_id AND definition.active=TRUE
      WHERE equipped.player_pet_id=? AND equipped.equipped=TRUE AND definition.display_name=? LIMIT 1`, [petId, displayName])).length === 1;
  }

  private async dailyAllowance(tx: DatabaseTransaction, owner: OwnerRow, product: ProductRow, quantity: bigint): Promise<bigint> {
    if (product.daily_limit === null || owner.display_name === "호이 남") return quantity;
    const current = (await tx.query<Array<{ value: bigint }>>(`SELECT value FROM player_counters WHERE player_id=? AND counter_code='point_shop_carrot_buy' AND period_key=${KST_PERIOD_SQL} FOR UPDATE`, [owner.player_id]))[0]?.value ?? 0n;
    return product.daily_limit > current ? product.daily_limit - current : 0n;
  }

  private async begin(tx: DatabaseTransaction, owner: OwnerRow, scope: string, key: string): Promise<bigint> {
    return (await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), scope, key, owner.identity_id])).insertId;
  }

  private async applyEffect(tx: DatabaseTransaction, operationId: bigint, owner: OwnerRow, product: ProductRow, quantity: bigint, pet: PetRow | undefined): Promise<Record<string, unknown>> {
    const settings = config(product.effect_config_json);
    if (product.effect_type === "STACK_ITEM") {
      if (product.reward_item_id === null) throw new ApplicationError("POINT_SHOP_ITEM_MAPPING_REQUIRED", "상품 아이템 연결을 확인하고 있습니다.", 409);
      let reward = quantity;
      if (settings.bonusSkill === "티어 상승론" && await this.hasSkill(tx, pet?.id, "티어 상승론")) reward += quantity / 100n;
      if (reward > MAX_UNSIGNED_BIGINT) throw new ApplicationError("POINT_SHOP_REWARD_OVERFLOW", "지급 수량이 처리 가능한 범위를 초과합니다.", 422);
      await tx.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),version=version+1", [owner.player_id, product.reward_item_id, reward.toString()]);
      await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'POINT_SHOP_PURCHASE')", [operationId, owner.player_id, product.reward_item_id, reward.toString()]);
      return { type: product.effect_type, itemId: product.reward_item_id.toString(), quantity: reward.toString(), bonusQuantity: (reward - quantity).toString() };
    }
    if (!pet) throw new ApplicationError("POINT_SHOP_PET_REQUIRED", "펫을 먼저 생성해 주세요", 409);
    if (product.effect_type === "PET_PERSONALITY_RANDOM") {
      const personality = LEGACY_PET_PERSONALITIES[Math.floor(this.random() * LEGACY_PET_PERSONALITIES.length)]!;
      await tx.execute("UPDATE player_pets SET personality_label=?,version=version+1 WHERE id=? AND version=?", [personality, pet.id, pet.version]);
      return { type: product.effect_type, personality, message: `${pet.display_name}의 성격이 ${personality}(으)로 변경되었습니다.` };
    }
    if (product.effect_type === "PET_APPEARANCE_RANDOM") {
      const generated = generateStarterPet(this.random);
      await tx.execute("UPDATE player_pets SET pet_type_code=?,image_value=?,version=version+1 WHERE id=? AND version=?", [generated.typeCode, generated.imageValue, pet.id, pet.version]);
      return { type: product.effect_type, petTypeCode: generated.typeCode, imageValue: generated.imageValue, message: `${pet.display_name}의 외형이 ${generated.imageValue}(으)로 변경되었습니다.` };
    }
    const petTypeCode = PET_ELEMENT_CODES[Math.floor(this.random() * PET_ELEMENT_CODES.length)]!;
    await tx.execute("UPDATE player_pets SET pet_type_code=?,version=version+1 WHERE id=? AND version=?", [petTypeCode, pet.id, pet.version]);
    return { type: product.effect_type, petTypeCode, message: `${pet.display_name}의 속성이 ${petTypeCode}(으)로 변경되었습니다.\n하늘 -> 땅 -> 바다 -> 하늘` };
  }

  private async applyGuildTax(tx: DatabaseTransaction, operationId: bigint, guildName: string, amount: bigint): Promise<void> {
    const guild = (await tx.query<Array<{ id: bigint }>>("SELECT id FROM guilds WHERE display_name=? AND status='active' LIMIT 1 FOR UPDATE", [guildName]))[0];
    if (!guild) return;
    await tx.execute("INSERT INTO guild_resource_accounts(guild_id,currency_code,balance,version) VALUES (?,'point',?,1) ON DUPLICATE KEY UPDATE balance=balance+VALUES(balance),version=version+1", [guild.id, amount.toString()]);
    const account = (await tx.query<Array<{ balance: string }>>("SELECT CAST(balance AS CHAR) balance FROM guild_resource_accounts WHERE guild_id=? AND currency_code='point'", [guild.id]))[0]!;
    await tx.execute("INSERT INTO guild_resource_ledger(operation_id,sequence_no,guild_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?,'POINT_SHOP_TAX')", [operationId, guild.id, amount.toString(), account.balance]);
  }

  private async finish(tx: DatabaseTransaction, input: PointShopBuyInput, owner: OwnerRow, operationId: bigint, product: ProductRow, quantity: bigint, spent: bigint, tax: bigint, balance: bigint, effect: Record<string, unknown>, data: string): Promise<PointShopBuyResult> {
    await tx.execute("INSERT INTO point_shop_purchase_events(operation_id,player_id,product_id,quantity,point_spent,tax_amount,point_balance_after,result_code,effect_result_json) VALUES (?,?,?,?,?,?,?,'purchased',?)", [operationId, owner.player_id, product.product_id, quantity.toString(), spent.toString(), tax.toString(), balance.toString(), JSON.stringify(effect)]);
    const audit = await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'point.shop.buy','purchased','Iris /구매',?,UTC_TIMESTAMP(3))", [operationId, owner.identity_id, owner.player_id, JSON.stringify({ productId: product.product_id, quantity: quantity.toString(), pointSpent: spent.toString(), taxAmount: tax.toString(), pointBalanceAfter: balance.toString(), effect })]);
    await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'POINT_SHOP_BUY',?,'completed','purchased',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE operation_id=VALUES(operation_id),execution_status='completed',result_code='purchased',completed_at=UTC_TIMESTAMP(3)", [executionEventId(input.eventId), operationId]);
    const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId, input.destinationId, JSON.stringify({ data })]);
    const result: PointShopBuyResult = { status: "purchased", data, playerId: owner.player_id.toString(), productId: product.product_id, quantity: quantity.toString(), pointSpent: spent.toString(), taxAmount: tax.toString(), pointBalanceAfter: balance.toString(), effect, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
    await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
    return result;
  }

  private async finishSimple(tx: DatabaseTransaction, input: PointShopBuyInput, owner: OwnerRow, scope: string, key: string, status: Exclude<PointShopBuyStatus,"purchased"|"ignored_unregistered">, data: string, quantity = 0n, product?: ProductRow, balance = 0n): Promise<PointShopBuyResult> {
    const operationId = await this.begin(tx, owner, scope, key);
    await tx.execute("INSERT INTO point_shop_purchase_events(operation_id,player_id,product_id,quantity,point_spent,tax_amount,point_balance_after,result_code,effect_result_json) VALUES (?,?,?,?,0,0,?,?,NULL)", [operationId, owner.player_id, product?.product_id ?? null, quantity.toString(), balance.toString(), status]);
    const audit = await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'point.shop.buy',?,'Iris /구매',?,UTC_TIMESTAMP(3))", [operationId, owner.identity_id, owner.player_id, status, JSON.stringify({ mutation: false, productId: product?.product_id ?? null, quantity: quantity.toString() })]);
    await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'POINT_SHOP_BUY',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE operation_id=VALUES(operation_id),execution_status='completed',result_code=VALUES(result_code),completed_at=UTC_TIMESTAMP(3)", [executionEventId(input.eventId), operationId, status]);
    const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId, input.destinationId, JSON.stringify({ data })]);
    const result: PointShopBuyResult = { status, data, playerId: owner.player_id.toString(), ...(product ? { productId: product.product_id } : {}), quantity: quantity.toString(), pointBalanceAfter: balance.toString(), outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
    await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
    return result;
  }
}

