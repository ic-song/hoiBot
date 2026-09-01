import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { hasFreeMarketMembership } from "./free-market-membership.js";
import { releaseMiniPetEscrow } from "./market-mini-pet-bulk-escrow.js";

const ALIAS = "/자유시장취소 [번호]";
const MAX_UINT64 = 18_446_744_073_709_551_615n;

interface Actor { identity_id: bigint; player_id: bigint; display_name: string; rank_emoji: string | null }
export interface FreeMarketCancellationListing { id: bigint; seller_player_id: bigint; asset_type_code: string; item_id: bigint | null; inventory_instance_id: bigint | null; quantity: bigint; status: string; version: bigint }
interface Fee { carrot_item_id: bigint; carrot_fee: bigint }
export interface FreeMarketCancelResult { status: "cancelled" | "not_found" | "not_owner" | "silent"; data?: string; listingId?: string; listingVersion?: string; refundedCarrot?: string; outboxId?: string; replayed?: boolean }

// 양의 uint64 표시번호 하나만 허용합니다.
export function parseFreeMarketCancelCommand(message: string | undefined): bigint | undefined {
  const match = /^\/자유시장취소\s+([1-9]\d*)$/.exec(message ?? "");
  if (match === null) return undefined;
  const displayNo = BigInt(match[1]!);
  return displayNo <= MAX_UINT64 ? displayNo : undefined;
}

// 완전한 취소 명령만 partial dispatch 후보로 허용합니다.
export function isFreeMarketCancelCandidate(message: string | undefined): boolean { return parseFreeMarketCancelCommand(message) !== undefined; }
// 표시번호를 DB 대표 alias로 정규화합니다.
export function normalizeFreeMarketCancelDispatchMessage(message: string): string { return isFreeMarketCancelCandidate(message) ? ALIAS : message; }
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

// 응답·실행·감사·outbox를 같은 transaction에서 완료합니다.
async function complete(t: DatabaseTransaction, input: { operationId: bigint; eventId: string; destinationId: string; actor: Actor; resultCode: string; actionCode: string; targetId: bigint; data: string; result: FreeMarketCancelResult; summary: Record<string, unknown> }): Promise<FreeMarketCancelResult> {
  const outbox = await t.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]);
  await t.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'MARKET_FREE_MARKET_CANCEL',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, input.operationId, input.resultCode]);
  await t.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'market_listing',?,?,?,'Iris /자유시장취소',?,UTC_TIMESTAMP(3))", [input.operationId, input.actor.identity_id, input.targetId, input.actionCode, input.resultCode, JSON.stringify(input.summary)]);
  const result = { ...input.result, data: input.data, outboxId: outbox.insertId.toString(), replayed: false };
  await t.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 표시번호를 stable listing으로 고정한 뒤 자산 반환·조건부 당근 환불·매물 종료를 원자 처리합니다.
