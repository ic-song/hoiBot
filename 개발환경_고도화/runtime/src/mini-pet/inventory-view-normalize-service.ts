import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const INVENTORY_CAPACITY = 100;
const ORIGINAL_GRADE_ORDER = [
  "일반", "고급", "희귀", "영웅", "전설", "전설+", "신화", "신화+",
  "초월", "초월+", "태초", "태초+", "창세", "창조"
] as const;

export interface MiniPetInventoryViewCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
  environmentCode: "prod" | "dev";
}

export interface MiniPetInventoryItem {
  ownedMiniPetId: string;
  stableOwnedId: string;
  playerId: string;
  definitionId: string;
  definitionCode: string;
  name: string;
  emoji: string;
  grade: string;
  battleExp: string;
  equipped: boolean;
  sortIndex: number | null;
}

export interface MiniPetInventoryViewResult {
  status: "read" | "repaired" | "ignored_missing_member";
  playerId?: string;
  capacity?: number;
  items?: MiniPetInventoryItem[];
  repairReasons?: string[];
  outboxId?: string;
  auditId?: string;
  data?: string;
  replayed?: boolean;
}

interface OwnerRow {
  identity_id: bigint;
  player_id: bigint;
  current_display_name: string;
}

interface InventoryRow {
  owned_mini_pet_id: bigint;
  player_id: bigint;
  mini_pet_definition_id: bigint;
  definition_code: string;
  display_name: string;
  custom_name: string | null;
  grade_display_name: string | null;
  grade_code: string | null;
  emoji_value: string | null;
  battle_experience: bigint;
  equipped: number | boolean;
  state_player_id: bigint | null;
  stable_owned_id: string | null;
  yakitori_stable_owned_id: string | null;
  sort_index: number | null;
}

interface ReadSnapshot {
  owner: OwnerRow;
  shapeCode: string;
  rows: InventoryRow[];
  orderedRows: InventoryRow[];
  repairReasons: string[];
}

interface OperationRow {
  id: bigint;
  status: string;
  result_json: string | MiniPetInventoryViewResult | null;
  request_hash: string | null;
  stale_processing: number;
}

// 인자나 접미사 없는 미니펫 가방 조회 명령만 허용합니다.
export function isMiniPetInventoryViewCommand(message: string | undefined): boolean {
  return message === "/미니펫가방";
}

// event ID를 operations key 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB unique 충돌만 기존 operation 재조회 경로로 전환합니다.
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (("errno" in error && error.errno === 1062) || ("code" in error && error.code === "ER_DUP_ENTRY"));
}

// MariaDB JSON 결과를 완료 replay 응답으로 복원합니다.
function stored(value: string | MiniPetInventoryViewResult): MiniPetInventoryViewResult {
  return typeof value === "string" ? JSON.parse(value) as MiniPetInventoryViewResult : value;
}

// 원본 gradeTable 순서에서 찾지 못한 등급은 가장 낮은 우선순위로 둡니다.
function gradePriority(grade: string): number {
  return ORIGINAL_GRADE_ORDER.indexOf(grade as typeof ORIGINAL_GRADE_ORDER[number]);
}

// 원본 EXP, 등급, 이름 순서에 stable ID 최종 tie-break를 더합니다.
function compareInventoryRows(left: InventoryRow, right: InventoryRow): number {
  if (right.battle_experience !== left.battle_experience) {
    return right.battle_experience > left.battle_experience ? 1 : -1;
  }
  const gradeDifference = gradePriority(right.grade_display_name ?? right.grade_code ?? "")
    - gradePriority(left.grade_display_name ?? left.grade_code ?? "");
  if (gradeDifference !== 0) return gradeDifference;
  const nameDifference = (left.custom_name ?? left.display_name).localeCompare(
    right.custom_name ?? right.display_name, "ko"
  );
  if (nameDifference !== 0) return nameDifference;
  const leftStable = left.stable_owned_id ?? left.yakitori_stable_owned_id ?? `owned:${left.owned_mini_pet_id}`;
  const rightStable = right.stable_owned_id ?? right.yakitori_stable_owned_id ?? `owned:${right.owned_mini_pet_id}`;
  return leftStable.localeCompare(rightStable);
}

