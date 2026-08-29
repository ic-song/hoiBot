import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { MariaCommandDispatchRepository } from "../dispatch/command-dispatcher.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/펀치순위초기화";
const COMMAND_CODE = "ADMIN_PUNCH_RANK_RESET";
const HANDLER_KEY = "admin_punch_rank_reset";
const PERMISSION_CODE = "punch.rank.reset";
const SCOPE = "admin.punch_rank.reset";

type Numeric = bigint | number | string;
interface AuthorityRow { operator_id: Numeric; identity_id: Numeric }
interface PunchRankStateRow { player_id: Numeric; best_score: Numeric; best_rank: string; total_play: Numeric; total_reward: Numeric; legend_count: Numeric; last_score: Numeric; last_rank: string; source_order: Numeric; version: Numeric; updated_at: string }
interface ReplayRow { operator_id: Numeric; result_json: string | PunchRankResetResult }

export interface PunchRankResetResult {
  status: "reset";
  operationId: string;
  snapshotId: string;
  resetRowCount: number;
  snapshotChecksum: string;
  data: string;
  outboxId: string;
}

export type PunchRankResetIrisResult = { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" | "handled_no_reply" };

// 펀치 순위 초기화는 인자 없는 정확 명령만 허용합니다.
export function isPunchRankResetCommand(message: string | undefined): boolean { return message === COMMAND; }

// player ID 순서의 정규화된 행으로 불변 snapshot checksum을 계산합니다.
export function computePunchRankResetChecksum(rows: readonly PunchRankStateRow[]): string {
  return createHash("sha256").update(rows.map(canonicalRow).join("\n")).digest("hex");
}

// 관리자 RBAC 확인 후 전체 펀치 순위를 snapshot과 함께 원자적으로 초기화합니다.
export class PunchRankResetService {
  public constructor(private readonly database: DatabaseClient) {}

  // rollout 상태와 최종 실행 결과를 Iris 중앙 dispatch 계약으로 반환합니다.
  public async handleIris(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<PunchRankResetIrisResult> {
    if (!isPunchRankResetCommand(input.message)) return { status: "legacy_fallback" };
    const definition = (await this.database.query<Array<{ rollout_state: string; enabled: number | boolean }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]))[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    const dispatchInput = { eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true };
    if (definition === undefined || !definition.enabled || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record(dispatchInput, { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state !== "ACTIVE") {
      await dispatch.record(dispatchInput, { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY });
      return { status: "shadow" };
    }
    await dispatch.record(dispatchInput, { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY });
    try {
      const result = await this.reset(input);
      return { status: "changed", data: result.data, outboxId: result.outboxId };
    } catch (error) {
      if (error instanceof ApplicationError && error.code === "PUNCH_RANK_RESET_FORBIDDEN") return { status: "handled_no_reply" };
      throw error;
    }
  }

  // 정렬 잠금·snapshot·삭제·감사·outbox를 단일 transaction으로 처리합니다.
  public async reset(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<PunchRankResetResult> {
    if (!isPunchRankResetCommand(input.message)) throw new ApplicationError("INVALID_PUNCH_RANK_RESET_COMMAND", "펀치 순위 초기화 명령 형식이 올바르지 않습니다.", 422);
    const requestKey = eventKey(input.eventId);
    return this.database.withTransaction(async (transaction) => {
      const authority = await requireAuthority(transaction, input.externalUserId);
      await transaction.query("SELECT lock_code FROM admin_global_locks WHERE lock_code='punch_rank_reset' FOR UPDATE");
      const replay = (await transaction.query<ReplayRow[]>("SELECT operator_id,result_json FROM punch_rank_reset_runs WHERE request_key=? FOR UPDATE", [requestKey]))[0];
      if (replay !== undefined) {
        if (String(replay.operator_id) !== String(authority.operator_id)) throw new ApplicationError("PUNCH_RANK_RESET_REPLAY_ACTOR_MISMATCH", "같은 초기화 요청의 운영자가 다릅니다.", 409);
        return stored(replay.result_json);
      }
      const rows = await transaction.query<PunchRankStateRow[]>("SELECT player_id,best_score,best_rank,total_play,total_reward,legend_count,last_score,last_rank,source_order,version,DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s.%f') updated_at FROM player_punch_rank_stats ORDER BY player_id FOR UPDATE");
      const snapshotChecksum = computePunchRankResetChecksum(rows);
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), SCOPE, requestKey, authority.identity_id]);
      const snapshot = await transaction.execute("INSERT INTO punch_rank_reset_snapshots(operation_id,row_count,snapshot_checksum) VALUES (?,?,?)", [operation.insertId, rows.length, snapshotChecksum]);
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]!;
        await transaction.execute("INSERT INTO punch_rank_reset_snapshot_rows(snapshot_id,player_id,ordinal_value,best_score,best_rank,total_play,total_reward,legend_count,last_score,last_rank,source_order,version,source_updated_at,row_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [snapshot.insertId, row.player_id, index + 1, row.best_score, row.best_rank, row.total_play, row.total_reward, row.legend_count, row.last_score, row.last_rank, row.source_order, row.version, row.updated_at, sha(canonicalRow(row))]);
      }
      const deleted = await transaction.execute("DELETE FROM player_punch_rank_stats");
      if (deleted.affectedRows !== BigInt(rows.length)) throw new Error("PUNCH_RANK_RESET_COUNT_MISMATCH");
      const remaining = (await transaction.query<Array<{ count_value: Numeric }>>("SELECT COUNT(*) count_value FROM player_punch_rank_stats"))[0]!;
      if (BigInt(remaining.count_value) !== 0n) throw new Error("PUNCH_RANK_RESET_POSTCONDITION_FAILED");
      const data = `✅ 펀치 순위 초기화 완료\n초기화 기록: ${rows.length}개\n복구 스냅샷: #${snapshot.insertId}`;
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.channelId, JSON.stringify({ data })]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','reset',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, COMMAND_CODE, operation.insertId]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'leaderboard',NULL,'admin.punch_rank.reset','reset','Iris /펀치순위초기화',?,UTC_TIMESTAMP(3))", [operation.insertId, authority.identity_id, JSON.stringify({ resetRowCount: rows.length, snapshotId: snapshot.insertId.toString(), snapshotChecksum, rewardChanged: false, rngUsed: false })]);
      const result: PunchRankResetResult = { status: "reset", operationId: operation.insertId.toString(), snapshotId: snapshot.insertId.toString(), resetRowCount: rows.length, snapshotChecksum, data, outboxId: outbox.insertId.toString() };
      await transaction.execute("INSERT INTO punch_rank_reset_runs(operation_id,request_key,operator_id,identity_id,snapshot_id,reset_row_count,snapshot_checksum,result_json) VALUES (?,?,?,?,?,?,?,?)", [operation.insertId, requestKey, authority.operator_id, authority.identity_id, snapshot.insertId, rows.length, snapshotChecksum, JSON.stringify(result)]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}

// 표준 operator-role-permission 관계로 초기화 권한을 확인합니다.
async function requireAuthority(transaction: DatabaseTransaction, externalUserId: string): Promise<AuthorityRow> {
  const row = (await transaction.query<AuthorityRow[]>(`SELECT operator_row.id operator_id,identity.id identity_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator_row ON operator_row.id=mapping.operator_id AND operator_row.status='active' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator_row.id JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code=? WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY operator_row.id LIMIT 1 FOR UPDATE`, [PERMISSION_CODE, externalUserId]))[0];
  if (row === undefined) throw new ApplicationError("PUNCH_RANK_RESET_FORBIDDEN", "펀치 순위 초기화 권한이 없습니다.", 403);
  return row;
}

function canonicalRow(row: PunchRankStateRow): string { return [row.player_id,row.best_score,row.best_rank,row.total_play,row.total_reward,row.legend_count,row.last_score,row.last_rank,row.source_order,row.version,row.updated_at].map(String).join("|"); }
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${sha(value)}`; }
function sha(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function stored(value: string | PunchRankResetResult): PunchRankResetResult { return typeof value === "string" ? JSON.parse(value) as PunchRankResetResult : value; }
