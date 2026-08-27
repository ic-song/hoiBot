import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE = "HOME_ACTIVITY_RESTORE";
const BACKUP_KEY = "legacy_pet_home_activity";

type RestoreStatus = "restored" | "missing" | "invalid";
export interface HomeActivityRestoreResult {
  status: RestoreStatus;
  message: string;
  outboxId: string;
  replayed: boolean;
  restoredUserCount: string;
  restoredAlertCount: string;
  restoredVisitorCount: string;
  backupRowCount: string;
}

interface OperatorRow { operator_id: bigint; }
interface PriorRow { result_json: string | HomeActivityRestoreResult | null; }
interface SourceRow { backup_key: string; source_root_hash: string; }
interface CountRow { value: bigint; }

export function buildHomeActivityRestoreMessage(status: RestoreStatus): string {
  if (status === "missing") return "❌ 펫홈 활동 백업 파일이 없습니다.";
  if (status === "invalid") return "❌ 펫홈 활동 백업 복구에 실패했습니다.";
  return "✅ 펫홈 활동 데이터를 직전 정상 백업으로 복구했습니다.";
}

function idempotencyKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

function parseStored(value: string | HomeActivityRestoreResult): HomeActivityRestoreResult {
  return typeof value === "string" ? JSON.parse(value) as HomeActivityRestoreResult : value;
}

async function scalar(transaction: DatabaseTransaction, sql: string, params: unknown[] = []): Promise<bigint> {
  return (await transaction.query<CountRow[]>(sql, params))[0]?.value ?? 0n;
}

async function finish(transaction: DatabaseTransaction, input: {
  operationId: bigint;
  eventId: string;
  destinationId: string;
  operatorId: bigint;
  source: SourceRow | null;
  legacyImportRunId: bigint | null;
  status: RestoreStatus;
  restoredUserCount: bigint;
  restoredAlertCount: bigint;
  restoredVisitorCount: bigint;
  backupRowCount: bigint;
}): Promise<HomeActivityRestoreResult> {
  const message = buildHomeActivityRestoreMessage(input.status);
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: message })],
  );
  await transaction.execute(
    "INSERT INTO pet_home_activity_restore_runs(operation_id,legacy_import_run_id,backup_key,result_code,restored_user_count,restored_alert_count,restored_visitor_count,backup_row_count) VALUES (?,?,?,?,?,?,?,?)",
    [input.operationId, input.legacyImportRunId, input.source?.backup_key ?? null, input.status, input.restoredUserCount, input.restoredAlertCount, input.restoredVisitorCount, input.backupRowCount],
  );
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, COMMAND_CODE, input.operationId, input.status],
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'pet_home_activity',NULL,'home.activity.restore',?,'Iris /펫홈활동살리기',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.operatorId, input.status, JSON.stringify({ backupKey: input.source?.backup_key ?? null, restoredUserCount: input.restoredUserCount.toString(), restoredAlertCount: input.restoredAlertCount.toString(), restoredVisitorCount: input.restoredVisitorCount.toString(), backupRowCount: input.backupRowCount.toString(), sourcePreserved: true })],
  );
  const result: HomeActivityRestoreResult = { status: input.status, message, outboxId: outbox.insertId.toString(), replayed: false, restoredUserCount: input.restoredUserCount.toString(), restoredAlertCount: input.restoredAlertCount.toString(), restoredVisitorCount: input.restoredVisitorCount.toString(), backupRowCount: input.backupRowCount.toString() };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

