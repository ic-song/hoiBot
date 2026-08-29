import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { FreeMarketCancelService, type FreeMarketCancellationListing } from "./free-market-cancel-service.js";

const ALIAS = "/거래소강제취소";
const COMMAND_CODE = "MARKET_TRADE_FORCE_CANCEL";
const SCOPE = "market.free_market.force_cancel";
const MAX_UINT64 = 18_446_744_073_709_551_615n;

interface Identity { identity_id: bigint; player_id: bigint }
interface Operator { operator_id: bigint }
interface Fee { carrot_item_id: bigint; carrot_fee: bigint }
interface ForceListing extends FreeMarketCancellationListing { seller_display_name: string }

export interface FreeMarketForceCancelResult {
  status: "forced_cancelled" | "not_found" | "forbidden";
  data: string;
  listingId?: string;
  listingVersion?: string;
  sellerPlayerId?: string;
  refundedCarrot?: string;
  outboxId: string;
  replayed: boolean;
}

// 양의 uint64 표시번호 하나만 허용합니다.
export function parseFreeMarketForceCancelCommand(message: string | undefined): bigint | undefined {
  const match = /^\/거래소강제취소\s+([1-9]\d*)$/.exec(message ?? "");
  if (match === null) return undefined;
  const displayNo = BigInt(match[1]!);
  return displayNo <= MAX_UINT64 ? displayNo : undefined;
}

// 완전한 관리자 강제취소 입력만 partial dispatch 후보로 허용합니다.
export function isFreeMarketForceCancelCandidate(message: string | undefined): boolean {
  return parseFreeMarketForceCancelCommand(message) !== undefined;
}

// 인자형 명령을 DB 대표 alias로 정규화합니다.
export function normalizeFreeMarketForceCancelDispatchMessage(message: string): string {
  return isFreeMarketForceCancelCandidate(message) ? ALIAS : message;
}

// 관리자 권한·판매자 자산 반환·회원권 수수료 환급·매물 종료를 원자 처리합니다.
export class FreeMarketForceCancelService {
  constructor(private readonly db: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<FreeMarketForceCancelResult | null> {
    const displayNo = parseFreeMarketForceCancelCommand(input.message);
    if (displayNo === undefined) return null;
    return this.db.withTransaction(async (t) => {
      const identity = (await t.query<Identity[]>(
        `SELECT identity.id identity_id,identity.player_id
           FROM external_identities identity
           JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
          WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
          ORDER BY identity.player_id LIMIT 1 FOR UPDATE`, [input.externalUserId]
      ))[0];
      if (identity === undefined) return null;

      const key = eventKey(input.eventId);
      const prior = (await t.query<Array<{ result_json: string | FreeMarketForceCancelResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [SCOPE, key]
      ))[0];
      if (prior?.result_json != null) return { ...stored(prior.result_json), replayed: true };
      if (prior !== undefined) throw new ApplicationError("FREE_MARKET_FORCE_CANCEL_IN_PROGRESS", "자유시장 강제취소 작업이 처리 중입니다.", 409);

      const operator = (await t.query<Operator[]>(
        `SELECT operator.id operator_id
           FROM admin_operator_external_identities mapping
           JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
           JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
           JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
           JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='market.free_market.force_cancel'
          WHERE mapping.external_identity_id=?
          ORDER BY operator.id LIMIT 1 FOR UPDATE`, [identity.identity_id]
      ))[0];
      const actorType = operator === undefined ? "external_identity" : "admin_operator";
      const actorId = operator?.operator_id ?? identity.identity_id;
      const operation = await t.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?, ?,?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), SCOPE, key, actorType, actorId]
      );
      if (operator === undefined) {
        return complete(t, {
          operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId,
          actorType, actorId, targetId: identity.player_id, resultCode: "forbidden", actionCode: `${SCOPE}.reject`,
          data: "❌ 자유시장 거래 강제취소 권한이 없습니다.", result: { status: "forbidden" },
          summary: { mutation: false, displayNo: displayNo.toString() }
        });
      }

      const ids = await t.query<Array<{ id: bigint }>>(
        "SELECT id FROM market_listings WHERE status='open' AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3)) ORDER BY created_at DESC,id DESC"
      );
      if (displayNo > BigInt(ids.length)) return this.rejectNotFound(t, operation.insertId, input, actorId, identity, displayNo);
      const listingId = ids[Number(displayNo - 1n)]!.id;
      const listing = (await t.query<ForceListing[]>(
        `SELECT listing.id,listing.seller_player_id,listing.asset_type_code,listing.item_id,listing.inventory_instance_id,
                listing.quantity,listing.status,listing.version,profile.current_display_name seller_display_name
           FROM market_listings listing JOIN player_profiles profile ON profile.player_id=listing.seller_player_id
          WHERE listing.id=? FOR UPDATE`, [listingId]
      ))[0];
      if (listing === undefined || listing.status !== "open") return this.rejectNotFound(t, operation.insertId, input, actorId, identity, displayNo, listingId);

      await new FreeMarketCancelService(this.db).restoreAsset(t, operation.insertId, listing);
      const fee = (await t.query<Fee[]>(
        "SELECT carrot_item_id,carrot_fee FROM market_listing_registration_fees WHERE listing_id=?", [listing.id]
      ))[0];
      const sellerHasPass = String((await t.query<Array<{ allowed: bigint | number }>>(
        "SELECT EXISTS(SELECT 1 FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND stack.quantity>0 AND item.display_name='자유시장회원권🏪') allowed",
        [listing.seller_player_id]
      ))[0]?.allowed ?? 0) === "1";
      let refunded = 0n;
      if (sellerHasPass && fee !== undefined && fee.carrot_fee > 0n) {
        await t.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,0)", [listing.seller_player_id, fee.carrot_item_id]);
        const stack = (await t.query<Array<{ version: bigint }>>(
          "SELECT version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [listing.seller_player_id, fee.carrot_item_id]
        ))[0]!;
        await t.execute(
          "UPDATE inventory_stacks SET quantity=quantity+?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",
          [fee.carrot_fee, listing.seller_player_id, fee.carrot_item_id, stack.version]
        );
        await t.execute(
          "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,9000,?,?,?,'FREE_MARKET_FORCE_CANCEL_FEE_REFUND')",
          [operation.insertId, listing.seller_player_id, fee.carrot_item_id, fee.carrot_fee]
        );
        refunded = fee.carrot_fee;
      }

