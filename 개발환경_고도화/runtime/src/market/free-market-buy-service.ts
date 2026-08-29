import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { isFreeMarketReadCommand } from "./free-market-read-service.js";
import { FreeMarketCancelService, isFreeMarketCancelCandidate, normalizeFreeMarketCancelDispatchMessage } from "./free-market-cancel-service.js";
import { HoiShopService, isHoiShopCommand } from "./hoi-shop-service.js";
import { AuctionBidService, isAuctionBidCandidate, normalizeAuctionBidDispatchMessage } from "./auction-bid-service.js";
import {
  FreeMarketBagRegisterService,
  isFreeMarketBagRegisterCandidate,
  normalizeFreeMarketBagRegisterDispatchMessage,
} from "./free-market-bag-register-service.js";

const BUY_ALIAS = "/자유시장구매 [번호]";
const CONFIRM = "자유시장거래";
const CANCEL = "자유시장거래취소";
const UINT64_MAX = 18_446_744_073_709_551_615n;

export type FreeMarketBuyCommand = { kind: "start"; displayNo: bigint } | { kind: "confirm" } | { kind: "cancel" } | { kind: "invalid" };
export interface FreeMarketBuyResult {
  status: "pending" | "purchased" | "cancelled" | "expired" | "rejected";
  data: string;
  listingId?: string;
  settlementId?: string;
  grossAmount?: string;
  feeAmount?: string;
  sellerNetAmount?: string;
  outboxId: string;
  replayed?: boolean;
}

interface Actor { identity_id: bigint; player_id: bigint; display_name: string; tier_code: string | null; rank_emoji: string | null }
interface Player { player_id: bigint; display_name: string; tier_code: string | null; rank_emoji: string | null }
interface Listing { id: bigint; seller_player_id: bigint; asset_type_code: string; item_id: bigint | null; inventory_instance_id: bigint | null; quantity: bigint; price_currency_code: string; price_amount: string; status: string; version: bigint; expires_at: Date | null }
interface Policy { confirmation_seconds: bigint; standard_fee_basis_points: bigint; member_fee_basis_points: bigint; stack_slot_limit: bigint; mini_pet_bag_limit: bigint; furniture_base_limit: bigint; furniture_premium_bonus: bigint; pet_skill_bag_limit: bigint; pendant_bag_limit: bigint }
interface Confirmation { listing_id: bigint; listing_version: bigint; price_amount: string; expires_at: Date; consumed_at: Date | null; cancelled_at: Date | null }

// 구매 시작·자동 확인·취소 명령을 완전 일치 형태로 구분합니다.
export function parseFreeMarketBuyCommand(message: string | undefined): FreeMarketBuyCommand | undefined {
  if (message === CONFIRM) return { kind: "confirm" };
  if (message === CANCEL) return { kind: "cancel" };
  const match = /^\/자유시장구매\s+(\d+)$/.exec(message ?? "");
  if (match === null) return undefined;
  const displayNo = BigInt(match[1]!);
  return displayNo <= UINT64_MAX ? { kind: "start", displayNo } : { kind: "invalid" };
}

// 실행 가능한 구매 흐름만 partial dispatch 후보로 허용합니다.
export function isFreeMarketBuyCandidate(message: string | undefined): boolean { return parseFreeMarketBuyCommand(message) !== undefined; }
// 구매 명령을 DB 대표 alias로 정규화합니다.
export function normalizeFreeMarketBuyDispatchMessage(message: string): string {
  const parsed = parseFreeMarketBuyCommand(message);
  return parsed?.kind === "start" || parsed?.kind === "invalid" ? BUY_ALIAS : parsed === undefined ? message : message;
}

// 자유시장 읽기·취소·구매 명령의 공용 진입 여부를 판정합니다.
export function isFreeMarketLifecycleCandidate(message: string | undefined): boolean {
  return isFreeMarketReadCommand(message) || isFreeMarketCancelCandidate(message) || isFreeMarketBuyCandidate(message)
    || isFreeMarketBagRegisterCandidate(message) || isHoiShopCommand(message) || isAuctionBidCandidate(message);
}

// 자유시장 생명주기 명령을 공용 dispatch 형식으로 정규화합니다.
export function normalizeFreeMarketLifecycleDispatchMessage(message: string): string {
  if (isFreeMarketBagRegisterCandidate(message)) return normalizeFreeMarketBagRegisterDispatchMessage(message);
  if (isFreeMarketReadCommand(message)) return message;
  if (isHoiShopCommand(message)) return message;
  if (isAuctionBidCandidate(message)) return normalizeAuctionBidDispatchMessage(message);
  if (isFreeMarketCancelCandidate(message)) return normalizeFreeMarketCancelDispatchMessage(message);
  if (isFreeMarketBuyCandidate(message)) return normalizeFreeMarketBuyDispatchMessage(message);
  return message;
}

// partial dispatch 결과가 자유시장 취소 또는 구매 실행과 일치하는지 판정합니다.
export function isFreeMarketMutationDispatch(message: string | undefined, route: string | undefined, handlerKey: string | undefined): boolean {
  if (route !== "MODERN") return false;
  return (handlerKey === "free_market_cancel" && isFreeMarketCancelCandidate(message))
    || (handlerKey === "free_market_buy" && isFreeMarketBuyCandidate(message))
    || (handlerKey === "free_market_bag_register" && isFreeMarketBagRegisterCandidate(message))
    || (handlerKey === "store_hoi_shop" && isHoiShopCommand(message))
    || (handlerKey === "store_auction_bid" && isAuctionBidCandidate(message));
}

