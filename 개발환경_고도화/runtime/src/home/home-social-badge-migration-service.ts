import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE = "HOME_SOCIAL_BADGE_MIGRATION";
const MIGRATION_KEY = "pet_home_social_badges_20260727";

type MigrationStatus = "migrated" | "already_applied";
type StatKey = "followers" | "mutual" | "receivedComments" | "receivedHomeLikes" | "receivedReactions" | "totalVisits" | "feedActiveDays";
type StatValues = Record<StatKey, bigint>;
type OperatorRow = { operator_id: bigint };
type StoredOperation = { result_json: string | HomeSocialBadgeMigrationResult | null };
type MigrationStateRow = { applied: number; applied_operation_id: bigint | null; processed_user_count: bigint; awarded_badge_count: bigint };
type SourceRow = StatValues & { player_id: bigint };
type StoredStatsRow = StatValues;
type AssignmentRow = { badge_code: string; priority: number };
type ProjectionRow = { badge_code: string; owned: number };
type BadgeDefinitionRow = {
  badge_code: string;
  emoji: string;
  display_name: string;
  criteria_json: string | Record<string, number> | null;
  required_badge_codes_json: string | string[] | null;
  sort_order: number;
};

export interface HomeSocialBadgeMigrationResult {
  status: MigrationStatus;
  message: string;
  outboxId: string;
  replayed: boolean;
  processedUserCount: string;
  awardedBadgeCount: string;
  backupOperationId: string;
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseStored(value: string | HomeSocialBadgeMigrationResult): HomeSocialBadgeMigrationResult {
  return typeof value === "string" ? JSON.parse(value) as HomeSocialBadgeMigrationResult : value;
}

function parseCriteria(value: BadgeDefinitionRow["criteria_json"]): Record<string, number> {
  if (value === null) return {};
  return typeof value === "string" ? JSON.parse(value) as Record<string, number> : value;
}

function parseRequiredBadges(value: BadgeDefinitionRow["required_badge_codes_json"]): string[] {
  if (value === null) return [];
  return typeof value === "string" ? JSON.parse(value) as string[] : value;
}

function maximum(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function qualifies(definition: BadgeDefinitionRow, stats: StatValues, owned: Set<string>): boolean {
  const requiredBadges = parseRequiredBadges(definition.required_badge_codes_json);
  if (requiredBadges.length > 0) return requiredBadges.every((badgeCode) => owned.has(badgeCode));
  const criteria = parseCriteria(definition.criteria_json);
  return Object.entries(criteria).every(([key, threshold]) => {
    const value = stats[key as StatKey];
    return value !== undefined && value >= BigInt(threshold);
  });
}

export function buildHomeSocialBadgeMigrationMessage(status: MigrationStatus, users: bigint, badges: bigint): string {
  if (status === "already_applied") return "✅ 펫홈 소셜·뱃지 마이그레이션이 이미 완료되었습니다.";
  return `✅ 펫홈 소셜·뱃지 마이그레이션 완료\n처리 유저: ${users}명\n기존 업적 지급: ${badges}개\n활동 파일 백업: 새 백업 생성`;
}

async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint;
  eventId: string;
  operatorId: bigint;
  destinationId: string;
  status: MigrationStatus;
  processedUserCount: bigint;
  awardedBadgeCount: bigint;
  backupOperationId: bigint;
}): Promise<HomeSocialBadgeMigrationResult> {
  const message = buildHomeSocialBadgeMigrationMessage(input.status, input.processedUserCount, input.awardedBadgeCount);
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: message })],
  );
  const result: HomeSocialBadgeMigrationResult = {
    status: input.status,
    message,
    outboxId: outbox.insertId.toString(),
    replayed: false,
    processedUserCount: input.processedUserCount.toString(),
    awardedBadgeCount: input.awardedBadgeCount.toString(),
    backupOperationId: input.backupOperationId.toString(),
  };
  await transaction.execute(
    "INSERT INTO pet_home_social_badge_migration_runs(operation_id,actor_operator_id,migration_status,processed_user_count,awarded_badge_count,backup_operation_id,created_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))",
    [input.operationId, input.operatorId, input.status, input.processedUserCount, input.awardedBadgeCount, input.backupOperationId],
  );
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, COMMAND_CODE, input.operationId, input.status],
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'pet_home_badges',NULL,'home.social_badge.migrate',?,'Iris /펫홈소셜뱃지마이그레이션',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.operatorId, input.status, JSON.stringify({ migrationKey: MIGRATION_KEY, processedUserCount: result.processedUserCount, awardedBadgeCount: result.awardedBadgeCount, backupOperationId: result.backupOperationId })],
  );
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// DB 실데이터로 누적치를 보정하고 신규 업적만 지급하며 기존 소유·장착·삭제 제외를 보존합니다.
export class HomeSocialBadgeMigrationService {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<HomeSocialBadgeMigrationResult> {
    return this.database.withTransaction(async (transaction) => {
      const operator = (await transaction.query<OperatorRow[]>(
        `SELECT mapping.operator_id
         FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
         JOIN admin_operators operator ON operator.id=mapping.operator_id
         JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
         JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
         WHERE identity.provider_code='kakao' AND identity.external_user_id=?
           AND identity.status='linked' AND operator.status='active'
           AND permission.permission_code='game.home.moderate'
         ORDER BY mapping.operator_id LIMIT 1 FOR UPDATE`,
        [input.externalUserId],
      ))[0];
      if (operator === undefined) throw new ApplicationError("HOME_SOCIAL_BADGE_MIGRATION_FORBIDDEN", "펫홈 소셜·뱃지 마이그레이션 권한이 없습니다.", 403);

      const key = eventKey(input.eventId);
      const prior = (await transaction.query<StoredOperation[]>(
        "SELECT result_json FROM operations WHERE idempotency_scope='home.social_badge.migrate' AND idempotency_key=? FOR UPDATE",
        [key],
      ))[0];
      if (prior?.result_json != null) return { ...parseStored(prior.result_json), replayed: true };
      if (prior !== undefined) throw new ApplicationError("HOME_SOCIAL_BADGE_MIGRATION_IN_PROGRESS", "펫홈 소셜·뱃지 마이그레이션이 처리 중입니다.", 409);

      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'home.social_badge.migrate',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, operator.operator_id],
      );
      const state = (await transaction.query<MigrationStateRow[]>(
        "SELECT applied,applied_operation_id,processed_user_count,awarded_badge_count FROM pet_home_social_badge_migration_state WHERE migration_key=? FOR UPDATE",
        [MIGRATION_KEY],
      ))[0];
      if (state === undefined) throw new ApplicationError("HOME_SOCIAL_BADGE_MIGRATION_STATE_MISSING", "펫홈 소셜·뱃지 마이그레이션 상태가 준비되지 않았습니다.", 500);
      if (state.applied === 1 && state.applied_operation_id !== null) {
        return complete(transaction, {
          operationId: operation.insertId,
          eventId: input.eventId,
          operatorId: operator.operator_id,
          destinationId: input.destinationId,
          status: "already_applied",
          processedUserCount: state.processed_user_count,
          awardedBadgeCount: state.awarded_badge_count,
          backupOperationId: state.applied_operation_id,
        });
      }

