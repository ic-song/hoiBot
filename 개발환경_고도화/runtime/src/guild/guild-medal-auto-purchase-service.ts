import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const ITEM_CODE = "guild_contribution_medal";
const COUNTER_CODE = "guild_contribution_medal_purchase_count";

type Numeric = bigint | number | string;
interface ActorRow { identity_id: bigint; player_id: bigint; display_name: string; }
interface ProductRow { guild_shop_item_id: bigint; item_id: bigint | null; display_name: string; price: string; daily_limit: number | null; }

export interface GuildMedalAutoPurchaseResult {
  status: "purchased" | "catalog_unavailable" | "limit_reached" | "insufficient_point";
  playerId: string;
  basePrice: string;
  tax: string;
  totalPrice: string;
  pointBefore: string;
  pointAfter: string;
  purchaseCountBefore: string;
  purchaseCountAfter: string;
  itemBefore: string;
  itemAfter: string;
  data: string;
  outboxId?: string;
  replayed: boolean;
}

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function integer(value: Numeric): bigint { return BigInt(String(value).split(".")[0]!); }
function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function stored(value: string | GuildMedalAutoPurchaseResult): GuildMedalAutoPurchaseResult { return typeof value === "string" ? JSON.parse(value) as GuildMedalAutoPurchaseResult : value; }
export function calculateGuildShopTax(basePrice: bigint, taxRateBasisPoints: number): bigint { return (basePrice * BigInt(taxRateBasisPoints) + 5_000n) / 10_000n; }

