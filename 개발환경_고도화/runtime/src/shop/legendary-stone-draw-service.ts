import { createHash, randomUUID } from "node:crypto";

import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { parseLegendaryStoneDrawCommand } from "./legendary-stone-draw-command.js";

const COMMAND_CODE = "LEGENDARY_STONE_DRAW";
const TICKET_CODE = "ITEM-LEGENDARY-STONE-DRAW-TICKET";
const TIER_TICKET_CODE = "ITEM-RWD-022";
const DIAMOND_BOX_CODE = "ITEM-RWD-053";
const SHOP_CODE = "ITEM-RWD-001";
const LEGENDARY_STONE_CODE = "ITEM-RWD-052";
const TICKET_NAME = "전설의돌 뽑기🩶[2](/전돌뽑기 숫자)";
const ALLSEE = "\u200b".repeat(500);

type Owner = { identity_id: bigint; player_id: bigint; display_name: string; rank_emoji: string | null };
type Item = { id: bigint; code: string };
type Stack = { item_id: bigint | null; code: string; quantity: bigint | string | null; version: bigint | string | null };

export interface LegendaryStoneDrawCounts {
  stone1: bigint;
  stone2: bigint;
  stone3: bigint;
  stone5: bigint;
  stone10: bigint;
  stone50: bigint;
  totalStone: bigint;
}

export interface LegendaryStoneDrawReply {
  outboxId: string;
  room: string;
  message: string;
}

export interface LegendaryStoneDrawResult {
  status: "applied" | "usage" | "limit" | "insufficient";
  replies: LegendaryStoneDrawReply[];
  replayed: boolean;
  useCount: string;
  remaining: string;
  counts: { stone1: string; stone2: string; stone3: string; stone5: string; stone10: string; stone50: string; totalStone: string };
}

function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | LegendaryStoneDrawResult): LegendaryStoneDrawResult { return typeof value === "string" ? JSON.parse(value) as LegendaryStoneDrawResult : value; }
function integral(value: bigint | string | null): bigint {
  if (value === null) return 0n;
  const text = String(value);
  if (!/^-?\d+(?:\.0+)?$/.test(text)) throw new Error("Expected an integral inventory value: " + text);
  return BigInt(text.split(".")[0]!);
}

// 매 추첨 확률 경계와 돌맹이 보상을 레거시 순서대로 계산합니다.
export function resolveLegendaryStoneDraw(samples: number[]): LegendaryStoneDrawCounts {
  const counts: LegendaryStoneDrawCounts = { stone1: 0n, stone2: 0n, stone3: 0n, stone5: 0n, stone10: 0n, stone50: 0n, totalStone: 0n };
  for (const sample of samples) {
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error("invalid legendary stone RNG sample");
    if (sample < 0.01) { counts.stone50 += 1n; counts.totalStone += 50n; }
    else if (sample < 0.03) { counts.stone10 += 1n; counts.totalStone += 10n; }
    else if (sample < 0.06) { counts.stone5 += 1n; counts.totalStone += 5n; }
    else if (sample < 0.11) { counts.stone3 += 1n; counts.totalStone += 3n; }
    else if (sample < 0.21) { counts.stone2 += 1n; counts.totalStone += 2n; }
    else { counts.stone1 += 1n; counts.totalStone += 1n; }
  }
  return counts;
}

function countResult(counts: LegendaryStoneDrawCounts): LegendaryStoneDrawResult["counts"] {
  return {
    stone1: counts.stone1.toString(), stone2: counts.stone2.toString(), stone3: counts.stone3.toString(),
    stone5: counts.stone5.toString(), stone10: counts.stone10.toString(), stone50: counts.stone50.toString(), totalStone: counts.totalStone.toString()
  };
}

