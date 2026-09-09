import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { parseHomeBadgeGachaCommand, type HomeBadgeGachaVariant } from "./home-badge-gacha-command.js";

const ALL_SEE = "\u200b".repeat(500);
const SAMPLE_DENOMINATOR = 0x10000000000000;

interface Actor { identity_id: bigint; player_id: bigint; rank_display: string; }
interface Policy {
  variant_code: HomeBadgeGachaVariant; command_code: string; source_code: string; ticket_item_id: bigint;
  ticket_code: string; ticket_display_name: string; definition_version_id: bigint; content_hash: string;
  duplicate_currency_code: string; duplicate_reward: string; grade_draw: number;
}
export interface HomeBadgeGachaDefinition {
  badge_code: string; source_code: string; grade_code: string | null; emoji_value: string;
  display_name: string; detail_text: string; ordinal: number;
}
export interface HomeBadgeGachaGradeWeight { grade_code: string; grade_ordinal: number; weight_value: bigint; }
export interface PlannedHomeBadgeDraw { definition: HomeBadgeGachaDefinition; gradeSample: number | null; poolSample: number; }
export interface HomeBadgeGachaReply { outboxId: string; room: string; data: string; }
export interface HomeBadgeGachaResult {
  status: "success" | "usage" | "ticket_shortage" | "silent";
  data?: string; outboxId?: string; replies?: HomeBadgeGachaReply[]; replayed?: boolean;
  variant?: HomeBadgeGachaVariant; openCount?: number; pointReward?: string;
  draws?: Array<{ badgeCode: string; resultKind: "new" | "duplicate" | "deleted"; gradeCode: string | null }>;
}

// 긴 provider event ID도 operation unique key 길이에 안전하게 맞춥니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// 재시도에서도 동일한 추첨을 만드는 v2.400 카탈로그 고정 seed를 만듭니다.
export function createHomeBadgeGachaSeed(contentHash: string, eventId: string, playerId: string, variant: HomeBadgeGachaVariant, count: bigint): string {
  return `${contentHash}|${eventKey(eventId)}|${playerId}|${variant}|${count.toString()}`;
}

// seed·순번·단계에서 0 이상 1 미만의 결정적 표본을 계산합니다.
export function homeBadgeGachaSample(seed: string, drawOrdinal: number, stage: "grade" | "pool"): number {
  const hash = createHash("sha256").update(`${seed}|${drawOrdinal}|${stage}`).digest("hex");
  return Number.parseInt(hash.slice(0, 13), 16) / SAMPLE_DENOMINATOR;
}

// DB 가중치 누적 경계로 등급을 선택합니다.
export function selectHomeBadgeGachaGrade(weights: HomeBadgeGachaGradeWeight[], sample: number): string {
  const total = weights.reduce((sum, row) => sum + row.weight_value, 0n);
  if (total <= 0n) throw new Error("홈뱃지 등급 가중치 DB seed가 필요합니다.");
  const scaled = BigInt(Math.floor(Math.max(0, Math.min(0.9999999999999999, sample)) * Number(total)));
  let cumulative = 0n;
  for (const row of weights.slice().sort((a, b) => a.grade_ordinal - b.grade_ordinal)) {
    cumulative += row.weight_value;
    if (scaled < cumulative) return row.grade_code;
  }
  return weights[weights.length - 1]!.grade_code;
}

// 등급 2단계 또는 균등 1단계 추첨 계획을 결정적으로 생성합니다.
export function planHomeBadgeGachaDraws(seed: string, definitions: HomeBadgeGachaDefinition[], weights: HomeBadgeGachaGradeWeight[], count: number, gradeDraw: boolean): PlannedHomeBadgeDraw[] {
  const plans: PlannedHomeBadgeDraw[] = [];
  for (let ordinal = 1; ordinal <= count; ordinal++) {
    const gradeSample = gradeDraw ? homeBadgeGachaSample(seed, ordinal, "grade") : null;
    const gradeCode = gradeSample === null ? null : selectHomeBadgeGachaGrade(weights, gradeSample);
    const pool = gradeCode === null ? definitions : definitions.filter(value => value.grade_code === gradeCode);
    if (pool.length === 0) throw new Error(`홈뱃지 추첨 pool이 비었습니다: ${gradeCode ?? "uniform"}`);
    const poolSample = homeBadgeGachaSample(seed, ordinal, "pool");
    const index = Math.min(pool.length - 1, Math.floor(poolSample * pool.length));
    plans.push({ definition: pool[index]!, gradeSample, poolSample });
  }
  return plans;
}

// DECIMAL 포인트 문자열을 정수 bigint로 변환합니다.
function integerDecimal(value: string): bigint { return BigInt(value.split(".")[0]!); }

