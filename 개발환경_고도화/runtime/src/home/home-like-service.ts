import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { awardHomeActivityBadges } from "./daily-comment-service.js";
import { parseHomeLikeCommand } from "./home-like-command.js";

type Identity = { player_id: bigint; display_name: string };
type RankRow = { player_id: bigint; display_name: string; like_count: bigint };
type Result = { kind: "like" | "rank" | "reset"; message: string; outboxId: string; auditId: string; replayed: boolean; targetPlayerId: string | null; likeCount: string | null; affectedCount: string | null };
const SCOPE = "home.like.action";
const ALLSEE = "\u200b".repeat(500);
const key = (value: string): string => value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
const json = <T>(value: string | T): T => typeof value === "string" ? JSON.parse(value) as T : value;

// Asia/Seoul 기준 일일 사용 period key를 반환합니다.
export function homeLikeKstDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string): string => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// 안정 player ID tie-break와 11번째 allsee 경계를 적용해 전체 좋아홈 순위를 표시합니다.
export function formatHomeLikeRank(rows: RankRow[]): string {
  if (rows.length === 0) return "등록된 펫홈 정보가 없습니다.";
  let message = "💗 펫홈 좋아홈 순위 💗\n━━━━━━━━━━━━\n";
  rows.forEach((row, index) => {
    if (index === 10) message += ALLSEE;
    const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
    message += `${medal} ${row.display_name} - ${row.like_count.toString()} 좋아홈\n`;
  });
  return message.trim();
}

async function queueEvidence(tx: DatabaseTransaction, input: { operationId: bigint; eventId: string; commandCode: string; actorType: "player" | "admin_operator"; actorId: bigint; targetId: bigint | null; actionCode: string; summary: object; destinationId: string; message: string }): Promise<{ outboxId: string; auditId: string }> {
  await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','success',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, input.commandCode, input.operationId]);
  const audit = await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json,created_at) VALUES (?,?,?,'player',?,?,'success',?,UTC_TIMESTAMP(3))", [input.operationId, input.actorType, input.actorId, input.targetId, input.actionCode, JSON.stringify(input.summary)]);
  const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: input.message })]);
  return { outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
}

// 좋아홈 지급·순위·초기화를 각각 replay-safe DB 작업으로 처리합니다.
export class HomeLikeService {
  constructor(private readonly database: DatabaseClient) {}

