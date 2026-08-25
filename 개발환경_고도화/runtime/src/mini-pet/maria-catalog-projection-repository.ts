import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import type {
  MiniPetCatalogEntry, MiniPetCatalogProjectionRepository, MiniPetPublishedSnapshotInput,
  MiniPetReadInput, MiniPetReadResult, OwnedMiniPetProjection
} from "./catalog-projection-repository.js";

interface ViewerRow { identity_id: bigint | null; player_id: bigint | null; operator_id: bigint | null; trusted_admin: number; }
interface OperationRow { id: bigint; status: string; result_json: string | MiniPetReadResult | null; request_hash: string | null; stale_processing: number; }

// 긴 event ID를 기존 operations key 제한 안에서 안정적으로 표현합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 동일 read DTO로 복원합니다.
function stored(value: string | MiniPetReadResult): MiniPetReadResult {
  return typeof value === "string" ? JSON.parse(value) as MiniPetReadResult : value;
}

// connector가 JSON scalar를 일반 문자열로 반환하는 경우에도 원문을 보존합니다.
function jsonValue(value: string | unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

// MariaDB unique 충돌만 기존 execution 재조회 경로로 전환합니다.
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "ER_DUP_ENTRY";
}

export class MariaMiniPetCatalogProjectionRepository implements MiniPetCatalogProjectionRepository {
  constructor(private readonly database: DatabaseClient) {}

  // 환경 identity를 확인하고 가장 최근 published snapshot의 immutable pin을 반환합니다.
  async resolveLatestSnapshotPin(environmentCode: "prod" | "dev"): Promise<{ poolVersion: string; snapshotAt: string }> {
    return this.database.withTransaction(async (tx) => {
      await this.requireDatabaseEnvironment(tx, environmentCode);
      const rows = await tx.query<Array<{ pool_version: string; snapshot_at: Date }>>(
        `SELECT pool_version, snapshot_at FROM mini_pet_catalog_snapshots
         WHERE environment_code = ? AND status = 'published'
         ORDER BY snapshot_at DESC, pool_version DESC LIMIT 1`,
        [environmentCode]
      );
      const row = rows[0];
      if (row === undefined) throw new ApplicationError("MINIPET_SNAPSHOT_NOT_FOUND", "발행된 미니펫 snapshot이 없습니다.", 404);
      return { poolVersion: row.pool_version, snapshotAt: row.snapshot_at.toISOString() };
    });
  }

  // pin된 owner snapshot에서 표시 이름이 정확히 일치하는 단일 player를 해석합니다.
  async resolveTargetPlayer(environmentCode: "prod" | "dev", poolVersion: string, snapshotAt: string, targetName: string): Promise<{ playerId: string; displayName: string }> {
    return this.database.withTransaction(async (tx) => {
      await this.requireDatabaseEnvironment(tx, environmentCode);
      const rows = await tx.query<Array<{ player_id: bigint; owner_display_name: string }>>(
        `SELECT owner.player_id, owner.owner_display_name
         FROM mini_pet_catalog_snapshots snapshot
         JOIN mini_pet_owner_read_snapshots owner
           ON owner.environment_code = snapshot.environment_code
          AND owner.snapshot_version = snapshot.owned_snapshot_version
         WHERE snapshot.environment_code = ? AND snapshot.pool_version = ?
           AND snapshot.snapshot_at = ? AND snapshot.status = 'published'
           AND owner.owner_display_name = ?
         ORDER BY owner.player_id LIMIT 2 FOR UPDATE`,
        [environmentCode, poolVersion, new Date(snapshotAt), targetName]
      );
      if (rows.length === 0) throw new ApplicationError("MINIPET_ADMIN_TARGET_NOT_FOUND", "대상 미니펫 데이터가 없습니다.", 404);
      if (rows.length > 1) throw new ApplicationError("MINIPET_ADMIN_TARGET_AMBIGUOUS", "같은 이름의 대상이 여러 명입니다.", 409);
      return { playerId: rows[0]!.player_id.toString(), displayName: rows[0]!.owner_display_name };
    });
  }