      const nextVersion = listing.version + 1n;
      const changed = await t.execute(
        "UPDATE market_listings SET status='cancelled',version=?,closed_at=UTC_TIMESTAMP(3) WHERE id=? AND status='open' AND version=?",
        [nextVersion, listing.id, listing.version]
      );
      if (changed.affectedRows !== 1n) throw new ApplicationError("FREE_MARKET_FORCE_CANCEL_CONFLICT", "자유시장 매물이 먼저 변경되었습니다.", 409);
      await t.execute("DELETE FROM market_asset_reservations WHERE listing_id=?", [listing.id]);
      await t.execute(
        "INSERT INTO market_events(listing_id,operation_id,event_code,detail_json) VALUES (?,?,'force_cancelled',?)",
        [listing.id, operation.insertId, JSON.stringify({ assetType: listing.asset_type_code, sellerPlayerId: listing.seller_player_id.toString(), refundedCarrot: refunded.toString() })]
      );
      await t.execute(
        "INSERT INTO market_listing_cancellations(operation_id,listing_id,seller_player_id,asset_type_code,asset_quantity,refunded_carrot_item_id,refunded_carrot_quantity,listing_version_before,listing_version_after) VALUES (?,?,?,?,?,?,?,?,?)",
        [operation.insertId, listing.id, listing.seller_player_id, listing.asset_type_code, listing.quantity, refunded > 0n ? fee!.carrot_item_id : null, refunded, listing.version, nextVersion]
      );
      const data = `✅ 자유시장 거래 강제취소 완료\n※ ${listing.seller_display_name} 님의 등록 상품이 가방으로 반환되었습니다.${refunded > 0n ? `\n※ 등록 수수료 당근🥕 ${commas(refunded)}개가 판매자에게 환불되었습니다.` : ""}`;
      return complete(t, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId,
        actorType, actorId, targetId: listing.id, resultCode: "forced_cancelled", actionCode: SCOPE,
        data, result: { status: "forced_cancelled", listingId: listing.id.toString(), listingVersion: nextVersion.toString(), sellerPlayerId: listing.seller_player_id.toString(), refundedCarrot: refunded.toString() },
        summary: { displayNo: displayNo.toString(), listingId: listing.id.toString(), sellerPlayerId: listing.seller_player_id.toString(), assetType: listing.asset_type_code, quantity: listing.quantity.toString(), refundedCarrot: refunded.toString() }
      });
    });
  }

  private rejectNotFound(t: DatabaseTransaction, operationId: bigint, input: { eventId: string; destinationId: string }, actorId: bigint, identity: Identity, displayNo: bigint, targetId = identity.player_id): Promise<FreeMarketForceCancelResult> {
    return complete(t, {
      operationId, eventId: input.eventId, destinationId: input.destinationId, actorType: "admin_operator", actorId,
      targetId, resultCode: "not_found", actionCode: `${SCOPE}.reject`, data: "❌ 강제취소할 자유시장 매물을 찾을 수 없습니다.",
      result: { status: "not_found" }, summary: { mutation: false, displayNo: displayNo.toString() }
    });
  }
}

// 명령 결과·감사·outbox를 동일 transaction에 기록합니다.
async function complete(t: DatabaseTransaction, input: {
  operationId: bigint; eventId: string; destinationId: string; actorType: "external_identity" | "admin_operator"; actorId: bigint;
  targetId: bigint; resultCode: string; actionCode: string; data: string; result: Omit<FreeMarketForceCancelResult, "data" | "outboxId" | "replayed">; summary: Record<string, unknown>;
}): Promise<FreeMarketForceCancelResult> {
  const outbox = await t.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]
  );
  await t.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, COMMAND_CODE, input.operationId, input.resultCode]
  );
  await t.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,?,?,'market_listing',?,?,?,?,?,UTC_TIMESTAMP(3))",
    [input.operationId, input.actorType, input.actorId, input.targetId, input.actionCode, input.resultCode, "Iris /거래소강제취소", JSON.stringify(input.summary)]
  );
  const result = { ...input.result, data: input.data, outboxId: outbox.insertId.toString(), replayed: false } as FreeMarketForceCancelResult;
  await t.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | FreeMarketForceCancelResult): FreeMarketForceCancelResult { return typeof value === "string" ? JSON.parse(value) : value; }
function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
