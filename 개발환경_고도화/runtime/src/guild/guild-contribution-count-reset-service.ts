import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/공헌구매초기화";
const COMMAND_CODE = "GUILD_CONTRIBUTION_COUNT_RESET";
const COUNTER_CODE = "guild_contribution_medal_purchase_count";
const PERIOD_KEY = "lifetime";
const PERMISSION_CODE = "guild.contribution_count.reset";
const SCOPE = "admin.guild_contribution_count.reset";
const USAGE = "사용법: /공헌구매초기화 [닉네임]";

export interface GuildContributionCountResetInput { eventId: string; externalUserId: string; channelId: string; message: string; }
export interface GuildContributionCountResetCommand { targetDisplayName: string; }
export interface GuildContributionCountResetResult {
  status: "reset";
  targetPlayerId: string;
  targetDisplayName: string;
  valueBefore: string;
  valueAfter: "0";
  changed: boolean;
  data: string;
  outboxId: string;
  auditId: string;
}
interface OperatorRow { operator_id: bigint; }
interface TargetRow { player_id: bigint; display_name: string; }
interface ReplayRow { actor_id: bigint | null; result_json: string | GuildContributionCountResetResult | null; }

// 공헌구매초기화의 bare 안내형 또는 닉네임 인수형만 공용 dispatch 후보로 인정합니다.
export function isGuildContributionCountResetCommand(message: string | undefined): boolean {
  return message === COMMAND || (message !== undefined && message.startsWith(`${COMMAND} `) && !/[\r\n]/.test(message));
}

// 첫 명령 토큰 뒤 전체 문자열을 공백 포함 표시명으로 보존합니다.
export function parseGuildContributionCountResetCommand(message: string): GuildContributionCountResetCommand {
  if (!isGuildContributionCountResetCommand(message)) throw new ApplicationError("INVALID_GUILD_CONTRIBUTION_COUNT_RESET_COMMAND", USAGE, 422);
  const targetDisplayName = message.slice(COMMAND.length).trim();
  if (targetDisplayName.length === 0) throw new ApplicationError("INVALID_GUILD_CONTRIBUTION_COUNT_RESET_COMMAND", USAGE, 422);
  return { targetDisplayName };
}

// 대상과 초기화 전 횟수를 함께 보여 레거시 운영 확인 흐름을 유지합니다.
export function formatGuildContributionCountResetReply(targetDisplayName: string, valueBefore: bigint): string {
  return `✅ [${targetDisplayName}]님의 공헌훈장 구매횟수를 초기화했습니다.\n이전 구매횟수: ${valueBefore.toString()}회`;
}

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | GuildContributionCountResetResult): GuildContributionCountResetResult { return typeof value === "string" ? JSON.parse(value) as GuildContributionCountResetResult : value; }
function retryable(error: unknown): boolean { const value = error as { code?: unknown; errno?: unknown }; return value.code === "ER_LOCK_DEADLOCK" || value.code === "ER_LOCK_WAIT_TIMEOUT" || value.code === "ER_DUP_ENTRY" || value.errno === 1213 || value.errno === 1205 || value.errno === 1062; }