export class FreeMarketCancelService {
  constructor(private readonly db: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<FreeMarketCancelResult | null> {
    const displayNo = parseFreeMarketCancelCommand(input.message);
    if (displayNo === undefined) return null;
    return this.db.withTransaction(async (t) => {
      const actor = (await t.query<Actor[]>(`SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name,rank.rank_emoji
        FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
        JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.player_id LIMIT 1 FOR UPDATE`, [input.externalUserId]))[0];
      if (actor === undefined) return null;
      const key = eventKey(input.eventId);
      const prior = (await t.query<Array<{ result_json: string | FreeMarketCancelResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='market.free_market.cancel' AND idempotency_key=? FOR UPDATE", [key]))[0];
      if (prior?.result_json != null) {
        const stored = typeof prior.result_json === "string" ? JSON.parse(prior.result_json) as FreeMarketCancelResult : prior.result_json;
        return { ...stored, replayed: true };
      }
      if (prior !== undefined) throw new ApplicationError("FREE_MARKET_CANCEL_IN_PROGRESS", "자유시장 취소 작업이 처리 중입니다.", 409);
      const operation = await t.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'market.free_market.cancel',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), key, actor.identity_id]);
      const reject = (status: "not_found" | "not_owner", data: string, targetId = actor.player_id) => complete(t, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor, resultCode: status, actionCode: "market.free_market.cancel.reject", targetId, data, result: { status }, summary: { mutation: false, displayNo: displayNo.toString() } });
      const ids = await t.query<Array<{ id: bigint }>>("SELECT id FROM market_listings WHERE status='open' AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3)) ORDER BY created_at DESC,id DESC");
      if (displayNo > BigInt(ids.length)) return reject("not_found", "❌ 취소할 자유시장 매물을 찾을 수 없습니다.");
      const listingId = ids[Number(displayNo - 1n)]!.id;
      const listing = (await t.query<FreeMarketCancellationListing[]>("SELECT id,seller_player_id,asset_type_code,item_id,inventory_instance_id,quantity,status,version FROM market_listings WHERE id=? FOR UPDATE", [listingId]))[0];
      if (listing === undefined || listing.status !== "open") return reject("not_found", "❌ 취소할 자유시장 매물을 찾을 수 없습니다.", listingId);
      if (listing.seller_player_id !== actor.player_id) return reject("not_owner", "❌ 본인이 등록한 자유시장 매물만 취소할 수 있습니다.", listingId);
      await this.restoreAsset(t, operation.insertId, listing);
      const fee = (await t.query<Fee[]>("SELECT carrot_item_id,carrot_fee FROM market_listing_registration_fees WHERE listing_id=?", [listing.id]))[0];
      const hasPass = await hasFreeMarketMembership(t, actor.player_id);
      let refunded = 0n;
      if (hasPass && fee !== undefined && fee.carrot_fee > 0n) {
        await t.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,0)", [actor.player_id, fee.carrot_item_id]);
        const stack = (await t.query<Array<{ version: bigint }>>("SELECT version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [actor.player_id, fee.carrot_item_id]))[0]!;
        await t.execute("UPDATE inventory_stacks SET quantity=quantity+?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [fee.carrot_fee, actor.player_id, fee.carrot_item_id, stack.version]);
        await t.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,9000,?,?,?,'FREE_MARKET_CANCEL_FEE_REFUND')", [operation.insertId, actor.player_id, fee.carrot_item_id, fee.carrot_fee]);
        refunded = fee.carrot_fee;
      }
      const nextVersion = listing.version + 1n;
      const changed = await t.execute("UPDATE market_listings SET status='cancelled',version=?,closed_at=UTC_TIMESTAMP(3) WHERE id=? AND status='open' AND version=?", [nextVersion, listing.id, listing.version]);
      if (changed.affectedRows !== 1n) throw new ApplicationError("FREE_MARKET_CANCEL_CONFLICT", "자유시장 매물이 먼저 변경되었습니다.", 409);
      await t.execute("DELETE FROM market_asset_reservations WHERE listing_id=?", [listing.id]);
      await t.execute("INSERT INTO market_events(listing_id,operation_id,event_code,detail_json) VALUES (?,?,'cancelled',?)", [listing.id, operation.insertId, JSON.stringify({ assetType: listing.asset_type_code, refundedCarrot: refunded.toString() })]);
      await t.execute("INSERT INTO market_listing_cancellations(operation_id,listing_id,seller_player_id,asset_type_code,asset_quantity,refunded_carrot_item_id,refunded_carrot_quantity,listing_version_before,listing_version_after) VALUES (?,?,?,?,?,?,?,?,?)", [operation.insertId, listing.id, actor.player_id, listing.asset_type_code, listing.quantity, refunded > 0n ? fee!.carrot_item_id : null, refunded, listing.version, nextVersion]);
      const data = `[${actor.rank_emoji ?? ""}${actor.display_name}] 님\n✅ 자유시장 등록 취소 완료\n※ 등록 상품이 가방으로 반환되었습니다.${refunded > 0n ? `\n※ 등록 수수료 당근🥕 ${commas(refunded)}개가 환불되었습니다.` : ""}`;
      return complete(t, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor, resultCode: "cancelled", actionCode: "market.free_market.cancel", targetId: listing.id, data, result: { status: "cancelled", listingId: listing.id.toString(), listingVersion: nextVersion.toString(), refundedCarrot: refunded.toString() }, summary: { displayNo: displayNo.toString(), listingId: listing.id.toString(), assetType: listing.asset_type_code, quantity: listing.quantity.toString(), refundedCarrot: refunded.toString() } });
    });
  }

  async restoreAsset(t: DatabaseTransaction, operationId: bigint, listing: FreeMarketCancellationListing): Promise<void> {
    if (listing.asset_type_code === "stack" || listing.asset_type_code === "bag") {
      if (listing.item_id === null) throw new ApplicationError("FREE_MARKET_ASSET_MISSING", "반환할 가방 아이템 정보가 없습니다.", 409);
      await t.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,0)", [listing.seller_player_id, listing.item_id]);
      const stack = (await t.query<Array<{ version: bigint }>>("SELECT version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [listing.seller_player_id, listing.item_id]))[0]!;
      await t.execute("UPDATE inventory_stacks SET quantity=quantity+?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [listing.quantity, listing.seller_player_id, listing.item_id, stack.version]);
      await t.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'FREE_MARKET_CANCEL_RETURN')", [operationId, listing.seller_player_id, listing.item_id, listing.quantity]);
      return;
    }
    if (listing.asset_type_code === "instance" || listing.asset_type_code === "pendant") {
      if (listing.inventory_instance_id === null) throw new ApplicationError("FREE_MARKET_ASSET_MISSING", "반환할 인스턴스 정보가 없습니다.", 409);
      const changed = await t.execute("UPDATE inventory_instances SET status='owned',version=version+1 WHERE id=? AND player_id=? AND status='reserved'", [listing.inventory_instance_id, listing.seller_player_id]);
      if (changed.affectedRows !== 1n) throw new ApplicationError("FREE_MARKET_ASSET_CONFLICT", "판매 자산이 먼저 변경되었습니다.", 409);
      return;
    }
    if (listing.asset_type_code === "pet_skill" || listing.asset_type_code === "skill") {
      const source = (await t.query<Array<{ player_pet_id: bigint; skill_id: bigint; quantity: bigint }>>("SELECT player_pet_id,skill_id,quantity FROM market_skill_registration_ledger WHERE listing_id=?", [listing.id]))[0];
      if (source === undefined) throw new ApplicationError("FREE_MARKET_ASSET_MISSING", "반환할 펫스킬 정보가 없습니다.", 409);
      await t.execute("INSERT IGNORE INTO pet_skill_inventory(player_pet_id,skill_id,quantity,version) VALUES (?,?,0,0)", [source.player_pet_id, source.skill_id]);
      const inventory = (await t.query<Array<{ version: bigint }>>("SELECT version FROM pet_skill_inventory WHERE player_pet_id=? AND skill_id=? FOR UPDATE", [source.player_pet_id, source.skill_id]))[0]!;
      await t.execute("UPDATE pet_skill_inventory SET quantity=quantity+?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_pet_id=? AND skill_id=? AND version=?", [source.quantity, source.player_pet_id, source.skill_id, inventory.version]);
      await t.execute("INSERT INTO pet_skill_inventory_ledger(operation_id,sequence_no,player_id,player_pet_id,skill_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,?, 'FREE_MARKET_CANCEL_RETURN')", [operationId, listing.seller_player_id, source.player_pet_id, source.skill_id, source.quantity]);
      return;
    }
    if (listing.asset_type_code === "furniture") {
      const items = await t.query<Array<{ id: bigint; version: bigint }>>(`SELECT instance.id,instance.version FROM market_furniture_registration_ledger ledger
        JOIN market_furniture_registration_items item ON item.operation_id=ledger.operation_id
        JOIN furniture_inventory_instances instance ON instance.id=item.furniture_instance_id
        WHERE ledger.listing_id=? AND instance.player_id=? ORDER BY item.sequence_no FOR UPDATE`, [listing.id, listing.seller_player_id]);
      if (BigInt(items.length) !== listing.quantity) throw new ApplicationError("FREE_MARKET_ASSET_MISSING", "반환할 가구 정보가 일치하지 않습니다.", 409);
      for (let index = 0; index < items.length; index++) {
        const item = items[index]!;
        const changed = await t.execute("UPDATE furniture_inventory_instances SET status='bag',version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND player_id=? AND status='listed' AND version=?", [item.id, listing.seller_player_id, item.version]);
        if (changed.affectedRows !== 1n) throw new ApplicationError("FREE_MARKET_ASSET_CONFLICT", "판매 가구가 먼저 변경되었습니다.", 409);
        await t.execute("INSERT INTO furniture_inventory_ledger(operation_id,sequence_no,player_id,furniture_instance_id,status_before,status_after,reason_code) VALUES (?,?,?,?,'listed','bag','FREE_MARKET_CANCEL_RETURN')", [operationId, index + 1, listing.seller_player_id, item.id]);
      }
      return;
    }
    if (listing.asset_type_code === "mini_pet" || listing.asset_type_code === "miniPet") {
      await releaseMiniPetEscrow(t, { listingId: listing.id, playerId: listing.seller_player_id, quantity: listing.quantity });
      return;
    }
    throw new ApplicationError("FREE_MARKET_ASSET_UNSUPPORTED", "지원하지 않는 자유시장 자산 유형입니다.", 409);
  }
}
