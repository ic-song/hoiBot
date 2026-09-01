import { createHash, randomUUID } from "node:crypto";

import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { compareLegacyBagItems } from "../inventory/legacy-bag-formatter.js";
import { ApplicationError } from "../shared/application-error.js";
import { FREE_MARKET_MEMBERSHIP_EXISTS_SQL } from "./free-market-membership.js";

const COMMAND = "/가방거래등록";
const CARROT_FEE = 100n;
const CONFIRM_SECONDS = 60;
const LISTING_DAYS = 30;
const MAX_UINT64 = 18_446_744_073_709_551_615n;
const MAX_DECIMAL_30 = 999_999_999_999_999_999_999_999_999_999n;

export interface FreeMarketBagRegisterCommand { sourceIndex: bigint; quantity: bigint; price: bigint }
export interface FreeMarketBagRegisterResult {
  status: "pending" | "registered" | "rejected" | "silent";
  data?: string;
  listingId?: string;
  itemId?: string;
  outboxId?: string;
  replayed?: boolean;
}

interface OwnerRow {
  identity_id: bigint;
  player_id: bigint;
  current_display_name: string;
  tier_code: string | null;
  rank_emoji: string | null;
}
interface BagRow {
  item_id: bigint;
  code: string;
  display_name: string;
  quantity: bigint;
  version: bigint;
  legacy_bag_order: string | null;
}
interface ConfirmationRow {
  command_text: string;
  item_id: bigint;
  item_version: bigint;
  source_index: bigint;
  quantity: bigint;
  price_amount: string;
}

// 가방 번호·양의 수량·양의 판매금액만 허용합니다.
export function parseFreeMarketBagRegisterCommand(message: string | undefined): FreeMarketBagRegisterCommand | undefined {
  const match = /^\/가방거래등록\s+([1-9]\d*)\s+([1-9]\d*)\s+([1-9]\d*)$/.exec(message ?? "");
  if (match === null) return undefined;
  const sourceIndex = BigInt(match[1]!);
  const quantity = BigInt(match[2]!);
  const price = BigInt(match[3]!);
  if (sourceIndex > MAX_UINT64 || quantity > MAX_UINT64 || price > MAX_DECIMAL_30) return undefined;
  return { sourceIndex, quantity, price };
}

// 완전한 가방 거래등록 입력만 partial dispatch 후보로 허용합니다.
export function isFreeMarketBagRegisterCandidate(message: string | undefined): boolean {
  return parseFreeMarketBagRegisterCommand(message) !== undefined;
}

// 인자형 등록 명령을 대표 alias로 정규화합니다.
export function normalizeFreeMarketBagRegisterDispatchMessage(message: string): string {
  return isFreeMarketBagRegisterCandidate(message) ? COMMAND : message;
}

// 긴 이벤트 ID를 operation 멱등 키 길이에 맞춥니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// bigint 금액을 천 단위 구분 형식으로 표시합니다.
function commas(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// DECIMAL 정수 문자열을 bigint로 복원합니다.
function whole(value: string): bigint {
  return BigInt(value.split(".")[0]!);
}

// transaction 결과를 실행·감사·outbox·operation 증거와 함께 완료합니다.
async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint;
  eventId: string;
  destinationId: string;
  owner: OwnerRow;
  resultCode: string;
  actionCode: string;
  data: string;
  result: FreeMarketBagRegisterResult;
  summary: Record<string, unknown>;
}): Promise<FreeMarketBagRegisterResult> {
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: input.data })],
  );
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'MARKET_BAG_TRADE_REGISTER',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, input.operationId, input.resultCode],
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,?,?,'Iris /가방거래등록',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.owner.identity_id, input.owner.player_id, input.actionCode, input.resultCode, JSON.stringify(input.summary)],
  );
  const result = { ...input.result, data: input.data, outboxId: outbox.insertId.toString(), replayed: false };
  await transaction.execute(
    "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
    [JSON.stringify(result), input.operationId],
  );
  return result;
}