// 동일 event에서 명령 의미가 바뀌었는지 확인할 canonical request hash를 만듭니다.
function commandRequestHash(command: MiniPetInventoryViewCommand): string {
  return createHash("sha256").update(JSON.stringify([
    command.environmentCode, command.externalUserId, command.channelId, command.message
  ])).digest("hex");
}

// repair 시작 전 읽은 대상 상태가 transaction 진입 전 변경되지 않았는지 고정합니다.
function repairPlanHash(command: MiniPetInventoryViewCommand, snapshot: ReadSnapshot): string {
  return createHash("sha256").update(JSON.stringify([
    command.environmentCode,
    command.externalUserId,
    command.channelId,
    command.message,
    snapshot.shapeCode,
    snapshot.orderedRows.map((row, index) => [
      row.owned_mini_pet_id.toString(), row.player_id.toString(), row.mini_pet_definition_id.toString(),
      row.stable_owned_id, row.yakitori_stable_owned_id, row.sort_index, row.equipped ? null : index + 1
    ])
  ])).digest("hex");
}

// 정규화된 가방 항목을 API와 Iris 출력에 공통으로 사용할 projection으로 변환합니다.
function projectItems(rows: InventoryRow[]): MiniPetInventoryItem[] {
  return rows.map((row) => ({
    ownedMiniPetId: row.owned_mini_pet_id.toString(),
    stableOwnedId: row.stable_owned_id ?? row.yakitori_stable_owned_id ?? "",
    playerId: row.player_id.toString(),
    definitionId: row.mini_pet_definition_id.toString(),
    definitionCode: row.definition_code,
    name: row.custom_name ?? row.display_name,
    emoji: row.emoji_value ?? "",
    grade: row.grade_display_name ?? row.grade_code ?? "",
    battleExp: row.battle_experience.toString(),
    equipped: Boolean(row.equipped),
    sortIndex: Boolean(row.equipped) ? null : row.sort_index
  }));
}

// 원본 미니펫 가방 표시 순서를 유지하는 Iris 메시지를 만듭니다.
function formatMessage(ownerName: string, items: MiniPetInventoryItem[]): string {
  const equipped = items.filter((item) => item.equipped);
  const bag = items.filter((item) => !item.equipped);
  if (items.length === 0) return `[${ownerName}] 님은 미니펫을 보유하고 있지 않습니다.`;
  const lines = [`[${ownerName}]의 미니펫 가방[${items.length}/${INVENTORY_CAPACITY}소장]`];
  for (const item of equipped) {
    lines.push(`미니펫🐹: ${item.name}${item.emoji}(+${item.battleExp}💕)[${item.grade}]`);
  }
  lines.push("━━━━━━━━━━━━━━━");
  for (const item of bag) {
    lines.push(`${item.sortIndex}. ${item.name}${item.emoji}(+${item.battleExp}💕)[${item.grade}]`);
  }
  return lines.join("\n");
}

// WBS350 가방 read projection과 필요한 경우에만 별도 repair transaction을 수행합니다.
export class MiniPetInventoryViewNormalizeService {
  constructor(private readonly database: DatabaseClient) {}