// 총괄 운영자 권한과 대상 lifetime counter를 잠가 감사·응답까지 원자 초기화합니다.
export class GuildContributionCountResetService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: GuildContributionCountResetInput): Promise<{ status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }> {
    parseGuildContributionCountResetCommand(input.message);
    const rollout = (await this.database.query<Array<{ rollout_state: string; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]
    ))[0];
    if (rollout === undefined || rollout.enabled !== 1 || rollout.rollout_state === "LEGACY_ONLY") return { status: "legacy_fallback" };
    if (rollout.rollout_state !== "ACTIVE") return { status: "shadow" };
    const result = await this.reset(input);
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async reset(input: GuildContributionCountResetInput): Promise<GuildContributionCountResetResult> {
    const command = parseGuildContributionCountResetCommand(input.message);
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.database.withTransaction(async (transaction) => {
          const operator = await requireOperator(transaction, input.externalUserId);
          const key = eventKey(input.eventId);
          const prior = (await transaction.query<ReplayRow[]>(
            "SELECT actor_id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [SCOPE, key]
          ))[0];
          if (prior?.result_json !== undefined && prior.result_json !== null) {
            if (prior.actor_id !== operator.operator_id) throw new ApplicationError("GUILD_CONTRIBUTION_COUNT_RESET_REPLAY_ACTOR_MISMATCH", "동일 요청의 실행자가 다릅니다.", 409);
            return stored(prior.result_json);
          }
          const target = await requireTarget(transaction, command.targetDisplayName);
          await transaction.execute(
            "INSERT INTO player_counters(player_id,counter_code,period_key,value,updated_at) VALUES (?,?,?,0,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)",
            [target.player_id, COUNTER_CODE, PERIOD_KEY]
          );
          const counter = (await transaction.query<Array<{ value: bigint }>>(
            "SELECT value FROM player_counters WHERE player_id=? AND counter_code=? AND period_key=? FOR UPDATE",
            [target.player_id, COUNTER_CODE, PERIOD_KEY]
          ))[0];
          if (counter === undefined) throw new Error("Guild contribution purchase counter was not created.");
          const operation = await transaction.execute(
            "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
            [randomUUID(), SCOPE, key, operator.operator_id]
          );
          const changed = counter.value !== 0n;
          if (changed) {
            const write = await transaction.execute(
              "UPDATE player_counters SET value=0,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND counter_code=? AND period_key=? AND value=?",
              [target.player_id, COUNTER_CODE, PERIOD_KEY, counter.value]
            );
            if (write.affectedRows !== 1n) throw new ApplicationError("GUILD_CONTRIBUTION_COUNT_RESET_CONFLICT", "공헌훈장 구매횟수가 먼저 변경되었습니다.", 409);
          }
          await transaction.execute(
            "INSERT INTO admin_guild_contribution_count_resets(operation_id,target_player_id,counter_code,period_key,value_before,value_after,changed) VALUES (?,?,?,?,?,0,?)",
            [operation.insertId, target.player_id, COUNTER_CODE, PERIOD_KEY, counter.value, changed]
          );
          const data = formatGuildContributionCountResetReply(target.display_name, counter.value);
          const outbox = await transaction.execute(
            "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
            [operation.insertId, input.channelId, JSON.stringify({ data })]
          );
          await transaction.execute(
            "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
            [input.eventId, COMMAND_CODE, operation.insertId, changed ? "reset" : "already_zero"]
          );
          const audit = await transaction.execute(
            "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player',?,'guild.contribution_count.reset','success','Iris /공헌구매초기화',?,UTC_TIMESTAMP(3))",
            [operation.insertId, operator.operator_id, target.player_id, JSON.stringify({ counterCode: COUNTER_CODE, periodKey: PERIOD_KEY, valueBefore: counter.value.toString(), valueAfter: "0", changed })]
          );
          const result: GuildContributionCountResetResult = {
            status: "reset", targetPlayerId: target.player_id.toString(), targetDisplayName: target.display_name,
            valueBefore: counter.value.toString(), valueAfter: "0", changed, data,
            outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString()
          };
          await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
          return result;
        });
      } catch (error) {
        lastError = error;
        if (!retryable(error) || attempt === 3) throw error;
      }
    }
    throw lastError;
  }
}

// 연결된 Kakao identity의 활성 총괄 운영자 permission을 확인합니다.
async function requireOperator(transaction: DatabaseTransaction, externalUserId: string): Promise<OperatorRow> {
  const operator = (await transaction.query<OperatorRow[]>(
    `SELECT mapping.operator_id FROM external_identities identity
     JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
     JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
     JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
     JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
     JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code=?
     WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
     ORDER BY mapping.operator_id LIMIT 1 FOR UPDATE`, [PERMISSION_CODE, externalUserId]
  ))[0];
  if (operator === undefined) throw new ApplicationError("FORBIDDEN", "공헌훈장 구매횟수 초기화 권한이 없습니다.", 403);
  return operator;
}

// 활성 회원 표시명을 단일 stable player ID로 확정하고 중복 표시명을 차단합니다.
async function requireTarget(transaction: DatabaseTransaction, targetDisplayName: string): Promise<TargetRow> {
  const targets = await transaction.query<TargetRow[]>(
    `SELECT player.id player_id,profile.current_display_name display_name FROM player_profiles profile
     JOIN players player ON player.id=profile.player_id AND player.status='active' AND player.deleted_at IS NULL
     WHERE profile.current_display_name=? ORDER BY player.id LIMIT 2 FOR UPDATE`, [targetDisplayName]
  );
  if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", "❌ 존재하지 않는 유저입니다.", 404);
  if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID 기준 수정이 필요합니다.", 409);
  return targets[0]!;
}