  // identity→operation→snapshot 순서로 고정해 read replay와 audit/outbox를 원자화합니다.
  async read(input: MiniPetReadInput): Promise<MiniPetReadResult> {
    try {
      return await this.database.withTransaction((tx) => this.readTransaction(tx, input, false));
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      return this.database.withTransaction((tx) => this.readTransaction(tx, input, true));
    }
  }

  // DB identity, replay와 stale recovery를 한 transaction에서 처리합니다.
  private async readTransaction(tx: DatabaseTransaction, input: MiniPetReadInput, collisionReplay: boolean): Promise<MiniPetReadResult> {
      await this.requireDatabaseEnvironment(tx, input.environmentCode);
      const viewer = await this.readViewer(tx, input.viewerExternalUserId, input.environmentCode);
      await this.authorize(tx, input, viewer);
      const scope = viewer.identity_id === null ? `mini-pet.public.read:${input.projectionCode}` : `mini-pet.read:${input.projectionCode}:${viewer.identity_id}`;
      const prior = await tx.query<OperationRow[]>(
        `SELECT operation.id, operation.status, operation.result_json, execution.request_hash,
          CASE WHEN operation.status = 'processing' AND operation.created_at < UTC_TIMESTAMP(3) - INTERVAL 5 MINUTE THEN 1 ELSE 0 END stale_processing
         FROM operations operation LEFT JOIN mini_pet_read_executions execution ON execution.operation_id = operation.id
         WHERE operation.idempotency_scope = ? AND operation.idempotency_key = ? FOR UPDATE`,
        [scope, eventKey(input.providerEventId)]
      );
      const replay = prior[0];
      if (replay?.result_json !== null && replay?.result_json !== undefined) {
        if (replay.request_hash !== input.requestHash) throw new ApplicationError("MINIPET_REPLAY_MISMATCH", "동일 event의 요청 내용이 다릅니다.", 409);
        return stored(replay.result_json);
      }
      if (replay !== undefined && replay.stale_processing !== 1) throw new ApplicationError("MINIPET_REPLAY_NOT_READY", "이전 projection 요청이 처리 중입니다.", 409);
      if (collisionReplay && replay === undefined) throw new ApplicationError("MINIPET_REPLAY_EXECUTION_MISSING", "unique 충돌 후 execution을 찾을 수 없습니다.", 409);
      const operationId = replay?.id ?? await this.createOperation(tx, scope, input, viewer.identity_id);
      if (replay !== undefined && replay.request_hash !== input.requestHash) {
        throw new ApplicationError("MINIPET_REPLAY_MISMATCH", "동일 event의 요청 내용이 다릅니다.", 409);
      }
      if (replay !== undefined) {
        await tx.execute("UPDATE operations SET status = 'processing', result_json = NULL, created_at = UTC_TIMESTAMP(3), completed_at = NULL WHERE id = ?", [operationId]);
        await tx.execute("UPDATE mini_pet_read_executions SET status = 'processing', environment_code = ?, pool_version = ?, projection_code = ?, snapshot_at = ?, started_at = UTC_TIMESTAMP(3), completed_at = NULL WHERE operation_id = ?", [input.environmentCode, input.poolVersion, input.projectionCode, new Date(input.snapshotAt), operationId]);
      }
      const result = await this.project(tx, input, viewer, operationId);
      await tx.execute("UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [JSON.stringify(result), operationId]);
      await tx.execute("UPDATE mini_pet_read_executions SET status = 'completed', completed_at = UTC_TIMESTAMP(3) WHERE operation_id = ?", [operationId]);
      return result;
  }

  // configured DB identity와 요청 환경을 잠금 조회로 대조합니다.
  private async requireDatabaseEnvironment(tx: DatabaseTransaction, environmentCode: string): Promise<void> {
    const rows = await tx.query<Array<{ environment_code: string }>>(
      "SELECT environment_code FROM mini_pet_projection_environment_identity WHERE singleton_id = 1 FOR UPDATE"
    );
    if (rows[0]?.environment_code !== environmentCode) throw new ApplicationError("MINIPET_DATABASE_ENVIRONMENT_MISMATCH", "DB environment identity가 일치하지 않습니다.", 409);
  }

  // linked Kakao identity와 선택적인 active operator를 같은 identity row에서 읽습니다.
  private async readViewer(tx: DatabaseTransaction, externalUserId: string | undefined, environmentCode: string): Promise<ViewerRow> {
    if (externalUserId === undefined) return { identity_id: null, player_id: null, operator_id: null, trusted_admin: 0 };
    const rows = await tx.query<ViewerRow[]>(
      `SELECT identity.id AS identity_id, identity.player_id, operator.id AS operator_id,
        CASE WHEN trusted.status = 'active' THEN 1 ELSE 0 END trusted_admin
       FROM external_identities identity
       LEFT JOIN admin_operator_external_identities mapping ON mapping.external_identity_id = identity.id
       LEFT JOIN admin_operators operator ON operator.id = mapping.operator_id AND operator.status = 'active'
       LEFT JOIN mini_pet_trusted_admin_identities trusted ON trusted.external_identity_id = identity.id AND trusted.environment_code = ?
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
       LIMIT 1 FOR UPDATE`, [environmentCode, externalUserId]
    );
    if (rows[0] === undefined) throw new ApplicationError("MINIPET_VIEWER_NOT_LINKED", "연결된 조회 identity가 필요합니다.", 403);
    return rows[0];
  }

  // 일반 self visibility와 admin-info 전용 permission을 분리합니다.
  private async authorize(tx: DatabaseTransaction, input: MiniPetReadInput, viewer: ViewerRow): Promise<void> {
    if (input.projectionCode === "admin_info") {
      const permissions = await tx.query<Array<{ allowed: number }>>(
        `SELECT 1 AS allowed FROM admin_operator_roles operator_role
         JOIN admin_role_permissions permission ON permission.role_id = operator_role.role_id
         WHERE operator_role.operator_id = ? AND permission.permission_code = 'minipet.admin_info.read' LIMIT 1`,
        [viewer.operator_id]
      );
      const channels = await tx.query<Array<{ allowed: number }>>(
        `SELECT 1 AS allowed FROM mini_pet_admin_read_channel_scopes
         WHERE environment_code = ? AND external_channel_id = ? AND status = 'active' LIMIT 1`,
        [input.environmentCode, input.requestChannelId]
      );
      if (viewer.operator_id === null || viewer.trusted_admin !== 1 || permissions[0] === undefined || channels[0] === undefined) {
        throw new ApplicationError("FORBIDDEN", "신뢰된 미니펫 관리자 조회 권한 또는 허용 채널이 없습니다.", 403);
      }
      if (viewer.player_id?.toString() === input.targetPlayerId) {
        throw new ApplicationError("MINIPET_ADMIN_SELF_TARGET", "본인 정보는 /미니펫가방을 이용해 주세요.", 409);
      }
      return;
    }
    if ((input.projectionCode === "inventory" || input.projectionCode === "collection")
      && (viewer.player_id === null || viewer.player_id.toString() !== input.targetPlayerId)) {
      throw new ApplicationError("FORBIDDEN", "본인의 미니펫 projection만 조회할 수 있습니다.", 403);
    }
  }

  // 기존 operations unique를 먼저 만들고 request hash 확장 원장을 연결합니다.
  private async createOperation(tx: DatabaseTransaction, scope: string, input: MiniPetReadInput, identityId: bigint | null): Promise<bigint> {
    const operation = await tx.execute(
      "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, ?, ?, 'iris', 'processing', UTC_TIMESTAMP(3))",
      [randomUUID(), scope, eventKey(input.providerEventId), identityId === null ? 'system' : 'external_identity', identityId ?? 0]
    );
    await tx.execute(
      "INSERT INTO mini_pet_read_executions (operation_id, request_hash, environment_code, pool_version, projection_code, snapshot_at) VALUES (?, ?, ?, ?, ?, ?)",
      [operation.insertId, input.requestHash, input.environmentCode, input.poolVersion, input.projectionCode, new Date(input.snapshotAt)]
    );
    return operation.insertId;
  }

  // catalog, owned, collection과 aggregate를 한 transaction snapshot에서 투영합니다.
  private async project(tx: DatabaseTransaction, input: MiniPetReadInput, viewer: ViewerRow, operationId: bigint): Promise<MiniPetReadResult> {
    const snapshots = await tx.query<Array<{ definition_version: string; owned_snapshot_version: string; grade_table_json: string | Record<string, string>; allowed_grades_json: string | string[]; stage_rewards_json: string | Record<string, unknown>; total_raw_probability: string; total_normalized_rate: string; zero_total: number; snapshot_at: Date }>>(
      `SELECT definition_version, owned_snapshot_version, grade_table_json, allowed_grades_json, stage_rewards_json,
        total_raw_probability, total_normalized_rate, zero_total, snapshot_at
       FROM mini_pet_catalog_snapshots WHERE environment_code = ? AND pool_version = ? AND status = 'published'`,
      [input.environmentCode, input.poolVersion]
    );
    const snapshot = snapshots[0];
    if (snapshot === undefined || snapshot.snapshot_at.toISOString() !== new Date(input.snapshotAt).toISOString()) {
      throw new ApplicationError("MINIPET_SNAPSHOT_STALE", "요청한 catalog snapshot pin을 찾을 수 없습니다.", 409);
    }
    const catalogRows = await tx.query<Array<{
      mini_pet_definition_id: bigint; definition_code: string; display_name: string; grade_code: string;
      grade_display_name: string; emoji_value: string; source_order: number; filter_key: string;
      raw_probability: string | null; normalized_rate: string | null; allowed: number;
    }>>(
      `SELECT mini_pet_definition_id, definition_code, display_name, grade_code, grade_display_name,
        emoji_value, source_order, filter_key, raw_probability, normalized_rate, allowed
       FROM mini_pet_catalog_entries WHERE environment_code = ? AND pool_version = ?
         AND (? <> 'draw_rates' OR allowed = TRUE) ORDER BY source_order ASC`,
      [input.environmentCode, input.poolVersion, input.projectionCode]
    );
    const catalog: MiniPetCatalogEntry[] = catalogRows.map((row) => ({
      definitionId: row.mini_pet_definition_id.toString(), definitionCode: row.definition_code,
      name: row.display_name, gradeCode: row.grade_code, grade: row.grade_display_name,
      emoji: row.emoji_value, sourceOrder: row.source_order, filterKey: row.filter_key,
      rawProbability: row.raw_probability, normalizedRate: row.normalized_rate, allowed: Boolean(row.allowed)
    }));
    const targetPlayerId = input.targetPlayerId ?? viewer.player_id?.toString();
    const owned = targetPlayerId === undefined ? await this.readAllOwned(tx, catalog, input.projectionCode === "equipped_rank", input.environmentCode, snapshot.owned_snapshot_version)
      : await this.readPlayerOwned(tx, targetPlayerId, catalog, input.environmentCode, snapshot.owned_snapshot_version);
    const gradeAggregate = this.aggregateGrades(owned, catalog);
    const allowedGrades = typeof snapshot.allowed_grades_json === "string" ? JSON.parse(snapshot.allowed_grades_json) as string[] : snapshot.allowed_grades_json;
    const gradeTable = typeof snapshot.grade_table_json === "string" ? JSON.parse(snapshot.grade_table_json) as Record<string, string> : snapshot.grade_table_json;
    const stageRewards = typeof snapshot.stage_rewards_json === "string" ? JSON.parse(snapshot.stage_rewards_json) as Record<string, unknown> : snapshot.stage_rewards_json;
    const collection = targetPlayerId === undefined ? [] : await this.readCollection(tx, targetPlayerId, input.environmentCode, input.poolVersion);
    const collectionGrades = allowedGrades.map((grade) => ({ grade, registered: collection.some((item) => item.grade === grade && item.registered) }));
    const adminLegacySnapshot = input.projectionCode === "admin_info" && targetPlayerId !== undefined
      ? await this.readAdminSnapshot(tx, input.environmentCode, snapshot.owned_snapshot_version, targetPlayerId) : undefined;
    const audit = await tx.execute(
      "INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'external_identity', ?, 'player', ?, ?, 'success', 'mini-pet read projection', ?, UTC_TIMESTAMP(3))",
      [operationId, viewer.identity_id ?? 0, targetPlayerId ?? viewer.player_id ?? viewer.identity_id ?? 0,
        `mini_pet.${input.projectionCode}.read`, JSON.stringify({ poolVersion: input.poolVersion, ownedCount: owned.length })]
    );
    let outboxId: string | undefined;
    if (input.replyDestinationId !== undefined) {
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'json', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [operationId, input.replyDestinationId, JSON.stringify({ projectionCode: input.projectionCode, poolVersion: input.poolVersion })]
      );
      outboxId = outbox.insertId.toString();
    }
    await tx.execute(
      "INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, ?, ?, 'completed', 'projection_ready', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [input.providerEventId, `mini_pet_${input.projectionCode}`, operationId]
    );
    return {
      projectionCode: input.projectionCode, environmentCode: input.environmentCode,
      poolVersion: input.poolVersion, definitionVersion: snapshot.definition_version,
      ownedSnapshotVersion: snapshot.owned_snapshot_version, snapshotAt: input.snapshotAt, zeroTotal: Boolean(snapshot.zero_total),
      totalRawProbability: String(snapshot.total_raw_probability), totalNormalizedRate: String(snapshot.total_normalized_rate),
      capacity: 100, catalog, owned, gradeAggregate, gradeTotalCount: gradeAggregate.reduce((sum, row) => sum + row.count, 0),
      allowedGrades, gradeTable, stageRewards, collection, collectionGrades,
      collectionRepairRequired: collection.some((item) => item.repairRequired),
      ...(adminLegacySnapshot === undefined ? {} : { adminLegacySnapshot }),
      ...(outboxId === undefined ? {} : { outboxId }), auditId: audit.insertId.toString()
    };
  }