// 가방 stack·등록 수수료·매물을 60초 확인 뒤 하나의 MariaDB transaction으로 반영합니다.
export class FreeMarketBagRegisterService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<FreeMarketBagRegisterResult> {
    const command = parseFreeMarketBagRegisterCommand(input.message);
    if (command === undefined) return { status: "silent" };
    return this.database.withTransaction(async (transaction) => {
      const owner = (await transaction.query<OwnerRow[]>(`SELECT identity.id identity_id,identity.player_id,profile.current_display_name,profile.tier_code,rank.rank_emoji
        FROM external_identities identity
        JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
        JOIN player_profiles profile ON profile.player_id=player.id
        LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
        ORDER BY identity.player_id LIMIT 1 FOR UPDATE`, [input.externalUserId]))[0];
      if (owner === undefined) return { status: "silent" };

      const key = eventKey(input.eventId);
      const prior = (await transaction.query<Array<{ result_json: string | FreeMarketBagRegisterResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='market.bag.register' AND idempotency_key=? FOR UPDATE",
        [key],
      ))[0];
      if (prior?.result_json != null) {
        const saved = typeof prior.result_json === "string" ? JSON.parse(prior.result_json) as FreeMarketBagRegisterResult : prior.result_json;
        return { ...saved, replayed: true };
      }
      if (prior !== undefined) throw new ApplicationError("MARKET_BAG_REGISTER_IN_PROGRESS", "가방 거래등록을 처리 중입니다.", 409);
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'market.bag.register',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, owner.identity_id],
      );