async function sourceIsValid(transaction: DatabaseTransaction, backupKey: string): Promise<boolean> {
  const unresolvedIdentityCount = await scalar(transaction, `
    SELECT COUNT(*) value FROM (
      SELECT owner_external_user_id external_user_id FROM pet_home_activity_restore_source_alerts WHERE backup_key=?
      UNION SELECT actor_external_user_id FROM pet_home_activity_restore_source_alerts WHERE backup_key=?
      UNION SELECT owner_external_user_id FROM pet_home_activity_restore_source_visitors WHERE backup_key=?
      UNION SELECT visitor_external_user_id FROM pet_home_activity_restore_source_visitors WHERE backup_key=?
      UNION SELECT owner_external_user_id FROM pet_home_activity_restore_source_social WHERE backup_key=?
      UNION SELECT owner_external_user_id FROM pet_home_activity_restore_source_relations WHERE backup_key=?
      UNION SELECT related_external_user_id FROM pet_home_activity_restore_source_relations WHERE backup_key=?
      UNION SELECT owner_external_user_id FROM pet_home_activity_restore_source_badges WHERE backup_key=?
      UNION SELECT owner_external_user_id FROM pet_home_activity_restore_source_feed_days WHERE backup_key=?
      UNION SELECT owner_external_user_id FROM pet_home_activity_restore_source_special_logs WHERE backup_key=?
    ) source_id LEFT JOIN external_identities identity ON identity.provider_code='kakao' AND identity.external_user_id=source_id.external_user_id AND identity.status='linked'
    LEFT JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
    WHERE identity.id IS NULL OR player.id IS NULL`, Array(10).fill(backupKey));
  const relationMismatchCount = await scalar(transaction, `
    SELECT COUNT(*) value FROM pet_home_activity_restore_source_relations relation_row
    LEFT JOIN pet_home_activity_restore_source_relations mirror ON mirror.backup_key=relation_row.backup_key
      AND mirror.owner_external_user_id=relation_row.related_external_user_id
      AND mirror.related_external_user_id=relation_row.owner_external_user_id
      AND mirror.direction_code=IF(relation_row.direction_code='following','followers','following')
    WHERE relation_row.backup_key=? AND mirror.backup_key IS NULL`, [backupKey]);
  const unknownBadgeCount = await scalar(transaction, `
    SELECT COUNT(*) value FROM (
      SELECT badge_code FROM pet_home_activity_restore_source_badges WHERE backup_key=?
      UNION SELECT equipped_badge_code FROM pet_home_activity_restore_source_social WHERE backup_key=? AND equipped_badge_code IS NOT NULL
      UNION SELECT badge_code FROM pet_home_activity_restore_source_special_logs WHERE backup_key=?
      UNION SELECT badge_code FROM pet_home_activity_restore_source_alerts WHERE backup_key=? AND badge_code IS NOT NULL
    ) source_badge LEFT JOIN pet_home_badge_definitions definition ON definition.badge_code=source_badge.badge_code AND definition.active=TRUE
    WHERE definition.badge_code IS NULL`, [backupKey, backupKey, backupKey, backupKey]);
  const invalidHeartDateCount = await scalar(transaction, `SELECT COUNT(*) value FROM pet_home_activity_restore_source_social WHERE backup_key=? AND (heart_usage_date NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR STR_TO_DATE(heart_usage_date,'%Y-%m-%d') IS NULL OR DATE_FORMAT(STR_TO_DATE(heart_usage_date,'%Y-%m-%d'),'%Y-%m-%d')<>heart_usage_date)`, [backupKey]);
  const badgeConflictCount = await scalar(transaction, `
    SELECT COUNT(*) value FROM pet_home_activity_restore_source_badges owned
    JOIN pet_home_activity_restore_source_badges deleted ON deleted.backup_key=owned.backup_key AND deleted.owner_external_user_id=owned.owner_external_user_id AND deleted.badge_code=owned.badge_code AND deleted.collection_code='deleted'
    WHERE owned.backup_key=? AND owned.collection_code='owned'`, [backupKey]);
  const invalidEquipmentCount = await scalar(transaction, `
    SELECT COUNT(*) value FROM pet_home_activity_restore_source_social social
    LEFT JOIN pet_home_activity_restore_source_badges badge ON badge.backup_key=social.backup_key AND badge.owner_external_user_id=social.owner_external_user_id AND badge.collection_code='owned' AND badge.badge_code=social.equipped_badge_code
    WHERE social.backup_key=? AND social.equipped_badge_code IS NOT NULL AND badge.badge_code IS NULL`, [backupKey]);
  return unresolvedIdentityCount === 0n && relationMismatchCount === 0n && unknownBadgeCount === 0n && invalidHeartDateCount === 0n && badgeConflictCount === 0n && invalidEquipmentCount === 0n;
}