// 정수 포인트를 천 단위 구분 문자열로 표시합니다.
function pointText(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

// draw 결과를 v2.400의 단일 응답·다섯 번째 접기 형식으로 만듭니다.
function formatResult(actor: Actor, variant: HomeBadgeGachaVariant, draws: Array<{ definition: HomeBadgeGachaDefinition; resultKind: "new" | "duplicate" | "deleted"; reward: bigint }>): string {
  const title = variant === "open1" ? "홈뱃지" : variant === "open2" ? "MBTI 홈뱃지" : "연애유형 홈뱃지";
  let data = `[${actor.rank_display}] 님\n${title} ${draws.length}개 오픈 결과🛡️\n━━━━━━━\n`;
  for (let index = 0; index < draws.length; index++) {
    if (index === 4) data += `${ALL_SEE}\n`;
    const draw = draws[index]!;
    const grade = draw.definition.grade_code === null ? "" : `[${draw.definition.grade_code}] `;
    const outcome = draw.resultKind === "new" ? "획득" : draw.resultKind === "duplicate" ? `중복 +${pointText(draw.reward)} 포인트` : "영구 삭제 뱃지 · 무보상";
    data += `${index + 1}. ${grade}${draw.definition.emoji_value} ${draw.definition.display_name} · ${outcome}\n`;
    if (variant !== "open1") data += `${draw.definition.detail_text}\n`;
  }
  return data.replace(/\n$/, "");
}

// 응답·공지·실행·감사·operation 완료를 같은 transaction에 기록합니다.
async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint; eventId: string; destinationId: string; actor: Actor; commandCode: string; actionCode: string;
  resultCode: string; data: string; result: HomeBadgeGachaResult; notices?: string[]; broadcastIds: readonly string[];
  summary: Record<string, unknown>;
}): Promise<HomeBadgeGachaResult> {
  const replies: HomeBadgeGachaReply[] = [];
  const main = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]);
  replies.push({ outboxId: main.insertId.toString(), room: input.destinationId, data: input.data });
  for (const notice of input.notices ?? []) {
    for (const room of input.broadcastIds) {
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, room, JSON.stringify({ data: notice })]);
      replies.push({ outboxId: outbox.insertId.toString(), room, data: notice });
    }
  }
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, input.commandCode, input.operationId, input.resultCode]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,?,?,'Iris 홈뱃지 오픈',?,UTC_TIMESTAMP(3))", [input.operationId, input.actor.identity_id, input.actor.player_id, input.actionCode, input.resultCode, JSON.stringify(input.summary)]);
  const result: HomeBadgeGachaResult = { ...input.result, data: input.data, outboxId: main.insertId.toString(), replies, replayed: false };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 동일 event의 unique·deadlock 경합을 완료 결과 재조회 대상으로 분류합니다.
function isIdempotencyRaceError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (("errno" in error && (error.errno === 1062 || error.errno === 1213)) || ("code" in error && (error.code === "ER_DUP_ENTRY" || error.code === "ER_LOCK_DEADLOCK")));
}