      const definitions = await transaction.query<BadgeDefinitionRow[]>(
        "SELECT badge_code,emoji,display_name,criteria_json,required_badge_codes_json,sort_order FROM pet_home_badge_definitions WHERE badge_category='activity' AND active=TRUE ORDER BY sort_order,badge_code",
      );
      const homes = await transaction.query<SourceRow[]>(
        `SELECT home.player_id,
          (SELECT COUNT(*) FROM pet_home_follows follow_row WHERE follow_row.followed_player_id=home.player_id AND follow_row.active=TRUE) followers,
          (SELECT COUNT(*) FROM pet_home_follows outgoing JOIN pet_home_follows incoming
             ON incoming.follower_player_id=outgoing.followed_player_id AND incoming.followed_player_id=outgoing.follower_player_id AND incoming.active=TRUE
             WHERE outgoing.follower_player_id=home.player_id AND outgoing.active=TRUE) mutual,
          (SELECT COUNT(*) FROM home_comments comment WHERE comment.home_player_id=home.player_id AND comment.status='visible' AND comment.deleted_at IS NULL) receivedComments,
          home.like_count receivedHomeLikes,
          (SELECT COUNT(*) FROM home_reactions reaction WHERE reaction.home_player_id=home.player_id AND reaction.reaction_code IN ('cute','cheer','cool','love')) receivedReactions,
          home.visit_count totalVisits,
          (SELECT COUNT(*) FROM pet_home_feed_activity_days feed_day WHERE feed_day.player_id=home.player_id) feedActiveDays
         FROM player_homes home ORDER BY home.player_id FOR UPDATE`,
      );

