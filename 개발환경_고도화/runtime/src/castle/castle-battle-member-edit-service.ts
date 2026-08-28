import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const ATTEMPT_COMMAND = "/캐슬대전횟수리셋";
const SCORE_COMMAND = "/캐슬스코어";
const ATTEMPT_CODE = "CASTLE_BATTLE_ATTEMPT_SET";
const SCORE_CODE = "CASTLE_BATTLE_SCORE_SET";
const PERMISSION_CODE = "game.castle_battle.manage";
const MAX_UNSIGNED = 18_446_744_073_709_551_615n;
const MIN_SIGNED = -9_223_372_036_854_775_808n;
const MAX_SIGNED = 9_223_372_036_854_775_807n;

export interface CastleBattleMemberEditCommand {
  kind: "attempt" | "score";
  commandCode: typeof ATTEMPT_CODE | typeof SCORE_CODE;
  targetDisplayName: string;
  value: bigint;
}

interface MemberSnapshot {
  attempts: string;
  score: string;
  tierPoint: string;
  tierName: string;
  lastBattleAt: string | null;
}

export interface CastleBattleMemberEditResult {
  status: "completed";
  commandCode: string;
  seasonId: string;
  targetPlayerId: string;
  targetDisplayName: string;
  before: MemberSnapshot;
  after: MemberSnapshot;
  changed: boolean;
  invalidatedSnapshotCount: string;
  data: string;
  outboxId: string;
  auditId: string;
  replayed: boolean;
}

interface OperatorRow { operator_id: bigint; }
interface SeasonRow { id: bigint; }
interface TargetRow { player_id: bigint; }
interface StateRow { score: bigint; tier_point: bigint; last_battle_at: string | Date | null; version: bigint; }
interface DailyRow { castle_battle_attempts: bigint; castle_battle_score: bigint; castle_rank_label: string | null; version: bigint; }
interface RankRow { score_requirement: bigint; tier_point: bigint; rank_name: string; }

// 두 운영자 명령은 대상명과 마지막 정수 토큰이 완전할 때만 현대화 후보가 됩니다.
export function isCastleBattleMemberEditCommandCandidate(message: string | undefined): boolean {
  if (message === undefined || (!message.startsWith(`${ATTEMPT_COMMAND} `) && !message.startsWith(`${SCORE_COMMAND} `))) return false;
  try { parseCastleBattleMemberEditCommand(message); return true; } catch { return false; }
}

// 마지막 정수 토큰을 값으로 분리해 공백을 포함한 표시명을 그대로 보존합니다.
export function parseCastleBattleMemberEditCommand(message: string): CastleBattleMemberEditCommand {
  const match = /^(\/캐슬대전횟수리셋|\/캐슬스코어)\s+([^\r\n]+?)\s+(-?\d+)$/.exec(message);
  if (match === null) throw new ApplicationError("INVALID_CASTLE_BATTLE_MEMBER_EDIT_COMMAND", "사용법: /캐슬대전횟수리셋 [대상] [값] 또는 /캐슬스코어 [대상] [값]", 422);
  const targetDisplayName = match[2]!.trim();
  const rawValue = match[3]!;
  if (targetDisplayName.length === 0) throw new ApplicationError("INVALID_CASTLE_BATTLE_MEMBER_EDIT_TARGET", "대상 회원명을 입력해주세요.", 422);
  const kind = match[1] === ATTEMPT_COMMAND ? "attempt" : "score";
  if (kind === "attempt" && rawValue.startsWith("-")) throw new ApplicationError("INVALID_CASTLE_BATTLE_ATTEMPT_VALUE", "캐슬대전 횟수는 0 이상의 정수로 입력해주세요.", 422);
  const value = BigInt(rawValue);
  if (kind === "attempt" && value > MAX_UNSIGNED) throw new ApplicationError("CASTLE_BATTLE_ATTEMPT_OUT_OF_RANGE", "캐슬대전 횟수가 저장 범위를 벗어났습니다.", 422);
  if (kind === "score" && (value < MIN_SIGNED || value > MAX_SIGNED)) throw new ApplicationError("CASTLE_BATTLE_SCORE_OUT_OF_RANGE", "캐슬스코어가 저장 범위를 벗어났습니다.", 422);
  return { kind, commandCode: kind === "attempt" ? ATTEMPT_CODE : SCORE_CODE, targetDisplayName, value };
}

