import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";

const COMMAND_CODE = "ADMIN_MINI_PET_BATTLE_COUNT";
const HANDLER_KEY = "admin_mini_pet_battle_count";
const MAX_UNSIGNED_BIGINT = 18446744073709551615n;
const USAGE = "사용법: /미니펫대전횟수 [대상] [횟수]";

interface OperatorRow { operator_id: bigint; }
interface PlayerRow { player_id: bigint; }
interface DailyRow { record_date: string; mini_battle_attempts: bigint; mini_battle_wins: bigint; mini_battle_losses: bigint; version: bigint; }
interface OperationRow { result_json: string | MiniPetBattleCountAdminResult | null; }

export interface MiniPetBattleCountAdminCommand { targetName: string; count: bigint; }
export interface MiniPetBattleCountAdminResult {
  status: "changed" | "unchanged" | "usage" | "not_found" | "ambiguous_target";
  data: string;
  targetPlayerId: string | null;
  recordDate: string | null;
  previousCount: string | null;
  count: string | null;
  wins: string | null;
  losses: string | null;
  previousVersion: string | null;
  version: string | null;
  operationId: string;
  executionId: string;
  auditId: string;
  outboxId: string;
}

// 미니펫 대전 횟수 명령의 정확 명령과 공백 인자형만 dispatch 후보로 허용합니다.
export function isMiniPetBattleCountAdminCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && (message === "/미니펫대전횟수" || /^\/미니펫대전횟수\s+.+$/.test(message));
}

// 대상명과 마지막 unsigned BIGINT 횟수의 완전한 형식만 해석합니다.
export function parseMiniPetBattleCountAdminCommand(message: string): MiniPetBattleCountAdminCommand | null {
  const match = /^\/미니펫대전횟수\s+(\S(?:.*\S)?)\s+(0|[1-9]\d*)$/.exec(message);
  if (match === null) return null;
  const count = BigInt(match[2]!);
  if (count > MAX_UNSIGNED_BIGINT) return null;
  return { targetName: match[1]!.trim(), count };
}

function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function storedResult(value: string | MiniPetBattleCountAdminResult): MiniPetBattleCountAdminResult {
  return typeof value === "string" ? JSON.parse(value) as MiniPetBattleCountAdminResult : value;
}

function isRetryableConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = String((error as { code?: unknown }).code ?? "");
  return code === "ER_CHECKREAD" || code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT";
}

async function runTransactionWithRetry<T>(database: DatabaseClient, work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await database.withTransaction(work); }
    catch (error) {
      lastError = error;
      if (!isRetryableConflict(error) || attempt === 2) throw error;
    }
  }
  throw lastError;
}

async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint; eventId: string; destinationId: string; operatorId: string;
  status: MiniPetBattleCountAdminResult["status"]; data: string; targetPlayerId: bigint | null;
  recordDate: string | null; previousCount: bigint | null; count: bigint | null;
  wins: bigint | null; losses: bigint | null; previousVersion: bigint | null; version: bigint | null;
}): Promise<MiniPetBattleCountAdminResult> {
  if (input.targetPlayerId !== null && input.recordDate !== null && input.previousCount !== null && input.count !== null
    && input.previousVersion !== null && input.version !== null) {
    await transaction.execute(
      `INSERT INTO mini_pet_battle_count_override_events
       (operation_id,player_id,record_date,previous_count,count_value,previous_version,version,changed)
       VALUES (?,?,?,?,?,?,?,?)`,
      [input.operationId,input.targetPlayerId,input.recordDate,input.previousCount,input.count,input.previousVersion,input.version,input.status === "changed"]
    );
  }
  const execution = await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_MINI_PET_BATTLE_COUNT',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId,input.operationId,input.status]
  );
  const audit = await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player',?,'mini_pet.battle_count.override',?,'Iris /미니펫대전횟수',?,UTC_TIMESTAMP(3))",
    [input.operationId,input.operatorId,input.targetPlayerId,input.status,JSON.stringify({
      recordDate:input.recordDate,previousCount:input.previousCount?.toString() ?? null,count:input.count?.toString() ?? null,
      wins:input.wins?.toString() ?? null,losses:input.losses?.toString() ?? null,
      previousVersion:input.previousVersion?.toString() ?? null,version:input.version?.toString() ?? null
    })]
  );
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId,input.destinationId,JSON.stringify({ data:input.data })]
  );
  const result: MiniPetBattleCountAdminResult = {
    status:input.status,data:input.data,targetPlayerId:input.targetPlayerId?.toString() ?? null,recordDate:input.recordDate,
    previousCount:input.previousCount?.toString() ?? null,count:input.count?.toString() ?? null,
    wins:input.wins?.toString() ?? null,losses:input.losses?.toString() ?? null,
    previousVersion:input.previousVersion?.toString() ?? null,version:input.version?.toString() ?? null,
    operationId:input.operationId.toString(),executionId:execution.insertId.toString(),auditId:audit.insertId.toString(),outboxId:outbox.insertId.toString()
  };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),input.operationId]);
  return result;
}