// 레거시 결과·기본 보상·50개 당첨 공지 문구를 생성합니다.
export function buildLegendaryStoneDrawMessages(input: { displayName: string; rankEmoji: string | null; useCount: bigint; remaining: bigint; counts: LegendaryStoneDrawCounts }): { primary: string[]; notice?: string } {
  const rankName = `${input.rankEmoji ?? ""}${input.displayName}`;
  const resultLine: string[] = [];
  if (input.counts.stone1 > 0n) resultLine.push(`1개: ${input.counts.stone1}회`);
  if (input.counts.stone2 > 0n) resultLine.push(`2개: ${input.counts.stone2}회`);
  if (input.counts.stone3 > 0n) resultLine.push(`3개: ${input.counts.stone3}회`);
  if (input.counts.stone5 > 0n) resultLine.push(`5개: ${input.counts.stone5}회`);
  if (input.counts.stone10 > 0n) resultLine.push(`10개: ${input.counts.stone10}회`);
  if (input.counts.stone50 > 0n) resultLine.push(`50개: ${input.counts.stone50}회`);
  let result = `🩶 전설의돌 뽑기 결과 🩶\n[${rankName}] 님이 전설의돌 뽑기를 진행했습니다!\n사용 수량: ${input.useCount}개\n\n`;
  result += `📊 뽑기 결과\n[${resultLine.join(" ")}]\n\n🗿 총 획득 전설의 돌맹이: ${commas(input.counts.totalStone)}개\n👜 남은 보유: ${input.remaining}개`;
  if (input.counts.stone50 > 0n) result += "\n🎊 대박 당첨 축하\n🎉 전설의 돌맹이🗿 50개 대박 당첨! 축하드립니다!\n\n🖼️ 축하 이미지\nhttps://ibb.co/YFNcgbCx\n";
  const base = `📦 기본 지급 아이템 ${ALLSEE}\n\n티어 승급티켓🎟 ${input.useCount * 4n}개\n다이아상자💎(/다이아상자오픈) ${input.useCount}개\n펫스윗홈인테리어샵🖼️(/샵오픈) ${input.useCount * 150n}개`;
  const notice = input.counts.stone50 > 0n
    ? `[전체알림💎]\n[${rankName}] 님이 전돌뽑기에서\n전설의 돌맹이🗿 50개에 당첨되었습니다!🎉\n(총 ${input.counts.stone50}회 당첨)`
    : undefined;
  return { primary: [result, base], ...(notice === undefined ? {} : { notice }) };
}

async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint; eventId: string; destinationId: string; owner: Owner; status: LegendaryStoneDrawResult["status"];
  primary: string[]; notice?: string; broadcastIds: readonly string[]; useCount: bigint; remaining: bigint;
  counts: LegendaryStoneDrawCounts; summary: Record<string, unknown>;
}): Promise<LegendaryStoneDrawResult> {
  const replies: LegendaryStoneDrawReply[] = [];
  if (input.notice !== undefined) {
    for (const room of [...new Set(input.broadcastIds)]) {
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, room, JSON.stringify({ data: input.notice })]);
      replies.push({ outboxId: outbox.insertId.toString(), room, message: input.notice });
    }
  }
  for (const message of input.primary) {
    const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: message })]);
    replies.push({ outboxId: outbox.insertId.toString(), room: input.destinationId, message });
  }
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, COMMAND_CODE, input.operationId, input.status]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'shop.legendary_stone.draw',?,'Iris /전돌뽑기',?,UTC_TIMESTAMP(3))", [input.operationId, input.owner.identity_id, input.owner.player_id, input.status, JSON.stringify(input.summary)]);
  const result: LegendaryStoneDrawResult = { status: input.status, replies, replayed: false, useCount: input.useCount.toString(), remaining: input.remaining.toString(), counts: countResult(input.counts) };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 티켓 차감·고정 보상·확률 보상·공지 outbox를 하나의 transaction으로 처리합니다.