  // 가방 projection을 읽기 전에 동일 event의 replay, mismatch, processing, stale 상태를 판정합니다.
  async resolveExistingOperation(
    command: MiniPetInventoryViewCommand
  ): Promise<MiniPetInventoryViewResult | null> {
    const hash = commandRequestHash(command);
    const key = eventKey(command.eventId);
    const priorRows = await this.database.query<OperationRow[]>(
      `SELECT operation.id, operation.status, operation.result_json, execution.request_hash,
        CASE WHEN operation.status = 'processing' AND operation.created_at < UTC_TIMESTAMP(3) - INTERVAL 5 MINUTE THEN 1 ELSE 0 END AS stale_processing
       FROM operations operation
       JOIN mini_pet_inventory_repair_executions execution ON execution.operation_id = operation.id
       JOIN external_identities identity ON identity.id = operation.actor_id AND operation.actor_type = 'external_identity'
       WHERE operation.idempotency_scope = CONCAT('mini-pet.inventory-view-normalize:', ?, ':', identity.id)
         AND operation.idempotency_key = ? AND execution.environment_code = ?
         AND identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
       LIMIT 1`,
      [command.environmentCode, key, command.environmentCode, command.externalUserId]
    );
    const prior = priorRows[0];
    if (prior === undefined) return null;
    if (prior.request_hash !== hash) {
      throw new ApplicationError("MINI_PET_INVENTORY_REPLAY_MISMATCH", "동일 event의 요청 내용이 다릅니다.", 409);
    }
    if (prior.result_json !== null && prior.result_json !== undefined) {
      return { ...stored(prior.result_json), replayed: true };
    }
    if (prior.stale_processing !== 1) {
      throw new ApplicationError("MINI_PET_INVENTORY_REPLAY_NOT_READY", "이전 가방 보정 요청이 처리 중입니다.", 409);
    }
    const residual = await this.database.query<Array<{ repair_count: bigint }>>(
      "SELECT COUNT(*) AS repair_count FROM mini_pet_inventory_repair_entries WHERE operation_id = ?",
      [prior.id]
    );
    if ((residual[0]?.repair_count ?? 0n) !== 0n) {
      throw new ApplicationError("MINI_PET_INVENTORY_STALE_PARTIAL_STATE", "부분 보정 흔적이 있어 자동 재시작하지 않았습니다.", 409);
    }
    return null;
  }

  async handle(command: MiniPetInventoryViewCommand): Promise<MiniPetInventoryViewResult> {
    if (!isMiniPetInventoryViewCommand(command.message)) {
      throw new ApplicationError("INVALID_MINI_PET_INVENTORY_VIEW_COMMAND", "정확한 /미니펫가방을 입력해주세요.", 422);
    }
    const replay = await this.resolveExistingOperation(command);
    if (replay !== null) return replay;
    const hash = commandRequestHash(command);
    const snapshot = await this.readSnapshot(this.database, command, false);
    if (snapshot === null) return { status: "ignored_missing_member" };
    if (snapshot.repairReasons.length === 0) {
      const items = projectItems(snapshot.orderedRows);
      return {
        status: "read",
        playerId: snapshot.owner.player_id.toString(),
        capacity: INVENTORY_CAPACITY,
        items,
        repairReasons: [],
        data: formatMessage(snapshot.owner.current_display_name, items)
      };
    }
    const planHash = repairPlanHash(command, snapshot);
    try {
      return await this.repair(command, hash, planHash, false);
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      return this.repair(command, hash, planHash, true);
    }
  }