      let awardedBadgeCount = 0n;
      let awardSequence = 0;
      for (const home of homes) {
        const previous = (await transaction.query<StoredStatsRow[]>(
          `SELECT followers,mutual,received_comments receivedComments,received_home_likes receivedHomeLikes,
             received_reactions receivedReactions,total_visits totalVisits,feed_active_days feedActiveDays
           FROM pet_home_badge_stats WHERE player_id=? FOR UPDATE`, [home.player_id],
        ))[0];
        await transaction.execute(
          `INSERT INTO pet_home_social_badge_stat_backups(operation_id,player_id,had_stats,followers,mutual,received_comments,received_home_likes,received_reactions,total_visits,feed_active_days)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [operation.insertId, home.player_id, previous === undefined ? 0 : 1, previous?.followers ?? 0n, previous?.mutual ?? 0n,
            previous?.receivedComments ?? 0n, previous?.receivedHomeLikes ?? 0n, previous?.receivedReactions ?? 0n, previous?.totalVisits ?? 0n, previous?.feedActiveDays ?? 0n],
        );
        await transaction.execute(
          `INSERT INTO pet_home_social_badge_assignment_backups(operation_id,player_id,badge_code,display_value,priority,starts_at,ends_at)
           SELECT ?,player_id,badge_code,display_value,priority,starts_at,ends_at FROM player_badge_assignments WHERE player_id=?`,
          [operation.insertId, home.player_id],
        );

        const stats: StatValues = {
          followers: home.followers,
          mutual: home.mutual,
          receivedComments: maximum(previous?.receivedComments ?? 0n, home.receivedComments),
          receivedHomeLikes: maximum(previous?.receivedHomeLikes ?? 0n, home.receivedHomeLikes),
          receivedReactions: maximum(previous?.receivedReactions ?? 0n, home.receivedReactions),
          totalVisits: maximum(previous?.totalVisits ?? 0n, home.totalVisits),
          feedActiveDays: home.feedActiveDays,
        };
        await transaction.execute(
          `INSERT INTO pet_home_badge_stats(player_id,followers,mutual,received_comments,received_home_likes,received_reactions,total_visits,feed_active_days,version,updated_at)
           VALUES (?,?,?,?,?,?,?,?,1,UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE followers=VALUES(followers),mutual=VALUES(mutual),received_comments=VALUES(received_comments),
             received_home_likes=VALUES(received_home_likes),received_reactions=VALUES(received_reactions),total_visits=VALUES(total_visits),
             feed_active_days=VALUES(feed_active_days),version=version+1,updated_at=UTC_TIMESTAMP(3)`,
          [home.player_id, stats.followers, stats.mutual, stats.receivedComments, stats.receivedHomeLikes, stats.receivedReactions, stats.totalVisits, stats.feedActiveDays],
        );

        const assignments = await transaction.query<AssignmentRow[]>(
          "SELECT badge_code,priority FROM player_badge_assignments WHERE player_id=? ORDER BY priority,badge_code FOR UPDATE", [home.player_id],
        );
        const projections = await transaction.query<ProjectionRow[]>(
          "SELECT badge_code,owned FROM player_home_badges WHERE player_id=? FOR UPDATE", [home.player_id],
        );
        const exclusionRows = await transaction.query<Array<{ badge_code: string }>>(
          "SELECT badge_code FROM player_home_badge_exclusions WHERE player_id=?", [home.player_id],
        );
        const owned = new Set(assignments.map((assignment) => assignment.badge_code));
        for (const projection of projections) if (projection.owned === 1) owned.add(projection.badge_code);
        const excluded = new Set(exclusionRows.map((row) => row.badge_code));
        for (const projection of projections) if (projection.owned !== 1) excluded.add(projection.badge_code);
        let nextPriority = assignments.reduce((value, assignment) => Math.max(value, assignment.priority), 0) + 1;

        for (const definition of definitions) {
          if (owned.has(definition.badge_code) || excluded.has(definition.badge_code)) continue;
          if (!qualifies(definition, stats, owned)) continue;
          const displayValue = `${definition.emoji} ${definition.display_name}`;
          await transaction.execute(
            "INSERT INTO player_badge_assignments(player_id,badge_code,display_value,priority) VALUES (?,?,?,?)",
            [home.player_id, definition.badge_code, displayValue, nextPriority++],
          );
          await transaction.execute(
            "INSERT INTO player_home_badges(player_id,badge_code,owned,equipped,version,updated_at) VALUES (?,?,TRUE,FALSE,1,UTC_TIMESTAMP(3))",
            [home.player_id, definition.badge_code],
          );
          awardSequence += 1;
          await transaction.execute(
            "INSERT INTO pet_home_social_badge_migration_awards(operation_id,sequence_no,player_id,badge_code,display_value,created_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))",
            [operation.insertId, awardSequence, home.player_id, definition.badge_code, displayValue],
          );
          owned.add(definition.badge_code);
          awardedBadgeCount += 1n;
        }
      }

      const processedUserCount = BigInt(homes.length);
      await transaction.execute(
        "UPDATE pet_home_social_badge_migration_state SET applied=TRUE,applied_operation_id=?,processed_user_count=?,awarded_badge_count=?,applied_at=UTC_TIMESTAMP(3),version=version+1 WHERE migration_key=? AND applied=FALSE",
        [operation.insertId, processedUserCount, awardedBadgeCount, MIGRATION_KEY],
      );
      return complete(transaction, {
        operationId: operation.insertId,
        eventId: input.eventId,
        operatorId: operator.operator_id,
        destinationId: input.destinationId,
        status: "migrated",
        processedUserCount,
        awardedBadgeCount,
        backupOperationId: operation.insertId,
      });
    });
  }
}