  // 한 player의 장착+가방 row를 legacy inventory 정렬 기준으로 읽습니다.
  private async readPlayerOwned(tx: DatabaseTransaction, playerId: string, catalog: MiniPetCatalogEntry[], environmentCode: string, snapshotVersion: string): Promise<OwnedMiniPetProjection[]> {
    const rows = await this.queryOwned(tx, "AND owned.player_id = ?", [playerId], environmentCode, snapshotVersion);
    return this.projectOwned(rows, catalog, false, snapshotVersion);
  }

  // 장착 순위는 전체 player 중 equipped row만 battle EXP와 stable owned ID로 정렬합니다.
  private async readAllOwned(tx: DatabaseTransaction, catalog: MiniPetCatalogEntry[], equippedOnly: boolean, environmentCode: string, snapshotVersion: string): Promise<OwnedMiniPetProjection[]> {
    const rows = await this.queryOwned(tx, equippedOnly ? "AND owned.equipped = TRUE" : "", [], environmentCode, snapshotVersion);
    return this.projectOwned(rows, catalog, equippedOnly, snapshotVersion);
  }

  // owned projection의 공통 relational row를 안정 ID와 함께 조회합니다.
  private async queryOwned(tx: DatabaseTransaction, whereSql: string, parameters: unknown[], environmentCode: string, snapshotVersion: string) {
    return tx.query<Array<{ id: bigint; player_id: bigint; mini_pet_definition_id: bigint; definition_code: string; definition_name: string; custom_name: string | null; grade_display_name: string; emoji_value: string; battle_experience: bigint; equipped: number; owner_display_name: string; owner_check_rank: string }>>(
      `SELECT owned.owned_mini_pet_id AS id, owned.player_id, owned.mini_pet_definition_id, definition.code AS definition_code,
        definition.display_name AS definition_name, owned.custom_name, definition.grade_display_name,
        definition.emoji_value, owned.battle_experience, owned.equipped,
        owner.owner_display_name, owner.owner_check_rank
       FROM mini_pet_owned_read_snapshots owned
       JOIN mini_pet_definitions definition ON definition.id = owned.mini_pet_definition_id
       JOIN mini_pet_owner_read_snapshots owner ON owner.player_id = owned.player_id
         AND owner.environment_code = ? AND owner.snapshot_version = ?
       WHERE owned.environment_code = ? AND owned.snapshot_version = ?
       ${whereSql} ORDER BY owned.battle_experience DESC, owned.owned_mini_pet_id ASC`,
      [environmentCode, snapshotVersion, environmentCode, snapshotVersion, ...parameters]
    );
  }

