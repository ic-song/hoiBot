import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { parseLegacyLikeCommand } from "./legacy-like-command.js";

type Identity = { player_id: bigint; identity_id: bigint; display_name: string };
type Operator = { operator_id: bigint; player_id: bigint | null; display_name: string };
type RankRow = { player_id: bigint; display_name: string; like_count: bigint };
export type LegacyLikeResult = {
  kind: "like" | "count" | "rank" | "reset" | "daily-reset";
  message: string;
  outboxId: string;
  auditId: string;
  replayed: boolean;
  pointAfter: string | null;
  usageAfter: string | null;
  currentLikeAfter: string | null;
  affectedCount: string | null;
};

const SCOPE = "social.legacy_like";
const ALLSEE = "\u200b".repeat(500);
const eventKey = (value: string): string => value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
const stored = (value: string | LegacyLikeResult): LegacyLikeResult => typeof value === "string" ? JSON.parse(value) as LegacyLikeResult : value;
const whole = (value: string): bigint => BigInt(value.split(".", 1)[0] ?? "0");

// Asia/Seoul 기준 일일 좋아요 사용 period key를 반환합니다.
export function legacyLikeKstDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string): string => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// DB의 안정 player ID tie-break 순서를 레거시 좋아요 순위 UI로 변환합니다.
export function formatLegacyLikeRank(rows: readonly RankRow[]): string {
  const lines = rows.map((row, index) => `${index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}위 `}${row.display_name} - 💕:${row.like_count.toString()}\n`);
  return `💕 좋아요 순위 💕\n\n${lines.slice(0, 10).join("")}${rows.length > 10 ? ALLSEE : ""}${lines.slice(10).join("")}`;
}

async function evidence(tx: DatabaseTransaction, input: {
  operationId: bigint; eventId: string; commandCode: string; actorType: "player" | "admin_operator";
  actorId: bigint; targetId: bigint | null; actionCode: string; summary: object; destinationId: string; message: string;
}): Promise<{ outboxId: string; auditId: string }> {
  await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','success',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, input.commandCode, input.operationId]);
  const audit = await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json,created_at) VALUES (?,?,?,'player',?,?,'success',?,UTC_TIMESTAMP(3))", [input.operationId, input.actorType, input.actorId, input.targetId, input.actionCode, JSON.stringify(input.summary)]);
  const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: input.message })]);
  return { outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
}

// 구형 좋아요·횟수·순위·초기화를 replay-safe DB aggregate로 처리합니다.
export class LegacyLikeService {
  constructor(private readonly database: DatabaseClient) {}

  async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<LegacyLikeResult> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try { return await this.executeOnce(input); }
      catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (!["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(code) || attempt === 3) throw error;
      }
    }
    throw new Error("좋아요 처리 재시도 한도를 초과했습니다.");
  }

  private async executeOnce(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<LegacyLikeResult> {
    const command = parseLegacyLikeCommand(input.message);
    if (command === null) throw new ApplicationError("LEGACY_LIKE_COMMAND_INVALID", "좋아요 명령 형식을 확인해 주세요.", 422);
    if (command.kind === "reset" || command.kind === "daily-reset") return this.reset(input, command.kind);
    const actor = await this.identity(input.externalUserId);
    if (command.kind === "count") return this.count(input, actor);
    if (command.kind === "rank") return this.rank(input, actor);
    return this.like(input, actor, command.targetName);
  }

  private async identity(externalUserId: string): Promise<Identity> {
    const actor = (await this.database.query<Identity[]>(`SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.id LIMIT 1`, [externalUserId]))[0];
    if (actor === undefined) throw new ApplicationError("LEGACY_LIKE_IDENTITY_REQUIRED", "가입된 사용자 정보를 찾을 수 없습니다.", 422);
    return actor;
  }

  private async operator(externalUserId: string): Promise<Operator> {
    const operator = (await this.database.query<Operator[]>(`SELECT operator.id operator_id,identity.player_id,operator.display_name FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='social.legacy_like.reset' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY operator.id LIMIT 1`, [externalUserId]))[0];
    if (operator === undefined) throw new ApplicationError("LEGACY_LIKE_RESET_FORBIDDEN", "좋아요 초기화 권한이 없습니다.", 403);
    return operator;
  }

  private async prior(tx: DatabaseTransaction, requestKey: string): Promise<LegacyLikeResult | null> {
    const row = (await tx.query<Array<{ result_json: string | LegacyLikeResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [SCOPE, requestKey]))[0];
    return row?.result_json == null ? null : { ...stored(row.result_json), replayed: true };
  }

  private async operation(tx: DatabaseTransaction, requestKey: string, actorType: "player" | "admin_operator", actorId: bigint): Promise<bigint> {
    return (await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,?,?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), SCOPE, requestKey, actorType, actorId])).insertId;
  }

  private async finish(tx: DatabaseTransaction, operationId: bigint, result: LegacyLikeResult): Promise<LegacyLikeResult> {
    await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
    return result;
  }

  private async like(input: { eventId: string; destinationId: string }, actor: Identity, targetName: string): Promise<LegacyLikeResult> {
    const requestKey = eventKey(input.eventId);
    return this.database.withTransaction(async (tx) => {
      const previous = await this.prior(tx, requestKey); if (previous !== null) return previous;
      await tx.query("SELECT version FROM social_like_global_locks WHERE lock_code='LEGACY_LIKE' FOR UPDATE");
      const season = (await tx.query<Array<{ active_season_id: bigint | null }>>("SELECT active_season_id FROM castle_battle_season_state WHERE scope_key='GLOBAL' FOR UPDATE"))[0];
      if (season?.active_season_id != null) throw new ApplicationError("LEGACY_LIKE_CASTLE_BATTLE_ACTIVE", "공성전 진행 중에는 좋아요를 사용할 수 없습니다.", 409);
      const targets = await tx.query<Identity[]>(`SELECT identity.id identity_id,player.id player_id,profile.current_display_name display_name FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.status='active' AND player.deleted_at IS NULL LEFT JOIN external_identities identity ON identity.player_id=player.id AND identity.provider_code='kakao' AND identity.status='linked' WHERE profile.current_display_name=? ORDER BY player.id LIMIT 2`, [targetName]);
      if (targets.length === 0) throw new ApplicationError("LEGACY_LIKE_TARGET_NOT_FOUND", "존재하지 않는 사용자입니다.", 404);
      if (targets.length > 1) throw new ApplicationError("LEGACY_LIKE_TARGET_AMBIGUOUS", "같은 이름의 회원이 여러 명입니다.", 409);
      const target = targets[0]!;
      if (target.player_id === actor.player_id) throw new ApplicationError("LEGACY_LIKE_SELF", "셀프💕 고만...", 422);
      const usageDate = legacyLikeKstDate();
      await tx.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,0)", [actor.player_id]);
      await tx.execute("INSERT IGNORE INTO player_counters(player_id,counter_code,period_key,value,updated_at) VALUES (?,'cntlike',?,0,UTC_TIMESTAMP(3)),(?,'like','current',0,UTC_TIMESTAMP(3)),(?,'like','lifetime',0,UTC_TIMESTAMP(3)),(?,'like0','lifetime',0,UTC_TIMESTAMP(3))", [actor.player_id, usageDate, target.player_id, target.player_id, target.player_id]);
      const account = (await tx.query<Array<{ balance: string; version: bigint }>>("SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE", [actor.player_id]))[0]!;
      const usage = (await tx.query<Array<{ value: bigint }>>("SELECT value FROM player_counters WHERE player_id=? AND counter_code='cntlike' AND period_key=? FOR UPDATE", [actor.player_id, usageDate]))[0]!;
      const current = (await tx.query<Array<{ value: bigint }>>("SELECT value FROM player_counters WHERE player_id=? AND counter_code='like' AND period_key='current' FOR UPDATE", [target.player_id]))[0]!;
      const lifetime = (await tx.query<Array<{ value: bigint }>>("SELECT value FROM player_counters WHERE player_id=? AND counter_code='like' AND period_key='lifetime' FOR UPDATE", [target.player_id]))[0]!;
      const pointBefore = whole(account.balance);
      if (usage.value >= 2n) throw new ApplicationError("LEGACY_LIKE_DAILY_LIMIT", "좋아요 2번을 모두 사용했습니다.", 409);
      if (pointBefore < 8n) throw new ApplicationError("LEGACY_LIKE_POINT_SHORT", "포인트가 부족합니다.", 409);
      const operationId = await this.operation(tx, requestKey, "player", actor.player_id);
      const pointAfter = pointBefore - 8n, usageAfter = usage.value + 1n, currentAfter = current.value + 1n, lifetimeAfter = lifetime.value + 1n;
      const changed = await tx.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?", [pointAfter.toString(), actor.player_id, account.version]);
      if (changed.affectedRows !== 1n) throw new Error("포인트 정보가 먼저 변경되었습니다.");
      await tx.execute("UPDATE player_counters SET value=?,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND counter_code='cntlike' AND period_key=?", [usageAfter, actor.player_id, usageDate]);
      await tx.execute("UPDATE player_counters SET value=?,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND counter_code='like' AND period_key='current'", [currentAfter, target.player_id]);
      await tx.execute("UPDATE player_counters SET value=?,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND counter_code='like' AND period_key='lifetime'", [lifetimeAfter, target.player_id]);
      await tx.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',-8,?,'LEGACY_LIKE_SEND')", [operationId, actor.player_id, pointAfter.toString()]);
      await tx.execute("INSERT INTO social_like_events(operation_id,actor_player_id,target_player_id,usage_date,usage_count_after,point_before,point_after,current_like_after,lifetime_like_after) VALUES (?,?,?,?,?,?,?,?,?)", [operationId, actor.player_id, target.player_id, usageDate, usageAfter, pointBefore.toString(), pointAfter.toString(), currentAfter, lifetimeAfter]);
      const proof = await evidence(tx, { operationId, eventId: input.eventId, commandCode: "LEGACY_LIKE_MUTATE", actorType: "player", actorId: actor.player_id, targetId: target.player_id, actionCode: "social.legacy_like.send", summary: { usageDate, usageAfter: usageAfter.toString(), pointBefore: pointBefore.toString(), pointAfter: pointAfter.toString(), currentLikeAfter: currentAfter.toString(), lifetimeLikeAfter: lifetimeAfter.toString() }, destinationId: input.destinationId, message: "💕" });
      return this.finish(tx, operationId, { kind: "like", message: "💕", ...proof, replayed: false, pointAfter: pointAfter.toString(), usageAfter: usageAfter.toString(), currentLikeAfter: currentAfter.toString(), affectedCount: null });
    });
  }

  private async count(input: { eventId: string; destinationId: string }, actor: Identity): Promise<LegacyLikeResult> {
    const requestKey = eventKey(input.eventId);
    return this.database.withTransaction(async (tx) => {
      const previous = await this.prior(tx, requestKey); if (previous !== null) return previous;
      const usage = (await tx.query<Array<{ value: bigint }>>("SELECT value FROM player_counters WHERE player_id=? AND counter_code='cntlike' AND period_key=?", [actor.player_id, legacyLikeKstDate()]))[0]?.value;
      const value = usage?.toString() ?? "undefined";
      const message = usage !== undefined && usage >= 3n ? `좋아요 ${value}번을 모두 사용했습니다.` : `좋아요 사용 횟수: ${value}번`;
      const operationId = await this.operation(tx, requestKey, "player", actor.player_id);
      const proof = await evidence(tx, { operationId, eventId: input.eventId, commandCode: "LEGACY_LIKE_COUNT_READ", actorType: "player", actorId: actor.player_id, targetId: actor.player_id, actionCode: "social.legacy_like.count.read", summary: { periodKey: legacyLikeKstDate(), value }, destinationId: input.destinationId, message });
      return this.finish(tx, operationId, { kind: "count", message, ...proof, replayed: false, pointAfter: null, usageAfter: usage?.toString() ?? null, currentLikeAfter: null, affectedCount: null });
    });
  }

  private async rank(input: { eventId: string; destinationId: string }, actor: Identity): Promise<LegacyLikeResult> {
    const requestKey = eventKey(input.eventId);
    return this.database.withTransaction(async (tx) => {
      const previous = await this.prior(tx, requestKey); if (previous !== null) return previous;
      await tx.query("SELECT version FROM social_like_global_locks WHERE lock_code='LEGACY_LIKE' FOR UPDATE");
      const rows = await tx.query<RankRow[]>(`SELECT player.id player_id,profile.current_display_name display_name,COALESCE(MAX(CASE WHEN counter.counter_code='like' AND counter.period_key='current' THEN counter.value END),0) like_count FROM players player JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_counters counter ON counter.player_id=player.id WHERE player.status='active' AND player.deleted_at IS NULL GROUP BY player.id,profile.current_display_name ORDER BY like_count DESC,player.id ASC`);
      const operationId = await this.operation(tx, requestKey, "player", actor.player_id);
      const champion = rows[0]?.player_id ?? null;
      const snapshot = rows.map((row, index) => ({ rank: index + 1, playerId: row.player_id.toString(), displayName: row.display_name, currentLikes: row.like_count.toString() }));
      await tx.execute("INSERT INTO social_like_rank_snapshots(operation_id,actor_player_id,champion_player_id,row_count,snapshot_json) VALUES (?,?,?,?,?)", [operationId, actor.player_id, champion, rows.length, JSON.stringify(snapshot)]);
      await tx.execute("UPDATE social_like_champion_markers SET player_id=?,operation_id=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE marker_code='CURRENT'", [champion, operationId]);
      const message = formatLegacyLikeRank(rows);
      const proof = await evidence(tx, { operationId, eventId: input.eventId, commandCode: "LEGACY_LIKE_RANK_READ", actorType: "player", actorId: actor.player_id, targetId: champion, actionCode: "social.legacy_like.rank.read", summary: { rowCount: rows.length, championPlayerId: champion?.toString() ?? null, stableOrder: snapshot.map((row) => row.playerId) }, destinationId: input.destinationId, message });
      return this.finish(tx, operationId, { kind: "rank", message, ...proof, replayed: false, pointAfter: null, usageAfter: null, currentLikeAfter: champion === null ? null : rows[0]!.like_count.toString(), affectedCount: rows.length.toString() });
    });
  }

  private async reset(input: { eventId: string; externalUserId: string; destinationId: string }, kind: "reset" | "daily-reset"): Promise<LegacyLikeResult> {
    const operator = await this.operator(input.externalUserId);
    const requestKey = eventKey(input.eventId);
    return this.database.withTransaction(async (tx) => {
      const previous = await this.prior(tx, requestKey); if (previous !== null) return previous;
      await tx.query("SELECT version FROM social_like_global_locks WHERE lock_code='LEGACY_LIKE' FOR UPDATE");
      const operationId = await this.operation(tx, requestKey, "admin_operator", operator.operator_id);
      if (kind === "daily-reset") {
        if (operator.player_id === null) throw new ApplicationError("LEGACY_LIKE_DAILY_RESET_PLAYER_REQUIRED", "운영자 회원 연결 정보가 필요합니다.", 422);
        const periodKey = legacyLikeKstDate();
        await tx.execute("INSERT IGNORE INTO player_counters(player_id,counter_code,period_key,value,updated_at) VALUES (?,'cntlike',?,0,UTC_TIMESTAMP(3))", [operator.player_id, periodKey]);
        const row = (await tx.query<Array<{ value: bigint }>>("SELECT value FROM player_counters WHERE player_id=? AND counter_code='cntlike' AND period_key=? FOR UPDATE", [operator.player_id, periodKey]))[0]!;
        await tx.execute("UPDATE player_counters SET value=0,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND counter_code='cntlike' AND period_key=?", [operator.player_id, periodKey]);
        const message = "좋아요 사용 횟수를 초기화했습니다.";
        const preliminary = { kind: "daily-reset", targetPlayerId: operator.player_id.toString(), periodKey, before: row.value.toString() };
        await tx.execute("INSERT INTO social_like_reset_runs(operation_id,operator_id,reset_kind,target_player_id,period_key,affected_count,before_sum,result_json) VALUES (?,?,'daily',?,?,?, ?,?)", [operationId, operator.operator_id, operator.player_id, periodKey, row.value === 0n ? 0 : 1, row.value, JSON.stringify(preliminary)]);
        const proof = await evidence(tx, { operationId, eventId: input.eventId, commandCode: "LEGACY_LIKE_RESET", actorType: "admin_operator", actorId: operator.operator_id, targetId: operator.player_id, actionCode: "social.legacy_like.daily_reset", summary: preliminary, destinationId: input.destinationId, message });
        const result: LegacyLikeResult = { kind: "daily-reset", message, ...proof, replayed: false, pointAfter: null, usageAfter: "0", currentLikeAfter: null, affectedCount: row.value === 0n ? "0" : "1" };
        await tx.execute("UPDATE social_like_reset_runs SET result_json=? WHERE operation_id=?", [JSON.stringify(result), operationId]);
        return this.finish(tx, operationId, result);
      }
      const rows = await tx.query<Array<{ player_id: bigint; value: bigint }>>("SELECT player_id,value FROM player_counters WHERE counter_code='like' AND period_key='current' ORDER BY player_id FOR UPDATE");
      const changed = rows.filter((row) => row.value !== 0n), beforeSum = rows.reduce((sum, row) => sum + row.value, 0n);
      for (const row of changed) {
        await tx.execute("INSERT INTO player_counters(player_id,counter_code,period_key,value,updated_at) VALUES (?,'like0','lifetime',?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE value=value+VALUES(value),updated_at=UTC_TIMESTAMP(3)", [row.player_id, row.value]);
      }
      await tx.execute("UPDATE player_counters SET value=0,updated_at=UTC_TIMESTAMP(3) WHERE counter_code='like' AND period_key='current' AND value<>0");
      const message = "리셋완";
      const preliminary = { kind: "reset", affectedCount: changed.length, beforeSum: beforeSum.toString() };
      await tx.execute("INSERT INTO social_like_reset_runs(operation_id,operator_id,reset_kind,target_player_id,period_key,affected_count,before_sum,result_json) VALUES (?,?,'current_to_lifetime',NULL,NULL,?,?,?)", [operationId, operator.operator_id, changed.length, beforeSum, JSON.stringify(preliminary)]);
      const proof = await evidence(tx, { operationId, eventId: input.eventId, commandCode: "LEGACY_LIKE_RESET", actorType: "admin_operator", actorId: operator.operator_id, targetId: null, actionCode: "social.legacy_like.reset", summary: preliminary, destinationId: input.destinationId, message });
      const result: LegacyLikeResult = { kind: "reset", message, ...proof, replayed: false, pointAfter: null, usageAfter: null, currentLikeAfter: "0", affectedCount: changed.length.toString() };
      await tx.execute("UPDATE social_like_reset_runs SET result_json=? WHERE operation_id=?", [JSON.stringify(result), operationId]);
      return this.finish(tx, operationId, result);
    });
  }
}
