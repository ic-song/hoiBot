import { createHash, randomUUID } from "node:crypto";

import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { FREE_MARKET_MEMBERSHIP_EXISTS_SQL } from "./free-market-membership.js";
import { reserveMiniPetEscrow } from "./market-mini-pet-bulk-escrow.js";

const COMMAND = "/미니펫거래등록";
const FEE_PER_PET = 20n;
const CONFIRM_SECONDS = 60;
const LISTING_DAYS = 30;
const MAX_UINT64 = 18_446_744_073_709_551_615n;
const MAX_DECIMAL_30 = 999_999_999_999_999_999_999_999_999_999n;

export interface FreeMarketMiniPetRegisterCommand { sourceIndex: bigint; quantity: bigint; price: bigint }
export interface FreeMarketMiniPetRegisterResult {
  status: "pending" | "registered" | "rejected" | "silent";
  data?: string;
  listingId?: string;
  ownedMiniPetIds?: string[];
  outboxId?: string;
  replayed?: boolean;
}

interface OwnerRow { identity_id: bigint; player_id: bigint; current_display_name: string; tier_code: string | null; rank_emoji: string | null }
interface MiniPetRow {
  id: bigint; mini_pet_definition_id: bigint; display_name: string; emoji_value: string | null;
  custom_name: string | null; custom_emoji: string | null; enhancement_level: bigint;
  battle_experience: bigint; castle_experience: bigint; raid_experience: bigint;
  is_elite: bigint; bag_sequence: bigint | null; version: bigint;
}
interface ConfirmationRow {
  command_text: string; source_index: bigint; quantity: bigint; mini_pet_definition_id: bigint;
  custom_name: string | null; custom_emoji: string | null; enhancement_level: bigint;
  battle_experience: bigint; castle_experience: bigint; raid_experience: bigint; is_elite: bigint;
  owned_ids_json: string | string[]; owned_versions_json: string | string[]; price_amount: string;
  carrot_item_id: bigint; carrot_fee: bigint;
}

// 미니펫 가방 번호·양의 수량·양의 판매금액만 허용합니다.
export function parseFreeMarketMiniPetRegisterCommand(message: string | undefined): FreeMarketMiniPetRegisterCommand | undefined {
  const match = /^\/미니펫거래등록\s+([1-9]\d*)\s+([1-9]\d*)\s+([1-9]\d*)$/.exec(message ?? "");
  if (match === null) return undefined;
  const sourceIndex = BigInt(match[1]!);
  const quantity = BigInt(match[2]!);
  const price = BigInt(match[3]!);
  if (sourceIndex > MAX_UINT64 || quantity > MAX_UINT64 || price > MAX_DECIMAL_30) return undefined;
  return { sourceIndex, quantity, price };
}

// 완전한 미니펫 거래등록 입력만 partial dispatch 후보로 허용합니다.
export function isFreeMarketMiniPetRegisterCandidate(message: string | undefined): boolean {
  return parseFreeMarketMiniPetRegisterCommand(message) !== undefined;
}

// 인자형 미니펫 등록 명령을 대표 alias로 정규화합니다.
export function normalizeFreeMarketMiniPetRegisterDispatchMessage(message: string): string {
  return isFreeMarketMiniPetRegisterCandidate(message) ? COMMAND : message;
}

// 긴 이벤트 ID를 operation 멱등 키 길이에 맞춥니다.
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
// bigint 금액을 천 단위 구분 형식으로 표시합니다.
function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
// JSON 컬럼을 비교 가능한 문자열 배열로 복원합니다.
function jsonArray(value: string | string[]): string[] { return Array.isArray(value) ? value : JSON.parse(value) as string[]; }
// DECIMAL 정수 문자열을 bigint로 복원합니다.
function whole(value: string): bigint { return BigInt(value.split(".")[0]!); }

// transaction 결과를 실행·감사·outbox·operation 증거와 함께 완료합니다.
async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint; eventId: string; destinationId: string; owner: OwnerRow;
  resultCode: string; actionCode: string; data: string; result: FreeMarketMiniPetRegisterResult;
  summary: Record<string, unknown>;
}): Promise<FreeMarketMiniPetRegisterResult> {
  const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'MARKET_MINIPET_TRADE_REGISTER',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, input.operationId, input.resultCode]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,?,?,'Iris /미니펫거래등록',?,UTC_TIMESTAMP(3))", [input.operationId, input.owner.identity_id, input.owner.player_id, input.actionCode, input.resultCode, JSON.stringify(input.summary)]);
  const result = { ...input.result, data: input.data, outboxId: outbox.insertId.toString(), replayed: false };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 동일 미니펫 N개·당근 수수료·매물을 60초 확인 뒤 원자적으로 예약합니다.