// 총괄 운영자가 KST 기준 일일 미니펫 대전 횟수를 원자적으로 절대값 변경합니다.
export class MiniPetBattleCountAdminService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }
  > {
    const definition = (await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1",[COMMAND_CODE]
    ))[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true },
        { route:"LEGACY_FALLBACK",reasonCode:"ROLLOUT_LEGACY_ONLY",commandCode:COMMAND_CODE,handlerKey:HANDLER_KEY });
      return { status:"legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true },
        { route:"SHADOW",reasonCode:"ROLLOUT_SHADOW",commandCode:COMMAND_CODE,handlerKey:HANDLER_KEY });
      return { status:"shadow" };
    }
    const operator = (await this.database.query<OperatorRow[]>(
      `SELECT operator.id operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' AND operator.display_name='호이 남'
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code='super_admin' AND role.active=TRUE
       JOIN admin_role_permissions permission ON permission.role_id=role.id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND permission.permission_code='mini_pet.battle_count.override' LIMIT 1`,[input.externalUserId]
    ))[0];
    if (operator === undefined) return { status:"handled_no_reply" };
    await dispatch.record({ eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true },
      { route:"MODERN",reasonCode:"MODERN_ROUTE_ALLOWED",commandCode:COMMAND_CODE,handlerKey:HANDLER_KEY });
    const result = await this.set({ message:input.message,idempotencyKey:input.eventId,sourceEventId:input.eventId,
      destinationId:input.channelId,operatorId:operator.operator_id.toString() });
    return { status:"changed",data:result.data,outboxId:result.outboxId };
  }

  async set(input: { message: string; idempotencyKey: string; sourceEventId: string; destinationId: string; operatorId: string }): Promise<MiniPetBattleCountAdminResult> {
    return runTransactionWithRetry(this.database,async transaction => {
      const operationWrite = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,'admin.mini_pet.battle_count.override',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,[randomUUID(),normalizeEventKey(input.idempotencyKey),input.operatorId]
      );
      const operation = (await transaction.query<OperationRow[]>("SELECT result_json FROM operations WHERE id=? FOR UPDATE",[operationWrite.insertId]))[0];
      if (operation === undefined) throw new Error("Mini-pet battle count operation claim failed.");
      if (operation.result_json !== null) return storedResult(operation.result_json);

      const command = parseMiniPetBattleCountAdminCommand(input.message);
      if (command === null) return complete(transaction,{ operationId:operationWrite.insertId,eventId:input.sourceEventId,
        destinationId:input.destinationId,operatorId:input.operatorId,status:"usage",data:USAGE,targetPlayerId:null,
        recordDate:null,previousCount:null,count:null,wins:null,losses:null,previousVersion:null,version:null });

      const players = await transaction.query<PlayerRow[]>(
        `SELECT player.id player_id FROM player_profiles profile
         JOIN players player ON player.id=profile.player_id AND player.status='active' AND player.deleted_at IS NULL
         WHERE profile.current_display_name=? ORDER BY player.id LIMIT 2 FOR UPDATE`,[command.targetName]
      );
      if (players.length !== 1) return complete(transaction,{ operationId:operationWrite.insertId,eventId:input.sourceEventId,
        destinationId:input.destinationId,operatorId:input.operatorId,status:players.length > 1 ? "ambiguous_target" : "not_found",
        data:players.length > 1 ? "동일한 대상명이 여러 명입니다." : "대상 유저가 없습니다.",targetPlayerId:null,
        recordDate:null,previousCount:null,count:command.count,wins:null,losses:null,previousVersion:null,version:null });

      const player = players[0]!;
      await transaction.execute(
        `INSERT INTO player_pet_daily_records(player_id,record_date,mini_battle_attempts,mini_battle_wins,mini_battle_losses,version)
         VALUES (?,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)),?,0,0,1)
         ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)`,[player.player_id,command.count]
      );
      const daily = (await transaction.query<DailyRow[]>(
        `SELECT DATE_FORMAT(record_date,'%Y-%m-%d') record_date,mini_battle_attempts,mini_battle_wins,mini_battle_losses,version
         FROM player_pet_daily_records WHERE player_id=? AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)) FOR UPDATE`,
        [player.player_id]
      ))[0];
      if (daily === undefined) throw new Error("Mini-pet battle daily record claim failed.");
      const changed = daily.mini_battle_attempts !== command.count;
      if (changed) {
        const update = await transaction.execute(
          `UPDATE player_pet_daily_records SET mini_battle_attempts=?,version=version+1,updated_at=UTC_TIMESTAMP(3)
           WHERE player_id=? AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)) AND version=?`,
          [command.count,player.player_id,daily.version]
        );
        if (update.affectedRows !== 1n) throw new Error("Mini-pet battle count version conflict.");
      }
      return complete(transaction,{ operationId:operationWrite.insertId,eventId:input.sourceEventId,destinationId:input.destinationId,
        operatorId:input.operatorId,status:changed ? "changed" : "unchanged",
        data:changed ? "미니펫대전횟수 변경 완료" : "미니펫 대전 횟수가 이미 동일합니다.",targetPlayerId:player.player_id,
        recordDate:daily.record_date,previousCount:daily.mini_battle_attempts,count:command.count,wins:daily.mini_battle_wins,
        losses:daily.mini_battle_losses,previousVersion:daily.version,version:changed ? daily.version + 1n : daily.version });
    });
  }
}