  // current source의 EXP↓, grade order, 이름 ko, stable ID 순서를 projection에 고정합니다.
  private projectOwned(rows: Awaited<ReturnType<MariaMiniPetCatalogProjectionRepository["queryOwned"]>>, catalog: MiniPetCatalogEntry[], rankOnly: boolean, snapshotVersion: string): OwnedMiniPetProjection[] {
    const gradeOrder = new Map(catalog.map((entry) => [entry.grade, entry.sourceOrder]));
    const projected = rows.map((row) => ({
      ownedId: row.id.toString(), playerId: row.player_id.toString(), definitionId: row.mini_pet_definition_id.toString(),
      definitionCode: row.definition_code, name: row.custom_name || row.definition_name || "이름없음",
      grade: row.grade_display_name || "일반", emoji: row.emoji_value || "❓",
      experience: row.battle_experience.toString(), equipped: Boolean(row.equipped), displayOrder: 0, rank: 0,
      ownerDisplayName: row.owner_display_name, ownerCheckRank: row.owner_check_rank, snapshotVersion
    }));
    projected.sort((left, right) => {
      const exp = BigInt(right.experience) - BigInt(left.experience);
      if (exp !== 0n) return exp > 0n ? 1 : -1;
      if (!rankOnly) {
        const grade = (gradeOrder.get(left.grade) ?? Number.MAX_SAFE_INTEGER) - (gradeOrder.get(right.grade) ?? Number.MAX_SAFE_INTEGER);
        if (grade !== 0) return grade;
        const name = left.name.localeCompare(right.name, "ko");
        if (name !== 0) return name;
      }
      return BigInt(left.ownedId) < BigInt(right.ownedId) ? -1 : 1;
    });
    return projected.map((item, index) => ({ ...item, displayOrder: index + 1, rank: index + 1 }));
  }

