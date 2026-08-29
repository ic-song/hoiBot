import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { awardHomeActivityBadges } from "./daily-comment-service.js";
import { parseHomeHeartExpressionCommand, type HomeHeartExpressionCommandName } from "./home-heart-expression-command.js";

const COMMAND_CODE = "HOME_HEART_EXPRESSION", SCOPE = "home.heart_expression", SAMPLE_DENOMINATOR = 0x10000000000000;
export const HOME_HEART_TYPES = [
  { code: "cute", command: "귀여워", label: "귀여워🐾" }, { code: "cheer", command: "응원해", label: "응원해⭐" },
  { code: "cool", command: "멋져요", label: "멋져요✨" }, { code: "love", command: "사랑해", label: "사랑해💖" }
] as const;
type ReactionCode = typeof HOME_HEART_TYPES[number]["code"];
type Actor = { identity_id: bigint; player_id: bigint; display_name: string; rank_display: string };
type Target = { player_id: bigint; display_name: string; rank_display: string };
export type HeartAllocation = { code: ReactionCode; label: string; quantity: bigint };
export interface HomeHeartExpressionResult {
  status: "guide" | "target_not_found" | "quantity_invalid" | "pass_required" | "target_pass_required" | "self" | "home_not_found" | "insufficient" | "success" | "silent";
  data?: string; outboxId?: string; replayed?: boolean; requestedCount?: string; limit?: string; usedBefore?: string; usedAfter?: string; remainingAfter?: string;
  targetPlayerId?: string; allocations?: Array<{ code: ReactionCode; label: string; quantity: string }>;
}
const eventKey = (value: string) => value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
const guide = (name: HomeHeartExpressionCommandName) => `사용법: /${name} [아이디] [수량]\n예시: /${name} 조사 남 2`;
const kstText = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date());
export const homeHeartKstDate = () => kstText().slice(0, 10);

// event와 주체·대상·수량에 고정된 /마음 랜덤 seed를 만듭니다.
export function createHomeHeartExpressionSeed(eventId: string, actorPlayerId: string, targetPlayerId: string, count: bigint): string {
  return `v2.400|${eventKey(eventId)}|${actorPlayerId}|${targetPlayerId}|${count.toString()}`;
}

// seed별 회차를 네 반응 타입 중 하나로 결정합니다.
export function homeHeartExpressionSample(seed: string, ordinal: bigint): number {
  return Number.parseInt(createHash("sha256").update(`${seed}|${ordinal.toString()}|heart`).digest("hex").slice(0, 13), 16) / SAMPLE_DENOMINATOR;
}

// 고정 명령 또는 /마음 랜덤 결과를 레거시 출력 순서로 합산합니다.
export function allocateHomeHeartExpressions(name: HomeHeartExpressionCommandName, count: bigint, seed: string): { allocations: HeartAllocation[]; rolls: Array<{ ordinal: bigint; sample: number | null; code: ReactionCode }> } {
  const quantities = new Map<ReactionCode, bigint>(HOME_HEART_TYPES.map(type => [type.code, 0n]));
  const fixed = HOME_HEART_TYPES.find(type => type.command === name), rolls: Array<{ ordinal: bigint; sample: number | null; code: ReactionCode }> = [];
  for (let ordinal = 1n; ordinal <= count; ordinal++) {
    const sample = fixed === undefined ? homeHeartExpressionSample(seed, ordinal) : null;
    const selected = fixed ?? HOME_HEART_TYPES[Math.min(Math.floor(sample! * HOME_HEART_TYPES.length), HOME_HEART_TYPES.length - 1)]!;
    quantities.set(selected.code, quantities.get(selected.code)! + 1n); rolls.push({ ordinal, sample, code: selected.code });
  }
  return { allocations: HOME_HEART_TYPES.map(type => ({ code: type.code, label: type.label, quantity: quantities.get(type.code)! })).filter(row => row.quantity > 0n), rolls };
}

// 네 타입의 고정 순서로 레거시 마음표현 결과 문구를 만듭니다.
export function formatHomeHeartAllocation(allocations: readonly HeartAllocation[]): string {
  const byCode = new Map(allocations.map(row => [row.code, row.quantity]));
  return HOME_HEART_TYPES.filter(type => (byCode.get(type.code) ?? 0n) > 0n).map(type => `${type.label} x${byCode.get(type.code)!.toString()}`).join(" | ");
}
function isRace(error: unknown): boolean { return typeof error === "object" && error !== null && (("errno" in error && (error.errno === 1062 || error.errno === 1213)) || ("code" in error && (error.code === "ER_DUP_ENTRY" || error.code === "ER_LOCK_DEADLOCK"))); }