async function backupCurrentProjection(transaction: DatabaseTransaction, operationId: bigint): Promise<bigint> {
  const statements: Array<[string, string]> = [
    ["pet_home_follows", "SELECT ?, 'pet_home_follows', CONCAT(follower_player_id,':',followed_player_id), JSON_OBJECT('follower',CAST(follower_player_id AS CHAR),'followed',CAST(followed_player_id AS CHAR),'active',active,'version',CAST(version AS CHAR),'createdAt',created_at,'updatedAt',updated_at) FROM pet_home_follows"],
    ["player_pet_home_heart_usage", "SELECT ?, 'player_pet_home_heart_usage', CONCAT(player_id,':',usage_date), JSON_OBJECT('playerId',CAST(player_id AS CHAR),'usageDate',usage_date,'usedCount',CAST(used_count AS CHAR),'version',CAST(version AS CHAR)) FROM player_pet_home_heart_usage"],
    ["pet_home_badge_stats", "SELECT ?, 'pet_home_badge_stats', CAST(player_id AS CHAR), JSON_OBJECT('playerId',CAST(player_id AS CHAR),'followers',CAST(followers AS CHAR),'mutual',CAST(mutual AS CHAR),'receivedComments',CAST(received_comments AS CHAR),'receivedHomeLikes',CAST(received_home_likes AS CHAR),'receivedReactions',CAST(received_reactions AS CHAR),'totalVisits',CAST(total_visits AS CHAR),'feedActiveDays',CAST(feed_active_days AS CHAR),'version',CAST(version AS CHAR)) FROM pet_home_badge_stats"],
    ["player_badge_assignments", "SELECT ?, 'player_badge_assignments', CONCAT(assignment.player_id,':',assignment.badge_code), JSON_OBJECT('playerId',CAST(assignment.player_id AS CHAR),'badgeCode',CONVERT(assignment.badge_code USING utf8mb4),'displayValue',assignment.display_value,'priority',assignment.priority,'startsAt',assignment.starts_at,'endsAt',assignment.ends_at) FROM player_badge_assignments assignment JOIN pet_home_badge_definitions definition ON definition.badge_code=assignment.badge_code"],
    ["player_home_badges", "SELECT ?, 'player_home_badges', CONCAT(player_id,':',badge_code), JSON_OBJECT('playerId',CAST(player_id AS CHAR),'badgeCode',CONVERT(badge_code USING utf8mb4),'owned',owned,'equipped',equipped,'version',CAST(version AS CHAR)) FROM player_home_badges"],
    ["player_badge_equipment", "SELECT ?, 'player_badge_equipment', CAST(player_id AS CHAR), JSON_OBJECT('playerId',CAST(player_id AS CHAR),'equippedBadgeCode',CONVERT(equipped_badge_code USING utf8mb4),'version',CAST(version AS CHAR)) FROM player_badge_equipment"],
    ["player_home_badge_exclusions", "SELECT ?, 'player_home_badge_exclusions', CONCAT(player_id,':',badge_code), JSON_OBJECT('playerId',CAST(player_id AS CHAR),'badgeCode',CONVERT(badge_code USING utf8mb4),'reasonCode',CONVERT(reason_code USING utf8mb4),'createdAt',created_at) FROM player_home_badge_exclusions"],
    ["pet_home_feed_activity_days", "SELECT ?, 'pet_home_feed_activity_days', CONCAT(player_id,':',activity_date), JSON_OBJECT('playerId',CAST(player_id AS CHAR),'activityDate',activity_date,'sourceCode',CONVERT(source_code USING utf8mb4),'createdAt',created_at) FROM pet_home_feed_activity_days"],
    ["pet_home_activity_alerts", "SELECT ?, 'pet_home_activity_alerts', CONCAT(owner_player_id,':',sequence_no), JSON_OBJECT('ownerPlayerId',CAST(owner_player_id AS CHAR),'sequenceNo',sequence_no,'alertType',CONVERT(alert_type USING utf8mb4),'actorPlayerId',CAST(actor_player_id AS CHAR),'createdAtText',created_at_text,'read',read_flag,'preview',preview_text,'badgeCode',CONVERT(badge_code USING utf8mb4),'actorName',actor_name,'feedKey',feed_key,'feedContent',feed_content,'mutual',mutual_flag,'count',CAST(aggregate_count AS CHAR),'restoredOperationId',CAST(restored_operation_id AS CHAR)) FROM pet_home_activity_alerts"],
    ["pet_home_recent_visitors", "SELECT ?, 'pet_home_recent_visitors', CONCAT(owner_player_id,':',sequence_no), JSON_OBJECT('ownerPlayerId',CAST(owner_player_id AS CHAR),'sequenceNo',sequence_no,'visitorPlayerId',CAST(visitor_player_id AS CHAR),'visitedAtText',visited_at_text,'restoredOperationId',CAST(restored_operation_id AS CHAR)) FROM pet_home_recent_visitors"],
    ["pet_home_special_badge_logs", "SELECT ?, 'pet_home_special_badge_logs', CONCAT(player_id,':',sequence_no), JSON_OBJECT('playerId',CAST(player_id AS CHAR),'sequenceNo',sequence_no,'badgeCode',CONVERT(badge_code USING utf8mb4),'actionCode',CONVERT(action_code USING utf8mb4),'adminExternalUserId',admin_external_user_id,'createdAtText',created_at_text,'restoredOperationId',CAST(restored_operation_id AS CHAR)) FROM pet_home_special_badge_logs"],
    ["pet_home_activity_migration_markers", "SELECT ?, 'pet_home_activity_migration_markers', migration_key, JSON_OBJECT('migrationKey',migration_key,'value',value_json,'restoredOperationId',CAST(restored_operation_id AS CHAR)) FROM pet_home_activity_migration_markers"],
  ];
  for (const [, selectSql] of statements) await transaction.execute(`INSERT INTO pet_home_activity_restore_backups(operation_id,entity_code,identity_key,row_json) ${selectSql}`, [operationId]);
  return scalar(transaction, "SELECT COUNT(*) value FROM pet_home_activity_restore_backups WHERE operation_id=?", [operationId]);
}