  // bag-only 등급 통계를 legacy elite alias와 1자리 백분율로 집계합니다.
  private aggregateGrades(owned: OwnedMiniPetProjection[], catalog: MiniPetCatalogEntry[]) {
    const bag = owned.filter((item) => !item.equipped);
    const counts = new Map<string, number>();
    const knownGrades = new Set(catalog.map((entry) => entry.grade));
    for (const item of bag) {
      const alias = item.grade === "엘리트급" || item.grade === "ELITE" ? "엘리트" : item.grade;
      const grade = alias === "엘리트" || knownGrades.has(alias) || alias === "이벤트" ? alias : "기타";
      counts.set(grade, (counts.get(grade) ?? 0) + 1);
    }
    const gradeOrder = new Map(catalog.map((entry) => [entry.grade, entry.sourceOrder]));
    return Array.from(counts.entries()).sort((left, right) => {
      if (left[0] === "이벤트") return -1;
      if (right[0] === "이벤트") return 1;
      if (left[0] === "기타") return 1;
      if (right[0] === "기타") return -1;
      if (left[0] === "엘리트" && right[0] !== "엘리트") return right[0] === "창조" ? 1 : (gradeOrder.get(right[0]) ?? Number.MAX_SAFE_INTEGER) > (gradeOrder.get("창조") ?? -1) ? -1 : 1;
      if (right[0] === "엘리트" && left[0] !== "엘리트") return left[0] === "창조" ? -1 : (gradeOrder.get(left[0]) ?? Number.MAX_SAFE_INTEGER) > (gradeOrder.get("창조") ?? -1) ? 1 : -1;
      return (gradeOrder.get(left[0]) ?? Number.MAX_SAFE_INTEGER) - (gradeOrder.get(right[0]) ?? Number.MAX_SAFE_INTEGER)
        || left[0].localeCompare(right[0], "ko");
    }).map(([grade, count]) => ({ grade, count, percentage: ((count / bag.length) * 100).toFixed(1) }));
  }

