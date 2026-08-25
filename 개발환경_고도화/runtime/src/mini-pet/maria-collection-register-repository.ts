import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import type {
  MiniPetCollectionRegisterInput,
  MiniPetCollectionRegisterRepository,
  MiniPetCollectionRegisterResult
} from "./collection-register-service.js";

interface ActorRow { identity_id: bigint; player_id: bigint; }
interface OperationRow { result_json: string | MiniPetCollectionRegisterResult | null; }
interface SelectedPetRow {
  sort_index: number;
  stable_owned_id: string;
  inventory_version: bigint;
  owned_mini_pet_id: bigint;
  mini_pet_definition_id: bigint;
  display_name: string;
  grade_code: string;
  progress: bigint;
}
interface SelectionSnapshot {
  bagNumber: number;
  stableOwnedId: string;
  inventoryVersion: string;
  ownedMiniPetId: string;
  definitionId: string;
  displayName: string;
  gradeCode: string;
  progress: string;
}
interface ConfirmationRow {
  id: bigint;
  status: string;
  selection_json: string | SelectionSnapshot[];
  expires_at: Date | string;
  version: bigint;
}
interface GradeRuleRow {
  grade_code: string;
  minimum_progress: bigint;
  point_cost_per_missing_progress: bigint;
  reward_item_code: string;
  reward_quantity: bigint;
}
interface StageRuleRow {
  stage_no: number;
  reward_item_code: string;
  reward_quantity: bigint;
  title_id: bigint;
  title_code: string;
}

// 긴 provider event ID를 operation unique key 길이로 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// 원문 확인번호를 DB에 남기지 않는 SHA-256 digest로 바꿉니다.
function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// MariaDB JSON 값을 타입이 보존된 객체로 복원합니다.
function parseJson<T>(value: string | T): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

// operation unique 충돌만 완료 결과 재조회 경로로 전환합니다.
function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "ER_DUP_ENTRY";
}

// 보상 항목을 item code별 합계로 정규화합니다.
function addReward(rewards: Map<string, bigint>, itemCode: string, quantity: bigint): void {
  rewards.set(itemCode, (rewards.get(itemCode) ?? 0n) + quantity);
}

// 미니펫 컬렉션 preview·확인·취소를 재시작 가능한 MariaDB transaction으로 처리합니다.
export class MariaMiniPetCollectionRegisterRepository implements MiniPetCollectionRegisterRepository {
  constructor(private readonly database: DatabaseClient) {}

  async preview(input: MiniPetCollectionRegisterInput, bagNumbers: number[]): Promise<MiniPetCollectionRegisterResult> {
    return this.run(input, "preview", (tx, operationId, actor) => this.previewTransaction(tx, operationId, actor, input, bagNumbers));
  }

  async confirm(input: MiniPetCollectionRegisterInput, confirmationToken: string): Promise<MiniPetCollectionRegisterResult> {
    return this.run(input, "confirm", (tx, operationId, actor) => this.confirmTransaction(tx, operationId, actor, input, confirmationToken));
  }

  async cancel(input: MiniPetCollectionRegisterInput, confirmationToken: string): Promise<MiniPetCollectionRegisterResult> {
    return this.run(input, "cancel", (tx, operationId, actor) => this.cancelTransaction(tx, operationId, actor, input, confirmationToken));
  }