// 자유시장 취소·구매 실행과 예상 가능한 사용자 오류 응답을 공용 경계에서 처리합니다.
export async function handleFreeMarketMutation(
  database: DatabaseClient,
  input: { eventId: string; externalUserId: string; destinationId: string; message: string; handlerKey: string },
  expectedErrorReply: (errorCode: string, message: string) => Promise<{ outboxId: string; data: string }>
): Promise<{ outboxId: string; data: string }> {
  try {
    if (input.handlerKey === "free_market_bag_register") {
      const result = await new FreeMarketBagRegisterService(database).handle(input);
      if (result.outboxId !== undefined && result.data !== undefined) return { outboxId: result.outboxId, data: result.data };
    } else if (input.handlerKey === "store_auction_bid") {
      const result = await new AuctionBidService(database).handle(input);
      if (result !== null) return { outboxId: result.outboxId, data: result.data };
    } else if (input.handlerKey === "store_hoi_shop") {
      const result = await new HoiShopService(database).read({ eventId: input.eventId, externalUserId: input.externalUserId, destinationId: input.destinationId, message: input.message });
      if (result !== null) return { outboxId: result.outboxId, data: result.data };
    } else if (input.handlerKey === "free_market_cancel") {
      const result = await new FreeMarketCancelService(database).handle(input);
      if (result !== null && result.outboxId !== undefined && result.data !== undefined) return { outboxId: result.outboxId, data: result.data };
    } else {
      const result = await new FreeMarketBuyService(database).handle(input);
      if (result !== null) return { outboxId: result.outboxId, data: result.data };
    }
  } catch (error) {
    const isExpectedCancel = input.handlerKey === "free_market_cancel" && error instanceof ApplicationError && error.statusCode === 409;
    const isExpectedBuy = input.handlerKey === "free_market_buy" && error instanceof ApplicationError && [409, 422].includes(error.statusCode);
    const isExpectedRegister = input.handlerKey === "free_market_bag_register" && error instanceof ApplicationError && [409, 422].includes(error.statusCode);
    const isExpectedBid = input.handlerKey === "store_auction_bid" && error instanceof ApplicationError && [409, 422].includes(error.statusCode);
    if (isExpectedCancel || isExpectedBuy || isExpectedRegister || isExpectedBid) return expectedErrorReply(`${input.handlerKey}_error`, (error as ApplicationError).message);
    throw error;
  }
  throw new ApplicationError("FREE_MARKET_MUTATION_NOT_HANDLED", "자유시장 요청을 처리할 수 없습니다.", 422);
}
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function eligibleTier(value: string | null): boolean { return value !== null && ["king", "emperor", "god"].includes(value.toLowerCase()); }
function integer(value: string): bigint { return BigInt(value.split(".")[0]!); }
function decimal(value: bigint): string { return `${value}.000`; }
function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
export function calculateFreeMarketFee(gross: bigint, basisPoints: bigint | number | string): bigint { return gross * BigInt(basisPoints) / 10_000n; }
function deadlock(error: unknown): boolean { const code = (error as { code?: string }).code; return code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT"; }

async function complete(t: DatabaseTransaction, input: { operationId: bigint; eventId: string; destinationId: string; actor: Actor; status: FreeMarketBuyResult["status"]; actionCode: string; targetId: bigint | null; data: string; result: Omit<FreeMarketBuyResult, "data" | "outboxId">; summary: Record<string, unknown> }): Promise<FreeMarketBuyResult> {
  const outbox = await t.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]);
  await t.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'MARKET_FREE_MARKET_BUY',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, input.operationId, input.status]);
  await t.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'market_listing',?,?,?,'Iris 자유시장 구매',?,UTC_TIMESTAMP(3))", [input.operationId, input.actor.identity_id, input.targetId, input.actionCode, input.status, JSON.stringify(input.summary)]);
  const result = { ...input.result, status: input.status, data: input.data, outboxId: outbox.insertId.toString(), replayed: false } as FreeMarketBuyResult;
  await t.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 자유시장 구매 확인과 다섯 자산 유형의 소유권·정산을 하나의 transaction으로 처리합니다.
