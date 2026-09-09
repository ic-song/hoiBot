import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE = "HOME_ACTIVITY_FILE_BOOTSTRAP";
const RESOURCE_CODE = "PET_HOME_ACTIVITY";
const RESOURCE_LABEL = "MariaDB: pet home activity";

export interface HomeActivityFileBootstrapResult {
  status: "created" | "already_exists";
  message: string;
  outboxId: string;
  replayed: boolean;
  activityRowCount: string;
  discoveredExisting: boolean;
}

type OperatorRow = { operator_id: bigint };
type StoredOperation = { result_json: string | HomeActivityFileBootstrapResult | null };

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseStored(value: string | HomeActivityFileBootstrapResult): HomeActivityFileBootstrapResult {
  return typeof value === "string" ? JSON.parse(value) as HomeActivityFileBootstrapResult : value;
}

export function buildHomeActivityFileBootstrapMessage(status: "created" | "already_exists"): string {
  return status === "created"
    ? `✅ 펫홈 활동 파일 생성 완료\n${RESOURCE_LABEL}`
    : `✅ 펫홈 활동 파일이 이미 있습니다.\n${RESOURCE_LABEL}`;
}

async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint;
  eventId: string;
  operatorId: bigint;
  destinationId: string;
  status: "created" | "already_exists";
  activityRowCount: bigint;
  discoveredExisting: boolean;
}): Promise<HomeActivityFileBootstrapResult> {
  const message = buildHomeActivityFileBootstrapMessage(input.status);
  const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: message })]);
  const result: HomeActivityFileBootstrapResult = { status: input.status, message, outboxId: outbox.insertId.toString(), replayed: false, activityRowCount: input.activityRowCount.toString(), discoveredExisting: input.discoveredExisting };
  await transaction.execute("INSERT INTO pet_home_activity_bootstrap_runs(operation_id,actor_operator_id,result_code,activity_row_count,discovered_existing) VALUES (?,?,?,?,?)", [input.operationId, input.operatorId, input.status, input.activityRowCount, input.discoveredExisting]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, COMMAND_CODE, input.operationId, input.status]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'pet_home_activity_store',NULL,'home.activity.bootstrap',?,'Iris /펫홈활동파일생성',?,UTC_TIMESTAMP(3))", [input.operationId, input.operatorId, input.status, JSON.stringify({ resourceCode: RESOURCE_CODE, status: input.status, activityRowCount: result.activityRowCount, discoveredExisting: input.discoveredExisting, existingRowsPreserved: true })]);
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 기존 활동 관계형 행을 보존하고 저장소의 최초 준비 상태만 멱등 기록합니다.
export class HomeActivityFileBootstrapService {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<HomeActivityFileBootstrapResult> {
    return this.database.withTransaction(async (transaction) => {
      const operator = (await transaction.query<OperatorRow[]>(`SELECT mapping.operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND operator.status='active' AND permission.permission_code='game.home.moderate' ORDER BY mapping.operator_id LIMIT 1 FOR UPDATE`, [input.externalUserId]))[0];
      if (operator === undefined) throw new ApplicationError("HOME_ACTIVITY_BOOTSTRAP_FORBIDDEN", "펫홈 활동 파일 생성 권한이 없습니다.", 403);
      const key = eventKey(input.eventId);
      const prior = (await transaction.query<StoredOperation[]>("SELECT result_json FROM operations WHERE idempotency_scope='home.activity.bootstrap' AND idempotency_key=? FOR UPDATE", [key]))[0];
      if (prior?.result_json != null) return { ...parseStored(prior.result_json), replayed: true };
      if (prior !== undefined) throw new ApplicationError("HOME_ACTIVITY_BOOTSTRAP_IN_PROGRESS", "활동 저장소 준비 작업이 처리 중입니다.", 409);
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'home.activity.bootstrap',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), key, operator.operator_id]);
      const stateExists = (await transaction.query<Array<{ resource_code: string }>>("SELECT resource_code FROM pet_home_activity_bootstrap_state WHERE resource_code=? FOR UPDATE", [RESOURCE_CODE]))[0] !== undefined;
      const counts = (await transaction.query<Array<{ activity_row_count: bigint }>>(`SELECT
        (SELECT COUNT(*) FROM pet_home_activity_alerts)
        +(SELECT COUNT(*) FROM pet_home_recent_visitors)
        +(SELECT COUNT(*) FROM pet_home_follows)
        +(SELECT COUNT(*) FROM player_pet_home_heart_usage)
        +(SELECT COUNT(*) FROM pet_home_badge_stats)
        +(SELECT COUNT(*) FROM player_home_badges)
        +(SELECT COUNT(*) FROM player_home_badge_exclusions)
        +(SELECT COUNT(*) FROM pet_home_feed_activity_days)
        +(SELECT COUNT(*) FROM pet_home_special_badge_logs)
        +(SELECT COUNT(*) FROM pet_home_activity_migration_markers) activity_row_count`))[0]!;
      const discoveredExisting = !stateExists && counts.activity_row_count > 0n;
      if (!stateExists) await transaction.execute("INSERT INTO pet_home_activity_bootstrap_state(resource_code,schema_version,initialized_operation_id,initialized_by_operator_id,discovered_existing,metadata_json,version,initialized_at) VALUES (?,1,?,?,?,?,1,UTC_TIMESTAMP(3))", [RESOURCE_CODE, operation.insertId, operator.operator_id, discoveredExisting, JSON.stringify({ storage: "mariadb", roots: ["alerts", "recentVisitors", "petHomeSocial", "migrations"], overwriteExisting: false })]);
      return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, operatorId: operator.operator_id, destinationId: input.destinationId, status: stateExists || discoveredExisting ? "already_exists" : "created", activityRowCount: counts.activity_row_count, discoveredExisting });
    });
  }
}