// v2.400 티켓·카탈로그·중복 포인트·영구삭제·공지 순서를 DB transaction으로 처리합니다.
export class HomeBadgeGachaService {
  public constructor(private readonly database: DatabaseClient, private readonly broadcastIds: readonly string[] = []) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<HomeBadgeGachaResult> {
    const command = parseHomeBadgeGachaCommand(input.message);
    if (command === null) return { status: "silent" };
    const actors = await this.database.query<Actor[]>(`SELECT identity.id identity_id,player.id player_id,CONCAT(COALESCE(rank_profile.rank_emoji,''),profile.current_display_name) rank_display FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`, [input.externalUserId]);
    const actor = actors[0];
    if (actor === undefined) return { status: "silent" };
    const scope = `home.badge.gacha:${command.variant}`;
    const key = eventKey(input.eventId);
    try {
      return await this.database.withTransaction(async transaction => {
        const prior = await transaction.query<Array<{ result_json: string | HomeBadgeGachaResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]);
        if (prior[0]?.result_json != null) {
          const stored = typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) as HomeBadgeGachaResult : prior[0].result_json;
          return { ...stored, replayed: true };
        }
        const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), scope, key, actor.identity_id]);
        if (!command.valid || command.count === null) {
          const usage = command.variant === "open2" ? "예) /홈뱃지오픈2 [1~100]" : `예) /홈뱃지오픈${command.variant === "open3" ? "3" : ""} [1~100]`;
          return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor, commandCode: command.commandCode, actionCode: `home.badge.gacha.${command.variant}`, resultCode: "usage", data: usage, result: { status: "usage", variant: command.variant }, broadcastIds: this.broadcastIds, summary: { mutation: false } });
        }
        await transaction.query("SELECT id FROM players WHERE id=? FOR UPDATE", [actor.player_id]);
        const policies = await transaction.query<Policy[]>(`SELECT policy.variant_code,policy.command_code,policy.source_code,policy.ticket_item_id,item.code ticket_code,item.display_name ticket_display_name,policy.definition_version_id,version.content_hash,policy.duplicate_currency_code,CAST(policy.duplicate_reward AS CHAR) duplicate_reward,policy.grade_draw FROM home_badge_gacha_policies policy JOIN item_definitions item ON item.id=policy.ticket_item_id AND item.active=TRUE JOIN home_badge_definition_versions version ON version.id=policy.definition_version_id WHERE policy.variant_code=? AND policy.active=TRUE`, [command.variant]);
        const policy = policies[0];
        if (policy === undefined) throw new Error("홈뱃지 뽑기 정책 DB seed가 필요합니다.");
        const tickets = await transaction.query<Array<{ quantity: bigint | null; version: bigint | null }>>("SELECT stack.quantity,stack.version FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=? WHERE item.id=? FOR UPDATE", [actor.player_id, policy.ticket_item_id]);
        const ticket = tickets[0];
        const have = ticket?.quantity ?? 0n;
        if (have < command.count) {
          const data = `${policy.ticket_display_name}이 부족합니다. (보유 ${have.toString()}개 / 필요 ${command.count.toString()}개)`;
          return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor, commandCode: policy.command_code, actionCode: `home.badge.gacha.${command.variant}`, resultCode: "ticket_shortage", data, result: { status: "ticket_shortage", variant: command.variant }, broadcastIds: this.broadcastIds, summary: { requested: command.count.toString(), available: have.toString(), mutation: false } });
        }
        await transaction.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,?,0,0)", [actor.player_id, policy.duplicate_currency_code]);
        const accounts = await transaction.query<Array<{ balance: string; version: bigint }>>("SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code=? FOR UPDATE", [actor.player_id, policy.duplicate_currency_code]);
        const account = accounts[0];
        if (account === undefined) throw new Error("홈뱃지 중복 포인트 계정을 만들 수 없습니다.");
        const definitions = await transaction.query<HomeBadgeGachaDefinition[]>("SELECT badge_code,source_code,grade_code,emoji_value,display_name,detail_text,ordinal FROM home_badge_definitions WHERE definition_version_id=? AND source_code=? ORDER BY ordinal", [policy.definition_version_id, policy.source_code]);
        const expectedCount = command.variant === "open1" ? 57 : command.variant === "open2" ? 20 : 50;
        if (definitions.length !== expectedCount) throw new Error(`홈뱃지 ${policy.source_code} DB 정의 ${expectedCount}종이 필요합니다.`);
        const weights = policy.grade_draw === 1 ? await transaction.query<HomeBadgeGachaGradeWeight[]>("SELECT grade_code,grade_ordinal,weight_value FROM home_badge_gacha_grade_weights WHERE variant_code=? ORDER BY grade_ordinal", [command.variant]) : [];
        const assignments = await transaction.query<Array<{ badge_code: string; priority: number }>>("SELECT badge_code,priority FROM player_badge_assignments WHERE player_id=? ORDER BY priority,badge_code FOR UPDATE", [actor.player_id]);
        const projections = await transaction.query<Array<{ badge_code: string; owned: number }>>("SELECT badge_code,owned FROM player_home_badges WHERE player_id=? FOR UPDATE", [actor.player_id]);
        const exclusions = await transaction.query<Array<{ badge_code: string }>>("SELECT badge_code FROM player_home_badge_exclusions WHERE player_id=? FOR UPDATE", [actor.player_id]);
        const owned = new Set(assignments.map(row => row.badge_code));
        for (const row of projections) if (row.owned === 1) owned.add(row.badge_code);
        const deleted = new Set(exclusions.map(row => row.badge_code));
        for (const row of projections) if (row.owned !== 1) deleted.add(row.badge_code);
        let priority = assignments.reduce((maximum, row) => Math.max(maximum, row.priority), 0) + 1;
        const seed = createHomeBadgeGachaSeed(policy.content_hash, input.eventId, actor.player_id.toString(), command.variant, command.count);
        const plans = planHomeBadgeGachaDraws(seed, definitions, weights, Number(command.count), policy.grade_draw === 1);
        const ticketAfter = have - command.count;
        const ticketUpdate = await transaction.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [ticketAfter, actor.player_id, policy.ticket_item_id, ticket?.version ?? 0n]);
        if (ticketUpdate.affectedRows !== 1n) throw new Error("홈뱃지 뽑기권이 먼저 변경되었습니다.");
        await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'HOME_BADGE_GACHA_TICKET')", [operation.insertId, actor.player_id, policy.ticket_item_id, -command.count]);
        const duplicateReward = integerDecimal(policy.duplicate_reward);
        let totalReward = 0n;
        const draws: Array<{ definition: HomeBadgeGachaDefinition; resultKind: "new" | "duplicate" | "deleted"; reward: bigint }> = [];
        for (let index = 0; index < plans.length; index++) {
          const plan = plans[index]!;
          let resultKind: "new" | "duplicate" | "deleted";
          let reward = 0n;
          if (deleted.has(plan.definition.badge_code)) resultKind = "deleted";
          else if (owned.has(plan.definition.badge_code)) { resultKind = "duplicate"; reward = duplicateReward; totalReward += reward; }
          else {
            resultKind = "new";
            await transaction.execute("INSERT INTO player_badge_assignments(player_id,badge_code,display_value,priority) VALUES (?,?,?,?)", [actor.player_id, plan.definition.badge_code, `${plan.definition.emoji_value} ${plan.definition.display_name}`, priority++]);
            await transaction.execute("INSERT INTO player_home_badges(player_id,badge_code,owned,equipped,version,updated_at) VALUES (?,?,TRUE,FALSE,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE owned=TRUE,equipped=FALSE,version=version+1,updated_at=UTC_TIMESTAMP(3)", [actor.player_id, plan.definition.badge_code]);
            owned.add(plan.definition.badge_code);
          }
          await transaction.execute("INSERT INTO home_badge_gacha_draw_results(operation_id,draw_ordinal,player_id,variant_code,definition_version_id,badge_code,grade_code,grade_sample,pool_sample,result_kind,point_reward) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [operation.insertId, index + 1, actor.player_id, command.variant, policy.definition_version_id, plan.definition.badge_code, plan.definition.grade_code, plan.gradeSample === null ? null : plan.gradeSample.toFixed(19), plan.poolSample.toFixed(19), resultKind, `${reward.toString()}.000`]);
          draws.push({ definition: plan.definition, resultKind, reward });
        }
        if (totalReward > 0n) {
          const before = integerDecimal(account.balance);
          const after = before + totalReward;
          const updated = await transaction.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code=? AND version=?", [`${after.toString()}.000`, actor.player_id, policy.duplicate_currency_code, account.version]);
          if (updated.affectedRows !== 1n) throw new Error("홈뱃지 중복 포인트가 먼저 변경되었습니다.");
          await transaction.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,2,?,?,?,?, 'HOME_BADGE_GACHA_DUPLICATE')", [operation.insertId, actor.player_id, policy.duplicate_currency_code, `${totalReward.toString()}.000`, `${after.toString()}.000`]);
        }
        const data = formatResult(actor, command.variant, draws);
        const notices = command.variant === "open1" ? draws.filter(draw => draw.definition.grade_code === "S").map(draw => `🎉 [${actor.rank_display}] 님이 [S] ${draw.definition.emoji_value} ${draw.definition.display_name} 홈뱃지를 획득했습니다!`) : [];
        return complete(transaction, {
          operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor, commandCode: policy.command_code,
          actionCode: `home.badge.gacha.${command.variant}`, resultCode: "success", data, notices, broadcastIds: this.broadcastIds,
          result: { status: "success", variant: command.variant, openCount: Number(command.count), pointReward: totalReward.toString(), draws: draws.map(draw => ({ badgeCode: draw.definition.badge_code, resultKind: draw.resultKind, gradeCode: draw.definition.grade_code })) },
          summary: { sourceContract: "v2.400", definitionVersionId: policy.definition_version_id.toString(), contentHash: policy.content_hash, requested: command.count.toString(), ticketBefore: have.toString(), ticketAfter: ticketAfter.toString(), pointReward: totalReward.toString(), rngSeedHash: createHash("sha256").update(seed).digest("hex"), draws: draws.map(draw => ({ badgeCode: draw.definition.badge_code, resultKind: draw.resultKind })) }
        });
      });
    } catch (error) {
      if (!isIdempotencyRaceError(error)) throw error;
      for (let attempt = 0; attempt < 10; attempt++) {
        const prior = await this.database.query<Array<{ result_json: string | HomeBadgeGachaResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [scope, key]);
        if (prior[0]?.result_json != null) {
          const stored = typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) as HomeBadgeGachaResult : prior[0].result_json;
          return { ...stored, replayed: true };
        }
        await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
      }
      throw error;
    }
  }
}