  async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<Result> {
    const command = parseHomeLikeCommand(input.message);
    if (command === null) throw new ApplicationError("HOME_LIKE_COMMAND_INVALID", "좋아홈 명령 형식을 확인해 주세요.", 422);
    if (command.kind === "reset") return this.reset(input);
    const actor = (await this.database.query<Identity[]>(
      `SELECT identity.player_id,profile.current_display_name display_name FROM external_identities identity
       JOIN players player ON player.id=identity.player_id AND player.status='active'
       JOIN player_profiles profile ON profile.player_id=identity.player_id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`, [input.externalUserId]
    ))[0];
    if (actor === undefined) throw new ApplicationError("HOME_LIKE_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);
    return command.kind === "rank" ? this.rank(input, actor) : this.like(input, actor, command.targetName);
  }

  private async rank(input: { eventId: string; destinationId: string }, actor: Identity): Promise<Result> {
    const requestKey = key(input.eventId);
    return this.database.withTransaction(async (tx) => {
      const prior = (await tx.query<Array<{ result_json: string | Result | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [SCOPE, requestKey]))[0];
      if (prior?.result_json != null) return { ...json<Result>(prior.result_json), replayed: true };
      const rows = await tx.query<RankRow[]>(`SELECT home.player_id,profile.current_display_name display_name,home.like_count FROM player_homes home JOIN players player ON player.id=home.player_id AND player.status='active' JOIN player_profiles profile ON profile.player_id=home.player_id ORDER BY home.like_count DESC,home.player_id ASC`);
      const operation = (await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), SCOPE, requestKey, actor.player_id])).insertId;
      const message = formatHomeLikeRank(rows);
      await tx.execute("INSERT INTO home_like_rank_reads(operation_id,actor_player_id,row_count,snapshot_json) VALUES (?,?,?,?)", [operation, actor.player_id, rows.length, JSON.stringify(rows.map((row, index) => ({ rank: index + 1, playerId: row.player_id.toString(), displayName: row.display_name, likeCount: row.like_count.toString() })))]);
      const evidence = await queueEvidence(tx, { operationId: operation, eventId: input.eventId, commandCode: "HOME_LIKE_RANK_READ", actorType: "player", actorId: actor.player_id, targetId: actor.player_id, actionCode: "home.like.rank.read", summary: { rowCount: rows.length }, destinationId: input.destinationId, message });
      const result: Result = { kind: "rank", message, ...evidence, replayed: false, targetPlayerId: null, likeCount: null, affectedCount: null };
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation]);
      return result;
    });
  }

  private async like(input: { eventId: string; destinationId: string }, actor: Identity, targetName: string): Promise<Result> {
    const requestKey = key(input.eventId);
    return this.database.withTransaction(async (tx) => {
      const prior = (await tx.query<Array<{ result_json: string | Result | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [SCOPE, requestKey]))[0];
      if (prior?.result_json != null) return { ...json<Result>(prior.result_json), replayed: true };
      await tx.query("SELECT version FROM home_like_global_locks WHERE lock_code='HOME_LIKE' FOR UPDATE");
      const targets = await tx.query<Identity[]>(`SELECT player.id player_id,profile.current_display_name display_name FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.status='active' WHERE profile.current_display_name=? ORDER BY player.id LIMIT 2`, [targetName]);
      if (targets.length === 0) throw new ApplicationError("HOME_LIKE_TARGET_NOT_FOUND", `❌ [${targetName}] 님은 존재하지 않습니다.`, 404);
      if (targets.length > 1) throw new ApplicationError("HOME_LIKE_TARGET_AMBIGUOUS", `❌ [${targetName}] 이름과 일치하는 회원이 여러 명입니다.`, 409);
      const target = targets[0]!;
      if (target.player_id === actor.player_id) throw new ApplicationError("HOME_LIKE_SELF_NOT_ALLOWED", "자기 자신의 펫홈에는 좋아홈을 보낼 수 없습니다.", 422);
      const passes = await tx.query<Array<{ player_id: bigint }>>(`SELECT DISTINCT player_id FROM player_passes WHERE player_id IN (?,?) AND pass_code IN ('support','beginner') AND enabled=TRUE AND (permanent=TRUE OR ends_at>=UTC_TIMESTAMP(3)) ORDER BY player_id`, [actor.player_id, target.player_id]);
      const passIds = new Set(passes.map((row) => row.player_id.toString()));
      if (!passIds.has(actor.player_id.toString())) throw new ApplicationError("HOME_LIKE_ACTOR_PASS_REQUIRED", `❌ [${actor.display_name}] 님은 활성 호이패스 또는 초보패스가 필요합니다.`, 403);
      if (!passIds.has(target.player_id.toString())) throw new ApplicationError("HOME_LIKE_TARGET_PASS_REQUIRED", `❌ [${target.display_name}] 님의 활성 펫홈 패스를 확인할 수 없습니다.`, 403);
      const pet = (await tx.query<Array<{ present: number }>>("SELECT 1 present FROM player_pets WHERE player_id=? AND display_name IS NOT NULL LIMIT 1", [target.player_id]))[0];
      if (pet === undefined) throw new ApplicationError("HOME_LIKE_TARGET_PET_REQUIRED", `❌ [${target.display_name}] 님은 아직 펫을 생성하지 않았습니다.`, 422);
      const usageDate = homeLikeKstDate();
      await tx.execute("INSERT IGNORE INTO player_counters(player_id,counter_code,period_key,value,updated_at) VALUES (?,'home_like_sent',?,0,UTC_TIMESTAMP(3))", [actor.player_id, usageDate]);
      const counter = (await tx.query<Array<{ value: bigint }>>("SELECT value FROM player_counters WHERE player_id=? AND counter_code='home_like_sent' AND period_key=? FOR UPDATE", [actor.player_id, usageDate]))[0]!;
      if (counter.value >= 2n) throw new ApplicationError("HOME_LIKE_DAILY_LIMIT", "오늘 사용할 수 있는 좋아홈 2회를 모두 사용했습니다.", 409);
      const home = (await tx.query<Array<{ like_count: bigint; version: bigint }>>("SELECT like_count,version FROM player_homes WHERE player_id=? FOR UPDATE", [target.player_id]))[0];
      if (home === undefined) throw new ApplicationError("HOME_LIKE_HOME_NOT_FOUND", "대상 펫홈을 찾을 수 없습니다.", 404);
      const operation = (await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), SCOPE, requestKey, actor.player_id])).insertId;
      const usageAfter = counter.value + 1n;
      const likeAfter = home.like_count + 1n;
      await tx.execute("UPDATE player_counters SET value=?,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND counter_code='home_like_sent' AND period_key=?", [usageAfter, actor.player_id, usageDate]);
      await tx.execute("UPDATE player_homes SET like_count=?,version=version+1 WHERE player_id=? AND version=?", [likeAfter, target.player_id, home.version]);
      await tx.execute("INSERT INTO pet_home_badge_stats(player_id,received_home_likes,version,updated_at) VALUES (?,1,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE received_home_likes=received_home_likes+1,version=version+1,updated_at=UTC_TIMESTAMP(3)", [target.player_id]);
      const awarded = await awardHomeActivityBadges(tx, target.player_id);
      const sequence = (await tx.query<Array<{ next_no: bigint }>>("SELECT COALESCE(MAX(sequence_no),0)+1 next_no FROM pet_home_activity_alerts WHERE owner_player_id=?", [target.player_id]))[0]!.next_no;
      await tx.execute(`INSERT INTO pet_home_activity_alerts(owner_player_id,sequence_no,alert_type,actor_player_id,created_at_text,read_flag,actor_name,aggregate_count,restored_operation_id) VALUES (?,?,'home_like',?,DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(3),'+00:00','+09:00'),'%Y-%m-%d %H:%i:%s'),FALSE,?,?,?)`, [target.player_id, sequence, actor.player_id, actor.display_name, likeAfter, operation]);
      await tx.execute("INSERT INTO home_activity_events(operation_id,home_player_id,actor_player_id,activity_code,detail_json) VALUES (?,?,?,'home_like',?)", [operation, target.player_id, actor.player_id, JSON.stringify({ usageDate, usageAfter: usageAfter.toString(), likeAfter: likeAfter.toString(), awardedBadges: awarded })]);
      await tx.execute("INSERT INTO home_like_events(operation_id,actor_player_id,target_player_id,usage_date,usage_count_after,like_count_after,awarded_badges_json) VALUES (?,?,?,?,?,?,?)", [operation, actor.player_id, target.player_id, usageDate, usageAfter, likeAfter, JSON.stringify(awarded)]);
      const message = `💗 [${actor.display_name}] 님이 [${target.display_name}] 님의 펫홈에 좋아홈을 보냈습니다!\n오늘 사용: ${usageAfter.toString()}/2\n누적 좋아홈: ${likeAfter.toString()}`;
      const evidence = await queueEvidence(tx, { operationId: operation, eventId: input.eventId, commandCode: "HOME_LIKE_MUTATE", actorType: "player", actorId: actor.player_id, targetId: target.player_id, actionCode: "home.like.grant", summary: { usageDate, usageAfter: usageAfter.toString(), likeAfter: likeAfter.toString(), awardedBadges: awarded }, destinationId: input.destinationId, message });
      const result: Result = { kind: "like", message, ...evidence, replayed: false, targetPlayerId: target.player_id.toString(), likeCount: likeAfter.toString(), affectedCount: null };
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation]);
      return result;
    });
  }

  private async reset(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<Result> {
    const operator = (await this.database.query<Array<{ operator_id: bigint; display_name: string }>>(
      `SELECT operator.id operator_id,operator.display_name FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code IN ('super_admin','manager') AND role.active=TRUE
       JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='home.like.reset'
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`, [input.externalUserId]
    ))[0];
    if (operator === undefined) throw new ApplicationError("HOME_LIKE_RESET_FORBIDDEN", "좋아홈 초기화 권한이 없습니다.", 403);
    const requestKey = key(input.eventId);
    return this.database.withTransaction(async (tx) => {
      const prior = (await tx.query<Array<{ result_json: string | Result | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [SCOPE, requestKey]))[0];
      if (prior?.result_json != null) return { ...json<Result>(prior.result_json), replayed: true };
      await tx.query("SELECT version FROM home_like_global_locks WHERE lock_code='HOME_LIKE' FOR UPDATE");
      const homes = await tx.query<Array<{ player_id: bigint; like_count: bigint }>>("SELECT player_id,like_count FROM player_homes ORDER BY player_id FOR UPDATE");
      const changedHomes = homes.filter((home) => home.like_count !== 0n);
      const beforeSum = homes.reduce((sum, home) => sum + home.like_count, 0n);
      const operation = (await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), SCOPE, requestKey, operator.operator_id])).insertId;
      await tx.execute("UPDATE player_homes SET like_count=0,version=version+1 WHERE like_count<>0");
      const message = `✅ ${changedHomes.length}명의 펫홈 누적 좋아홈을 초기화했습니다.`;
      const preliminary = { kind: "reset", affectedCount: changedHomes.length.toString(), beforeSum: beforeSum.toString() };
      await tx.execute("INSERT INTO home_like_reset_runs(operation_id,operator_id,affected_count,before_sum,result_json) VALUES (?,?,?,?,?)", [operation, operator.operator_id, changedHomes.length, beforeSum, JSON.stringify(preliminary)]);
      const evidence = await queueEvidence(tx, { operationId: operation, eventId: input.eventId, commandCode: "HOME_LIKE_RESET", actorType: "admin_operator", actorId: operator.operator_id, targetId: null, actionCode: "home.like.reset", summary: preliminary, destinationId: input.destinationId, message });
      const result: Result = { kind: "reset", message, ...evidence, replayed: false, targetPlayerId: null, likeCount: null, affectedCount: changedHomes.length.toString() };
      await tx.execute("UPDATE home_like_reset_runs SET result_json=? WHERE operation_id=?", [JSON.stringify(result), operation]);
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation]);
      return result;
    });
  }
}
