import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { parseSupportPremiumNoticeCommand } from "./support-premium-notice-command.js";

const COMMAND_CODE = "SUPPORT_PREMIUM_NOTICE_SEND";
const SCOPE = "support.premium_notice_send";
type Actor = { identity_id: bigint; player_id: bigint; rank_display: string };
type Policy = { policy_key: string; premium_pass_code: string; max_message_length: number; free_daily_count: number; item_daily_count: number; consume_item_id: bigint };
type Usage = { premium_count: number; item_count: number; version: bigint };
type Inventory = { quantity: bigint | null; version: bigint | null };
type Completion = { mode: "NONE" | "PREMIUM_FREE" | "ITEM"; premiumBefore?: number; premiumAfter?: number; itemBefore?: number; itemAfter?: number; itemId?: bigint; inventoryBefore?: bigint; inventoryAfter?: bigint; messageLength?: number };
export interface SupportPremiumNoticeReply { outboxId: string; room: string; data: string }
export interface SupportPremiumNoticeResult {
  status: "blocked" | "format" | "too_long" | "premium_required" | "insufficient" | "item_limit" | "success" | "silent";
  data?: string; outboxId?: string; replies?: SupportPremiumNoticeReply[]; replayed?: boolean;
  mode?: Completion["mode"]; premiumCountAfter?: number; itemCountAfter?: number; inventoryAfter?: string;
}

// 긴 event ID를 operation unique key 길이에 맞춥니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// 동시 중복 insert·deadlock을 재실행 가능한 경쟁으로 분류합니다.
function isRace(error: unknown): boolean {
  return typeof error === "object" && error !== null && (("errno" in error && (error.errno === 1062 || error.errno === 1213)) || ("code" in error && (error.code === "ER_DUP_ENTRY" || error.code === "ER_LOCK_DEADLOCK")));
}

// v2.400의 성공 방송 본문을 만듭니다.
export function formatSupportPremiumNoticeBroadcast(rankDisplay: string, message: string): string {
  return `[👑호이패스 프리미엄👑]\n[${rankDisplay}]\n[확성기📢]: ${message}`;
}

// 결과·실행·감사·outbox·operation 완료를 같은 transaction에 기록합니다.
async function complete(tx: DatabaseTransaction, input: { operationId: bigint; eventId: string; destinationId: string; actor: Actor; usageDate: string; resultCode: SupportPremiumNoticeResult["status"]; data: string; result: SupportPremiumNoticeResult; completion: Completion; summary: Record<string, unknown> }): Promise<SupportPremiumNoticeResult> {
  const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]);
  await tx.execute("INSERT INTO support_premium_notice_executions(operation_id,player_id,usage_date,usage_mode,result_code,premium_count_before,premium_count_after,item_count_before,item_count_after,consume_item_id,inventory_before,inventory_after,message_length,outbox_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [input.operationId, input.actor.player_id, input.usageDate, input.completion.mode, input.resultCode, input.completion.premiumBefore ?? null, input.completion.premiumAfter ?? null, input.completion.itemBefore ?? null, input.completion.itemAfter ?? null, input.completion.itemId ?? null, input.completion.inventoryBefore ?? null, input.completion.inventoryAfter ?? null, input.completion.messageLength ?? null, outbox.insertId]);
  await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, COMMAND_CODE, input.operationId, input.resultCode]);
  await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'support.premium_notice_send',?,'Iris 프리미엄 알림 전송',?,UTC_TIMESTAMP(3))", [input.operationId, input.actor.identity_id, input.actor.player_id, input.resultCode, JSON.stringify(input.summary)]);
  const reply = { outboxId: outbox.insertId.toString(), room: input.destinationId, data: input.data };
  const result: SupportPremiumNoticeResult = { ...input.result, data: input.data, outboxId: reply.outboxId, replies: [reply], replayed: false };
  await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 프리미엄 무료 횟수와 확성기 소비 후 방송을 원자 처리합니다.