// 레거시 성공 의미를 유지하면서 실제 반영된 절대값을 명확히 보여줍니다.
export function formatCastleBattleMemberEditReply(command: CastleBattleMemberEditCommand): string {
  return command.kind === "attempt"
    ? `[${command.targetDisplayName}] 님의 캐슬대전 횟수를 ${command.value.toString()}회로 변경했습니다.`
    : `[${command.targetDisplayName}] 님의 캐슬스코어를 ${command.value.toString()}점으로 변경했습니다.`;
}

// 캐슬대전 회원 횟수·점수 편집을 권한, 잠금, 감사, outbox와 한 transaction으로 처리합니다.
export class CastleBattleMemberEditService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<{ status: "changed"; data: string; outboxId: string } | { status: "shadow" } | { status: "legacy_fallback" }> {
    const command = parseCastleBattleMemberEditCommand(input.message);
    const rollout = (await this.database.query<Array<{ rollout_state: string; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [command.commandCode]
    ))[0];
    if (rollout === undefined || rollout.enabled !== 1 || rollout.rollout_state === "LEGACY_ONLY") return { status: "legacy_fallback" };
    if (rollout.rollout_state !== "ACTIVE") return { status: "shadow" };
    const result = await this.update({ ...input, command });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async update(input: { eventId: string; externalUserId: string; channelId: string; command: CastleBattleMemberEditCommand }): Promise<CastleBattleMemberEditResult> {
    const requestKey = normalizeEventKey(input.eventId);
    return this.database.withTransaction(async (transaction) => {
      const operator = await findOperator(transaction, input.externalUserId);
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,'castle.battle.member_edit',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
        [randomUUID(), requestKey, operator.operator_id]
      );
      const operationRows = await transaction.query<Array<{ actor_id: string; result_json: string | CastleBattleMemberEditResult | null }>>(
        "SELECT actor_id,result_json FROM operations WHERE id=? FOR UPDATE", [operation.insertId]
      );
      const operationRow = operationRows[0]!;
      if (String(operationRow.actor_id) !== operator.operator_id.toString()) throw new ApplicationError("CASTLE_MEMBER_EDIT_REPLAY_ACTOR_MISMATCH", "동일 요청의 실행자가 다릅니다.", 409);
      if (operationRow.result_json !== null) return { ...stored(operationRow.result_json), replayed: true };

      const season = (await transaction.query<SeasonRow[]>(
        `SELECT id FROM castle_battle_seasons WHERE status='active'
         AND (starts_at IS NULL OR starts_at<=UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at>=UTC_TIMESTAMP(3))
         ORDER BY starts_at DESC,id DESC LIMIT 1 FOR UPDATE`
      ))[0];
      if (season === undefined) throw new ApplicationError("CASTLE_BATTLE_ACTIVE_SEASON_REQUIRED", "진행 중인 캐슬대전 시즌이 필요합니다.", 409);
      const targets = await transaction.query<TargetRow[]>(
        `SELECT profile.player_id FROM player_profiles profile
         JOIN players player ON player.id=profile.player_id AND player.status='active'
         WHERE profile.current_display_name=? ORDER BY profile.player_id LIMIT 2 FOR UPDATE`,
        [input.command.targetDisplayName]
      );
      if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", "❌ 존재하지 않는 유저입니다.", 404);
      if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID 기준 수정이 필요합니다.", 409);
      const targetPlayerId = targets[0]!.player_id;
      const state = (await transaction.query<StateRow[]>(
        "SELECT score,tier_point,last_battle_at,version FROM castle_battle_player_states WHERE season_id=? AND player_id=? FOR UPDATE",
        [season.id, targetPlayerId]
      ))[0];
      if (state === undefined) throw new ApplicationError("CASTLE_BATTLE_MEMBER_STATE_REQUIRED", "대상의 캐슬대전 시즌 상태가 없습니다.", 409);
      await transaction.execute(
        `INSERT INTO player_pet_daily_records(player_id,record_date,castle_battle_score,version)
         VALUES (?,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)),?,1)
         ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)`,
        [targetPlayerId, state.score]
      );
      const daily = (await transaction.query<DailyRow[]>(
        `SELECT castle_battle_attempts,castle_battle_score,castle_rank_label,version FROM player_pet_daily_records
         WHERE player_id=? AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)) FOR UPDATE`,
        [targetPlayerId]
      ))[0]!;
      const rankRows = await transaction.query<RankRow[]>(
        "SELECT score_requirement,tier_point,rank_name FROM castle_battle_rank_definitions ORDER BY score_requirement FOR UPDATE"
      );
      if (rankRows.length === 0) throw new ApplicationError("CASTLE_BATTLE_RANK_DEFINITION_REQUIRED", "캐슬대전 등급 설정이 없습니다.", 409);
      const currentRank = rankFor(state.score, rankRows);
      const before: MemberSnapshot = {
        attempts: daily.castle_battle_attempts.toString(), score: state.score.toString(), tierPoint: state.tier_point.toString(),
        tierName: currentRank.rank_name, lastBattleAt: state.last_battle_at === null ? null : new Date(state.last_battle_at).toISOString()
      };
      let stateVersionAfter = state.version;
      let dailyVersionAfter = daily.version;
      let invalidatedSnapshotCount = 0n;
      let changed = false;

      if (input.command.kind === "attempt") {
        changed = daily.castle_battle_attempts !== input.command.value;
        if (changed) {
          const write = await transaction.execute(
            `UPDATE player_pet_daily_records SET castle_battle_attempts=?,version=version+1,updated_at=UTC_TIMESTAMP(3)
             WHERE player_id=? AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)) AND version=?`,
            [input.command.value, targetPlayerId, daily.version]
          );
          if (write.affectedRows !== 1n) throw new ApplicationError("CASTLE_BATTLE_DAILY_VERSION_CONFLICT", "캐슬대전 횟수가 먼저 변경되었습니다.", 409);
          dailyVersionAfter += 1n;
        }
      } else {
        const nextRank = rankFor(input.command.value, rankRows);
        const stateWrite = await transaction.execute(
          `UPDATE castle_battle_player_states SET score=?,tier_point=?,last_battle_at=UTC_TIMESTAMP(3),version=version+1
           WHERE season_id=? AND player_id=? AND version=?`,
          [input.command.value, nextRank.tier_point, season.id, targetPlayerId, state.version]
        );
        if (stateWrite.affectedRows !== 1n) throw new ApplicationError("CASTLE_BATTLE_STATE_VERSION_CONFLICT", "캐슬스코어가 먼저 변경되었습니다.", 409);
        const dailyWrite = await transaction.execute(
          `UPDATE player_pet_daily_records SET castle_battle_score=?,castle_rank_label=?,version=version+1,updated_at=UTC_TIMESTAMP(3)
           WHERE player_id=? AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)) AND version=?`,
          [input.command.value, nextRank.rank_name, targetPlayerId, daily.version]
        );
        if (dailyWrite.affectedRows !== 1n) throw new ApplicationError("CASTLE_BATTLE_DAILY_VERSION_CONFLICT", "캐슬대전 일일 상태가 먼저 변경되었습니다.", 409);
        stateVersionAfter += 1n;
        dailyVersionAfter += 1n;
        changed = true;
        const snapshots = await transaction.query<Array<{ id: bigint; status: string }>>(
          "SELECT id,status FROM castle_battle_rank_snapshots WHERE season_id=? AND status='published' ORDER BY id FOR UPDATE", [season.id]
        );
        for (const snapshot of snapshots) {
          await transaction.execute(
            `INSERT INTO castle_battle_rank_snapshot_invalidations(operation_id,snapshot_id,season_id,target_player_id,reason_code,previous_status)
             VALUES (?,?,?,?,?,?)`,
            [operation.insertId, snapshot.id, season.id, targetPlayerId, "admin_score_edit", snapshot.status]
          );
        }
        if (snapshots.length > 0) {
          const invalidated = await transaction.execute(
            "UPDATE castle_battle_rank_snapshots SET status='invalidated' WHERE season_id=? AND status='published'", [season.id]
          );
          invalidatedSnapshotCount = invalidated.affectedRows;
        }
      }

      const finalState = (await transaction.query<StateRow[]>(
        "SELECT score,tier_point,last_battle_at,version FROM castle_battle_player_states WHERE season_id=? AND player_id=?", [season.id, targetPlayerId]
      ))[0]!;
      const finalDaily = (await transaction.query<DailyRow[]>(
        `SELECT castle_battle_attempts,castle_battle_score,castle_rank_label,version FROM player_pet_daily_records
         WHERE player_id=? AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))`, [targetPlayerId]
      ))[0]!;
      const finalRank = rankFor(finalState.score, rankRows);
      const after: MemberSnapshot = {
        attempts: finalDaily.castle_battle_attempts.toString(), score: finalState.score.toString(), tierPoint: finalState.tier_point.toString(),
        tierName: finalDaily.castle_rank_label ?? finalRank.rank_name,
        lastBattleAt: finalState.last_battle_at === null ? null : new Date(finalState.last_battle_at).toISOString()
      };
      const data = formatCastleBattleMemberEditReply(input.command);
      await transaction.execute(
        `INSERT INTO castle_battle_member_adjustment_runs(operation_id,request_key,operator_id,command_code,season_id,target_player_id,daily_record_date,
           before_json,after_json,changed,state_version_before,state_version_after,daily_version_before,daily_version_after)
         VALUES (?,?,?,?,?,?,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)),?,?,?,?,?,?,?)`,
        [operation.insertId, requestKey, operator.operator_id, input.command.commandCode, season.id, targetPlayerId,
          JSON.stringify(before), JSON.stringify(after), changed, state.version, stateVersionAfter, daily.version, dailyVersionAfter]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'player',?,'castle.battle.member_edit','success',?, ?,UTC_TIMESTAMP(3))`,
        [operation.insertId, operator.operator_id, targetPlayerId, `Iris 총괄 운영자 ${input.command.kind === "attempt" ? ATTEMPT_COMMAND : SCORE_COMMAND}`,
          JSON.stringify({ commandCode: input.command.commandCode, before, after, changed, invalidatedSnapshotCount: invalidatedSnapshotCount.toString() })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,?,?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.eventId, input.command.commandCode, operation.insertId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.channelId, JSON.stringify({ data })]
      );
      const result: CastleBattleMemberEditResult = {
        status: "completed", commandCode: input.command.commandCode, seasonId: season.id.toString(), targetPlayerId: targetPlayerId.toString(),
        targetDisplayName: input.command.targetDisplayName, before, after, changed,
        invalidatedSnapshotCount: invalidatedSnapshotCount.toString(), data, outboxId: outbox.insertId.toString(),
        auditId: audit.insertId.toString(), replayed: false
      };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}

// 현재 transaction의 고정 권한 스냅샷에서 캐슬대전 관리 권한을 확인합니다.
async function findOperator(transaction: DatabaseTransaction, externalUserId: string): Promise<OperatorRow> {
  const row = (await transaction.query<OperatorRow[]>(
    `SELECT mapping.operator_id FROM external_identities identity
     JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
     JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
     JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
     JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id AND permission.permission_code=?
     WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
     ORDER BY mapping.operator_id LIMIT 1 FOR UPDATE`,
    [PERMISSION_CODE, externalUserId]
  ))[0];
  if (row === undefined) throw new ApplicationError("CASTLE_BATTLE_MEMBER_EDIT_PERMISSION_REQUIRED", "❌ 캐슬대전 회원 편집 권한이 없습니다.", 403);
  return row;
}

// 점수 이하의 최고 등급을 선택하고 음수 점수는 최저 등급으로 고정합니다.
function rankFor(score: bigint, definitions: readonly RankRow[]): RankRow {
  let selected = definitions[0]!;
  for (const definition of definitions) {
    if (definition.score_requirement <= score) selected = definition;
    else break;
  }
  return selected;
}

function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

function stored(value: string | CastleBattleMemberEditResult): CastleBattleMemberEditResult {
  return typeof value === "string" ? JSON.parse(value) as CastleBattleMemberEditResult : value;
}