  // collection registration과 stage projection을 definition source order로 읽습니다.
  private async readCollection(tx: DatabaseTransaction, playerId: string, environmentCode: string, poolVersion: string) {
    const rows = await tx.query<Array<{ definition_id: bigint; definition_code: string; display_name: string; grade_display_name: string; registered: number; stage: number; completed_stage: number; repair_required: number }>>(
      `SELECT definition.id AS definition_id, definition.code AS definition_code, definition.display_name,
        definition.grade_display_name, COALESCE(projection.registered, FALSE) registered,
        COALESCE(NULLIF(projection.stage, 0), 1) stage, COALESCE(projection.completed_stage, 0) completed_stage,
        CASE WHEN projection.player_id IS NOT NULL AND projection.stage < 1 THEN 1 ELSE 0 END repair_required
       FROM mini_pet_catalog_entries entry
       JOIN mini_pet_definitions definition ON definition.id = entry.mini_pet_definition_id
       LEFT JOIN mini_pet_collection_projections projection ON projection.mini_pet_definition_id = definition.id AND projection.player_id = ?
       WHERE entry.environment_code = ? AND entry.pool_version = ? AND entry.allowed = TRUE
       ORDER BY entry.source_order, definition.display_name COLLATE utf8mb4_unicode_ci, definition.id`,
      [playerId, environmentCode, poolVersion]
    );
    return rows.map((row) => ({ definitionId: row.definition_id.toString(), definitionCode: row.definition_code,
      name: row.display_name, grade: row.grade_display_name, registered: Boolean(row.registered),
      stage: row.stage, completedStage: row.completed_stage, repairRequired: Boolean(row.repair_required) }));
  }

