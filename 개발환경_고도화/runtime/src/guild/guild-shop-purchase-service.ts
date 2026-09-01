import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE = "GUILD_SHOP_PURCHASE";

export interface GuildShopPurchaseCommand { productNumber: number; quantity: bigint; }
export interface GuildShopPurchaseResult {
  status: "purchased";
  replayed: boolean;
  productId: string;
  quantity: string;
  totalPrice: string;
  balanceAfter: string;
  data: string;
  outboxId: string;
}

interface ActorRow { identity_id: bigint; player_id: bigint; guild_id: bigint | null; }
interface ProductRow { id: bigint; product_id: string; item_id: bigint | null; display_name: string; price: bigint; daily_limit: number | null; }

// 길드상점 구매 명령은 번호와 선택 수량만 허용합니다.
export function isGuildShopPurchaseCommandCandidate(message: string | undefined): boolean {
  return message === "/길드상점구매" || (message !== undefined && /^\/길드상점구매\s+\d+(?:\s+\d+)?$/.test(message));
}

// 레거시 번호·수량 입력을 엄격한 구매 모델로 변환합니다.
export function parseGuildShopPurchaseCommand(message: string | undefined): GuildShopPurchaseCommand | null {
  if (message === undefined) return null;
  const match = /^\/길드상점구매\s+([1-9]\d*)(?:\s+([1-9]\d*))?$/.exec(message);
  if (match === null) return null;
  const productNumber = Number(match[1]);
  if (!Number.isSafeInteger(productNumber)) return null;
  return { productNumber, quantity: BigInt(match[2] ?? "1") };
}

// 레거시 Math.round와 같은 양의 정수 반올림으로 세금을 계산합니다.
export function calculateGuildShopTax(basePrice: bigint, taxRateBasisPoints: number): bigint {
  return (basePrice * BigInt(taxRateBasisPoints) + 5_000n) / 10_000n;
}

function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | GuildShopPurchaseResult): GuildShopPurchaseResult { return typeof value === "string" ? JSON.parse(value) as GuildShopPurchaseResult : value; }
function integerDecimal(value: string): bigint {
  const [integer, fraction = ""] = value.split(".");
  if (!/^\d+$/.test(integer ?? "") || !/^0*$/.test(fraction)) throw new ApplicationError("GUILD_SHOP_NON_INTEGER_BALANCE", "길드상점 포인트 잔액이 정수 단위가 아닙니다.", 409);
  return BigInt(integer!);
}