  private async readSnapshot(
    queryable: Pick<DatabaseClient, "query"> | DatabaseTransaction,
    command: MiniPetInventoryViewCommand,
    lock: boolean
  ): Promise<ReadSnapshot | null> {
    const suffix = lock ? " FOR UPDATE" : "";
    const environment = await queryable.query<Array<{ environment_code: string }>>(
      `SELECT environment_code FROM mini_pet_projection_environment_identity WHERE singleton_id = 1${suffix}`
    );
    if (environment[0]?.environment_code !== command.environmentCode) {
      throw new ApplicationError("MINI_PET_INVENTORY_ENVIRONMENT_MISMATCH", "요청 환경과 DB 환경이 일치하지 않습니다.", 409);
    }
    const owners = await queryable.query<OwnerRow[]>(
      `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name
       FROM external_identities identity JOIN player_profiles profile ON profile.player_id = identity.player_id
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
         AND identity.player_id IS NOT NULL${suffix}`,
      [command.externalUserId]
    );
    const owner = owners[0];
    if (owner === undefined) return null;
    const shapeRows = await queryable.query<Array<{ bag_shape_code: string }>>(
      `SELECT bag_shape_code FROM mini_pet_inventory_player_states WHERE player_id = ?${suffix}`,
      [owner.player_id]
    );
    const rows = await queryable.query<InventoryRow[]>(
      `SELECT owned.id AS owned_mini_pet_id, owned.player_id, owned.mini_pet_definition_id,
        definition.code AS definition_code, definition.display_name, owned.custom_name,
        definition.grade_display_name, definition.grade_code, definition.emoji_value,
        owned.battle_experience, owned.equipped, state.player_id AS state_player_id,
        state.stable_owned_id, reward.stable_owned_id AS yakitori_stable_owned_id, state.sort_index
       FROM owned_mini_pets owned
       JOIN mini_pet_definitions definition ON definition.id = owned.mini_pet_definition_id
       LEFT JOIN mini_pet_inventory_owned_states state ON state.owned_mini_pet_id = owned.id
       LEFT JOIN yakitori_package_owned_rewards reward ON reward.owned_mini_pet_id = owned.id
       LEFT JOIN mini_pet_owned_lifecycle lifecycle ON lifecycle.owned_mini_pet_id = owned.id
       WHERE owned.player_id = ? AND COALESCE(lifecycle.state_code, 'active') = 'active'
       ORDER BY owned.id${suffix}`,
      [owner.player_id]
    );
    if (rows.length > INVENTORY_CAPACITY) {
      throw new ApplicationError("MINI_PET_INVENTORY_CAPACITY_EXCEEDED", "미니펫 가방이 100마리를 초과해 자동 보정하지 않았습니다.", 409);
    }
    if (rows.filter((row) => Boolean(row.equipped)).length > 1) {
      throw new ApplicationError("MINI_PET_INVENTORY_MULTIPLE_EQUIPPED", "장착 미니펫이 여러 마리라 자동 보정하지 않았습니다.", 409);
    }
    const shapeCode = shapeRows[0]?.bag_shape_code ?? "missing";
    const bagRows = rows.filter((row) => !Boolean(row.equipped)).sort(compareInventoryRows);
    const equippedRows = rows.filter((row) => Boolean(row.equipped));
    const repairReasons = new Set<string>();
    if (shapeCode !== "array") repairReasons.add("bag_shape");
    for (let index = 0; index < bagRows.length; index += 1) {
      const row = bagRows[index]!;
      if (row.stable_owned_id === null) repairReasons.add("stable_owned_id");
      if (row.state_player_id !== null && row.state_player_id !== owner.player_id) repairReasons.add("player_binding");
      if (row.sort_index !== index + 1) repairReasons.add("sort_index");
    }
    for (const row of equippedRows) {
      if (row.stable_owned_id === null) repairReasons.add("stable_owned_id");
      if (row.state_player_id !== null && row.state_player_id !== owner.player_id) repairReasons.add("player_binding");
      if (row.sort_index !== null) repairReasons.add("equipped_sort_index");
    }
    return { owner, shapeCode, rows, orderedRows: [...equippedRows, ...bagRows], repairReasons: [...repairReasons] };
  }