async function replaceProjection(transaction: DatabaseTransaction, operationId: bigint, backupKey: string): Promise<void> {
  for (const table of ["pet_home_activity_alerts", "pet_home_recent_visitors", "pet_home_special_badge_logs", "pet_home_activity_migration_markers", "player_badge_equipment", "player_home_badge_exclusions", "pet_home_feed_activity_days", "player_pet_home_heart_usage", "pet_home_follows", "pet_home_badge_stats", "player_home_badges"]) await transaction.execute(`DELETE FROM ${table}`);
  await transaction.execute("DELETE assignment FROM player_badge_assignments assignment JOIN pet_home_badge_definitions definition ON definition.badge_code=assignment.badge_code");
  const identityJoin = "JOIN external_identities identity ON identity.provider_code='kakao' AND identity.external_user_id=source.owner_external_user_id AND identity.status='linked'";
  await transaction.execute(`INSERT INTO pet_home_follows(follower_player_id,followed_player_id,active,version) SELECT owner_identity.player_id,related_identity.player_id,TRUE,1 FROM pet_home_activity_restore_source_relations source JOIN external_identities owner_identity ON owner_identity.provider_code='kakao' AND owner_identity.external_user_id=source.owner_external_user_id AND owner_identity.status='linked' JOIN external_identities related_identity ON related_identity.provider_code='kakao' AND related_identity.external_user_id=source.related_external_user_id AND related_identity.status='linked' WHERE source.backup_key=? AND source.direction_code='following'`, [backupKey]);
  await transaction.execute(`INSERT INTO player_pet_home_heart_usage(player_id,usage_date,used_count,version) SELECT identity.player_id,source.heart_usage_date,source.heart_used_count,1 FROM pet_home_activity_restore_source_social source ${identityJoin} WHERE source.backup_key=?`, [backupKey]);
  await transaction.execute(`INSERT INTO pet_home_badge_stats(player_id,followers,mutual,received_comments,received_home_likes,received_reactions,total_visits,feed_active_days,version) SELECT identity.player_id,source.followers_count,source.mutual_count,source.received_comments,source.received_home_likes,source.received_reactions,source.total_visits,(SELECT COUNT(*) FROM pet_home_activity_restore_source_feed_days day_row WHERE day_row.backup_key=source.backup_key AND day_row.owner_external_user_id=source.owner_external_user_id),1 FROM pet_home_activity_restore_source_social source ${identityJoin} WHERE source.backup_key=?`, [backupKey]);
  await transaction.execute(`INSERT INTO player_badge_assignments(player_id,badge_code,display_value,priority) SELECT identity.player_id,source.badge_code,CONCAT(definition.emoji,' ',definition.display_name),source.sequence_no FROM pet_home_activity_restore_source_badges source ${identityJoin} JOIN pet_home_badge_definitions definition ON definition.badge_code=source.badge_code WHERE source.backup_key=? AND source.collection_code='owned'`, [backupKey]);
  await transaction.execute(`INSERT INTO player_home_badges(player_id,badge_code,owned,equipped,version) SELECT identity.player_id,source.badge_code,TRUE,(social.equipped_badge_code=source.badge_code),1 FROM pet_home_activity_restore_source_badges source ${identityJoin} LEFT JOIN pet_home_activity_restore_source_social social ON social.backup_key=source.backup_key AND social.owner_external_user_id=source.owner_external_user_id WHERE source.backup_key=? AND source.collection_code='owned'`, [backupKey]);
  await transaction.execute(`INSERT INTO player_badge_equipment(player_id,equipped_badge_code,version) SELECT identity.player_id,source.equipped_badge_code,1 FROM pet_home_activity_restore_source_social source ${identityJoin} WHERE source.backup_key=?`, [backupKey]);
  await transaction.execute(`INSERT INTO player_home_badge_exclusions(player_id,badge_code,reason_code) SELECT identity.player_id,source.badge_code,'legacy_permanent_delete' FROM pet_home_activity_restore_source_badges source ${identityJoin} WHERE source.backup_key=? AND source.collection_code='deleted'`, [backupKey]);
  await transaction.execute(`INSERT INTO pet_home_feed_activity_days(player_id,activity_date,source_code) SELECT identity.player_id,source.activity_date,'legacy_activity_restore' FROM pet_home_activity_restore_source_feed_days source ${identityJoin} WHERE source.backup_key=?`, [backupKey]);
  await transaction.execute(`INSERT INTO pet_home_activity_alerts(owner_player_id,sequence_no,alert_type,actor_player_id,created_at_text,read_flag,preview_text,badge_code,actor_name,feed_key,feed_content,mutual_flag,aggregate_count,restored_operation_id) SELECT owner_identity.player_id,source.sequence_no,source.alert_type,actor_identity.player_id,source.created_at_text,source.read_flag,source.preview_text,source.badge_code,source.actor_name,source.feed_key,source.feed_content,source.mutual_flag,source.aggregate_count,? FROM pet_home_activity_restore_source_alerts source JOIN external_identities owner_identity ON owner_identity.provider_code='kakao' AND owner_identity.external_user_id=source.owner_external_user_id AND owner_identity.status='linked' JOIN external_identities actor_identity ON actor_identity.provider_code='kakao' AND actor_identity.external_user_id=source.actor_external_user_id AND actor_identity.status='linked' WHERE source.backup_key=?`, [operationId, backupKey]);
  await transaction.execute(`INSERT INTO pet_home_recent_visitors(owner_player_id,sequence_no,visitor_player_id,visited_at_text,restored_operation_id) SELECT owner_identity.player_id,source.sequence_no,visitor_identity.player_id,source.visited_at_text,? FROM pet_home_activity_restore_source_visitors source JOIN external_identities owner_identity ON owner_identity.provider_code='kakao' AND owner_identity.external_user_id=source.owner_external_user_id AND owner_identity.status='linked' JOIN external_identities visitor_identity ON visitor_identity.provider_code='kakao' AND visitor_identity.external_user_id=source.visitor_external_user_id AND visitor_identity.status='linked' WHERE source.backup_key=?`, [operationId, backupKey]);
  await transaction.execute(`INSERT INTO pet_home_special_badge_logs(player_id,sequence_no,badge_code,action_code,admin_external_user_id,created_at_text,restored_operation_id) SELECT identity.player_id,source.sequence_no,source.badge_code,source.action_code,source.admin_external_user_id,source.created_at_text,? FROM pet_home_activity_restore_source_special_logs source ${identityJoin} WHERE source.backup_key=?`, [operationId, backupKey]);
  await transaction.execute("INSERT INTO pet_home_activity_migration_markers(migration_key,value_json,restored_operation_id) SELECT migration_key,value_json,? FROM pet_home_activity_restore_source_migrations WHERE backup_key=?", [operationId, backupKey]);
}