export class FreeMarketMiniPetRegisterService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<FreeMarketMiniPetRegisterResult> {
    const command = parseFreeMarketMiniPetRegisterCommand(input.message);
    if (command === undefined) return { status: "silent" };
    return this.database.withTransaction(async (transaction) => {
      const owner = (await transaction.query<OwnerRow[]>(`SELECT identity.id identity_id,identity.player_id,profile.current_display_name,profile.tier_code,rank.rank_emoji
        FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
        JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.player_id LIMIT 1 FOR UPDATE`, [input.externalUserId]))[0];
      if (owner === undefined) return { status: "silent" };
      const key = eventKey(input.eventId);
      const prior = (await transaction.query<Array<{ result_json: string | FreeMarketMiniPetRegisterResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='market.mini_pet.register' AND idempotency_key=? FOR UPDATE", [key]))[0];
      if (prior?.result_json != null) {
        const saved = typeof prior.result_json === "string" ? JSON.parse(prior.result_json) as FreeMarketMiniPetRegisterResult : prior.result_json;
        return { ...saved, replayed: true };
      }
      if (prior !== undefined) throw new ApplicationError("MARKET_MINIPET_REGISTER_IN_PROGRESS", "미니펫 거래등록을 처리 중입니다.", 409);
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'market.mini_pet.register',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), key, owner.identity_id]);
      const reject = (resultCode: string, data: string, summary: Record<string, unknown>) => complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, owner, resultCode, actionCode: "market.mini_pet.register.reject", data, result: { status: "rejected" }, summary });

      const eligible = (await transaction.query<Array<{ allowed: bigint }>>("SELECT COUNT(*) allowed FROM market_registration_tier_policies WHERE tier_code=? AND can_register=TRUE", [owner.tier_code]))[0]?.allowed ?? 0n;
      if (eligible === 0n) return reject("tier_required", `❌ [${owner.rank_emoji ?? ""}${owner.current_display_name}]님 거래등록은 티어 "킹" 이상만 가능합니다.`, { mutation: false, tierCode: owner.tier_code });
      const benefits = (await transaction.query<Array<{ ticket: bigint; merchant: bigint }>>(`SELECT ${FREE_MARKET_MEMBERSHIP_EXISTS_SQL} ticket,EXISTS(SELECT 1 FROM player_pets pet JOIN pet_skills owned ON owned.player_pet_id=pet.id JOIN skill_definitions skill ON skill.id=owned.skill_id WHERE pet.player_id=? AND skill.display_name='타고난 장사꾼') merchant`, [owner.player_id, owner.player_id]))[0];
      const limit = 1n + ((benefits?.ticket ?? 0n) > 0n ? 7n : 0n) + ((benefits?.merchant ?? 0n) > 0n ? 2n : 0n);
      const active = (await transaction.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM market_listings WHERE seller_player_id=? AND status='open' AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3))", [owner.player_id]))[0]?.count_value ?? 0n;
      if (active + 1n > limit) return reject("listing_limit", `❌ 자유시장 등록 가능 건수를 초과했습니다.\n현재: ${active}/${limit}건\n요청: +1건`, { mutation: false, active: active.toString(), limit: limit.toString() });

      const bag = await transaction.query<MiniPetRow[]>(`SELECT owned.id,owned.mini_pet_definition_id,definition.display_name,definition.emoji_value,owned.custom_name,owned.custom_emoji,
        owned.enhancement_level,owned.battle_experience,owned.castle_experience,owned.raid_experience,owned.is_elite,owned.bag_sequence,owned.version
        FROM owned_mini_pets owned JOIN mini_pet_definitions definition ON definition.id=owned.mini_pet_definition_id AND definition.active=TRUE
        LEFT JOIN market_mini_pet_reservations reservation ON reservation.owned_mini_pet_id=owned.id
        WHERE owned.player_id=? AND owned.equipped=FALSE AND reservation.owned_mini_pet_id IS NULL
        ORDER BY CASE WHEN owned.bag_sequence IS NULL THEN 1 ELSE 0 END,owned.bag_sequence,owned.id FOR UPDATE`, [owner.player_id]);
      const target = command.sourceIndex > BigInt(bag.length) ? undefined : bag[Number(command.sourceIndex - 1n)];
      if (target === undefined) return reject("mini_pet_not_found", "해당 미니펫가방 번호의 미니펫이 존재하지 않습니다.", { mutation: false, sourceIndex: command.sourceIndex.toString() });
      const matching = bag.filter((candidate) => candidate.mini_pet_definition_id === target.mini_pet_definition_id
        && candidate.custom_name === target.custom_name && candidate.custom_emoji === target.custom_emoji
        && candidate.enhancement_level === target.enhancement_level && candidate.battle_experience === target.battle_experience
        && candidate.castle_experience === target.castle_experience && candidate.raid_experience === target.raid_experience
        && candidate.is_elite === target.is_elite).slice(0, Number(command.quantity));
      if (BigInt(matching.length) < command.quantity) return reject("insufficient_mini_pet", "거래 등록할 동일 미니펫 수량이 부족합니다.", { mutation: false, requested: command.quantity.toString(), available: String(matching.length) });
      const fee = FEE_PER_PET * command.quantity;
      const carrot = (await transaction.query<Array<{ item_id: bigint; quantity: bigint; version: bigint }>>("SELECT stack.item_id,stack.quantity,stack.version FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id AND item.active=TRUE WHERE stack.player_id=? AND item.code='ITEM-RWD-044' ORDER BY item.id LIMIT 1 FOR UPDATE", [owner.player_id]))[0];
      if (carrot === undefined || carrot.quantity < fee) return reject("insufficient_carrot", `미니펫 거래 등록 수수료 당근🥕 ${commas(fee)}개가 부족합니다.`, { mutation: false, requiredCarrot: fee.toString() });
      const ids = matching.map((pet) => pet.id.toString());
      const versions = matching.map((pet) => pet.version.toString());
      const pending = (await transaction.query<ConfirmationRow[]>(`SELECT command_text,source_index,quantity,mini_pet_definition_id,custom_name,custom_emoji,enhancement_level,battle_experience,castle_experience,raid_experience,is_elite,owned_ids_json,owned_versions_json,CAST(price_amount AS CHAR) price_amount,carrot_item_id,carrot_fee FROM market_mini_pet_registration_confirmations WHERE player_id=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE`, [owner.player_id]))[0];
      const same = pending !== undefined && pending.command_text === input.message && pending.source_index === command.sourceIndex && pending.quantity === command.quantity
        && pending.mini_pet_definition_id === target.mini_pet_definition_id && pending.custom_name === target.custom_name && pending.custom_emoji === target.custom_emoji
        && pending.enhancement_level === target.enhancement_level && pending.battle_experience === target.battle_experience && pending.castle_experience === target.castle_experience
        && pending.raid_experience === target.raid_experience && pending.is_elite === target.is_elite && JSON.stringify(jsonArray(pending.owned_ids_json)) === JSON.stringify(ids)
        && JSON.stringify(jsonArray(pending.owned_versions_json)) === JSON.stringify(versions) && whole(pending.price_amount) === command.price
        && pending.carrot_item_id === carrot.item_id && pending.carrot_fee === fee;
      const displayName = target.custom_name ?? target.display_name;
      const emoji = target.custom_emoji ?? target.emoji_value ?? "";
      if (!same) {
        await transaction.execute(`INSERT INTO market_mini_pet_registration_confirmations(player_id,command_text,source_index,quantity,mini_pet_definition_id,custom_name,custom_emoji,enhancement_level,battle_experience,castle_experience,raid_experience,is_elite,owned_ids_json,owned_versions_json,price_amount,carrot_item_id,carrot_fee,expires_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE command_text=VALUES(command_text),source_index=VALUES(source_index),quantity=VALUES(quantity),mini_pet_definition_id=VALUES(mini_pet_definition_id),custom_name=VALUES(custom_name),custom_emoji=VALUES(custom_emoji),enhancement_level=VALUES(enhancement_level),battle_experience=VALUES(battle_experience),castle_experience=VALUES(castle_experience),raid_experience=VALUES(raid_experience),is_elite=VALUES(is_elite),owned_ids_json=VALUES(owned_ids_json),owned_versions_json=VALUES(owned_versions_json),price_amount=VALUES(price_amount),carrot_item_id=VALUES(carrot_item_id),carrot_fee=VALUES(carrot_fee),expires_at=VALUES(expires_at),updated_at=VALUES(updated_at)`, [owner.player_id, input.message, command.sourceIndex, command.quantity, target.mini_pet_definition_id, target.custom_name, target.custom_emoji, target.enhancement_level, target.battle_experience, target.castle_experience, target.raid_experience, target.is_elite, JSON.stringify(ids), JSON.stringify(versions), command.price.toString(), carrot.item_id, fee, CONFIRM_SECONDS]);
        const data = `[${owner.rank_emoji ?? ""}${owner.current_display_name}] 님\n🏪 자유시장 등록 확인\n━━━━━━━━━━━━\n[${emoji}${displayName}] ${command.quantity}개\n🅟${commas(command.price)}에 등록하시겠습니까?\n\n※ 등록 수수료 [당근🥕 ${commas(fee)}개]가 차감됩니다.\n※ 60초 안에 같은 명령어를 다시 입력하면 등록됩니다.`;
        return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, owner, resultCode: "confirmation_pending", actionCode: "market.mini_pet.register.confirm", data, result: { status: "pending", ownedMiniPetIds: ids }, summary: { mutation: false, sourceIndex: command.sourceIndex.toString(), ownedMiniPetIds: ids, versions, quantity: command.quantity.toString(), price: command.price.toString(), confirmationSeconds: CONFIRM_SECONDS } });
      }

      const carrotChanged = await transaction.execute("UPDATE inventory_stacks SET quantity=quantity-?,version=version+1 WHERE player_id=? AND item_id=? AND quantity>=? AND version=?", [fee, owner.player_id, carrot.item_id, fee, carrot.version]);
      if (carrotChanged.affectedRows !== 1n) throw new ApplicationError("MARKET_MINIPET_INVENTORY_CONFLICT", "당근 가방이 먼저 변경되었습니다.", 409);
      await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'FREE_MARKET_MINIPET_REGISTER_FEE')", [operation.insertId, owner.player_id, carrot.item_id, -fee]);
      const expiresAt = new Date(Date.now() + LISTING_DAYS * 86_400_000);
      const listing = await transaction.execute("INSERT INTO market_listings(seller_player_id,asset_type_code,item_id,inventory_instance_id,quantity,price_currency_code,price_amount,expires_at) VALUES (?,'mini_pet',NULL,NULL,?,'point',?,?)", [owner.player_id, command.quantity, command.price.toString(), expiresAt]);
      await transaction.execute("INSERT INTO market_asset_reservations(listing_id,reservation_key,reserved_at,expires_at) VALUES (?,UUID(),UTC_TIMESTAMP(3),?)", [listing.insertId, expiresAt]);
      await reserveMiniPetEscrow(transaction, { listingId: listing.insertId, playerId: owner.player_id, assets: matching.map((pet) => ({ ownedMiniPetId: pet.id, version: pet.version })) });
      await transaction.execute("INSERT INTO market_listing_registration_fees(listing_id,carrot_item_id,carrot_fee,source_code) VALUES (?,?,?,'mini_pet_register')", [listing.insertId, carrot.item_id, fee]);
      await transaction.execute("INSERT INTO market_events(listing_id,operation_id,event_code,detail_json) VALUES (?,?,'created',?)", [listing.insertId, operation.insertId, JSON.stringify({ assetType: "mini_pet", sourceIndex: command.sourceIndex.toString(), ownedMiniPetIds: ids, quantity: command.quantity.toString(), carrotFee: fee.toString() })]);
      await transaction.execute(`INSERT INTO market_mini_pet_registration_ledger(operation_id,listing_id,player_id,mini_pet_definition_id,source_index,quantity,price_amount,carrot_item_id,carrot_fee,owned_ids_json,owned_versions_json,carrot_version_before,carrot_version_after) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [operation.insertId, listing.insertId, owner.player_id, target.mini_pet_definition_id, command.sourceIndex, command.quantity, command.price.toString(), carrot.item_id, fee, JSON.stringify(ids), JSON.stringify(versions), carrot.version, carrot.version + 1n]);
      await transaction.execute("DELETE FROM market_mini_pet_registration_confirmations WHERE player_id=?", [owner.player_id]);
      const tradeFee = (benefits?.ticket ?? 0n) > 0n ? 5 : 10;
      const data = `[${owner.rank_emoji ?? ""}${owner.current_display_name}] 님\n🏪 자유시장 등록 완료\n━━━━━━━━━━━━\n[${emoji}${displayName}] ${command.quantity}개\n🅟${commas(command.price)}에 등록되었습니다.\n\n※ 등록 수수료 [당근🥕 ${commas(fee)}개]가 차감되었습니다.\n※ 거래수수료는 판매자에게 ${tradeFee}% 부담됩니다.`;
      return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, owner, resultCode: "registered", actionCode: "market.mini_pet.register", data, result: { status: "registered", listingId: listing.insertId.toString(), ownedMiniPetIds: ids }, summary: { mutation: true, listingId: listing.insertId.toString(), sourceIndex: command.sourceIndex.toString(), ownedMiniPetIds: ids, versions, quantity: command.quantity.toString(), price: command.price.toString(), carrotFee: fee.toString() } });
    });
  }
}