// 기존 카탈로그·재화·재고·길드자금·행복재단 원장을 한 트랜잭션으로 소비합니다.
export class GuildShopPurchaseService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<GuildShopPurchaseResult | null> {
    if (!isGuildShopPurchaseCommandCandidate(input.message)) return null;
    const command = parseGuildShopPurchaseCommand(input.message);
    if (command === null) throw new ApplicationError("INVALID_GUILD_SHOP_PURCHASE", "사용법\n/길드상점구매 번호 갯수", 422);
    const rollout = (await this.database.query<Array<{ rollout_state: string; enabled: number }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]))[0];
    if (rollout === undefined || rollout.enabled !== 1 || rollout.rollout_state !== "ACTIVE") return null;
    return this.database.withTransaction(async transaction => {
      const key = eventKey(input.eventId);
      const prior = (await transaction.query<Array<{ result_json: string | GuildShopPurchaseResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='guild.shop.purchase' AND idempotency_key=? FOR UPDATE", [key]))[0];
      if (prior?.result_json != null) return { ...stored(prior.result_json), replayed: true };
      const actor = (await transaction.query<ActorRow[]>("SELECT identity.id identity_id,identity.player_id,membership.guild_id FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL LEFT JOIN guild_members membership ON membership.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE", [input.externalUserId]))[0];
      if (actor === undefined) return null;
      if (actor.guild_id === null) throw new ApplicationError("GUILD_REQUIRED", "길드에 가입한 회원만 길드상점을 이용할 수 있습니다.", 409);
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'guild.shop.purchase',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), key, actor.identity_id]);
      const products = await transaction.query<ProductRow[]>("SELECT id,product_id,item_id,display_name,price,daily_limit FROM guild_shop_items WHERE enabled=TRUE ORDER BY display_order,id FOR UPDATE");
      const product = products[command.productNumber - 1];
      if (product === undefined) throw new ApplicationError("GUILD_SHOP_ITEM_NOT_FOUND", "❌ 존재하지 않는 상품입니다.", 404);
      if (product.item_id === null) throw new ApplicationError("GUILD_SHOP_ITEM_MAPPING_REQUIRED", "❌ 상품의 아이템 연결이 준비되지 않았습니다.", 409);
      const definition = (await transaction.query<Array<{ stackable: number }>>("SELECT stackable FROM item_definitions WHERE id=? AND active=TRUE FOR UPDATE", [product.item_id]))[0];
      if (definition === undefined || definition.stackable !== 1) throw new ApplicationError("GUILD_SHOP_STACK_ITEM_REQUIRED", "❌ 현재 구매할 수 없는 상품입니다.", 409);
      if (product.daily_limit !== null) await this.reserveDailyLimit(transaction, actor.player_id, product.product_id, command.quantity, BigInt(product.daily_limit));
      const castle = (await transaction.query<Array<{ tax_rate_basis_points: number; lord_guild_name: string | null; version: bigint }>>("SELECT tax_rate_basis_points,lord_guild_name,version FROM castle_state WHERE state_code='HOI_CASTLE' FOR UPDATE"))[0];
      const rate = castle?.tax_rate_basis_points ?? 0;
      const basePrice = BigInt(product.price) * command.quantity;
      const tax = calculateGuildShopTax(basePrice, rate);
      const total = basePrice + tax;
      const account = (await transaction.query<Array<{ balance: string; version: bigint }>>("SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE", [actor.player_id]))[0];
      const before = integerDecimal(account?.balance ?? "0");
      if (account === undefined || before < total) throw new ApplicationError("GUILD_SHOP_POINT_SHORTAGE", `❌ 포인트가 부족합니다.\n상품금액 : 🅟${commas(basePrice)}\n세금 : 🅟${commas(tax)}${rate > 0 ? ` (${rate / 100}%)` : ""}\n총 필요 : 🅟${commas(total)}\n보유 : 🅟${commas(before)}`, 409);
      const after = before - total;
      const debit = await transaction.execute("UPDATE currency_accounts SET balance=?,version=version+1 WHERE player_id=? AND currency_code='point' AND version=?", [after, actor.player_id, account.version]);
      if (debit.affectedRows !== 1n) throw new ApplicationError("GUILD_SHOP_PURCHASE_CONFLICT", "길드상점 결제 상태가 먼저 변경되었습니다.", 409);
      await transaction.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?, 'GUILD_SHOP_PURCHASE')", [operation.insertId, actor.player_id, -total, after]);
      await transaction.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),version=version+1", [actor.player_id, product.item_id, command.quantity]);
      await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'GUILD_SHOP_PURCHASE')", [operation.insertId, actor.player_id, product.item_id, command.quantity]);
      const distributions = await this.distributeTax(transaction, operation.insertId, tax, castle?.lord_guild_name ?? null, castle?.version);
      await transaction.execute("INSERT INTO guild_shop_purchases(operation_id,player_id,guild_id,product_id,item_id,quantity,base_price,tax_amount,total_price,guild_fund_amount,foundation_amount,balance_after,purchased_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))", [operation.insertId, actor.player_id, actor.guild_id, product.product_id, product.item_id, command.quantity, basePrice, tax, total, distributions.guildFund, distributions.foundation, after]);
      const data = `✅ 길드상점 구매 완료\n상품 : ${product.display_name}\n수량 : ${command.quantity}개\n상품금액 🅟: ${commas(basePrice)}\n세금 : 🅟${commas(tax)}${rate > 0 ? ` (${rate / 100}%)` : ""}\n총 결제 : 🅟${commas(total)}\n남은 포인트 : 🅟${commas(after)}`;
      return this.complete(transaction, operation.insertId, input, actor, product, command.quantity, total, after, data);
    });
  }

  private async reserveDailyLimit(transaction: DatabaseTransaction, playerId: bigint, productId: string, quantity: bigint, limit: bigint): Promise<void> {
    await transaction.execute("INSERT IGNORE INTO guild_shop_daily_purchases(player_id,product_id,purchase_date,quantity,version) VALUES (?,?,DATE(DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 9 HOUR)),0,1)", [playerId, productId]);
    const row = (await transaction.query<Array<{ quantity: bigint; version: bigint }>>("SELECT quantity,version FROM guild_shop_daily_purchases WHERE player_id=? AND product_id=? AND purchase_date=DATE(DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 9 HOUR)) FOR UPDATE", [playerId, productId]))[0]!;
    if (BigInt(row.quantity) + quantity > limit) throw new ApplicationError("GUILD_SHOP_DAILY_LIMIT", `❌ 이 상품은 하루 ${limit}개까지만 구매할 수 있습니다.\n현재 구매량 : ${row.quantity}개`, 409);
    await transaction.execute("UPDATE guild_shop_daily_purchases SET quantity=quantity+?,version=version+1 WHERE player_id=? AND product_id=? AND purchase_date=DATE(DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 9 HOUR)) AND version=?", [quantity, playerId, productId, row.version]);
  }

  private async distributeTax(transaction: DatabaseTransaction, operationId: bigint, tax: bigint, lordGuildName: string | null, castleVersion: bigint | undefined): Promise<{ guildFund: bigint; foundation: bigint }> {
    if (tax === 0n || lordGuildName === null || castleVersion === undefined) return { guildFund: 0n, foundation: 0n };
    const guild = (await transaction.query<Array<{ id: bigint }>>("SELECT id FROM guilds WHERE display_name=? AND status='active' LIMIT 1 FOR UPDATE", [lordGuildName]))[0];
    if (guild === undefined) return { guildFund: 0n, foundation: 0n };
    const guildFund = (tax * 15n + 50n) / 100n;
    const foundation = tax - guildFund;
    await transaction.execute("INSERT INTO guild_resource_accounts(guild_id,currency_code,balance,version) VALUES (?,'guild_fund',?,1) ON DUPLICATE KEY UPDATE balance=balance+VALUES(balance),version=version+1", [guild.id, guildFund]);
    const guildBalance = (await transaction.query<Array<{ balance: string }>>("SELECT CAST(balance AS CHAR) balance FROM guild_resource_accounts WHERE guild_id=? AND currency_code='guild_fund'", [guild.id]))[0]!;
    await transaction.execute("INSERT INTO guild_resource_ledger(operation_id,sequence_no,guild_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'guild_fund',?,?,'GUILD_SHOP_TAX')", [operationId, guild.id, guildFund, integerDecimal(guildBalance.balance)]);
    await transaction.execute("UPDATE foundation_states SET total_amount=total_amount+?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE foundation_code='happy'", [foundation]);
    const castleWrite = await transaction.execute("UPDATE castle_state SET earnings=earnings+?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE state_code='HOI_CASTLE' AND version=?", [guildFund, castleVersion]);
    if (castleWrite.affectedRows !== 1n) throw new ApplicationError("GUILD_SHOP_TAX_CONFLICT", "성 세금 상태가 먼저 변경되었습니다.", 409);
    return { guildFund, foundation };
  }

  private async complete(transaction: DatabaseTransaction, operationId: bigint, input: { eventId: string; channelId: string }, actor: ActorRow, product: ProductRow, quantity: bigint, totalPrice: bigint, balanceAfter: bigint, data: string): Promise<GuildShopPurchaseResult> {
    const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId, input.channelId, JSON.stringify({ data })]);
    await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','purchased',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, COMMAND_CODE, operationId]);
    const result: GuildShopPurchaseResult = { status: "purchased", replayed: false, productId: product.product_id, quantity: quantity.toString(), totalPrice: totalPrice.toString(), balanceAfter: balanceAfter.toString(), data, outboxId: outbox.insertId.toString() };
    await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'guild_shop_item',?,'guild.shop.purchase','purchased','Iris /길드상점구매',?,UTC_TIMESTAMP(3))", [operationId, actor.identity_id, product.id, JSON.stringify(result)]);
    await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
    return result;
  }
}