export class LegendaryStoneDrawService {
  public constructor(private readonly database: DatabaseClient, private readonly random: () => number = Math.random, private readonly broadcastIds: readonly string[] = []) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<LegendaryStoneDrawResult> {
    const command = parseLegendaryStoneDrawCommand(input.message);
    if (command === undefined) throw new ApplicationError("LEGENDARY_STONE_DRAW_COMMAND_INVALID", "전돌뽑기 명령 형식을 확인해 주세요.", 422);
    return this.database.withTransaction(async transaction => {
      const owner = (await transaction.query<Owner[]>(`SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name,rank.rank_emoji
        FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
        JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.player_id LIMIT 1 FOR UPDATE`, [input.externalUserId]))[0];
      if (owner === undefined) throw new ApplicationError("LEGENDARY_STONE_DRAW_USER_REQUIRED", "가입 정보를 확인할 수 없습니다.", 403);
      const key = eventKey(input.eventId);
      const prior = (await transaction.query<Array<{ result_json: string | LegendaryStoneDrawResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='shop.legendary_stone.draw' AND idempotency_key=? FOR UPDATE", [key]))[0];
      if (prior?.result_json != null) return { ...stored(prior.result_json), replayed: true };
      const operationId = (await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'shop.legendary_stone.draw',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), key, owner.identity_id])).insertId;
      const zero: LegendaryStoneDrawCounts = { stone1: 0n, stone2: 0n, stone3: 0n, stone5: 0n, stone10: 0n, stone50: 0n, totalStone: 0n };
      if (command.kind === "usage") return complete(transaction, { operationId, eventId: input.eventId, destinationId: input.destinationId, owner, status: "usage", primary: ["사용법: /전돌뽑기 [숫자]\n예시: /전돌뽑기 10"], broadcastIds: this.broadcastIds, useCount: 0n, remaining: 0n, counts: zero, summary: { mutation: false, reason: "usage" } });
      if (command.kind === "limit") return complete(transaction, { operationId, eventId: input.eventId, destinationId: input.destinationId, owner, status: "limit", primary: ["한 번에 최대 100개까지만 사용할 수 있습니다."], broadcastIds: this.broadcastIds, useCount: 0n, remaining: 0n, counts: zero, summary: { mutation: false, reason: "limit" } });

      const codes = [TICKET_CODE, TIER_TICKET_CODE, DIAMOND_BOX_CODE, SHOP_CODE, LEGENDARY_STONE_CODE];
      const items = await transaction.query<Item[]>("SELECT id,code FROM item_definitions WHERE code IN (?,?,?,?,?) AND active=TRUE AND stackable=TRUE ORDER BY id FOR UPDATE", codes);
      if (items.length !== codes.length || new Set(items.map(item => item.id.toString())).size !== codes.length) throw new ApplicationError("LEGENDARY_STONE_DRAW_ITEM_REQUIRED", "전돌뽑기 아이템 정의를 확인할 수 없습니다.", 409);
      const byCode = new Map(items.map(item => [item.code, item]));
      for (const code of [TIER_TICKET_CODE, DIAMOND_BOX_CODE, SHOP_CODE, LEGENDARY_STONE_CODE]) await transaction.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,1)", [owner.player_id, byCode.get(code)!.id]);
      const stacks = await transaction.query<Stack[]>(`SELECT stack.item_id,item.code,stack.quantity,stack.version FROM item_definitions item
        LEFT JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=? WHERE item.code IN (?,?,?,?,?) ORDER BY item.id FOR UPDATE`, [owner.player_id, ...codes]);
      const ticket = stacks.find(row => row.code === TICKET_CODE);
      const owned = ticket === undefined ? 0n : integral(ticket.quantity);
      if (ticket?.item_id == null || ticket.version == null || owned < command.count) return complete(transaction, { operationId, eventId: input.eventId, destinationId: input.destinationId, owner, status: "insufficient", primary: [`${TICKET_NAME} 보유 수량이 부족합니다.\n현재 보유: ${owned}개`], broadcastIds: this.broadcastIds, useCount: command.count, remaining: owned, counts: zero, summary: { mutation: false, requested: command.count.toString(), owned: owned.toString() } });

      const samples = Array.from({ length: Number(command.count) }, () => this.random());
      const counts = resolveLegendaryStoneDraw(samples);
      const remaining = owned - command.count;
      const consumed = await transaction.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [remaining, owner.player_id, ticket.item_id, ticket.version]);
      if (consumed.affectedRows !== 1n) throw new ApplicationError("LEGENDARY_STONE_DRAW_CONFLICT", "전돌뽑기 티켓 보유량이 먼저 변경되었습니다.", 409);
      let sequence = 1;
      await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,'LEGENDARY_STONE_DRAW_CONSUME')", [operationId, sequence++, owner.player_id, ticket.item_id, -command.count]);
      const grants: Array<[string, bigint]> = [[TIER_TICKET_CODE, command.count * 4n], [DIAMOND_BOX_CODE, command.count], [SHOP_CODE, command.count * 150n], [LEGENDARY_STONE_CODE, counts.totalStone]];
      for (const [code, quantity] of grants) {
        const stack = stacks.find(row => row.code === code);
        if (stack?.item_id == null || stack.version == null) throw new ApplicationError("LEGENDARY_STONE_DRAW_STACK_REQUIRED", "전돌뽑기 보상 가방을 준비할 수 없습니다.", 409);
        const changed = await transaction.execute("UPDATE inventory_stacks SET quantity=quantity+?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [quantity, owner.player_id, stack.item_id, stack.version]);
        if (changed.affectedRows !== 1n) throw new ApplicationError("LEGENDARY_STONE_DRAW_CONFLICT", "전돌뽑기 보상 가방이 먼저 변경되었습니다.", 409);
        await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,'LEGENDARY_STONE_DRAW_REWARD')", [operationId, sequence++, owner.player_id, stack.item_id, quantity]);
      }
      const outcome = (sample: number): [string, bigint] => sample < 0.01 ? ["stone_50", 50n] : sample < 0.03 ? ["stone_10", 10n] : sample < 0.06 ? ["stone_5", 5n] : sample < 0.11 ? ["stone_3", 3n] : sample < 0.21 ? ["stone_2", 2n] : ["stone_1", 1n];
      for (let index = 0; index < samples.length; index++) { const resolved = outcome(samples[index]!); await transaction.execute("INSERT INTO legendary_stone_draw_rng_samples(operation_id,sequence_no,sample_value,outcome_code,outcome_quantity) VALUES (?,?,?,?,?)", [operationId, index + 1, samples[index]!.toFixed(17), resolved[0], resolved[1]]); }
      await transaction.execute("INSERT INTO legendary_stone_draw_operations(operation_id,player_id,use_count,stone_1_count,stone_2_count,stone_3_count,stone_5_count,stone_10_count,stone_50_count,total_stone_reward,ticket_remaining,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))", [operationId, owner.player_id, command.count, counts.stone1, counts.stone2, counts.stone3, counts.stone5, counts.stone10, counts.stone50, counts.totalStone, remaining]);
      const messages = buildLegendaryStoneDrawMessages({ displayName: owner.display_name, rankEmoji: owner.rank_emoji, useCount: command.count, remaining, counts });
      return complete(transaction, { operationId, eventId: input.eventId, destinationId: input.destinationId, owner, status: "applied", primary: messages.primary, ...(messages.notice === undefined ? {} : { notice: messages.notice }), broadcastIds: this.broadcastIds, useCount: command.count, remaining, counts, summary: { mutation: true, useCount: command.count.toString(), remaining: remaining.toString(), counts: countResult(counts), fixedRewards: { tierTicket: (command.count * 4n).toString(), diamondBox: command.count.toString(), shop: (command.count * 150n).toString() }, noticeCount: counts.stone50.toString() } });
    });
  }
}