async function complete(tx: DatabaseTransaction, input: { operationId: bigint; eventId: string; destinationId: string; actor: Actor; targetId: bigint; resultCode: HomeHeartExpressionResult["status"]; data: string; result: HomeHeartExpressionResult; summary: Record<string, unknown> }): Promise<HomeHeartExpressionResult> {
  const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]);
  await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, COMMAND_CODE, input.operationId, input.resultCode]);
  await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'home.heart_expression',?,'Iris 펫홈 마음표현',?,UTC_TIMESTAMP(3))", [input.operationId, input.actor.identity_id, input.targetId, input.resultCode, JSON.stringify(input.summary)]);
  const result: HomeHeartExpressionResult = { ...input.result, data: input.data, outboxId: outbox.insertId.toString(), replayed: false };
  await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]); return result;
}

// 다섯 펫홈 마음표현의 quota·반응·배지·알림·원장을 한 transaction으로 처리합니다.
export class HomeHeartExpressionService {
  public constructor(private readonly database: DatabaseClient) {}
  public async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<HomeHeartExpressionResult> {
    const command = parseHomeHeartExpressionCommand(input.message); if (command === null) return { status: "silent" };
    const actor = (await this.database.query<Actor[]>(`SELECT identity.id identity_id,player.id player_id,profile.current_display_name display_name,CONCAT(COALESCE(rank_profile.rank_emoji,''),profile.current_display_name) rank_display FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`, [input.externalUserId]))[0];
    if (actor === undefined) return { status: "silent" }; const key = eventKey(input.eventId);
    try { return await this.database.withTransaction(async tx => {
      const prior = (await tx.query<Array<{ result_json: string | HomeHeartExpressionResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [SCOPE, key]))[0];
      if (prior?.result_json != null) { const stored = typeof prior.result_json === "string" ? JSON.parse(prior.result_json) as HomeHeartExpressionResult : prior.result_json; return { ...stored, replayed: true }; }
      const operationId = (await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), SCOPE, key, actor.identity_id])).insertId;
      const finish = (status: HomeHeartExpressionResult["status"], data: string, targetId = actor.player_id, extra: HomeHeartExpressionResult = { status }) => complete(tx, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, targetId, resultCode: status, data, result: { ...extra, status }, summary: { sourceContract: "v2.400", mutation: status === "success", command: command.name } });
      if (command.remainder === null) return finish("guide", guide(command.name));
      const target = (await tx.query<Target[]>(`SELECT player.id player_id,profile.current_display_name display_name,CONCAT(COALESCE(rank_profile.rank_emoji,''),profile.current_display_name) rank_display FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.status='active' AND player.deleted_at IS NULL LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id WHERE ?=profile.current_display_name OR ? LIKE CONCAT(profile.current_display_name,' %') ORDER BY CHAR_LENGTH(profile.current_display_name) DESC,player.id LIMIT 1`, [command.remainder, command.remainder]))[0];
      if (target === undefined) return finish("target_not_found", "존재하지 않는 아이디입니다.\n아이디를 다시 확인해 주세요.");
      const amountText = command.remainder.slice(target.display_name.length).trim();
      if (amountText !== "" && !/^\d+$/.test(amountText)) return finish("quantity_invalid", `사용법: /${command.name} [아이디] [수량]\n수량 뒤에는 다른 문구를 입력할 수 없습니다.`, target.player_id);
      const count = amountText === "" ? 1n : BigInt(amountText); if (count < 1n) return finish("quantity_invalid", "마음표현 수량은 1 이상의 숫자로 입력해 주세요.", target.player_id);
      const lockIds = [actor.player_id, target.player_id].sort((a, b) => a < b ? -1 : a > b ? 1 : 0); await tx.query(`SELECT id FROM players WHERE id IN (${lockIds.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, lockIds);
      const actorPasses = await tx.query<Array<{ pass_code: string }>>("SELECT pass_code FROM player_passes WHERE player_id=? AND pass_code IN ('support','beginner','premium') AND enabled=TRUE AND (permanent=TRUE OR ends_at>=UTC_TIMESTAMP(3)) ORDER BY pass_code FOR UPDATE", [actor.player_id]);
      if (actorPasses.length === 0) return finish("pass_required", "펫홈 마음표현💞은\n호이패스·초보패스 이용자만 사용할 수 있습니다.", target.player_id);
      const targetPass = (await tx.query<Array<{ present: number }>>("SELECT 1 present FROM player_passes WHERE player_id=? AND pass_code IN ('support','beginner','premium') AND enabled=TRUE AND (permanent=TRUE OR ends_at>=UTC_TIMESTAMP(3)) LIMIT 1", [target.player_id]))[0];
      if (targetPass === undefined) return finish("target_pass_required", "상대방이 호이패스·초보패스 이용자가 아니어서\n마음표현을 남길 수 없습니다.", target.player_id);
      if (actor.player_id === target.player_id) return finish("self", "본인의 펫홈에는 마음표현을 사용할 수 없습니다.", target.player_id);
      const home = (await tx.query<Array<{ version: bigint }>>("SELECT version FROM player_homes WHERE player_id=? FOR UPDATE", [target.player_id]))[0]; if (home === undefined) return finish("home_not_found", "존재하지 않는 아이디입니다.\n아이디를 다시 확인해 주세요.", target.player_id);
      const mutualBonus = BigInt((await tx.query<Array<{ value: bigint }>>(`SELECT COUNT(*) value FROM pet_home_follows outgoing JOIN pet_home_follows incoming ON incoming.follower_player_id=outgoing.followed_player_id AND incoming.followed_player_id=outgoing.follower_player_id AND incoming.active=TRUE WHERE outgoing.follower_player_id=? AND outgoing.active=TRUE AND EXISTS(SELECT 1 FROM player_passes friend_pass WHERE friend_pass.player_id=outgoing.followed_player_id AND friend_pass.pass_code IN ('support','beginner','premium') AND friend_pass.enabled=TRUE AND (friend_pass.permanent=TRUE OR friend_pass.ends_at>=UTC_TIMESTAMP(3)))`, [actor.player_id]))[0]?.value ?? 0n);
      const premiumBonus = actorPasses.some(row => row.pass_code === "premium") ? 15n : 0n;
      const skillBonus = BigInt((await tx.query<Array<{ heart_bonus: bigint }>>(`SELECT COALESCE(SUM(skill_row.heart_bonus),0) heart_bonus FROM (SELECT DISTINCT definition.id,CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(definition.rules_json,'$.heartBonus')),'0') AS UNSIGNED) heart_bonus FROM player_pets pet JOIN pet_skills equipped ON equipped.player_pet_id=pet.id AND equipped.equipped=TRUE JOIN skill_definitions definition ON definition.id=equipped.skill_id AND definition.active=TRUE WHERE pet.player_id=? AND JSON_EXTRACT(definition.rules_json,'$.heartBonus') IS NOT NULL) skill_row`, [actor.player_id]))[0]?.heart_bonus ?? 0n);
      const usageDate = homeHeartKstDate(), limit = 1n + mutualBonus + premiumBonus + skillBonus; await tx.execute("INSERT IGNORE INTO player_pet_home_heart_usage(player_id,usage_date,used_count,version) VALUES (?,?,0,1)", [actor.player_id, usageDate]);
      const usage = (await tx.query<Array<{ used_count: bigint; version: bigint }>>("SELECT used_count,version FROM player_pet_home_heart_usage WHERE player_id=? AND usage_date=? FOR UPDATE", [actor.player_id, usageDate]))[0]!, usedBefore = BigInt(usage.used_count), remaining = limit > usedBefore ? limit - usedBefore : 0n;
      if (count > remaining) return finish("insufficient", `사용 가능한 마음표현 횟수가 부족합니다.💞\n남은 마음: ${remaining.toString()}개 / 오늘 한도: ${limit.toString()}개`, target.player_id, { status: "insufficient", requestedCount: count.toString(), limit: limit.toString(), usedBefore: usedBefore.toString(), usedAfter: usedBefore.toString(), remainingAfter: remaining.toString(), targetPlayerId: target.player_id.toString() });
      const seed = createHomeHeartExpressionSeed(input.eventId, actor.player_id.toString(), target.player_id.toString(), count), allocation = allocateHomeHeartExpressions(command.name, count, seed), usedAfter = usedBefore + count, remainingAfter = limit - usedAfter;
      const usageChanged = await tx.execute("UPDATE player_pet_home_heart_usage SET used_count=?,version=version+1 WHERE player_id=? AND usage_date=? AND version=?", [usedAfter, actor.player_id, usageDate, usage.version]); if (usageChanged.affectedRows !== 1n) throw new Error("펫홈 마음표현 사용량이 먼저 변경되었습니다.");
      const homeChanged = await tx.execute("UPDATE player_homes SET version=version+1 WHERE player_id=? AND version=?", [target.player_id, home.version]); if (homeChanged.affectedRows !== 1n) throw new Error("대상 펫홈이 먼저 변경되었습니다.");
      await tx.execute("UPDATE player_homes SET last_heart_expression_date=?,version=version+1 WHERE player_id=?", [usageDate, actor.player_id]);
      for (const row of allocation.allocations) { await tx.execute("INSERT INTO home_heart_expression_totals(home_player_id,reaction_code,quantity,version) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),version=version+1", [target.player_id, row.code, row.quantity]); await tx.execute("INSERT IGNORE INTO home_reactions(home_player_id,actor_player_id,reaction_code) VALUES (?,?,?)", [target.player_id, actor.player_id, row.code]); }
      for (const roll of allocation.rolls) await tx.execute("INSERT INTO home_heart_expression_rolls(operation_id,roll_ordinal,sample,reaction_code) VALUES (?,?,?,?)", [operationId, roll.ordinal, roll.sample === null ? null : roll.sample.toFixed(19), roll.code]);
      await tx.execute("INSERT INTO pet_home_badge_stats(player_id,followers,mutual,received_comments,received_home_likes,received_reactions,total_visits,feed_active_days,version) VALUES (?,0,0,0,0,?,0,0,1) ON DUPLICATE KEY UPDATE received_reactions=received_reactions+VALUES(received_reactions),version=version+1", [target.player_id, count]);
      const awarded = await awardHomeActivityBadges(tx, target.player_id); let sequence = Number((await tx.query<Array<{ value: bigint }>>("SELECT COALESCE(MAX(sequence_no),0) value FROM pet_home_activity_alerts WHERE owner_player_id=? FOR UPDATE", [target.player_id]))[0]?.value ?? 0n) + 1, createdAtText = kstText();
      for (const row of allocation.allocations) await tx.execute("INSERT INTO pet_home_activity_alerts(owner_player_id,sequence_no,alert_type,actor_player_id,created_at_text,read_flag,preview_text,actor_name,aggregate_count,restored_operation_id) VALUES (?,?,?,?,?,FALSE,?,?,?,?)", [target.player_id, sequence++, `heart_${row.code}`, actor.player_id, createdAtText, row.label, actor.display_name, row.quantity, operationId]);
      for (const badgeCode of awarded) await tx.execute("INSERT INTO pet_home_activity_alerts(owner_player_id,sequence_no,alert_type,actor_player_id,created_at_text,read_flag,badge_code,restored_operation_id) VALUES (?,?,'badge_earned',?,?,FALSE,?,?)", [target.player_id, sequence++, target.player_id, createdAtText, badgeCode, operationId]);
      await tx.execute("DELETE FROM pet_home_activity_alerts WHERE owner_player_id=? AND sequence_no NOT IN (SELECT sequence_no FROM (SELECT sequence_no FROM pet_home_activity_alerts WHERE owner_player_id=? ORDER BY sequence_no DESC LIMIT 100) keep_rows)", [target.player_id, target.player_id]);
      const serialized = allocation.allocations.map(row => ({ code: row.code, label: row.label, quantity: row.quantity.toString() }));
      await tx.execute("INSERT INTO home_heart_expression_executions(operation_id,actor_player_id,target_player_id,command_name,requested_count,usage_date,limit_before,used_before,used_after,remaining_after,allocations_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [operationId, actor.player_id, target.player_id, command.name, count, usageDate, limit, usedBefore, usedAfter, remainingAfter, JSON.stringify(serialized)]);
      await tx.execute("INSERT INTO home_activity_events(operation_id,home_player_id,actor_player_id,activity_code,detail_json) VALUES (?,?,?,'heart_expression',?)", [operationId, target.player_id, actor.player_id, JSON.stringify({ command: command.name, requestedCount: count.toString(), allocations: serialized, awardedBadges: awarded })]);
      const data = `💞 ${target.rank_display}님의 펫홈에\n[${formatHomeHeartAllocation(allocation.allocations)}] 마음을 표현했습니다!\n\n남은 마음: ${remainingAfter.toString()}개`;
      return complete(tx, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, targetId: target.player_id, resultCode: "success", data, result: { status: "success", requestedCount: count.toString(), limit: limit.toString(), usedBefore: usedBefore.toString(), usedAfter: usedAfter.toString(), remainingAfter: remainingAfter.toString(), targetPlayerId: target.player_id.toString(), allocations: serialized }, summary: { sourceContract: "v2.400", mutation: true, command: command.name, requestedCount: count.toString(), usageDate, limit: limit.toString(), seedHash: createHash("sha256").update(seed).digest("hex"), awardedBadges: awarded } });
    }); } catch (error) { if (!isRace(error)) throw error; for (let attempt = 0; attempt < 10; attempt++) { const prior = (await this.database.query<Array<{ result_json: string | HomeHeartExpressionResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [SCOPE, key]))[0]; if (prior?.result_json != null) { const stored = typeof prior.result_json === "string" ? JSON.parse(prior.result_json) as HomeHeartExpressionResult : prior.result_json; return { ...stored, replayed: true }; } await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1))); } throw error; }
  }
}