      const eligible = (await transaction.query<Array<{ allowed: bigint }>>(
        "SELECT COUNT(*) allowed FROM market_registration_tier_policies WHERE tier_code=? AND can_register=TRUE",
        [owner.tier_code],
      ))[0]?.allowed ?? 0n;
      if (eligible === 0n) return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, owner,
        resultCode: "tier_required", actionCode: "market.bag.register.reject",
        data: `❌ [${owner.rank_emoji ?? ""}${owner.current_display_name}]님 거래등록은 티어 "킹" 이상만 가능합니다.`,
        result: { status: "rejected" }, summary: { mutation: false, tierCode: owner.tier_code },
      });

      const target = await this.resolveTarget(transaction, owner.player_id, command.sourceIndex);
      if (target === undefined) return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, owner,
        resultCode: "item_not_found", actionCode: "market.bag.register.reject",
        data: "해당 가방 번호의 아이템이 존재하지 않습니다.", result: { status: "rejected" },
        summary: { mutation: false, sourceIndex: command.sourceIndex.toString() },
      });

      const limit = await this.registrationLimit(transaction, owner.player_id);
      const active = (await transaction.query<Array<{ count_value: bigint }>>(
        "SELECT COUNT(*) count_value FROM market_listings WHERE seller_player_id=? AND status='open' AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3))",
        [owner.player_id],
      ))[0]?.count_value ?? 0n;
      if (active + 1n > limit) return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, owner,
        resultCode: "listing_limit", actionCode: "market.bag.register.reject",
        data: `❌ 자유시장 등록 가능 건수를 초과했습니다.\n현재: ${active}/${limit}건\n요청: +1건`,
        result: { status: "rejected" }, summary: { mutation: false, active: active.toString(), limit: limit.toString() },
      });

      const carrot = (await transaction.query<Array<{ item_id: bigint; quantity: bigint; version: bigint }>>(`SELECT stack.item_id,stack.quantity,stack.version
        FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
        WHERE stack.player_id=? AND (item.code='ITEM-RWD-044' OR item.display_name='🥕당근이세요?' OR item.display_name='당근')
        ORDER BY CASE WHEN item.code='ITEM-RWD-044' THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE`, [owner.player_id]))[0];
      const requiredTarget = command.quantity + (carrot?.item_id === target.item_id ? CARROT_FEE : 0n);
      if (target.quantity < requiredTarget) return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, owner,
        resultCode: "insufficient_item", actionCode: "market.bag.register.reject",
        data: "거래 등록할 아이템 수량이 부족합니다.", result: { status: "rejected", itemId: target.item_id.toString() },
        summary: { mutation: false, itemId: target.item_id.toString(), requested: command.quantity.toString(), available: target.quantity.toString() },
      });
      if (carrot === undefined || carrot.quantity < CARROT_FEE || (carrot.item_id === target.item_id && carrot.quantity < requiredTarget)) {
        return complete(transaction, {
          operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, owner,
          resultCode: "insufficient_carrot", actionCode: "market.bag.register.reject",
          data: "가방 거래 등록 수수료 당근🥕 100개가 부족합니다.", result: { status: "rejected" },
          summary: { mutation: false, requiredCarrot: "100" },
        });
      }

      const pending = (await transaction.query<ConfirmationRow[]>(
        "SELECT command_text,item_id,item_version,source_index,quantity,CAST(price_amount AS CHAR) price_amount FROM market_bag_registration_confirmations WHERE player_id=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE",
        [owner.player_id],
      ))[0];
      const same = pending !== undefined && pending.command_text === input.message && pending.item_id === target.item_id
        && pending.item_version === target.version && pending.source_index === command.sourceIndex
        && pending.quantity === command.quantity && whole(pending.price_amount) === command.price;
      if (!same) {
        await transaction.execute(`INSERT INTO market_bag_registration_confirmations
          (player_id,command_text,item_id,item_version,source_index,quantity,price_amount,expires_at,updated_at)
          VALUES (?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),UTC_TIMESTAMP(3))
          ON DUPLICATE KEY UPDATE command_text=VALUES(command_text),item_id=VALUES(item_id),item_version=VALUES(item_version),source_index=VALUES(source_index),quantity=VALUES(quantity),price_amount=VALUES(price_amount),expires_at=VALUES(expires_at),updated_at=VALUES(updated_at)`,
        [owner.player_id, input.message, target.item_id, target.version, command.sourceIndex, command.quantity, command.price.toString(), CONFIRM_SECONDS]);
        const data = `[${owner.rank_emoji ?? ""}${owner.current_display_name}] 님\n🏪 자유시장 등록 확인\n━━━━━━━━━━━━\n[${target.display_name}] ${command.quantity}개\n🅟${commas(command.price)}에 등록하시겠습니까?\n\n※ 등록 수수료 [당근🥕 100개]가 차감됩니다.\n※ 60초 안에 같은 명령어를 다시 입력하면 등록됩니다.`;
        return complete(transaction, {
          operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, owner,
          resultCode: "confirmation_pending", actionCode: "market.bag.register.confirm", data,
          result: { status: "pending", itemId: target.item_id.toString() },
          summary: { mutation: false, sourceIndex: command.sourceIndex.toString(), itemId: target.item_id.toString(), quantity: command.quantity.toString(), price: command.price.toString(), confirmationSeconds: CONFIRM_SECONDS },
        });
      }

      if (target.item_id === carrot.item_id) {
        const debit = command.quantity + CARROT_FEE;
        const changed = await transaction.execute(
          "UPDATE inventory_stacks SET quantity=quantity-?,version=version+1 WHERE player_id=? AND item_id=? AND version=? AND quantity>=?",
          [debit, owner.player_id, target.item_id, target.version, debit],
        );
        if (changed.affectedRows !== 1n) throw new ApplicationError("MARKET_BAG_INVENTORY_CONFLICT", "가방이 먼저 변경되었습니다.", 409);
      } else {
        const itemChanged = await transaction.execute(
          "UPDATE inventory_stacks SET quantity=quantity-?,version=version+1 WHERE player_id=? AND item_id=? AND version=? AND quantity>=?",
          [command.quantity, owner.player_id, target.item_id, target.version, command.quantity],
        );
        const carrotChanged = await transaction.execute(
          "UPDATE inventory_stacks SET quantity=quantity-?,version=version+1 WHERE player_id=? AND item_id=? AND version=? AND quantity>=?",
          [CARROT_FEE, owner.player_id, carrot.item_id, carrot.version, CARROT_FEE],
        );
        if (itemChanged.affectedRows !== 1n || carrotChanged.affectedRows !== 1n) throw new ApplicationError("MARKET_BAG_INVENTORY_CONFLICT", "가방이 먼저 변경되었습니다.", 409);
      }
      await transaction.execute(
        "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'FREE_MARKET_BAG_REGISTER_RESERVE'),(?,2,?,?,?,'FREE_MARKET_BAG_REGISTER_FEE')",
        [operation.insertId, owner.player_id, target.item_id, -command.quantity, operation.insertId, owner.player_id, carrot.item_id, -CARROT_FEE],
      );
      const expiresAt = new Date(Date.now() + LISTING_DAYS * 86_400_000);
      const listing = await transaction.execute(
        "INSERT INTO market_listings(seller_player_id,asset_type_code,item_id,inventory_instance_id,quantity,price_currency_code,price_amount,expires_at) VALUES (?,'bag',?,NULL,?,'point',?,?)",
        [owner.player_id, target.item_id, command.quantity, command.price.toString(), expiresAt],
      );
      await transaction.execute(
        "INSERT INTO market_asset_reservations(listing_id,reservation_key,reserved_at,expires_at) VALUES (?,UUID(),UTC_TIMESTAMP(3),?)",
        [listing.insertId, expiresAt],
      );
      await transaction.execute(
        "INSERT INTO market_events(listing_id,operation_id,event_code,detail_json) VALUES (?,?,'created',?)",
        [listing.insertId, operation.insertId, JSON.stringify({ assetType: "bag", sourceIndex: command.sourceIndex.toString(), quantity: command.quantity.toString(), carrotFee: "100" })],
      );
      await transaction.execute(
        "INSERT INTO market_listing_registration_fees(listing_id,carrot_item_id,carrot_fee,source_code) VALUES (?,?,?,'bag_register')",
        [listing.insertId, carrot.item_id, CARROT_FEE],
      );
      await transaction.execute(`INSERT INTO market_bag_registration_ledger
        (operation_id,listing_id,player_id,item_id,source_index,quantity,price_amount,carrot_item_id,carrot_fee,inventory_version_before,inventory_version_after)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [operation.insertId, listing.insertId, owner.player_id, target.item_id, command.sourceIndex, command.quantity, command.price.toString(), carrot.item_id, CARROT_FEE, target.version, target.version + 1n]);
      await transaction.execute("DELETE FROM market_bag_registration_confirmations WHERE player_id=?", [owner.player_id]);
      const data = `[${owner.rank_emoji ?? ""}${owner.current_display_name}] 님\n🏪 자유시장 등록 완료\n━━━━━━━━━━━━\n[${target.display_name}] ${command.quantity}개\n🅟${commas(command.price)}에 등록되었습니다.\n\n※ 등록 수수료 [당근🥕 100개]가 차감되었습니다.\n※ 거래수수료는 판매자에게 10% 부담됩니다.`;
      return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, owner,
        resultCode: "registered", actionCode: "market.bag.register", data,
        result: { status: "registered", listingId: listing.insertId.toString(), itemId: target.item_id.toString() },
        summary: { sourceIndex: command.sourceIndex.toString(), itemId: target.item_id.toString(), quantity: command.quantity.toString(), price: command.price.toString(), listingId: listing.insertId.toString(), carrotFee: "100" },
      });
    });
  }

  // `/가방`과 동일한 정렬 뒤 번호를 stable item ID와 version으로 고정합니다.
  private async resolveTarget(transaction: DatabaseTransaction, playerId: bigint, sourceIndex: bigint): Promise<BagRow | undefined> {
    const rows = await transaction.query<BagRow[]>(`SELECT stack.item_id,item.code,item.display_name,stack.quantity,stack.version,
      JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.legacyBagOrder')) legacy_bag_order
      FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
      WHERE stack.player_id=? AND stack.quantity>0 AND item.active=TRUE AND item.stackable=TRUE FOR UPDATE`, [playerId]);
    const sorted = rows.sort((left, right) => compareLegacyBagItems(
      { displayName: left.display_name, quantity: left.quantity.toString(), legacyBagOrder: left.legacy_bag_order === null ? null : Number(left.legacy_bag_order) },
      { displayName: right.display_name, quantity: right.quantity.toString(), legacyBagOrder: right.legacy_bag_order === null ? null : Number(right.legacy_bag_order) },
    ));
    return sourceIndex > BigInt(sorted.length) ? undefined : sorted[Number(sourceIndex - 1n)];
  }

  // 기본 1건에 회원권 7건과 장사꾼 스킬 2건을 합산합니다.
  private async registrationLimit(transaction: DatabaseTransaction, playerId: bigint): Promise<bigint> {
    const benefits = (await transaction.query<Array<{ ticket: bigint; merchant: bigint }>>(`SELECT
      ${FREE_MARKET_MEMBERSHIP_EXISTS_SQL} ticket,
      EXISTS(SELECT 1 FROM player_pets pet JOIN pet_skills owned ON owned.player_pet_id=pet.id JOIN skill_definitions skill ON skill.id=owned.skill_id WHERE pet.player_id=? AND skill.display_name='타고난 장사꾼') merchant`,
    [playerId, playerId]))[0];
    return 1n + ((benefits?.ticket ?? 0n) > 0n ? 7n : 0n) + ((benefits?.merchant ?? 0n) > 0n ? 2n : 0n);
  }
}