  private async run(
    input: MiniPetCollectionRegisterInput,
    action: "preview" | "confirm" | "cancel",
    work: (tx: DatabaseTransaction, operationId: bigint, actor: ActorRow) => Promise<MiniPetCollectionRegisterResult>
  ): Promise<MiniPetCollectionRegisterResult> {
    const execute = async (collisionReplay: boolean) => this.database.withTransaction(async (tx) => {
      const actor = await this.readActor(tx, input.externalUserId);
      if (actor === undefined) return { status: "ignored" as const };
      const scope = `minipet.collection_register:${action}:${actor.identity_id}`;
      const key = eventKey(input.eventId);
      const prior = await tx.query<OperationRow[]>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, key]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
        return parseJson<MiniPetCollectionRegisterResult>(prior[0].result_json);
      }
      if (collisionReplay) {
        throw new ApplicationError("MINIPET_COLLECTION_REPLAY_INCOMPLETE", "이전 컬렉션 등록 요청이 아직 처리 중입니다.", 409);
      }
      const operation = await tx.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, key, actor.identity_id]
      );
      return work(tx, operation.insertId, actor);
    });
    try {
      return await execute(false);
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      return execute(true);
    }
  }

  // 연결된 활성 플레이어를 잠그고 명령 actor를 확정합니다.
  private async readActor(tx: DatabaseTransaction, externalUserId: string): Promise<ActorRow | undefined> {
    const rows = await tx.query<ActorRow[]>(
      `SELECT identity.id AS identity_id, identity.player_id
       FROM external_identities identity JOIN players player ON player.id = identity.player_id
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
         AND identity.status = 'linked' AND player.status = 'active' FOR UPDATE`,
      [externalUserId]
    );
    return rows[0];
  }

  // 선택된 가방번호를 stable identity snapshot으로 고정하고 10분 확인번호를 발급합니다.
  private async previewTransaction(
    tx: DatabaseTransaction,
    operationId: bigint,
    actor: ActorRow,
    input: MiniPetCollectionRegisterInput,
    bagNumbers: number[]
  ): Promise<MiniPetCollectionRegisterResult> {
    const placeholders = bagNumbers.map(() => "?").join(", ");
    const selected = await tx.query<SelectedPetRow[]>(
      `SELECT state.sort_index, state.stable_owned_id, state.version AS inventory_version,
              owned.id AS owned_mini_pet_id, owned.mini_pet_definition_id, definition.display_name,
              definition.grade_code, owned.progress
       FROM mini_pet_inventory_owned_states state
       JOIN owned_mini_pets owned ON owned.id = state.owned_mini_pet_id AND owned.player_id = state.player_id
       JOIN mini_pet_definitions definition ON definition.id = owned.mini_pet_definition_id AND definition.active = TRUE
       WHERE state.player_id = ? AND state.sort_index IN (${placeholders})
       ORDER BY state.sort_index FOR UPDATE`,
      [actor.player_id, ...bagNumbers]
    );
    if (selected.length !== bagNumbers.length) {
      throw new ApplicationError("MINIPET_COLLECTION_SELECTION_MISSING", "선택한 가방번호의 미니펫을 다시 확인해주세요.", 404);
    }
    const byBag = new Map(selected.map((row) => [Number(row.sort_index), row]));
    const snapshot = bagNumbers.map((bagNumber) => {
      const row = byBag.get(bagNumber)!;
      if (row.grade_code === null || row.grade_code === "") {
        throw new ApplicationError("MINIPET_COLLECTION_GRADE_MISSING", `${row.display_name}의 등급 KEY가 없습니다.`, 409);
      }
      return {
        bagNumber,
        stableOwnedId: row.stable_owned_id,
        inventoryVersion: row.inventory_version.toString(),
        ownedMiniPetId: row.owned_mini_pet_id.toString(),
        definitionId: row.mini_pet_definition_id.toString(),
        displayName: row.display_name,
        gradeCode: row.grade_code,
        progress: row.progress.toString()
      } satisfies SelectionSnapshot;
    });
    const confirmationToken = randomUUID();
    const expiresAtDate = new Date(Date.now() + 10 * 60_000);
    const expiresAt = expiresAtDate.toISOString();
    await tx.execute(
      `UPDATE mini_pet_collection_confirmations
       SET status = 'replaced', version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE player_id = ? AND status = 'pending'`,
      [actor.player_id]
    );
    await tx.execute(
      `INSERT INTO mini_pet_collection_confirmations
        (token_hash, player_id, selection_json, selection_hash, status, version, expires_at, preview_operation_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 1, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [tokenHash(confirmationToken), actor.player_id, JSON.stringify(snapshot),
        createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"), expiresAtDate, operationId]
    );
    const data = [
      "미니펫 컬렉션 등록 예정",
      ...snapshot.map((row) => `${row.bagNumber}. ${row.displayName} [${row.gradeCode}]`),
      "",
      `10분 안에 /컬렉션등록 확인 ${confirmationToken}`,
      `취소하려면 /컬렉션등록 취소 ${confirmationToken}`
    ].join("\n");
    return this.complete(tx, operationId, actor, input, "mini_pet_collection_register_preview", data, {
      status: "previewed", confirmationToken, expiresAt,
      selectedStableOwnedIds: snapshot.map((row) => row.stableOwnedId)
    }, { selectionCount: snapshot.length, selectionHash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex") });
  }

  // 확인 토큰 snapshot을 재검증하고 모든 컬렉션 효과를 한 transaction으로 반영합니다.
  private async confirmTransaction(
    tx: DatabaseTransaction,
    operationId: bigint,
    actor: ActorRow,
    input: MiniPetCollectionRegisterInput,
    confirmationToken: string
  ): Promise<MiniPetCollectionRegisterResult> {
    const confirmations = await tx.query<ConfirmationRow[]>(
      `SELECT id, status, selection_json, expires_at, version
       FROM mini_pet_collection_confirmations WHERE token_hash = ? AND player_id = ? FOR UPDATE`,
      [tokenHash(confirmationToken), actor.player_id]
    );
    const confirmation = confirmations[0];
    if (confirmation === undefined) throw new ApplicationError("MINIPET_COLLECTION_TOKEN_NOT_FOUND", "컬렉션 확인번호를 찾을 수 없습니다.", 404);
    if (confirmation.status !== "pending") throw new ApplicationError("MINIPET_COLLECTION_TOKEN_USED", "이미 처리되었거나 취소된 컬렉션 확인번호입니다.", 409);
    if (new Date(confirmation.expires_at).getTime() <= Date.now()) {
      throw new ApplicationError("MINIPET_COLLECTION_TOKEN_EXPIRED", "컬렉션 확인번호가 만료되었습니다. 다시 선택해주세요.", 410);
    }
    const snapshot = parseJson<SelectionSnapshot[]>(confirmation.selection_json);
    const stableIds = snapshot.map((row) => row.stableOwnedId);
    const placeholders = stableIds.map(() => "?").join(", ");
    const current = await tx.query<SelectedPetRow[]>(
      `SELECT state.sort_index, state.stable_owned_id, state.version AS inventory_version,
              owned.id AS owned_mini_pet_id, owned.mini_pet_definition_id, definition.display_name,
              definition.grade_code, owned.progress
       FROM mini_pet_inventory_owned_states state
       JOIN owned_mini_pets owned ON owned.id = state.owned_mini_pet_id AND owned.player_id = state.player_id
       JOIN mini_pet_definitions definition ON definition.id = owned.mini_pet_definition_id AND definition.active = TRUE
       WHERE state.player_id = ? AND state.stable_owned_id IN (${placeholders}) FOR UPDATE`,
      [actor.player_id, ...stableIds]
    );
    const currentByStable = new Map(current.map((row) => [row.stable_owned_id, row]));
    for (const selected of snapshot) {
      const row = currentByStable.get(selected.stableOwnedId);
      if (row === undefined || row.inventory_version.toString() !== selected.inventoryVersion
        || row.owned_mini_pet_id.toString() !== selected.ownedMiniPetId
        || row.mini_pet_definition_id.toString() !== selected.definitionId) {
        throw new ApplicationError("MINIPET_COLLECTION_SELECTION_CHANGED", "선택 후 가방이 변경되었습니다. 다시 선택해주세요.", 409);
      }
    }
    const grades = [...new Set(snapshot.map((row) => row.gradeCode))];
    const gradeRules = await tx.query<GradeRuleRow[]>(
      `SELECT grade_code, minimum_progress, point_cost_per_missing_progress, reward_item_code, reward_quantity
       FROM mini_pet_collection_grade_rules WHERE grade_code IN (${grades.map(() => "?").join(", ")}) AND active = TRUE FOR UPDATE`,
      grades
    );
    const ruleByGrade = new Map(gradeRules.map((row) => [row.grade_code, row]));
    if (gradeRules.length !== grades.length) throw new ApplicationError("MINIPET_COLLECTION_GRADE_RULE_MISSING", "미니펫 등급 보상 설정이 완전하지 않습니다.", 409);

    await tx.execute(
      `INSERT INTO mini_pet_collection_states (player_id, current_stage, completed_stage, version, updated_at)
       VALUES (?, 1, 0, 1, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE player_id = VALUES(player_id)`,
      [actor.player_id]
    );
    const states = await tx.query<Array<{ current_stage: number; completed_stage: number; version: bigint }>>(
      "SELECT current_stage, completed_stage, version FROM mini_pet_collection_states WHERE player_id = ? FOR UPDATE",
      [actor.player_id]
    );
    const state = states[0]!;
    const completedStage = Math.min(100, Math.max(Number(state.completed_stage) + 1, Number(state.current_stage)));
    const stageAfter = Math.min(100, completedStage + 1);
    const stageRules = await tx.query<StageRuleRow[]>(
      `SELECT rule.stage_no, rule.reward_item_code, rule.reward_quantity, rule.title_id, title.code AS title_code
       FROM mini_pet_collection_stage_rules rule JOIN title_definitions title ON title.id = rule.title_id
       WHERE rule.stage_no = ? AND rule.active = TRUE AND title.active = TRUE FOR UPDATE`,
      [completedStage]
    );
    const stageRule = stageRules[0];
    if (stageRule === undefined) throw new ApplicationError("MINIPET_COLLECTION_STAGE_RULE_MISSING", "컬렉션 단계 보상 설정을 찾을 수 없습니다.", 409);

    let pointCost = 0n;
    const rewards = new Map<string, bigint>();
    for (const selected of snapshot) {
      const rule = ruleByGrade.get(selected.gradeCode)!;
      const missing = rule.minimum_progress > BigInt(selected.progress)
        ? rule.minimum_progress - BigInt(selected.progress) : 0n;
      pointCost += missing * rule.point_cost_per_missing_progress;
      addReward(rewards, rule.reward_item_code, rule.reward_quantity);
    }
    addReward(rewards, stageRule.reward_item_code, stageRule.reward_quantity);

    if (pointCost > 0n) {
      const accounts = await tx.query<Array<{ balance: string }>>(
        "SELECT balance FROM currency_accounts WHERE player_id = ? AND currency_code = 'point' FOR UPDATE",
        [actor.player_id]
      );
      const balance = BigInt(String(accounts[0]?.balance ?? "0").split(".")[0] ?? "0");
      if (balance < pointCost) throw new ApplicationError("MINIPET_COLLECTION_POINT_SHORTAGE", `자동 강화에 필요한 포인트가 ${pointCost - balance} 부족합니다.`, 409);
      await tx.execute(
        "UPDATE currency_accounts SET balance = balance - ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE player_id = ? AND currency_code = 'point'",
        [pointCost.toString(), actor.player_id]
      );
      await tx.execute(
        `INSERT INTO currency_ledger
          (operation_id, sequence_no, player_id, currency_code, delta, balance_after, reason_code, created_at)
         VALUES (?, 1, ?, 'point', ?, ?, 'mini_pet_collection_auto_enhance', UTC_TIMESTAMP(3))`,
        [operationId, actor.player_id, (-pointCost).toString(), (balance - pointCost).toString()]
      );
    }

    let inventorySequence = 1;
    for (const [itemCode, quantity] of rewards) {
      const items = await tx.query<Array<{ id: bigint }>>(
        "SELECT id FROM item_definitions WHERE code = ? AND active = TRUE AND stackable = TRUE FOR UPDATE",
        [itemCode]
      );
      const item = items[0];
      if (item === undefined) throw new ApplicationError("MINIPET_COLLECTION_REWARD_ITEM_MISSING", `${itemCode} 보상 아이템 KEY를 찾을 수 없습니다.`, 409);
      await tx.execute(
        `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), version = version + 1`,
        [actor.player_id, item.id, quantity]
      );
      await tx.execute(
        `INSERT INTO inventory_ledger
          (operation_id, sequence_no, player_id, item_id, instance_id, quantity_delta, reason_code, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, 'mini_pet_collection_reward', UTC_TIMESTAMP(3))`,
        [operationId, inventorySequence++, actor.player_id, item.id, quantity]
      );
    }

    for (const selected of snapshot) {
      await tx.execute(
        `INSERT INTO mini_pet_collection_entries
          (player_id, mini_pet_definition_id, discovered_count, first_discovered_at, updated_at)
         VALUES (?, ?, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE discovered_count = discovered_count + 1, updated_at = UTC_TIMESTAMP(3)`,
        [actor.player_id, selected.definitionId]
      );
      await tx.execute(
        `INSERT INTO mini_pet_collection_projections
          (player_id, mini_pet_definition_id, registered, stage, completed_stage, projection_version)
         VALUES (?, ?, TRUE, ?, ?, 1)
         ON DUPLICATE KEY UPDATE registered = TRUE, stage = VALUES(stage), completed_stage = VALUES(completed_stage),
           projection_version = projection_version + 1`,
        [actor.player_id, selected.definitionId, stageAfter, completedStage]
      );
    }
    await tx.execute(
      `INSERT INTO player_titles (player_id, title_id, acquired_at, equipped)
       VALUES (?, ?, UTC_TIMESTAMP(3), FALSE)
       ON DUPLICATE KEY UPDATE acquired_at = COALESCE(acquired_at, VALUES(acquired_at))`,
      [actor.player_id, stageRule.title_id]
    );
    await tx.execute(
      "UPDATE mini_pet_collection_states SET current_stage = ?, completed_stage = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE player_id = ?",
      [stageAfter, completedStage, actor.player_id]
    );
    const ownedIds = snapshot.map((row) => row.ownedMiniPetId);
    await tx.execute(`DELETE FROM mini_pet_title_assignments WHERE owned_mini_pet_id IN (${ownedIds.map(() => "?").join(", ")})`, ownedIds);
    await tx.execute(`DELETE FROM mini_pet_inventory_owned_states WHERE player_id = ? AND stable_owned_id IN (${placeholders})`, [actor.player_id, ...stableIds]);
    const deleted = await tx.execute(`DELETE FROM owned_mini_pets WHERE player_id = ? AND id IN (${ownedIds.map(() => "?").join(", ")})`, [actor.player_id, ...ownedIds]);
    if (deleted.affectedRows !== BigInt(snapshot.length)) throw new ApplicationError("MINIPET_COLLECTION_DELETE_MISMATCH", "선택한 미니펫 제거 수가 일치하지 않습니다.", 409);

    const rewardResult = [...rewards].map(([itemCode, quantity]) => ({ itemCode, quantity: quantity.toString() }));
    const data = `미니펫 컬렉션 ${completedStage}단계 등록 완료\n자동 강화 포인트: ${pointCost}\n보상: ${rewardResult.map((row) => `${row.itemCode} ${row.quantity}개`).join(", ")}\n칭호: ${stageRule.title_code}`;
    const result = await this.complete(tx, operationId, actor, input, "mini_pet_collection_register_confirm", data, {
      status: "registered", selectedStableOwnedIds: stableIds,
      stageBefore: Number(state.current_stage), stageAfter, completedStage,
      pointCost: pointCost.toString(), rewards: rewardResult, titleCode: stageRule.title_code
    }, { confirmationId: confirmation.id.toString(), selectionCount: snapshot.length, pointCost: pointCost.toString(), rewards: rewardResult, titleCode: stageRule.title_code });
    await tx.execute(
      `INSERT INTO mini_pet_collection_registration_ledger
        (operation_id, confirmation_id, player_id, selection_count, stage_before, stage_after, completed_stage, point_cost, rewards_json, title_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [operationId, confirmation.id, actor.player_id, snapshot.length, state.current_stage, stageAfter, completedStage,
        pointCost, JSON.stringify(rewardResult), stageRule.title_id]
    );
    await tx.execute(
      `UPDATE mini_pet_collection_confirmations
       SET status = 'consumed', consume_operation_id = ?, result_json = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND status = 'pending' AND version = ?`,
      [operationId, JSON.stringify(result), confirmation.id, confirmation.version]
    );
    return result;
  }

  // pending 확인번호만 원자 취소하고 재사용을 막습니다.
  private async cancelTransaction(
    tx: DatabaseTransaction,
    operationId: bigint,
    actor: ActorRow,
    input: MiniPetCollectionRegisterInput,
    confirmationToken: string
  ): Promise<MiniPetCollectionRegisterResult> {
    const confirmations = await tx.query<ConfirmationRow[]>(
      "SELECT id, status, selection_json, expires_at, version FROM mini_pet_collection_confirmations WHERE token_hash = ? AND player_id = ? FOR UPDATE",
      [tokenHash(confirmationToken), actor.player_id]
    );
    const confirmation = confirmations[0];
    if (confirmation === undefined) throw new ApplicationError("MINIPET_COLLECTION_TOKEN_NOT_FOUND", "컬렉션 확인번호를 찾을 수 없습니다.", 404);
    if (confirmation.status !== "pending") throw new ApplicationError("MINIPET_COLLECTION_TOKEN_USED", "이미 처리되었거나 취소된 컬렉션 확인번호입니다.", 409);
    await tx.execute(
      "UPDATE mini_pet_collection_confirmations SET status = 'cancelled', cancel_operation_id = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND version = ?",
      [operationId, confirmation.id, confirmation.version]
    );
    return this.complete(tx, operationId, actor, input, "mini_pet_collection_register_cancel", "미니펫 컬렉션 등록을 취소했습니다.", {
      status: "cancelled"
    }, { confirmationId: confirmation.id.toString() });
  }

  // 응답, 실행, 감사, operation 결과를 동일 transaction에 저장합니다.
  private async complete(
    tx: DatabaseTransaction,
    operationId: bigint,
    actor: ActorRow,
    input: MiniPetCollectionRegisterInput,
    commandCode: string,
    data: string,
    result: Omit<MiniPetCollectionRegisterResult, "data" | "outboxId" | "auditId">,
    changeSummary: Record<string, unknown>
  ): Promise<MiniPetCollectionRegisterResult> {
    const outbox = await tx.execute(
      `INSERT INTO outbox_messages
        (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
       VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [operationId, input.channelId, JSON.stringify({ data })]
    );
    await tx.execute(
      `INSERT INTO command_executions
        (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
       VALUES (?, ?, ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [input.eventId, commandCode, operationId]
    );
    const audit = await tx.execute(
      `INSERT INTO command_audit
        (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
       VALUES (?, 'external_identity', ?, 'mini_pet_collection', ?, ?, 'success', 'Iris /컬렉션등록', ?, UTC_TIMESTAMP(3))`,
      [operationId, actor.identity_id, actor.player_id, commandCode.replaceAll("_", "."), JSON.stringify(changeSummary)]
    );
    const completed: MiniPetCollectionRegisterResult = {
      ...result, data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString()
    };
    await tx.execute(
      "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
      [JSON.stringify(completed), operationId]
    );
    return completed;
  }
}
