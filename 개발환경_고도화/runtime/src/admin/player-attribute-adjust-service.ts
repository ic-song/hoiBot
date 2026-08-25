import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { formatDecimal3, parseDecimal3 } from "../shared/numeric-policy.js";

const MAX_ATTRIBUTE_AMOUNT = 9223372036854775807n;
const MIN_LEVEL = -9223372036854775808n;
const MAX_LEVEL = 9223372036854775807n;

type AttributeName = "lv" | "point";
type Direction = "increase" | "decrease";
interface ParsedAttributeCommand { attribute: AttributeName; direction: Direction; amount: bigint; targetName: string; }

export interface PlayerAttributeAdjustCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface PlayerAttributeAdjustResult {
  status: "adjusted"; targetPlayerId: string; targetName: string; attribute: AttributeName;
  direction: Direction; amount: string; beforeValue: string; afterValue: string;
  outboxId: string; auditId: string; data: string; replayed?: boolean;
}

// 회원 속성 증감 명령의 완전한 공백 형식만 실행 대상으로 인정합니다.
export function isPlayerAttributeAdjustCommand(message: string | undefined): boolean {
  return message !== undefined && /^\/속성(?:증가|감소)\s+\S(?:.*\S)?\s+(?:lv|point)\s+\d+$/.test(message);
}

// 대상명·속성·수량을 안전한 정수 조정값으로 해석합니다.
function parseAttributeCommand(message: string): ParsedAttributeCommand {
  const matched = /^\/속성(증가|감소)\s+(.+?)\s+(lv|point)\s+(\d+)$/.exec(message);
  if (matched === null) throw new ApplicationError("INVALID_PLAYER_ATTRIBUTE_COMMAND", "정확한 /속성증가|감소 [유저명] [lv|point] [숫자]를 입력해주세요.", 422);
  const amount = BigInt(matched[4]!);
  if (amount > MAX_ATTRIBUTE_AMOUNT) throw new ApplicationError("PLAYER_ATTRIBUTE_LIMIT", "속성 조정값이 허용 범위를 넘었습니다.", 422);
  return { direction: matched[1] === "증가" ? "increase" : "decrease", targetName: matched[2]!, attribute: matched[3] as AttributeName, amount };
}

// 긴 event ID를 operations 멱등키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function parseStoredResult(value: string | PlayerAttributeAdjustResult): PlayerAttributeAdjustResult {
  const result = typeof value === "string" ? JSON.parse(value) as PlayerAttributeAdjustResult : value;
  return { ...result, replayed: true };
}

// 회원 레벨·포인트 증감과 원장·감사·응답을 한 트랜잭션으로 저장합니다.
export class PlayerAttributeAdjustService {
  constructor(private readonly database: DatabaseClient) {}

