import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface SpecialBadgeRevokeResult {
  data: string;
  outboxId: string;
  playerId: string;
  targetDisplayName: string;
  badgeCode: string;
  equippedCleared: boolean;
}

interface BadgeDefinition { badge_code: string; emoji: string; display_name: string; }

// 특별 뱃지 회수 후보는 대상과 뱃지 표현이 있는 전체 명령으로 제한합니다.
export function isSpecialBadgeRevokeCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && /^\/특별뱃지회수\s+.+$/.test(message);
}

// 코드·대괄호 코드·이름·표시명으로 특별 뱃지 정의를 찾습니다.
export function resolveSpecialBadgeDefinition(input: string, badges: BadgeDefinition[]): BadgeDefinition | undefined {
  const value = input.trim();
  const upper = value.toUpperCase();
  const bracket = /^\[([A-Z]\d{2})\]$/.exec(upper);
  const code = bracket?.[1] ?? upper;
  return badges.find((badge) => badge.badge_code === code || badge.display_name === value
    || `${badge.emoji} ${badge.display_name}` === value || `[${badge.badge_code}] ${badge.emoji} ${badge.display_name}` === value);
}

// 특별 뱃지 assignment·장착·알림·감사·응답을 한 트랜잭션에서 회수합니다.
export class SpecialBadgeRevokeService {
  constructor(private readonly database: DatabaseClient) {}

  async revoke(input: { message: string; idempotencyKey: string; sourceEventId: string; destinationId: string; operatorId: string; operatorDisplayName: string }): Promise<SpecialBadgeRevokeResult> {
    const scope = "pet_home.special_badge.revoke";
    return this.database.withTransaction(async (transaction) => {
      const prior = await transaction.query<Array<{ result_json: string | SpecialBadgeRevokeResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, input.idempotencyKey]
      );
      if (prior[0]?.result_json != null) return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      const content = input.message.replace(/^\/특별뱃지회수\s+/, "");
      const target = await resolveTarget(transaction, content);
      const badges = await transaction.query<BadgeDefinition[]>(
        "SELECT badge_code,emoji,display_name FROM pet_home_badge_definitions WHERE badge_category='special' AND active=TRUE ORDER BY badge_code"
      );
      const badge = resolveSpecialBadgeDefinition(target.rest, badges);
      if (badge === undefined) throw invalidTargetOrBadge();
      const assignments = await transaction.query<Array<{ priority: number; display_value: string }>>(
        "SELECT priority,display_value FROM player_badge_assignments WHERE player_id=? AND badge_code=? FOR UPDATE", [target.playerId, badge.badge_code]
      );
      const assignment = assignments[0];
      if (assignment === undefined) throw new ApplicationError("SPECIAL_BADGE_NOT_OWNED", "❌ 해당 유저가 보유하지 않은 특별 뱃지입니다.", 409);
      const equipmentRows = await transaction.query<Array<{ equipped_badge_code: string | null; version: bigint }>>(
        "SELECT equipped_badge_code,version FROM player_badge_equipment WHERE player_id=? FOR UPDATE", [target.playerId]
      );
      const equipment = equipmentRows[0];
      const equippedCleared = equipment?.equipped_badge_code === badge.badge_code;
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, input.idempotencyKey, input.operatorId]
      );
      const removed = await transaction.execute(
        "DELETE FROM player_badge_assignments WHERE player_id=? AND badge_code=?", [target.playerId, badge.badge_code]
      );
      if (removed.affectedRows !== 1n) throw new ApplicationError("SPECIAL_BADGE_ASSIGNMENT_CONFLICT", "특별 뱃지 보유 상태가 먼저 변경되었습니다.", 409);
      let equipmentVersionAfter: bigint | null = equipment?.version ?? null;
      if (equippedCleared && equipment !== undefined) {
        const update = await transaction.execute(
          "UPDATE player_badge_equipment SET equipped_badge_code=NULL,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND version=?",
          [target.playerId, equipment.version]
        );
        if (update.affectedRows !== 1n) throw new ApplicationError("SPECIAL_BADGE_EQUIPMENT_CONFLICT", "특별 뱃지 장착 상태가 먼저 변경되었습니다.", 409);
        equipmentVersionAfter = equipment.version + 1n;
      }
      await transaction.execute(
        `INSERT INTO player_badge_alerts(alert_id,player_id,alert_type,badge_code,actor_operator_id,source_operation_id,created_at)
         VALUES (?,?, 'special_badge_revoked',?,?,?,UTC_TIMESTAMP(3))`,
        [randomUUID(), target.playerId, badge.badge_code, input.operatorId, operation.insertId]
      );
      await transaction.execute(
        `INSERT INTO player_special_badge_mutations(operation_id,player_id,badge_code,mutation_kind,assignment_priority,equipped_before,equipment_version_before,equipment_version_after)
         VALUES (?,?,?,'revoke',?,?,?,?)`,
        [operation.insertId, target.playerId, badge.badge_code, assignment.priority, equippedCleared, equipment?.version ?? null, equipmentVersionAfter]
      );
      const data = `✅ 특별 뱃지를 회수했습니다.\n━━━━━━━━━━━━\n대상: ${target.displayName}\n회수 뱃지: ${badge.emoji} ${badge.display_name} [${badge.badge_code}]\n처리 관리자: ${input.operatorDisplayName}`;
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'player',?,'pet_home.special_badge.revoke','success','Iris 운영자 /특별뱃지회수',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, target.playerId, JSON.stringify({ badgeCode: badge.badge_code, displayValue: assignment.display_value, equippedCleared })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'ADMIN_SPECIAL_BADGE_REVOKE',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      const result: SpecialBadgeRevokeResult = { data, outboxId: outbox.insertId.toString(), playerId: target.playerId.toString(), targetDisplayName: target.displayName, badgeCode: badge.badge_code, equippedCleared };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}

// 긴 표시명을 우선해 대상과 뒤따르는 뱃지 표현을 분리합니다.
async function resolveTarget(transaction: DatabaseTransaction, content: string): Promise<{ playerId: bigint; displayName: string; rest: string }> {
  const players = await transaction.query<Array<{ player_id: bigint; current_display_name: string }>>(
    "SELECT profile.player_id,profile.current_display_name FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.status='active' ORDER BY CHAR_LENGTH(profile.current_display_name) DESC,profile.player_id"
  );
  for (const player of players) {
    if (!content.startsWith(player.current_display_name)) continue;
    const next = content.charAt(player.current_display_name.length);
    if (next !== " " && next !== ",") continue;
    let rest = content.slice(player.current_display_name.length).trim();
    if (rest.startsWith(",")) rest = rest.slice(1).trim();
    if (rest.length === 0) break;
    return { playerId: player.player_id, displayName: player.current_display_name, rest };
  }
  throw invalidTargetOrBadge();
}

// 레거시 대상·뱃지 확인 오류를 동일 문구로 생성합니다.
function invalidTargetOrBadge(): ApplicationError {
  return new ApplicationError("INVALID_SPECIAL_BADGE_TARGET", "❌ 대상 유저 또는 특별 뱃지 이름·코드를 확인해 주세요.\n/특별뱃지목록에서 정확한 이름 또는 코드를 확인할 수 있습니다.", 422);
}