  private async repair(
    command: MiniPetInventoryViewCommand,
    expectedHash: string,
    expectedPlanHash: string,
    collisionReplay: boolean
  ): Promise<MiniPetInventoryViewResult> {
    return this.database.withTransaction(async (tx) => {
      const snapshot = await this.readSnapshot(tx, command, true);
      if (snapshot === null) return { status: "ignored_missing_member" };
      const scope = `mini-pet.inventory-view-normalize:${command.environmentCode}:${snapshot.owner.identity_id}`;
      const key = eventKey(command.eventId);
      const prior = await tx.query<OperationRow[]>(
        `SELECT operation.id, operation.status, operation.result_json, execution.request_hash,
          CASE WHEN operation.status = 'processing' AND operation.created_at < UTC_TIMESTAMP(3) - INTERVAL 5 MINUTE THEN 1 ELSE 0 END AS stale_processing
         FROM operations operation
         LEFT JOIN mini_pet_inventory_repair_executions execution ON execution.operation_id = operation.id
         WHERE operation.idempotency_scope = ? AND operation.idempotency_key = ? FOR UPDATE`,
        [scope, key]
      );
      const replay = prior[0];
      if (replay?.result_json !== null && replay?.result_json !== undefined) {
        if (replay.request_hash !== expectedHash) {
          throw new ApplicationError("MINI_PET_INVENTORY_REPLAY_MISMATCH", "동일 event의 요청 내용이 다릅니다.", 409);
        }
        return { ...stored(replay.result_json), replayed: true };
      }
      if (replay !== undefined && replay.request_hash !== expectedHash) {
        throw new ApplicationError("MINI_PET_INVENTORY_REPLAY_MISMATCH", "동일 event의 요청 내용이 다릅니다.", 409);
      }
      if (replay !== undefined && replay.stale_processing !== 1) {
        throw new ApplicationError("MINI_PET_INVENTORY_REPLAY_NOT_READY", "이전 가방 보정 요청이 처리 중입니다.", 409);
      }
      if (collisionReplay && replay === undefined) {
        throw new ApplicationError("MINI_PET_INVENTORY_REPLAY_EXECUTION_MISSING", "unique 충돌 후 기존 요청을 찾을 수 없습니다.", 409);
      }
      if (repairPlanHash(command, snapshot) !== expectedPlanHash) {
        throw new ApplicationError("MINI_PET_INVENTORY_REPAIR_DRIFT", "미니펫 가방이 먼저 변경되어 다시 조회해야 합니다.", 409);
      }
      const operationId = replay?.id ?? await this.createOperation(
        tx, scope, key, snapshot.owner.identity_id, command.environmentCode, expectedHash
      );
      if (replay !== undefined) {
        const residual = await tx.query<Array<{ repair_count: bigint }>>(
          "SELECT COUNT(*) AS repair_count FROM mini_pet_inventory_repair_entries WHERE operation_id = ? FOR UPDATE",
          [operationId]
        );
        if ((residual[0]?.repair_count ?? 0n) !== 0n) {
          throw new ApplicationError("MINI_PET_INVENTORY_STALE_PARTIAL_STATE", "부분 보정 흔적이 있어 자동 재시작하지 않았습니다.", 409);
        }
        await tx.execute(
          "UPDATE operations SET status = 'processing', result_json = NULL, created_at = UTC_TIMESTAMP(3), completed_at = NULL WHERE id = ?",
          [operationId]
        );
        await tx.execute(
          "UPDATE mini_pet_inventory_repair_executions SET status = 'processing', repair_diff_json = NULL, started_at = UTC_TIMESTAMP(3), completed_at = NULL WHERE operation_id = ?",
          [operationId]
        );
      }

      await tx.execute(
        `INSERT INTO mini_pet_inventory_player_states (player_id, bag_shape_code, capacity_limit, version)
         VALUES (?, 'array', 100, 1)
         ON DUPLICATE KEY UPDATE bag_shape_code = 'array', capacity_limit = 100, version = version + 1`,
        [snapshot.owner.player_id]
      );
      await tx.execute(
        `UPDATE mini_pet_inventory_owned_states
            SET sort_index = NULL, version = version + 1
          WHERE player_id = ? AND sort_index IS NOT NULL`,
        [snapshot.owner.player_id]
      );
      const normalizedRows: InventoryRow[] = [];
      const diffs: Array<Record<string, unknown>> = [];
      for (let index = 0; index < snapshot.orderedRows.length; index += 1) {
        const row = snapshot.orderedRows[index]!;
        const desiredSortIndex = Boolean(row.equipped) ? null : snapshot.orderedRows
          .slice(0, index + 1).filter((candidate) => !Boolean(candidate.equipped)).length;
        const stableOwnedId = row.stable_owned_id ?? row.yakitori_stable_owned_id ?? randomUUID();
        const stableCreated = row.stable_owned_id === null;
        const changed = stableCreated || row.state_player_id !== snapshot.owner.player_id
          || row.sort_index !== desiredSortIndex;
        await tx.execute(
          `INSERT INTO mini_pet_inventory_owned_states
            (owned_mini_pet_id, player_id, stable_owned_id, sort_index, version)
           VALUES (?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE player_id = VALUES(player_id), sort_index = VALUES(sort_index), version = version + 1`,
          [row.owned_mini_pet_id, snapshot.owner.player_id, stableOwnedId, desiredSortIndex]
        );
        if (changed) {
          await tx.execute(
            `INSERT INTO mini_pet_inventory_repair_entries
              (operation_id, owned_mini_pet_id, stable_owned_id, before_sort_index, after_sort_index, stable_id_created)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [operationId, row.owned_mini_pet_id, stableOwnedId, row.sort_index, desiredSortIndex, stableCreated]
          );
          diffs.push({
            ownedMiniPetId: row.owned_mini_pet_id.toString(),
            stableOwnedId,
            beforeSortIndex: row.sort_index,
            afterSortIndex: desiredSortIndex,
            stableIdCreated: stableCreated
          });
        }
        normalizedRows.push({
          ...row,
          state_player_id: snapshot.owner.player_id,
          stable_owned_id: stableOwnedId,
          sort_index: desiredSortIndex
        });
      }
      const items = projectItems(normalizedRows);
      const data = formatMessage(snapshot.owner.current_display_name, items);
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [operationId, command.channelId, JSON.stringify({ data })]
      );
      await tx.execute(
        "INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, 'mini_pet_inventory_view_normalize', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [command.eventId, operationId]
      );
      const audit = await tx.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
         VALUES (?, 'external_identity', ?, 'player', ?, 'mini_pet.inventory_view_normalize', 'success', 'Iris /미니펫가방 조건부 보정', ?, UTC_TIMESTAMP(3))`,
        [operationId, snapshot.owner.identity_id, snapshot.owner.player_id, JSON.stringify({
          environmentCode: command.environmentCode,
          capacity: INVENTORY_CAPACITY,
          repairReasons: snapshot.repairReasons,
          duplicateDefinitionsPreserved: true,
          diffs
        })]
      );
      const result: MiniPetInventoryViewResult = {
        status: "repaired",
        playerId: snapshot.owner.player_id.toString(),
        capacity: INVENTORY_CAPACITY,
        items,
        repairReasons: snapshot.repairReasons,
        outboxId: outbox.insertId.toString(),
        auditId: audit.insertId.toString(),
        data
      };
      await tx.execute(
        "UPDATE mini_pet_inventory_repair_executions SET status = 'completed', repair_diff_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE operation_id = ?",
        [JSON.stringify(diffs), operationId]
      );
      await tx.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(result), operationId]
      );
      return result;
    });
  }

  private async createOperation(
    tx: DatabaseTransaction,
    scope: string,
    key: string,
    identityId: bigint,
    environmentCode: "prod" | "dev",
    hash: string
  ): Promise<bigint> {
    const operation = await tx.execute(
      "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))",
      [randomUUID(), scope, key, identityId]
    );
    await tx.execute(
      "INSERT INTO mini_pet_inventory_repair_executions (operation_id, request_hash, environment_code) VALUES (?, ?, ?)",
      [operation.insertId, hash, environmentCode]
    );
    return operation.insertId;
  }
}