  async execute(command: PlayerAttributeAdjustCommand): Promise<PlayerAttributeAdjustResult> {
    if (!isPlayerAttributeAdjustCommand(command.message)) throw new ApplicationError("INVALID_PLAYER_ATTRIBUTE_COMMAND", "정확한 회원 속성 증감 명령을 입력해주세요.", 422);
    const parsed = parseAttributeCommand(command.message);
    return this.database.withTransaction(async (transaction) => {
      const operators = await transaction.query<Array<{ operator_id: bigint }>>(
        `SELECT mapping.operator_id FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id = identity.id
         JOIN admin_operators operator ON operator.id = mapping.operator_id
         JOIN admin_operator_roles operator_role ON operator_role.operator_id = operator.id
         JOIN admin_role_permissions permission ON permission.role_id = operator_role.role_id
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
           AND operator.status = 'active' AND permission.permission_code = 'player.attribute.adjust' LIMIT 1 FOR UPDATE`,
        [command.externalUserId]
      );
      const operator = operators[0];
      if (operator === undefined) throw new ApplicationError("FORBIDDEN", "회원 속성 조정 권한이 없습니다.", 403);

      const scope = `admin.player-attribute-adjust:${operator.operator_id}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PlayerAttributeAdjustResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
        const replay = parseStoredResult(prior[0].result_json);
        if (replay.targetName !== parsed.targetName || replay.attribute !== parsed.attribute
          || replay.direction !== parsed.direction || replay.amount !== parsed.amount.toString()) {
          throw new ApplicationError("PLAYER_ATTRIBUTE_REPLAY_MISMATCH", "같은 이벤트의 회원 속성 조정 내용이 이전 요청과 다릅니다.", 409);
        }
        return replay;
      }

      const targets = await transaction.query<Array<{ player_id: bigint }>>(
        "SELECT player_id FROM player_profiles WHERE current_display_name = ? ORDER BY player_id LIMIT 2 FOR UPDATE", [parsed.targetName]
      );
      if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", `❌ [${parsed.targetName}] 님은 존재하지 않습니다.`, 404);
      if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID 기반 조정이 필요합니다.", 409);
      const target = targets[0]!;
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES(?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, operator.operator_id]
      );
      const signedAmount = parsed.direction === "increase" ? parsed.amount : -parsed.amount;
      let beforeValue: string;
      let afterValue: string;

      if (parsed.attribute === "lv") {
        const profiles = await transaction.query<Array<{ level: bigint; version: bigint }>>(
          "SELECT level,version FROM player_profiles WHERE player_id=? FOR UPDATE", [target.player_id]
        );
        const profile = profiles[0];
        if (profile === undefined) throw new ApplicationError("PLAYER_PROFILE_NOT_FOUND", "회원 프로필을 찾을 수 없습니다.", 404);
        const nextLevel = profile.level + signedAmount;
        if (nextLevel < MIN_LEVEL || nextLevel > MAX_LEVEL) throw new ApplicationError("PLAYER_ATTRIBUTE_OVERFLOW", "레벨 조정 결과가 허용 범위를 넘었습니다.", 422);
        const updated = await transaction.execute(
          "UPDATE player_profiles SET level=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND version=?",
          [nextLevel, target.player_id, profile.version]
        );
        if (updated.affectedRows !== 1n) throw new ApplicationError("PLAYER_PROFILE_CONFLICT", "회원 프로필이 먼저 변경되었습니다.", 409);
        beforeValue = profile.level.toString();
        afterValue = nextLevel.toString();
      } else {
        await transaction.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES(?,'point',0,1)", [target.player_id]);
        const accounts = await transaction.query<Array<{ balance: string; version: bigint }>>(
          "SELECT balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE", [target.player_id]
        );
        const account = accounts[0];
        if (account === undefined) throw new ApplicationError("POINT_ACCOUNT_NOT_FOUND", "회원 포인트 계정을 만들 수 없습니다.", 404);
        const before = parseDecimal3(account.balance, "point balance");
        const after = before + signedAmount * 1000n;
        const updated = await transaction.execute(
          "UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?",
          [formatDecimal3(after), target.player_id, account.version]
        );
        if (updated.affectedRows !== 1n) throw new ApplicationError("POINT_ACCOUNT_CONFLICT", "회원 포인트가 먼저 변경되었습니다.", 409);
        await transaction.execute(
          `INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code)
           VALUES(?,1,?,'point',?,?,'admin_player_attribute_adjust')`,
          [operation.insertId, target.player_id, formatDecimal3(signedAmount * 1000n), formatDecimal3(after)]
        );
        beforeValue = formatDecimal3(before);
        afterValue = formatDecimal3(after);
      }

      const verb = parsed.direction === "increase" ? "증가" : "감소";
      const data = `✅ [${parsed.targetName}] 님의 ${parsed.attribute}를 ${parsed.amount}${verb}했습니다. (${beforeValue} → ${afterValue})`;
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES(?,'admin_player_attribute_adjust',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, [command.eventId, operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES(?,'admin_operator',?,'player',?,'player.attribute.adjust','success',?,?,UTC_TIMESTAMP(3))`,
        [operation.insertId, operator.operator_id, target.player_id, `Iris /속성${verb}`, JSON.stringify({ attribute: parsed.attribute, direction: parsed.direction, amount: parsed.amount.toString(), beforeValue, afterValue })]
      );
      const result: PlayerAttributeAdjustResult = { status: "adjusted", targetPlayerId: target.player_id.toString(), targetName: parsed.targetName,
        attribute: parsed.attribute, direction: parsed.direction, amount: parsed.amount.toString(), beforeValue, afterValue,
        outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), data };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