export class FreeMarketBuyService {
  constructor(private readonly db: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<FreeMarketBuyResult | null> {
    const command = parseFreeMarketBuyCommand(input.message);
    if (command === undefined) return null;
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await this.db.withTransaction((t) => this.handleTransaction(t, input, command)); }
      catch (error) { last = error; if (!deadlock(error) || attempt === 2) throw error; }
    }
    throw last;
  }

  private async handleTransaction(t: DatabaseTransaction, input: { eventId: string; externalUserId: string; destinationId: string; message: string }, command: FreeMarketBuyCommand): Promise<FreeMarketBuyResult | null> {
    const actor = (await t.query<Actor[]>(`SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name,profile.tier_code,rank.rank_emoji
      FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
      JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id
      WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.player_id LIMIT 1 FOR UPDATE`, [input.externalUserId]))[0];
    if (actor === undefined) return null;
    const started = await this.operation(t, actor, input.eventId);
    if (started.replay !== undefined) return started.replay;
    if (command.kind === "invalid" || (command.kind === "start" && command.displayNo === 0n)) return complete(t, { operationId: started.id, eventId: input.eventId, destinationId: input.destinationId, actor, status: "rejected", actionCode: "market.free_market.buy.reject", targetId: null, data: "❌ 구매할 자유시장 번호를 확인해주세요.", result: { status: "rejected" }, summary: { mutation: false, reason: "invalid_number" } });
    if (command.kind === "cancel") return this.cancel(t, started.id, actor, input);
    if (command.kind === "confirm") return this.confirm(t, started.id, actor, input);
    return this.start(t, started.id, actor, input, command.displayNo);
  }

  private async operation(t: DatabaseTransaction, actor: Actor, eventId: string): Promise<{ id: bigint; replay?: FreeMarketBuyResult }> {
    const key = eventKey(eventId);
    const prior = (await t.query<Array<{ id: bigint; result_json: string | FreeMarketBuyResult | null }>>("SELECT id,result_json FROM operations WHERE idempotency_scope='market.free_market.buy' AND idempotency_key=? FOR UPDATE", [key]))[0];
    if (prior?.result_json != null) { const stored = typeof prior.result_json === "string" ? JSON.parse(prior.result_json) as FreeMarketBuyResult : prior.result_json; return { id: prior.id, replay: { ...stored, replayed: true } }; }
    if (prior !== undefined) throw new ApplicationError("FREE_MARKET_BUY_IN_PROGRESS", "자유시장 구매 작업이 처리 중입니다.", 409);
    const write = await t.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'market.free_market.buy',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)", [randomUUID(), key, actor.identity_id]);
    if (write.affectedRows !== 1n) {
      const duplicate = (await t.query<Array<{ result_json: string | FreeMarketBuyResult | null }>>("SELECT result_json FROM operations WHERE id=? FOR UPDATE", [write.insertId]))[0];
      if (duplicate?.result_json != null) { const stored = typeof duplicate.result_json === "string" ? JSON.parse(duplicate.result_json) as FreeMarketBuyResult : duplicate.result_json; return { id: write.insertId, replay: { ...stored, replayed: true } }; }
      throw new ApplicationError("FREE_MARKET_BUY_IN_PROGRESS", "자유시장 구매 작업이 처리 중입니다.", 409);
    }
    return { id: write.insertId };
  }

  private async start(t: DatabaseTransaction, operationId: bigint, actor: Actor, input: { eventId: string; destinationId: string }, displayNo: bigint): Promise<FreeMarketBuyResult> {
    const ids = await t.query<Array<{ id: bigint }>>("SELECT id FROM market_listings WHERE status='open' AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3)) ORDER BY created_at DESC,id DESC");
    if (displayNo > BigInt(ids.length)) return this.reject(t, operationId, actor, input, null, "❌ 구매할 자유시장 매물을 찾을 수 없습니다.", "not_found", { displayNo: displayNo.toString() });
    const listing = await this.listing(t, ids[Number(displayNo - 1n)]!.id);
    if (listing === undefined) return this.reject(t, operationId, actor, input, null, "❌ 구매할 자유시장 매물을 찾을 수 없습니다.", "not_found", { displayNo: displayNo.toString() });
    const checked = await this.validate(t, actor, listing);
    if (checked.error !== undefined) return this.reject(t, operationId, actor, input, listing.id, checked.error, checked.code!, { displayNo: displayNo.toString(), listingId: listing.id.toString() });
    const policy = await this.policy(t);
    await t.execute(`INSERT INTO free_market_buy_confirmations(player_id,listing_id,listing_version,price_amount,requested_event_id,expires_at,consumed_at,consumed_event_id,cancelled_at,cancelled_event_id,created_at,updated_at)
      VALUES (?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),NULL,NULL,NULL,NULL,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE listing_id=VALUES(listing_id),listing_version=VALUES(listing_version),price_amount=VALUES(price_amount),requested_event_id=VALUES(requested_event_id),expires_at=VALUES(expires_at),consumed_at=NULL,consumed_event_id=NULL,cancelled_at=NULL,cancelled_event_id=NULL,updated_at=UTC_TIMESTAMP(3)`, [actor.player_id, listing.id, listing.version, listing.price_amount, input.eventId, policy.confirmation_seconds]);
    const label = await this.assetLabel(t, listing);
    const data = `[${actor.rank_emoji ?? ""}${actor.display_name}] 님\n🏪 자유시장 구매 확인\n━━━━━━━━━━━━\n${label} ×${listing.quantity}\n가격: 🅟${commas(integer(listing.price_amount))}\n판매자: ${checked.seller!.rank_emoji ?? ""}${checked.seller!.display_name}\n\n※ 60초 안에 '${CONFIRM}' 입력\n※ 취소: '${CANCEL}'`;
    return complete(t, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, status: "pending", actionCode: "market.free_market.buy.confirmation", targetId: listing.id, data, result: { status: "pending", listingId: listing.id.toString(), grossAmount: integer(listing.price_amount).toString() }, summary: { mutation: false, confirmationCreated: true, displayNo: displayNo.toString(), listingId: listing.id.toString(), listingVersion: listing.version.toString() } });
  }

  private async confirm(t: DatabaseTransaction, operationId: bigint, actor: Actor, input: { eventId: string; destinationId: string }): Promise<FreeMarketBuyResult> {
    const confirmation = (await t.query<Confirmation[]>("SELECT listing_id,listing_version,CAST(price_amount AS CHAR) price_amount,expires_at,consumed_at,cancelled_at FROM free_market_buy_confirmations WHERE player_id=? FOR UPDATE", [actor.player_id]))[0];
    if (confirmation === undefined || confirmation.consumed_at !== null || confirmation.cancelled_at !== null) return this.reject(t, operationId, actor, input, null, "❌ 확인할 자유시장 거래가 없습니다.", "confirmation_missing", {});
    const fresh = (await t.query<Array<{ fresh: bigint }>>("SELECT (? > UTC_TIMESTAMP(3)) fresh", [confirmation.expires_at]))[0]?.fresh ?? 0n;
    if (fresh === 0n) {
      await t.execute("UPDATE free_market_buy_confirmations SET cancelled_at=UTC_TIMESTAMP(3),cancelled_event_id=?,updated_at=UTC_TIMESTAMP(3) WHERE player_id=?", [input.eventId, actor.player_id]);
      return complete(t, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, status: "expired", actionCode: "market.free_market.buy.expired", targetId: confirmation.listing_id, data: "❌ 자유시장 거래 확인 시간이 만료되었습니다.", result: { status: "expired", listingId: confirmation.listing_id.toString() }, summary: { mutation: false, confirmationExpired: true } });
    }
    const listing = await this.listing(t, confirmation.listing_id);
    if (listing === undefined || listing.version !== confirmation.listing_version || listing.price_amount !== confirmation.price_amount) return this.reject(t, operationId, actor, input, confirmation.listing_id, "❌ 자유시장 매물 상태가 변경되었습니다. 다시 확인해주세요.", "listing_changed", { expectedVersion: confirmation.listing_version.toString() });
    const checked = await this.validate(t, actor, listing);
    if (checked.error !== undefined) return this.reject(t, operationId, actor, input, listing.id, checked.error, checked.code!, { listingId: listing.id.toString() });
    const seller = checked.seller!;
    const policy = await this.policy(t);
    await t.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,0),(?,'point',0,0)", [actor.player_id, seller.player_id]);
    const accounts = await t.query<Array<{ player_id: bigint; balance: string; version: bigint }>>("SELECT player_id,CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id IN (?,?) AND currency_code='point' ORDER BY player_id FOR UPDATE", [actor.player_id, seller.player_id]);
    const buyerAccount = accounts.find((row) => row.player_id === actor.player_id)!;
    const sellerAccount = accounts.find((row) => row.player_id === seller.player_id)!;
    const gross = integer(listing.price_amount);
    const buyerBefore = integer(buyerAccount.balance);
    const sellerBefore = integer(sellerAccount.balance);
    if (buyerBefore < gross) return this.reject(t, operationId, actor, input, listing.id, "❌ 포인트가 부족합니다.", "insufficient_point", { required: gross.toString(), balance: buyerBefore.toString() });
    const hasPass = String((await t.query<Array<{ allowed: bigint | number }>>("SELECT EXISTS(SELECT 1 FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND stack.quantity>0 AND item.display_name='자유시장회원권🏪') allowed", [seller.player_id]))[0]?.allowed ?? 0) === "1";
    const feeBasisPoints = hasPass ? policy.member_fee_basis_points : policy.standard_fee_basis_points;
    const fee = calculateFreeMarketFee(gross, feeBasisPoints);
    const net = gross - fee;
    const buyerAfter = buyerBefore - gross;
    const sellerAfter = sellerBefore + net;
    if ((await t.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?", [decimal(buyerAfter), actor.player_id, buyerAccount.version])).affectedRows !== 1n) throw new ApplicationError("FREE_MARKET_BUY_CONFLICT", "구매자 포인트가 먼저 변경되었습니다.", 409);
    if ((await t.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?", [decimal(sellerAfter), seller.player_id, sellerAccount.version])).affectedRows !== 1n) throw new ApplicationError("FREE_MARKET_BUY_CONFLICT", "판매자 포인트가 먼저 변경되었습니다.", 409);
    await t.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?, 'FREE_MARKET_BUY_DEBIT'),(?,2,?,'point',?,?, 'FREE_MARKET_BUY_SELLER_NET')", [operationId, actor.player_id, decimal(-gross), decimal(buyerAfter), operationId, seller.player_id, decimal(net), decimal(sellerAfter)]);
    const foundation = (await t.query<Array<{ version: bigint }>>("SELECT version FROM foundation_states WHERE foundation_code='happy' FOR UPDATE"))[0];
    if (foundation === undefined) throw new ApplicationError("FREE_MARKET_FOUNDATION_REQUIRED", "행복재단 정산 상태가 준비되지 않았습니다.", 409);
    if ((await t.execute("UPDATE foundation_states SET total_amount=total_amount+?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE foundation_code='happy' AND version=?", [decimal(fee), foundation.version])).affectedRows !== 1n) throw new ApplicationError("FREE_MARKET_BUY_CONFLICT", "행복재단 정산 상태가 먼저 변경되었습니다.", 409);
    await this.transferAsset(t, operationId, actor.player_id, listing);
    const nextVersion = listing.version + 1n;
    if ((await t.execute("UPDATE market_listings SET status='sold',version=?,closed_at=UTC_TIMESTAMP(3) WHERE id=? AND status='open' AND version=?", [nextVersion, listing.id, listing.version])).affectedRows !== 1n) throw new ApplicationError("FREE_MARKET_BUY_CONFLICT", "자유시장 매물이 먼저 변경되었습니다.", 409);
    await t.execute("DELETE FROM market_asset_reservations WHERE listing_id=?", [listing.id]);
    const settlement = await t.execute("INSERT INTO market_settlements(operation_id,listing_id,buyer_player_id,gross_amount,fee_amount,net_amount,settled_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))", [operationId, listing.id, actor.player_id, decimal(gross), decimal(fee), decimal(net)]);
    await t.execute("INSERT INTO market_fee_ledger(operation_id,listing_id,currency_code,amount,reason_code) VALUES (?,?,'point',?,'FREE_MARKET_BUY_FEE')", [operationId, listing.id, decimal(fee)]);
    await t.execute("INSERT INTO market_events(listing_id,operation_id,event_code,detail_json) VALUES (?,?,'sold',?)", [listing.id, operationId, JSON.stringify({ buyerPlayerId: actor.player_id.toString(), sellerPlayerId: seller.player_id.toString(), feeBasisPoints: feeBasisPoints.toString() })]);
    await t.execute("INSERT INTO free_market_buy_events(operation_id,listing_id,buyer_player_id,seller_player_id,asset_type_code,asset_quantity,gross_amount,fee_basis_points,fee_amount,seller_net_amount,listing_version_before,listing_version_after) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [operationId, listing.id, actor.player_id, seller.player_id, listing.asset_type_code, listing.quantity, decimal(gross), feeBasisPoints, decimal(fee), decimal(net), listing.version, nextVersion]);
    await t.execute("UPDATE free_market_buy_confirmations SET consumed_at=UTC_TIMESTAMP(3),consumed_event_id=?,updated_at=UTC_TIMESTAMP(3) WHERE player_id=?", [input.eventId, actor.player_id]);
    const label = await this.assetLabel(t, listing);
    const data = `✅ 자유시장 거래 완료\n${label} ×${listing.quantity}\n구매가: 🅟${commas(gross)}\n판매자 정산: 🅟${commas(net)}\n거래수수료: 🅟${commas(fee)}`;
    return complete(t, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, status: "purchased", actionCode: "market.free_market.buy", targetId: listing.id, data, result: { status: "purchased", listingId: listing.id.toString(), settlementId: settlement.insertId.toString(), grossAmount: gross.toString(), feeAmount: fee.toString(), sellerNetAmount: net.toString() }, summary: { listingId: listing.id.toString(), listingVersionBefore: listing.version.toString(), listingVersionAfter: nextVersion.toString(), buyerPlayerId: actor.player_id.toString(), sellerPlayerId: seller.player_id.toString(), assetType: listing.asset_type_code, quantity: listing.quantity.toString(), gross: gross.toString(), fee: fee.toString(), net: net.toString(), feeBasisPoints: feeBasisPoints.toString() } });
  }

  private async cancel(t: DatabaseTransaction, operationId: bigint, actor: Actor, input: { eventId: string; destinationId: string }): Promise<FreeMarketBuyResult> {
    const confirmation = (await t.query<Array<{ listing_id: bigint }>>("SELECT listing_id FROM free_market_buy_confirmations WHERE player_id=? AND consumed_at IS NULL AND cancelled_at IS NULL FOR UPDATE", [actor.player_id]))[0];
    if (confirmation === undefined) return this.reject(t, operationId, actor, input, null, "취소할 자유시장 거래 확인이 없습니다.", "confirmation_missing", {});
    await t.execute("UPDATE free_market_buy_confirmations SET cancelled_at=UTC_TIMESTAMP(3),cancelled_event_id=?,updated_at=UTC_TIMESTAMP(3) WHERE player_id=?", [input.eventId, actor.player_id]);
    return complete(t, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, status: "cancelled", actionCode: "market.free_market.buy.cancel", targetId: confirmation.listing_id, data: "자유시장 거래를 취소했습니다.", result: { status: "cancelled", listingId: confirmation.listing_id.toString() }, summary: { mutation: false, confirmationCancelled: true } });
  }

  private reject(t: DatabaseTransaction, operationId: bigint, actor: Actor, input: { eventId: string; destinationId: string }, targetId: bigint | null, data: string, reason: string, extra: Record<string, unknown>): Promise<FreeMarketBuyResult> {
    return complete(t, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, status: "rejected", actionCode: "market.free_market.buy.reject", targetId, data, result: { status: "rejected", ...(targetId === null ? {} : { listingId: targetId.toString() }) }, summary: { mutation: false, reason, ...extra } });
  }

  private async listing(t: DatabaseTransaction, id: bigint): Promise<Listing | undefined> {
    return (await t.query<Listing[]>("SELECT id,seller_player_id,asset_type_code,item_id,inventory_instance_id,quantity,price_currency_code,CAST(price_amount AS CHAR) price_amount,status,version,expires_at FROM market_listings WHERE id=? FOR UPDATE", [id]))[0];
  }

  private async policy(t: DatabaseTransaction): Promise<Policy> {
    const policy = (await t.query<Policy[]>("SELECT confirmation_seconds,standard_fee_basis_points,member_fee_basis_points,stack_slot_limit,mini_pet_bag_limit,furniture_base_limit,furniture_premium_bonus,pet_skill_bag_limit,pendant_bag_limit FROM free_market_buy_policy WHERE policy_key='default'"))[0];
    if (policy === undefined) throw new ApplicationError("FREE_MARKET_BUY_POLICY_REQUIRED", "자유시장 구매 정책이 준비되지 않았습니다.", 409);
    return policy;
  }

  private async validate(t: DatabaseTransaction, actor: Actor, listing: Listing): Promise<{ seller?: Player; error?: string; code?: string }> {
    if (listing.status !== "open" || (listing.expires_at !== null && listing.expires_at.getTime() <= Date.now())) return { error: "❌ 구매할 자유시장 매물을 찾을 수 없습니다.", code: "not_found" };
    if (listing.price_currency_code !== "point") return { error: "❌ 현재 포인트 매물만 구매할 수 있습니다.", code: "unsupported_currency" };
    if (listing.seller_player_id === actor.player_id) return { error: "❌ 본인이 등록한 상품은 구매할 수 없습니다.", code: "self_trade" };
    const players = await t.query<Player[]>(`SELECT player.id player_id,profile.current_display_name display_name,profile.tier_code,rank.rank_emoji FROM players player
      JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id
      WHERE player.id IN (?,?) AND player.status='active' AND player.deleted_at IS NULL ORDER BY player.id FOR UPDATE`, [actor.player_id, listing.seller_player_id]);
    const seller = players.find((row) => row.player_id === listing.seller_player_id);
    if (seller === undefined) return { error: "❌ 판매자 정보를 찾을 수 없습니다.", code: "seller_missing" };
    if (!eligibleTier(actor.tier_code)) return { error: `❌[${actor.rank_emoji ?? ""}${actor.display_name}]님 자유시장 거래는 티어 👑킹 이상부터 가능합니다.`, code: "buyer_tier_required" };
    if (!eligibleTier(seller.tier_code)) return { error: `❌[${seller.rank_emoji ?? ""}${seller.display_name}]님은 티어 👑킹 미만이라 거래할 수 없습니다.`, code: "seller_tier_required" };
    const policy = await this.policy(t);
    const capacity = await this.capacityError(t, actor.player_id, listing, policy);
    if (capacity !== undefined) return { error: capacity, code: "capacity_full" };
    await t.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,0)", [actor.player_id]);
    const account = (await t.query<Array<{ balance: string }>>("SELECT CAST(balance AS CHAR) balance FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE", [actor.player_id]))[0]!;
    if (integer(account.balance) < integer(listing.price_amount)) return { error: "❌ 포인트가 부족합니다.", code: "insufficient_point" };
    return { seller };
  }

  private async capacityError(t: DatabaseTransaction, buyer: bigint, listing: Listing, policy: Policy): Promise<string | undefined> {
    if (listing.asset_type_code === "stack" || listing.asset_type_code === "bag") {
      if (listing.item_id === null) return "❌ 구매할 가방 아이템 정보가 없습니다.";
      const values = (await t.query<Array<{ existing: bigint; count_value: bigint }>>("SELECT EXISTS(SELECT 1 FROM inventory_stacks WHERE player_id=? AND item_id=? AND quantity>0) existing,(SELECT COUNT(*) FROM inventory_stacks WHERE player_id=? AND quantity>0) count_value", [buyer, listing.item_id, buyer]))[0]!;
      if (values.existing === 0n && values.count_value >= policy.stack_slot_limit) return "❌ 가방 공간이 부족합니다.";
      return undefined;
    }
    if (listing.asset_type_code === "instance" || listing.asset_type_code === "pendant") {
      const count = (await t.query<Array<{ count_value: bigint }>>(`SELECT COUNT(*) count_value FROM inventory_instances instance JOIN item_definitions item ON item.id=instance.item_id WHERE instance.player_id=? AND instance.status='owned' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.objectType')),JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.objectType')))='pendant' FOR UPDATE`, [buyer]))[0]?.count_value ?? 0n;
      if (count + listing.quantity > policy.pendant_bag_limit) return "❌ 펜던트 가방 공간이 부족합니다.";
      return undefined;
    }
    if (listing.asset_type_code === "pet_skill" || listing.asset_type_code === "skill") {
      const pet = (await t.query<Array<{ id: bigint }>>("SELECT id FROM player_pets WHERE player_id=? ORDER BY id LIMIT 1 FOR UPDATE", [buyer]))[0];
      if (pet === undefined) return "❌ 펫스킬을 받을 등록 펫이 없습니다.";
      const count = (await t.query<Array<{ count_value: bigint }>>("SELECT COALESCE(SUM(quantity),0) count_value FROM pet_skill_inventory WHERE player_pet_id=? FOR UPDATE", [pet.id]))[0]?.count_value ?? 0n;
      if (count + listing.quantity > policy.pet_skill_bag_limit) return "❌ 펫스킬가방 공간이 부족합니다.";
      return undefined;
    }
    if (listing.asset_type_code === "furniture") {
      const values = (await t.query<Array<{ count_value: bigint; premium: bigint }>>("SELECT (SELECT COUNT(*) FROM furniture_inventory_instances WHERE player_id=? AND status='bag') count_value,EXISTS(SELECT 1 FROM player_passes WHERE player_id=? AND pass_code='premium' AND enabled=TRUE AND (permanent=TRUE OR ends_at>=UTC_TIMESTAMP(3))) premium", [buyer, buyer]))[0]!;
      const limit = policy.furniture_base_limit + (values.premium > 0n ? policy.furniture_premium_bonus : 0n);
      if (values.count_value + listing.quantity > limit) return "❌ 가구 가방 공간이 부족합니다.";
      return undefined;
    }
    if (listing.asset_type_code === "mini_pet" || listing.asset_type_code === "miniPet") {
      const values = (await t.query<Array<{ count_value: bigint; limit_value: bigint }>>("SELECT (SELECT COUNT(*) FROM owned_mini_pets WHERE player_id=?) count_value,COALESCE((SELECT keep_count FROM mini_pet_inventory_limits WHERE player_id=?),?) limit_value", [buyer, buyer, policy.mini_pet_bag_limit]))[0]!;
      if (values.count_value + listing.quantity > values.limit_value) return "❌ 미니펫 가방 공간이 부족합니다.";
      return undefined;
    }
    return "❌ 지원하지 않는 자유시장 상품 유형입니다.";
  }

  private async transferAsset(t: DatabaseTransaction, operationId: bigint, buyer: bigint, listing: Listing): Promise<void> {
    if (listing.asset_type_code === "stack" || listing.asset_type_code === "bag") {
      if (listing.item_id === null) throw new ApplicationError("FREE_MARKET_ASSET_MISSING", "구매할 가방 아이템 정보가 없습니다.", 409);
      await t.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,0)", [buyer, listing.item_id]);
      const stack = (await t.query<Array<{ version: bigint }>>("SELECT version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [buyer, listing.item_id]))[0]!;
      if ((await t.execute("UPDATE inventory_stacks SET quantity=quantity+?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [listing.quantity, buyer, listing.item_id, stack.version])).affectedRows !== 1n) throw new ApplicationError("FREE_MARKET_ASSET_CONFLICT", "가방이 먼저 변경되었습니다.", 409);
      await t.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,10,?,?,?,'FREE_MARKET_BUY_RECEIVE')", [operationId, buyer, listing.item_id, listing.quantity]);
      return;
    }
    if (listing.asset_type_code === "instance" || listing.asset_type_code === "pendant") {
      if (listing.inventory_instance_id === null) throw new ApplicationError("FREE_MARKET_ASSET_MISSING", "구매할 펜던트 정보가 없습니다.", 409);
      const instance = (await t.query<Array<{ item_id: bigint; version: bigint }>>("SELECT item_id,version FROM inventory_instances WHERE id=? AND player_id=? AND status='reserved' FOR UPDATE", [listing.inventory_instance_id, listing.seller_player_id]))[0];
      if (instance === undefined || (await t.execute("UPDATE inventory_instances SET player_id=?,status='owned',version=version+1 WHERE id=? AND player_id=? AND status='reserved' AND version=?", [buyer, listing.inventory_instance_id, listing.seller_player_id, instance.version])).affectedRows !== 1n) throw new ApplicationError("FREE_MARKET_ASSET_CONFLICT", "펜던트 소유권이 먼저 변경되었습니다.", 409);
      await t.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,instance_id,quantity_delta,reason_code) VALUES (?,10,?,?,?,-1,'FREE_MARKET_BUY_TRANSFER'),(?,11,?,?,?,1,'FREE_MARKET_BUY_TRANSFER')", [operationId, listing.seller_player_id, instance.item_id, listing.inventory_instance_id, operationId, buyer, instance.item_id, listing.inventory_instance_id]);
      return;
    }
    if (listing.asset_type_code === "pet_skill" || listing.asset_type_code === "skill") {
      const source = (await t.query<Array<{ skill_id: bigint; quantity: bigint }>>("SELECT skill_id,quantity FROM market_skill_registration_ledger WHERE listing_id=? FOR UPDATE", [listing.id]))[0];
      const pet = (await t.query<Array<{ id: bigint }>>("SELECT id FROM player_pets WHERE player_id=? ORDER BY id LIMIT 1 FOR UPDATE", [buyer]))[0];
      if (source === undefined || pet === undefined || source.quantity !== listing.quantity) throw new ApplicationError("FREE_MARKET_ASSET_MISSING", "구매할 펫스킬 정보가 일치하지 않습니다.", 409);
      await t.execute("INSERT IGNORE INTO pet_skill_inventory(player_pet_id,skill_id,quantity,version,updated_at) VALUES (?,?,0,0,UTC_TIMESTAMP(3))", [pet.id, source.skill_id]);
      const skill = (await t.query<Array<{ version: bigint }>>("SELECT version FROM pet_skill_inventory WHERE player_pet_id=? AND skill_id=? FOR UPDATE", [pet.id, source.skill_id]))[0]!;
      if ((await t.execute("UPDATE pet_skill_inventory SET quantity=quantity+?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_pet_id=? AND skill_id=? AND version=?", [source.quantity, pet.id, source.skill_id, skill.version])).affectedRows !== 1n) throw new ApplicationError("FREE_MARKET_ASSET_CONFLICT", "펫스킬가방이 먼저 변경되었습니다.", 409);
      await t.execute("INSERT INTO pet_skill_inventory_ledger(operation_id,sequence_no,player_id,player_pet_id,skill_id,quantity_delta,reason_code) VALUES (?,10,?,?,?,?, 'FREE_MARKET_BUY_RECEIVE')", [operationId, buyer, pet.id, source.skill_id, source.quantity]);
      return;
    }
    if (listing.asset_type_code === "furniture") {
      const items = await t.query<Array<{ id: bigint; version: bigint }>>(`SELECT instance.id,instance.version FROM market_furniture_registration_ledger ledger JOIN market_furniture_registration_items item ON item.operation_id=ledger.operation_id JOIN furniture_inventory_instances instance ON instance.id=item.furniture_instance_id WHERE ledger.listing_id=? AND instance.player_id=? ORDER BY item.sequence_no FOR UPDATE`, [listing.id, listing.seller_player_id]);
      if (BigInt(items.length) !== listing.quantity) throw new ApplicationError("FREE_MARKET_ASSET_MISSING", "구매할 가구 정보가 일치하지 않습니다.", 409);
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]!;
        if ((await t.execute("UPDATE furniture_inventory_instances SET player_id=?,status='bag',version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND player_id=? AND status='listed' AND version=?", [buyer, item.id, listing.seller_player_id, item.version])).affectedRows !== 1n) throw new ApplicationError("FREE_MARKET_ASSET_CONFLICT", "가구 소유권이 먼저 변경되었습니다.", 409);
        await t.execute("INSERT INTO furniture_inventory_ledger(operation_id,sequence_no,player_id,furniture_instance_id,status_before,status_after,reason_code) VALUES (?,?,?,?,'listed','bag','FREE_MARKET_BUY_RECEIVE')", [operationId, index + 10, buyer, item.id]);
      }
      return;
    }
    if (listing.asset_type_code === "mini_pet" || listing.asset_type_code === "miniPet") {
      const reservation = (await t.query<Array<{ owned_mini_pet_id: bigint }>>("SELECT owned_mini_pet_id FROM market_mini_pet_reservations WHERE listing_id=? AND player_id=? FOR UPDATE", [listing.id, listing.seller_player_id]))[0];
      if (reservation === undefined || listing.quantity !== 1n) throw new ApplicationError("FREE_MARKET_ASSET_MISSING", "구매할 미니펫 정보가 일치하지 않습니다.", 409);
      const pet = (await t.query<Array<{ version: bigint }>>("SELECT version FROM owned_mini_pets WHERE id=? AND player_id=? AND equipped=FALSE FOR UPDATE", [reservation.owned_mini_pet_id, listing.seller_player_id]))[0];
      if (pet === undefined) throw new ApplicationError("FREE_MARKET_ASSET_CONFLICT", "미니펫 소유권이 먼저 변경되었습니다.", 409);
      const targetSequence = (await t.query<Array<{ next_value: bigint }>>("SELECT COALESCE(MAX(bag_sequence),0)+1 next_value FROM owned_mini_pets WHERE player_id=? FOR UPDATE", [buyer]))[0]?.next_value ?? 1n;
      if ((await t.execute("UPDATE owned_mini_pets SET player_id=?,bag_sequence=?,version=version+1 WHERE id=? AND player_id=? AND equipped=FALSE AND version=?", [buyer, targetSequence, reservation.owned_mini_pet_id, listing.seller_player_id, pet.version])).affectedRows !== 1n) throw new ApplicationError("FREE_MARKET_ASSET_CONFLICT", "미니펫 소유권이 먼저 변경되었습니다.", 409);
      const remaining = await t.query<Array<{ id: bigint }>>("SELECT id FROM owned_mini_pets WHERE player_id=? AND equipped=FALSE ORDER BY COALESCE(bag_sequence,id),id FOR UPDATE", [listing.seller_player_id]);
      for (let index = 0; index < remaining.length; index += 1) await t.execute("UPDATE owned_mini_pets SET bag_sequence=?,version=version+1 WHERE id=?", [index + 1, remaining[index]!.id]);
      await t.execute("DELETE FROM market_mini_pet_reservations WHERE listing_id=?", [listing.id]);
      return;
    }
    throw new ApplicationError("FREE_MARKET_ASSET_UNSUPPORTED", "지원하지 않는 자유시장 상품 유형입니다.", 409);
  }

  private async assetLabel(t: DatabaseTransaction, listing: Listing): Promise<string> {
    if (listing.asset_type_code === "pet_skill" || listing.asset_type_code === "skill") return (await t.query<Array<{ name_value: string }>>("SELECT definition.display_name name_value FROM market_skill_registration_ledger ledger JOIN skill_definitions definition ON definition.id=ledger.skill_id WHERE ledger.listing_id=?", [listing.id]))[0]?.name_value ?? "펫스킬";
    if (listing.asset_type_code === "furniture") return (await t.query<Array<{ name_value: string }>>("SELECT definition.display_name name_value FROM market_furniture_registration_ledger ledger JOIN furniture_definitions definition ON definition.id=ledger.furniture_definition_id WHERE ledger.listing_id=?", [listing.id]))[0]?.name_value ?? "가구";
    if (listing.asset_type_code === "mini_pet" || listing.asset_type_code === "miniPet") return (await t.query<Array<{ name_value: string }>>("SELECT definition.display_name name_value FROM market_mini_pet_reservations reservation JOIN owned_mini_pets owned ON owned.id=reservation.owned_mini_pet_id JOIN mini_pet_definitions definition ON definition.id=owned.mini_pet_definition_id WHERE reservation.listing_id=?", [listing.id]))[0]?.name_value ?? "미니펫";
    if (listing.item_id !== null) return (await t.query<Array<{ name_value: string }>>("SELECT display_name name_value FROM item_definitions WHERE id=?", [listing.item_id]))[0]?.name_value ?? listing.asset_type_code;
    return listing.asset_type_code;
  }
}