// 검증된 펫홈 활동 백업 projection을 원본 변경 없이 한 transaction으로 복구합니다.
export class HomeActivityRestoreService {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<HomeActivityRestoreResult> {
    return this.database.withTransaction(async (transaction) => {
      const operator = (await transaction.query<OperatorRow[]>(`
        SELECT DISTINCT operator.id operator_id FROM external_identities identity
        JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
        JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
        JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
        JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id AND permission.permission_code='game.home.moderate'
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 2 FOR UPDATE`, [input.externalUserId]))[0];
      if (operator === undefined) throw new ApplicationError("HOME_ACTIVITY_RESTORE_FORBIDDEN", "펫홈 활동 복구 권한이 없습니다.", 403);
      const key = idempotencyKey(input.eventId);
      const prior = (await transaction.query<PriorRow[]>("SELECT result_json FROM operations WHERE idempotency_scope='home.activity.restore' AND idempotency_key=? FOR UPDATE", [key]))[0];
      if (prior?.result_json != null) return { ...parseStored(prior.result_json), replayed: true };
      if (prior !== undefined) throw new ApplicationError("HOME_ACTIVITY_RESTORE_IN_PROGRESS", "펫홈 활동 복구가 처리 중입니다.", 409);
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'home.activity.restore',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), key, operator.operator_id]);
      const source = (await transaction.query<SourceRow[]>("SELECT backup_key,source_root_hash FROM pet_home_activity_restore_sources WHERE backup_key=? AND active=TRUE FOR UPDATE", [BACKUP_KEY]))[0] ?? null;
      if (source === null) return finish(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, operatorId: operator.operator_id, source, legacyImportRunId: null, status: "missing", restoredUserCount: 0n, restoredAlertCount: 0n, restoredVisitorCount: 0n, backupRowCount: 0n });
      if (!(await sourceIsValid(transaction, source.backup_key))) return finish(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, operatorId: operator.operator_id, source, legacyImportRunId: null, status: "invalid", restoredUserCount: 0n, restoredAlertCount: 0n, restoredVisitorCount: 0n, backupRowCount: 0n });
      const importRun = await transaction.execute("INSERT INTO legacy_import_runs(run_key,source_root_hash,mode,status,started_at) VALUES (?,?,'RESTORE','running',UTC_TIMESTAMP(3))", [randomUUID(), source.source_root_hash]);
      const backupRowCount = await backupCurrentProjection(transaction, operation.insertId);
      await replaceProjection(transaction, operation.insertId, source.backup_key);
      const restoredUserCount = await scalar(transaction, "SELECT COUNT(*) value FROM pet_home_activity_restore_source_social WHERE backup_key=?", [source.backup_key]);
      const restoredAlertCount = await scalar(transaction, "SELECT COUNT(*) value FROM pet_home_activity_restore_source_alerts WHERE backup_key=?", [source.backup_key]);
      const restoredVisitorCount = await scalar(transaction, "SELECT COUNT(*) value FROM pet_home_activity_restore_source_visitors WHERE backup_key=?", [source.backup_key]);
      await transaction.execute("UPDATE legacy_import_runs SET status='completed',completed_at=UTC_TIMESTAMP(3) WHERE id=?", [importRun.insertId]);
      return finish(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, operatorId: operator.operator_id, source, legacyImportRunId: importRun.insertId, status: "restored", restoredUserCount, restoredAlertCount, restoredVisitorCount, backupRowCount });
    });
  }
}