export class SupportPremiumNoticeService {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string; broadcastDestinationId: string; message: string }): Promise<SupportPremiumNoticeResult> {
    const command = parseSupportPremiumNoticeCommand(input.message);
    if (command === null) return { status: "silent" };
    const actor = (await this.database.query<Actor[]>(`SELECT identity.id identity_id,player.id player_id,CONCAT(COALESCE(rank_profile.rank_emoji,''),profile.current_display_name) rank_display FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`, [input.externalUserId]))[0];
    if (actor === undefined) return { status: "silent" };
    const key = eventKey(input.eventId);
    try {
      return await this.database.withTransaction(async tx => {
        const prior = (await tx.query<Array<{ result_json: string | SupportPremiumNoticeResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [SCOPE, key]))[0];
        if (prior?.result_json != null) {
          const stored = typeof prior.result_json === "string" ? JSON.parse(prior.result_json) as SupportPremiumNoticeResult : prior.result_json;
          return { ...stored, replayed: true };
        }
        const operationId = (await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), SCOPE, key, actor.identity_id])).insertId;
        await tx.query("SELECT id FROM players WHERE id=? FOR UPDATE", [actor.player_id]);
        const policy = (await tx.query<Policy[]>(`SELECT policy.policy_key,policy.premium_pass_code,policy.max_message_length,policy.free_daily_count,policy.item_daily_count,item.id consume_item_id FROM support_premium_notice_policies policy JOIN item_definitions item ON item.code=policy.consume_item_code AND item.active=TRUE WHERE policy.enabled=TRUE AND policy.rollout_state='SHADOW' ORDER BY policy.version DESC LIMIT 1 FOR UPDATE`))[0];
        if (policy === undefined) throw new Error("프리미엄 알림 v2.400 DB 정책이 필요합니다.");
        const usageDate = String((await tx.query<Array<{ usage_date: string }>>("SELECT DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(3),'+00:00','+09:00'),'%Y-%m-%d') usage_date"))[0]!.usage_date);
        const war = (await tx.query<Array<{ active: number }>>("SELECT active FROM guild_territory_wars WHERE war_key='current' LIMIT 1 FOR UPDATE"))[0];
        if (war?.active === 1) return complete(tx, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, usageDate, resultCode: "blocked", data: "🏰 길드 영지전 진행 중에는 /알림을 사용할 수 없습니다.\n영지전 종료 후 다시 이용해 주세요.", result: { status: "blocked", mode: "NONE" }, completion: { mode: "NONE" }, summary: { mutation: false, sourceContract: "v2.400", reason: "territory_war_active" } });
        if (command.message === null) return complete(tx, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, usageDate, resultCode: "format", data: "잘못된 명령어 형식입니다. 사용법: /알림 {메시지}", result: { status: "format", mode: "NONE" }, completion: { mode: "NONE" }, summary: { mutation: false, sourceContract: "v2.400", reason: "message_required" } });
        if (command.message.length > Number(policy.max_message_length)) return complete(tx, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, usageDate, resultCode: "too_long", data: `[${actor.rank_display}] 님\n❌ 알림 내용은 최대 ${policy.max_message_length}글자까지 입력할 수 있습니다.`, result: { status: "too_long", mode: "NONE" }, completion: { mode: "NONE", messageLength: command.message.length }, summary: { mutation: false, sourceContract: "v2.400", messageLength: command.message.length } });
        const pass = (await tx.query<Array<{ active: number }>>("SELECT (enabled=TRUE AND (permanent=TRUE OR ends_at IS NULL OR ends_at>=UTC_TIMESTAMP(3))) active FROM player_passes WHERE player_id=? AND pass_code=? FOR UPDATE", [actor.player_id, policy.premium_pass_code]))[0];
        if (pass?.active !== 1) return complete(tx, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, usageDate, resultCode: "premium_required", data: `❌ [${actor.rank_display}] 님은 🐺호패프리미엄🐺 유저가 아닙니다.`, result: { status: "premium_required", mode: "NONE" }, completion: { mode: "NONE", messageLength: command.message.length }, summary: { mutation: false, sourceContract: "v2.400", reason: "premium_required" } });
        await tx.execute("INSERT INTO support_premium_notice_daily_usage(player_id,usage_date,premium_count,item_count,version) VALUES (?,?,0,0,1) ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)", [actor.player_id, usageDate]);
        const usage = (await tx.query<Usage[]>("SELECT premium_count,item_count,version FROM support_premium_notice_daily_usage WHERE player_id=? AND usage_date=? FOR UPDATE", [actor.player_id, usageDate]))[0]!;
        const useFree = usage.premium_count < Number(policy.free_daily_count);
        let inventory: Inventory = { quantity: null, version: null };
        if (!useFree) {
          inventory = (await tx.query<Inventory[]>("SELECT stack.quantity,stack.version FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=? WHERE item.id=? FOR UPDATE", [actor.player_id, policy.consume_item_id]))[0] ?? inventory;
          const held = inventory.quantity ?? 0n;
          if (held < 1n) return complete(tx, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, usageDate, resultCode: "insufficient", data: `[${actor.rank_display}] 님\n❌ 오늘의 👑호이패스 프리미엄 무료 알림\n${policy.free_daily_count}회를 모두 사용했습니다.`, result: { status: "insufficient", mode: "NONE", premiumCountAfter: usage.premium_count, itemCountAfter: usage.item_count, inventoryAfter: held.toString() }, completion: { mode: "NONE", premiumBefore: usage.premium_count, premiumAfter: usage.premium_count, itemBefore: usage.item_count, itemAfter: usage.item_count, itemId: policy.consume_item_id, inventoryBefore: held, inventoryAfter: held, messageLength: command.message.length }, summary: { mutation: false, sourceContract: "v2.400", reason: "speaker_required" } });
          if (usage.item_count >= Number(policy.item_daily_count)) return complete(tx, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, usageDate, resultCode: "item_limit", data: `❌ [${actor.rank_display}] 님 오늘은 이미 공지 아이템을 사용하셨습니다.`, result: { status: "item_limit", mode: "NONE", premiumCountAfter: usage.premium_count, itemCountAfter: usage.item_count, inventoryAfter: held.toString() }, completion: { mode: "NONE", premiumBefore: usage.premium_count, premiumAfter: usage.premium_count, itemBefore: usage.item_count, itemAfter: usage.item_count, itemId: policy.consume_item_id, inventoryBefore: held, inventoryAfter: held, messageLength: command.message.length }, summary: { mutation: false, sourceContract: "v2.400", reason: "speaker_daily_limit" } });
        }
        const premiumAfter = usage.premium_count + (useFree ? 1 : 0);
        const itemAfter = usage.item_count + (useFree ? 0 : 1);
        const usageChanged = await tx.execute("UPDATE support_premium_notice_daily_usage SET premium_count=?,item_count=?,version=version+1 WHERE player_id=? AND usage_date=? AND version=?", [premiumAfter, itemAfter, actor.player_id, usageDate, usage.version]);
        if (usageChanged.affectedRows !== 1n) throw new Error("프리미엄 알림 횟수가 먼저 변경되었습니다.");
        let inventoryAfter = inventory.quantity ?? 0n;
        if (!useFree) {
          inventoryAfter -= 1n;
          const changed = await tx.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [inventoryAfter, actor.player_id, policy.consume_item_id, inventory.version]);
          if (changed.affectedRows !== 1n) throw new Error("확성기 재고가 먼저 변경되었습니다.");
          await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?, -1,'SUPPORT_PREMIUM_NOTICE_SEND')", [operationId, actor.player_id, policy.consume_item_id]);
        }
        const mode: Completion["mode"] = useFree ? "PREMIUM_FREE" : "ITEM";
        const data = formatSupportPremiumNoticeBroadcast(actor.rank_display, command.message);
        return complete(tx, { operationId, eventId: input.eventId, destinationId: input.broadcastDestinationId, actor, usageDate, resultCode: "success", data, result: { status: "success", mode, premiumCountAfter: premiumAfter, itemCountAfter: itemAfter, inventoryAfter: inventoryAfter.toString() }, completion: { mode, premiumBefore: usage.premium_count, premiumAfter, itemBefore: usage.item_count, itemAfter, itemId: useFree ? undefined : policy.consume_item_id, inventoryBefore: useFree ? undefined : inventory.quantity ?? 0n, inventoryAfter: useFree ? undefined : inventoryAfter, messageLength: command.message.length }, summary: { mutation: true, sourceContract: "v2.400", policy: policy.policy_key, mode, usageDate, messageLength: command.message.length } });
      });
    } catch (error) {
      if (!isRace(error)) throw error;
      for (let attempt = 0; attempt < 10; attempt++) {
        const prior = (await this.database.query<Array<{ result_json: string | SupportPremiumNoticeResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [SCOPE, key]))[0];
        if (prior?.result_json != null) {
          const stored = typeof prior.result_json === "string" ? JSON.parse(prior.result_json) as SupportPremiumNoticeResult : prior.result_json;
          return { ...stored, replayed: true };
        }
        await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
      }
      throw error;
    }
  }
}
