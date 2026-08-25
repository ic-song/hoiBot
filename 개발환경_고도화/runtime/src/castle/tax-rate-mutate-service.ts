import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const CASTLE_CODE = "hoi_castle";
const WICKED_LORD_SKILL = "wicked_lord";

export interface CastleTaxRateCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface CastleTaxRateResult {
  status: "updated"; castleCode: string; lordPlayerId: string; beforeRate: string; afterRate: string;
  wickedLord: boolean; outboxId: string; auditId: string; data: string; replayed?: boolean;
}

// 숫자 하나만 받는 세율 변경 명령만 실행 대상으로 인정합니다.
export function isCastleTaxRateCommand(message: string | undefined): boolean {
  return message !== undefined && /^\/세금\s+\d+$/.test(message);
}

// 세율 숫자를 MariaDB 안전 범위로 해석합니다.
function parseTaxRate(message: string): number {
  if (!isCastleTaxRateCommand(message)) throw new ApplicationError("INVALID_CASTLE_TAX_COMMAND", "정확한 /세금 [숫자]를 입력해주세요.", 422);
  const value = BigInt(message.slice(4).trim());
  if (value > 100n) throw new ApplicationError("CASTLE_TAX_RANGE", "세율은 허용 범위 안에서 입력해주세요.", 422);
  return Number(value);
}

// 긴 event ID를 operations 멱등키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function parseStoredResult(value: string | CastleTaxRateResult): CastleTaxRateResult {
  const result = typeof value === "string" ? JSON.parse(value) as CastleTaxRateResult : value;
  return { ...result, replayed: true };
}

// 성주 권한·스킬 정책·세율 변경·감사·응답을 한 트랜잭션으로 저장합니다.
export class CastleTaxRateMutateService {
  constructor(private readonly database: DatabaseClient) {}

  async execute(command: CastleTaxRateCommand): Promise<CastleTaxRateResult> {
    const rate = parseTaxRate(command.message);
    return this.database.withTransaction(async (transaction) => {
      const actors = await transaction.query<Array<{ identity_id: bigint; player_id: bigint }>>(
        `SELECT identity.id identity_id,identity.player_id FROM external_identities identity
         JOIN players player ON player.id=identity.player_id
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
           AND player.status='active' LIMIT 1`, [command.externalUserId]
      );
      const actor = actors[0];
      if (actor === undefined) throw new ApplicationError("PLAYER_NOT_REGISTERED", "가입된 회원만 세율을 변경할 수 있습니다.", 404);
      const scope = `castle.tax-rate:${CASTLE_CODE}:${actor.identity_id}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | CastleTaxRateResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
        const replay = parseStoredResult(prior[0].result_json);
        if (replay.afterRate !== String(rate)) throw new ApplicationError("CASTLE_TAX_REPLAY_MISMATCH", "같은 이벤트의 세율이 이전 요청과 다릅니다.", 409);
        return replay;
      }
      const castles = await transaction.query<Array<{ lord_player_id: bigint | null; tax_rate: number; version: bigint }>>(
        "SELECT lord_player_id,tax_rate,version FROM castle_states WHERE code=? FOR UPDATE", [CASTLE_CODE]
      );
      const castle = castles[0];
      if (castle === undefined) throw new ApplicationError("CASTLE_STATE_REQUIRED", "호이캐슬 설정을 찾을 수 없습니다.", 409);
      if (castle.lord_player_id === null || castle.lord_player_id !== actor.player_id) throw new ApplicationError("CASTLE_LORD_REQUIRED", "호이캐슬 성주만 세율을 변경할 수 있습니다.", 403);
      const skills = await transaction.query<Array<{ skill_id: bigint }>>(
        `SELECT assignment.skill_id FROM player_skill_assignments assignment
         JOIN skill_definitions definition ON definition.id=assignment.skill_id
         WHERE assignment.player_id=? AND assignment.active=TRUE AND definition.code=? AND definition.active=TRUE
         LIMIT 1 FOR UPDATE`, [actor.player_id, WICKED_LORD_SKILL]
      );
      const wickedLord = skills[0] !== undefined;
      if (rate !== 5 && !(wickedLord && rate >= 11 && rate <= 30)) {
        throw new ApplicationError("CASTLE_TAX_NOT_ALLOWED", wickedLord ? "악덕한 영주 세율은 5 또는 11~30만 가능합니다." : "일반 성주 세율은 5만 가능합니다.", 422);
      }
      const configurationSets = await transaction.query<Array<{ id: bigint }>>(
        "SELECT id FROM configuration_sets WHERE set_code='castle_tax' AND status='active' ORDER BY version DESC LIMIT 1 FOR UPDATE"
      );
      const configurationSet = configurationSets[0];
      if (configurationSet === undefined) throw new ApplicationError("CASTLE_TAX_CONFIG_REQUIRED", "캐슬 세율 설정 이력 기준을 찾을 수 없습니다.", 409);
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES(?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))`, [randomUUID(), scope, eventKey, actor.player_id]
      );
      const updated = await transaction.execute(
        "UPDATE castle_states SET tax_rate=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE code=? AND version=?",
        [rate, CASTLE_CODE, castle.version]
      );
      if (updated.affectedRows !== 1n) throw new ApplicationError("CASTLE_STATE_CONFLICT", "호이캐슬 정보가 먼저 변경되었습니다.", 409);
      await transaction.execute(
        `INSERT INTO configuration_change_log(configuration_set_id,actor_id,action_code,change_json)
         VALUES(?,?,'castle.tax-rate.change',?)`,
        [configurationSet.id, actor.player_id, JSON.stringify({ operationId: operation.insertId.toString(), castleCode: CASTLE_CODE, beforeRate: String(castle.tax_rate), afterRate: String(rate), wickedLord })]
      );
      const data = `🏰 호이캐슬 세율이 ${castle.tax_rate}%에서 ${rate}%로 변경됐습니다.`;
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES(?,'castle_tax_rate_mutate',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, [command.eventId, operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES(?,'player',?,'castle_tax_operation',?,'castle.tax-rate.change','success','Iris /세금',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, actor.player_id, operation.insertId, JSON.stringify({ castleCode: CASTLE_CODE, beforeRate: String(castle.tax_rate), afterRate: String(rate), wickedLord })]
      );
      const result: CastleTaxRateResult = { status: "updated", castleCode: CASTLE_CODE, lordPlayerId: actor.player_id.toString(), beforeRate: String(castle.tax_rate), afterRate: String(rate), wickedLord, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), data };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