  // allowlist에 등록된 full legacy snapshot field만 관리자 projection에 노출합니다.
  private async readAdminSnapshot(tx: DatabaseTransaction, environmentCode: string, snapshotVersion: string, playerId: string): Promise<Record<string, unknown>> {
    const rows = await tx.query<Array<{ field_code: string; field_value_json: string | unknown }>>(
      `SELECT snapshot.field_code, snapshot.field_value_json
       FROM mini_pet_admin_legacy_snapshot_fields snapshot
       JOIN mini_pet_admin_snapshot_field_allowlist allowlist ON allowlist.field_code = snapshot.field_code
       WHERE snapshot.environment_code = ? AND snapshot.snapshot_version = ? AND snapshot.player_id = ?
       ORDER BY snapshot.field_code`, [environmentCode, snapshotVersion, playerId]
    );
    return Object.fromEntries(rows.map((row) => [row.field_code, jsonValue(row.field_value_json)]));
  }

  // gradeTable/allowedGrades와 draw entries를 immutable published version으로 적재합니다.
  async publishSnapshot(input: MiniPetPublishedSnapshotInput): Promise<{ poolVersion: string; definitionVersion: string; snapshotAt: string }> {
    return this.database.withTransaction(async (tx) => {
      await this.requireDatabaseEnvironment(tx, input.environmentCode);
      const publisher = await this.readViewer(tx, input.publisherExternalUserId, input.environmentCode);
      const allowed = await tx.query<Array<{ allowed: number }>>(
        `SELECT 1 allowed FROM admin_operator_roles operator_role
         JOIN admin_role_permissions permission ON permission.role_id = operator_role.role_id
         WHERE operator_role.operator_id = ? AND permission.permission_code = 'minipet.catalog.publish' LIMIT 1`, [publisher.operator_id]
      );
      if (publisher.trusted_admin !== 1 || allowed[0] === undefined) throw new ApplicationError("FORBIDDEN", "신뢰된 snapshot 발행 권한이 없습니다.", 403);
      await tx.execute(
        "INSERT INTO mini_pet_owned_snapshot_versions (environment_code, snapshot_version, captured_at) VALUES (?, ?, ?)",
        [input.environmentCode, input.ownedSnapshotVersion, input.snapshotAt]
      );
      await tx.execute(
        `INSERT INTO mini_pet_owned_read_snapshots
          (environment_code, snapshot_version, owned_mini_pet_id, player_id, mini_pet_definition_id,
           custom_name, battle_experience, equipped)
         SELECT ?, ?, owned.id, owned.player_id, owned.mini_pet_definition_id,
           owned.custom_name, owned.battle_experience, owned.equipped
         FROM owned_mini_pets owned`,
        [input.environmentCode, input.ownedSnapshotVersion]
      );
      const missingOwnerSnapshots = await tx.query<Array<{ missing_count: bigint }>>(
        `SELECT COUNT(DISTINCT owned.player_id) AS missing_count
         FROM mini_pet_owned_read_snapshots owned
         LEFT JOIN mini_pet_owner_read_snapshots owner ON owner.player_id = owned.player_id
           AND owner.environment_code = owned.environment_code AND owner.snapshot_version = owned.snapshot_version
         WHERE owned.environment_code = ? AND owned.snapshot_version = ? AND owner.player_id IS NULL`,
        [input.environmentCode, input.ownedSnapshotVersion]
      );
      if (BigInt(missingOwnerSnapshots[0]?.missing_count ?? 0) > 0n) {
        throw new ApplicationError("MINIPET_OWNER_SNAPSHOT_INCOMPLETE", "owned snapshot과 같은 버전의 owner 표시정보가 완전하지 않습니다.", 409);
      }
      await tx.execute(
        `INSERT INTO mini_pet_catalog_snapshots
          (pool_version, environment_code, catalog_kind, definition_version, owned_snapshot_version, snapshot_at,
           grade_table_json, allowed_grades_json, stage_rewards_json, total_raw_probability, total_normalized_rate, zero_total, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')`,
        [input.poolVersion, input.environmentCode, input.catalogKind, input.definitionVersion, input.ownedSnapshotVersion,
          input.snapshotAt, JSON.stringify(input.gradeTable), JSON.stringify(input.allowedGrades), JSON.stringify(input.stageRewards),
          input.entries.reduce((sum, entry) => sum + Number(entry.rawProbability ?? 0), 0),
          input.entries.filter((entry) => entry.allowed).reduce((sum, entry) => sum + Number(entry.normalizedRate ?? 0), 0),
          input.entries.filter((entry) => entry.allowed).length === 0]
      );
      for (const entry of input.entries) {
        await tx.execute(
          `INSERT INTO mini_pet_catalog_entries
            (environment_code, pool_version, source_order, mini_pet_definition_id, definition_code, display_name,
             grade_code, grade_display_name, emoji_value, filter_key, raw_probability, normalized_rate, allowed)
           SELECT ?, ?, ?, definition.id, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM mini_pet_definitions definition WHERE definition.code = ?`,
          [input.environmentCode, input.poolVersion, entry.sourceOrder, entry.definitionCode, entry.name, entry.gradeCode,
            entry.grade, entry.emoji, entry.filterKey, entry.rawProbability, entry.normalizedRate, entry.allowed, entry.definitionCode]
        );
      }
      return { poolVersion: input.poolVersion, definitionVersion: input.definitionVersion, snapshotAt: input.snapshotAt };
    });
  }
}