// 길드상점 카탈로그·일일 제한·캐슬 세율을 읽어 공헌훈장 1개를 자동 구매합니다.
export class GuildMedalAutoPurchaseService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { externalUserId: string; channelId: string; eventId: string; suppressOutbox?: boolean }): Promise<GuildMedalAutoPurchaseResult | null> {
    return this.database.withTransaction(async transaction => {
      const actor = (await transaction.query<ActorRow[]>(
        "SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE",
        [input.externalUserId]
      ))[0];
      if (actor === undefined) return null;
      const key = eventKey(input.eventId), scope = `guild.medal.auto-purchase:${actor.identity_id}`;
      const prior = (await transaction.query<Array<{ result_json: string | GuildMedalAutoPurchaseResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]
      ))[0];
      if (prior?.result_json != null) return { ...stored(prior.result_json), replayed: true };
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, actor.identity_id]
      );
      const product = (await transaction.query<ProductRow[]>(
        "SELECT shop.id guild_shop_item_id,shop.item_id,shop.display_name,CAST(shop.price AS CHAR) price,shop.daily_limit FROM guild_shop_items shop LEFT JOIN item_definitions item ON item.id=shop.item_id WHERE shop.enabled=TRUE AND item.code=? ORDER BY shop.display_order,shop.id LIMIT 1 FOR UPDATE",
        [ITEM_CODE]
      ))[0];
      const date = (await transaction.query<Array<{ value: string }>>("SELECT DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d') value"))[0]!.value;
      let status: GuildMedalAutoPurchaseResult["status"] = "catalog_unavailable";
      let basePrice = 0n, tax = 0n, totalPrice = 0n, pointBefore = 0n, pointAfter = 0n, countBefore = 0n, countAfter = 0n, itemBefore = 0n, itemAfter = 0n;
      if (product !== undefined && product.item_id !== null) {
        basePrice = integer(product.price);
        await transaction.execute("INSERT INTO player_counters(player_id,counter_code,period_key,value,updated_at) VALUES (?,?,?,0,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)", [actor.player_id, COUNTER_CODE, date]);
        countBefore = BigInt((await transaction.query<Array<{ value: Numeric }>>("SELECT value FROM player_counters WHERE player_id=? AND counter_code=? AND period_key=? FOR UPDATE", [actor.player_id, COUNTER_CODE, date]))[0]!.value);
        countAfter = countBefore;
        const account = (await transaction.query<Array<{ balance: string; version: bigint }>>("SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE", [actor.player_id]))[0];
        pointBefore = account === undefined ? 0n : integer(account.balance); pointAfter = pointBefore;
        const stack = (await transaction.query<Array<{ quantity: Numeric; version: bigint }>>("SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [actor.player_id, product.item_id]))[0];
        itemBefore = stack === undefined ? 0n : BigInt(stack.quantity); itemAfter = itemBefore;
        const limit = BigInt(product.daily_limit ?? 1);
        if (countBefore >= limit) status = "limit_reached";
        else {
          const castle = (await transaction.query<Array<{ tax_rate_basis_points: number; earnings: string; version: bigint }>>("SELECT tax_rate_basis_points,CAST(earnings AS CHAR) earnings,version FROM castle_state WHERE state_code='HOI_CASTLE' FOR UPDATE"))[0];
          tax = calculateGuildShopTax(basePrice, castle?.tax_rate_basis_points ?? 0); totalPrice = basePrice + tax;
          if (pointBefore < totalPrice) status = "insufficient_point";
          else {
            status = "purchased"; pointAfter -= totalPrice; countAfter += 1n; itemAfter += 1n;
            if (account === undefined) await transaction.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',?,1)", [actor.player_id, pointAfter]);
            else {
              const write = await transaction.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?", [pointAfter, actor.player_id, account.version]);
              if (write.affectedRows !== 1n) throw new ApplicationError("GUILD_MEDAL_POINT_CONFLICT", "포인트 정보가 먼저 변경되었습니다.", 409);
            }
            if (stack === undefined) await transaction.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,1,1)", [actor.player_id, product.item_id]);
            else await transaction.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [itemAfter, actor.player_id, product.item_id, stack.version]);
            await transaction.execute("UPDATE player_counters SET value=?,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND counter_code=? AND period_key=? AND value=?", [countAfter, actor.player_id, COUNTER_CODE, date, countBefore]);
            if (castle !== undefined && tax > 0n) await transaction.execute("UPDATE castle_state SET earnings=earnings+?,version=version+1 WHERE state_code='HOI_CASTLE' AND version=?", [tax, castle.version]);
            await transaction.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?, 'guild_medal_auto_purchase')", [operation.insertId, actor.player_id, -totalPrice, pointAfter]);
            await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,1,'guild_medal_auto_purchase')", [operation.insertId, actor.player_id, product.item_id]);
          }
        }
      }
      const data = status === "purchased" && product !== undefined
        ? `✅ 길드공헌훈장🌟 자동 구매 완료\n상품 : ${product.display_name}\n수량 : 1개\n상품금액 🅟: ${commas(basePrice)}\n세금 : 🅟${commas(tax)}\n총 결제 : 🅟${commas(totalPrice)}` : "";
      const outbox = status === "purchased" && !input.suppressOutbox ? await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.channelId, JSON.stringify({ data })]) : undefined;
      const result: GuildMedalAutoPurchaseResult = { status, playerId: actor.player_id.toString(), basePrice: basePrice.toString(), tax: tax.toString(), totalPrice: totalPrice.toString(), pointBefore: pointBefore.toString(), pointAfter: pointAfter.toString(), purchaseCountBefore: countBefore.toString(), purchaseCountAfter: countAfter.toString(), itemBefore: itemBefore.toString(), itemAfter: itemAfter.toString(), data, ...(outbox === undefined ? {} : { outboxId: outbox.insertId.toString() }), replayed: false };
      await transaction.execute("INSERT INTO guild_medal_auto_purchase_runs(operation_id,player_id,guild_shop_item_id,record_date,status,base_price,tax,total_price,point_before,point_after,purchase_count_before,purchase_count_after,item_before,item_after) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [operation.insertId, actor.player_id, product?.guild_shop_item_id ?? null, date, status, basePrice, tax, totalPrice, pointBefore, pointAfter, countBefore, countAfter, itemBefore, itemAfter]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'GUILD_MEDAL_AUTO_PURCHASE',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, operation.insertId, status]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'guild.medal.auto_purchase',?,'v2.400 /정리 child',?,UTC_TIMESTAMP(3))", [operation.insertId, actor.identity_id, actor.player_id, status, JSON.stringify(result)]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
