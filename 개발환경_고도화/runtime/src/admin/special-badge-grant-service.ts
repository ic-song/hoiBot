import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import {
  invalidSpecialBadgeTargetOrBadge,
  resolveSpecialBadgeDefinition,
  resolveSpecialBadgeTarget,
  type BadgeDefinition
} from "./special-badge-revoke-service.js";

export interface SpecialBadgeGrantResult {
  data: string;
  outboxId: string;
  playerId: string;
  targetDisplayName: string;
  badgeCode: string;
  assignmentPriority: number;
}

// 특별 뱃지 지급 후보는 대상과 뱃지 표현이 모두 있는 명령으로 제한합니다.
export function isSpecialBadgeGrantCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && /^\/특별뱃지지급\s+.+$/.test(message);
}

// 특별 뱃지 assignment·알림·감사·응답을 한 트랜잭션에서 지급합니다.
export class SpecialBadgeGrantService {
  constructor(private readonly database: DatabaseClient) {}

  async grant(input: { message: string; idempotencyKey: string; sourceEventId: string; destinationId: string; operatorId: string; operatorDisplayName: string }): Promise<SpecialBadgeGrantResult> {
    const scope = "pet_home.special_badge.grant";
    return this.database.withTransaction(async (transaction) => {
      const prior = await transaction.query<Array<{ result_json: string | SpecialBadgeGrantResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, input.idempotencyKey]
      );
      if (prior[0]?.result_json != null) return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      const content = input.message.replace(/^\/특별뱃지지급\s+/, "");
      const target = await resolveSpecialBadgeTarget(transaction, content);
      const badges = await transaction.query<BadgeDefinition[]>(
        "SELECT badge_code,emoji,display_name FROM pet_home_badge_definitions WHERE badge_category='special' AND active=TRUE ORDER BY badge_code"
      );
      const badge = resolveSpecialBadgeDefinition(target.rest, badges);
      if (badge === undefined) throw invalidSpecialBadgeTargetOrBadge();
      const excluded = await transaction.query<Array<{ badge_code: string }>>(
        "SELECT badge_code FROM player_home_badge_exclusions WHERE player_id=? AND badge_code=? FOR UPDATE", [target.playerId, badge.badge_code]
      );
      if (excluded[0] !== undefined) throw new ApplicationError("SPECIAL_BADGE_PERMANENTLY_DELETED", "❌ 해당 유저가 영구 삭제한 뱃지라 다시 지급할 수 없습니다.", 409);
      const assignments = await transaction.query<Array<{ badge_code: string; priority: number }>>(
        "SELECT badge_code,priority FROM player_badge_assignments WHERE player_id=? ORDER BY priority,badge_code FOR UPDATE", [target.playerId]
      );
      if (assignments.some((assignment) => assignment.badge_code === badge.badge_code)) {
        throw new ApplicationError("SPECIAL_BADGE_ALREADY_OWNED", `⚠️ 해당 유저가 이미 보유한 특별 뱃지입니다.\n대상: ${target.displayName}\n뱃지: ${badge.emoji} ${badge.display_name} [${badge.badge_code}]`, 409);
      }
      const assignmentPriority = assignments.reduce((maximum, assignment) => Math.max(maximum, assignment.priority), 0) + 1;
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, input.idempotencyKey, input.operatorId]
      );
      const displayValue = `${badge.emoji} ${badge.display_name}`;
      await transaction.execute(
        "INSERT INTO player_badge_assignments(player_id,badge_code,display_value,priority) VALUES (?,?,?,?)",
        [target.playerId, badge.badge_code, displayValue, assignmentPriority]
      );
      await transaction.execute(
        `INSERT INTO player_badge_alerts(alert_id,player_id,alert_type,badge_code,actor_operator_id,source_operation_id,created_at)
         VALUES (?,?,'special_badge_granted',?,?,?,UTC_TIMESTAMP(3))`,
        [randomUUID(), target.playerId, badge.badge_code, input.operatorId, operation.insertId]
      );
      await transaction.execute(
        `INSERT INTO player_special_badge_mutations(operation_id,player_id,badge_code,mutation_kind,assignment_priority,equipped_before,equipment_version_before,equipment_version_after)
         VALUES (?,?,?,'grant',?,FALSE,NULL,NULL)`,
        [operation.insertId, target.playerId, badge.badge_code, assignmentPriority]
      );
      const data = `✅ 특별 뱃지를 지급했습니다.\n━━━━━━━━━━━━\n대상: ${target.displayName}\n지급 뱃지: ${badge.emoji} ${badge.display_name} [${badge.badge_code}]\n처리 관리자: ${input.operatorDisplayName}`;
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'player',?,'pet_home.special_badge.grant','success','Iris 운영자 /특별뱃지지급',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, target.playerId, JSON.stringify({ badgeCode: badge.badge_code, displayValue, assignmentPriority })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'ADMIN_SPECIAL_BADGE_GRANT',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      const result: SpecialBadgeGrantResult = { data, outboxId: outbox.insertId.toString(), playerId: target.playerId.toString(), targetDisplayName: target.displayName, badgeCode: badge.badge_code, assignmentPriority };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
