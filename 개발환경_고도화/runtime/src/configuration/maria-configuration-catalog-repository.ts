import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import {
  configurationContentHash,
  type ConfigurationCatalogRepository,
  type ConfigurationKeyDefinition,
  type ConfigurationMutationResult,
  type ConfigurationSetDefinition,
  type ConfigurationSetStatus,
  type ConfigurationSnapshot,
  type CreateConfigurationDraftInput,
  type DiscardConfigurationDraftInput,
  type NormalizedConfigurationValue,
  type PublishConfigurationDraftInput,
  type RetireConfigurationInput,
  type RollbackConfigurationInput,
  validateConfigurationSnapshot,
} from "./configuration-catalog.js";

type Numeric = bigint | number | string;

interface SetRow {
  id: Numeric;
  set_code: string;
  version: Numeric;
  status: string;
}

interface ValueRow {
  config_key: string;
  value_type: string;
  string_value: string | null;
  decimal_value: string | number | null;
  integer_value: Numeric | null;
  boolean_value: bigint | number | boolean | null;
  json_value: string | unknown | null;
  validation_json: string | unknown | null;
}

interface OperationRow {
  id: Numeric;
  result_json: string | StoredEnvelope | null;
}

interface StoredEnvelope {
  fingerprint: string;
  result: ConfigurationMutationResult;
}

interface LockedState {
  rows: readonly SetRow[];
  active: SetRow | null;
  nextVersion: string;
}

type MutationAction = ConfigurationMutationResult["action"];

const IDEMPOTENCY_SCOPE = "configuration.catalog";

function fail(code: string, message: string, statusCode = 409): never {
  throw new ApplicationError(code, message, statusCode);
}

function text(value: Numeric): string {
  return String(value);
}

function canonicalDecimal(value: string | number): string {
  const raw = String(value);
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const normalized = fraction.replace(/0+$/, "") === "" ? whole : `${whole}.${fraction.replace(/0+$/, "")}`;
  return negative && normalized !== "0" ? `-${normalized}` : normalized;
}

function json<T>(value: string | T): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

function envelope(value: string | StoredEnvelope): StoredEnvelope {
  const parsed = json<StoredEnvelope>(value);
  if (typeof parsed?.fingerprint !== "string" || parsed.result === undefined) {
    fail("CONFIGURATION_REPLAY_CORRUPT", "설정 변경 재실행 결과가 올바르지 않습니다.", 500);
  }
  return parsed;
}

function fingerprint(action: MutationAction, input: object, changes?: readonly NormalizedConfigurationValue[]): string {
  return createHash("sha256").update(JSON.stringify({ action, input, changes: changes ?? null })).digest("hex");
}

function metadata(row: ValueRow, definition: ConfigurationKeyDefinition): Pick<NormalizedConfigurationValue, "validation" | "source"> {
  if (row.validation_json === null) fail("CONFIGURATION_METADATA_MISSING", `설정 metadata가 없습니다: ${row.config_key}`, 500);
  const parsed = json<{ validation?: unknown; source?: unknown }>(row.validation_json as string | { validation?: unknown; source?: unknown });
  return {
    validation: (parsed.validation ?? {}) as NormalizedConfigurationValue["validation"],
    source: parsed.source as NormalizedConfigurationValue["source"],
  };
}

function rowValue(row: ValueRow, definition: ConfigurationKeyDefinition): NormalizedConfigurationValue {
  const bound = metadata(row, definition);
  let value: NormalizedConfigurationValue["value"];
  if (definition.type === "string") value = row.string_value ?? fail("CONFIGURATION_VALUE_MISSING", `${row.config_key} 문자열 값이 없습니다.`, 500);
  else if (definition.type === "integer") value = row.integer_value === null ? fail("CONFIGURATION_VALUE_MISSING", `${row.config_key} 정수 값이 없습니다.`, 500) : text(row.integer_value);
  else if (definition.type === "decimal") value = row.decimal_value === null ? fail("CONFIGURATION_VALUE_MISSING", `${row.config_key} 소수 값이 없습니다.`, 500) : canonicalDecimal(row.decimal_value);
  else if (definition.type === "boolean") {
    if (row.boolean_value === null) fail("CONFIGURATION_VALUE_MISSING", `${row.config_key} boolean 값이 없습니다.`, 500);
    const raw = Number(row.boolean_value);
    if (raw !== 0 && raw !== 1) fail("CONFIGURATION_VALUE_BOOLEAN", `${row.config_key} DB boolean 값이 올바르지 않습니다.`, 500);
    value = raw === 1;
  }
  else value = row.json_value === null ? null : json<NormalizedConfigurationValue["value"]>(row.json_value as string | NormalizedConfigurationValue["value"]);
  return { key: row.config_key, type: definition.type, value, ...bound };
}

function status(value: string): ConfigurationSetStatus {
  if (value !== "draft" && value !== "active" && value !== "retired") fail("CONFIGURATION_STATUS_INVALID", `지원하지 않는 설정 상태입니다: ${value}`, 500);
  return value;
}

function currentVersion(row: SetRow | null): string {
  return row === null ? "0" : text(row.version);
}

function assertExpected(active: SetRow | null, expected: string): void {
  const actual = currentVersion(active);
  if (actual !== expected) fail("CONFIGURATION_VERSION_CONFLICT", `현재 설정 버전은 ${actual}입니다.`);
}

function findVersion(rows: readonly SetRow[], version: string): SetRow | undefined {
  return rows.find((row) => text(row.version) === version);
}

function storageColumns(value: NormalizedConfigurationValue): readonly unknown[] {
  return [
    value.type === "string" ? value.value : null,
    value.type === "decimal" ? value.value : null,
    value.type === "integer" ? value.value : null,
    value.type === "boolean" ? value.value : null,
    value.type === "json" ? JSON.stringify(value.value) : null,
    JSON.stringify({ validation: value.validation, source: value.source }),
  ];
}

// 기존 configuration_* 테이블을 immutable version 카탈로그로 재사용합니다.
export class MariaConfigurationCatalogRepository implements ConfigurationCatalogRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async readCurrent(definition: ConfigurationSetDefinition): Promise<ConfigurationSnapshot | null> {
    const rows = await this.database.query<SetRow[]>(
      "SELECT id,set_code,version,status FROM configuration_sets WHERE set_code=? AND status='active' ORDER BY version DESC",
      [definition.setCode],
    );
    if (rows.length > 1) fail("CONFIGURATION_ACTIVE_AMBIGUOUS", `${definition.setCode} active 버전이 여러 개입니다.`, 500);
    return rows[0] === undefined ? null : this.snapshot(this.database, definition, rows[0]);
  }

  public async readVersion(definition: ConfigurationSetDefinition, version: string): Promise<ConfigurationSnapshot | null> {
    const row = (await this.database.query<SetRow[]>(
      "SELECT id,set_code,version,status FROM configuration_sets WHERE set_code=? AND version=? LIMIT 1",
      [definition.setCode, version],
    ))[0];
    return row === undefined ? null : this.snapshot(this.database, definition, row);
  }

  public createDraft(definition: ConfigurationSetDefinition, input: CreateConfigurationDraftInput, changes: readonly NormalizedConfigurationValue[]): Promise<ConfigurationMutationResult> {
    return this.mutate("draft", input, changes, async (transaction, operation, state) => {
      assertExpected(state.active, input.expectedActiveVersion);
      const baseVersion = input.baseVersion ?? currentVersion(state.active);
      const base = baseVersion === "0" ? undefined : findVersion(state.rows, baseVersion);
      if (baseVersion !== "0" && base === undefined) fail("CONFIGURATION_BASE_NOT_FOUND", "초안 기준 버전을 찾을 수 없습니다.", 404);
      const baseValues = base === undefined ? [] : await this.values(transaction, definition, base);
      const projected = new Map(baseValues.map((entry) => [entry.key, entry]));
      for (const change of changes) projected.set(change.key, change);
      const values = [...projected.values()].sort((left, right) => left.key.localeCompare(right.key));
      validateConfigurationSnapshot(definition, values);
      const setId = await this.insertSet(transaction, definition.setCode, state.nextVersion, "draft", null);
      await this.insertValues(transaction, setId, values);
      if (base?.status === "draft") {
        await transaction.execute("UPDATE configuration_sets SET status='retired',effective_to=UTC_TIMESTAMP(3) WHERE id=? AND status='draft'", [base.id]);
      }
      return this.complete(transaction, operation, "draft", definition, state.active, state.nextVersion, baseVersion === "0" ? null : baseVersion, setId, values, input.actorId, input.reason);
    });
  }

  public publish(definition: ConfigurationSetDefinition, input: PublishConfigurationDraftInput): Promise<ConfigurationMutationResult> {
    return this.mutate("publish", input, undefined, async (transaction, operation, state) => {
      assertExpected(state.active, input.expectedActiveVersion);
      const draft = findVersion(state.rows, input.draftVersion);
      if (draft === undefined) fail("CONFIGURATION_DRAFT_NOT_FOUND", "게시할 초안을 찾을 수 없습니다.", 404);
      if (draft.status !== "draft") fail("CONFIGURATION_DRAFT_STATE", "draft 상태만 게시할 수 있습니다.");
      const values = await this.values(transaction, definition, draft);
      if (state.active !== null) await transaction.execute("UPDATE configuration_sets SET status='retired',effective_to=UTC_TIMESTAMP(3) WHERE id=? AND status='active'", [state.active.id]);
      await transaction.execute("UPDATE configuration_sets SET status='active',effective_from=UTC_TIMESTAMP(3),effective_to=NULL,approved_by=? WHERE id=? AND status='draft'", [input.actorId, draft.id]);
      return this.complete(transaction, operation, "publish", definition, state.active, input.draftVersion, null, draft.id, values, input.actorId, input.reason);
    });
  }

  public rollback(definition: ConfigurationSetDefinition, input: RollbackConfigurationInput): Promise<ConfigurationMutationResult> {
    return this.mutate("rollback", input, undefined, async (transaction, operation, state) => {
      assertExpected(state.active, input.expectedActiveVersion);
      if (state.active === null) fail("CONFIGURATION_ACTIVE_REQUIRED", "rollback할 active 설정이 없습니다.");
      if (input.targetVersion === input.expectedActiveVersion) fail("CONFIGURATION_ROLLBACK_CURRENT", "현재 버전으로 rollback할 수 없습니다.");
      const target = findVersion(state.rows, input.targetVersion);
      if (target === undefined) fail("CONFIGURATION_TARGET_NOT_FOUND", "rollback 대상 버전을 찾을 수 없습니다.", 404);
      const values = await this.values(transaction, definition, target);
      const setId = await this.insertSet(transaction, definition.setCode, state.nextVersion, "active", input.actorId);
      await this.insertValues(transaction, setId, values);
      await transaction.execute("UPDATE configuration_sets SET status='retired',effective_to=UTC_TIMESTAMP(3) WHERE id=? AND status='active'", [state.active.id]);
      return this.complete(transaction, operation, "rollback", definition, state.active, state.nextVersion, input.targetVersion, setId, values, input.actorId, input.reason);
    });
  }

  public retire(definition: ConfigurationSetDefinition, input: RetireConfigurationInput): Promise<ConfigurationMutationResult> {
    return this.mutate("retire", input, undefined, async (transaction, operation, state) => {
      assertExpected(state.active, input.expectedActiveVersion);
      if (state.active === null) fail("CONFIGURATION_ACTIVE_REQUIRED", "retire할 active 설정이 없습니다.");
      await transaction.execute("UPDATE configuration_sets SET status='retired',effective_to=UTC_TIMESTAMP(3) WHERE id=? AND status='active'", [state.active.id]);
      return this.complete(transaction, operation, "retire", definition, state.active, input.expectedActiveVersion, null, state.active.id, null, input.actorId, input.reason);
    });
  }

  public discardDraft(definition: ConfigurationSetDefinition, input: DiscardConfigurationDraftInput): Promise<ConfigurationMutationResult> {
    return this.mutate("discard", input, undefined, async (transaction, operation, state) => {
      const draft = findVersion(state.rows, input.draftVersion);
      if (draft === undefined) fail("CONFIGURATION_DRAFT_NOT_FOUND", "폐기할 초안을 찾을 수 없습니다.", 404);
      if (draft.status !== "draft") fail("CONFIGURATION_DRAFT_STATE", "draft 상태만 폐기할 수 있습니다.");
      await transaction.execute("UPDATE configuration_sets SET status='retired',effective_to=UTC_TIMESTAMP(3) WHERE id=? AND status='draft'", [draft.id]);
      return this.complete(transaction, operation, "discard", definition, state.active, input.draftVersion, null, draft.id, null, input.actorId, input.reason);
    });
  }

  private async mutate<T extends { setCode: string; actorId: string; idempotencyKey: string; reason: string }>(
    action: MutationAction,
    input: T,
    changes: readonly NormalizedConfigurationValue[] | undefined,
    work: (transaction: DatabaseTransaction, operation: OperationRow, state: LockedState) => Promise<ConfigurationMutationResult>,
  ): Promise<ConfigurationMutationResult> {
    const requestFingerprint = fingerprint(action, input, changes);
    const scope = `${IDEMPOTENCY_SCOPE}.${action}`;
    return this.database.withTransaction(async (transaction) => {
      await this.requireOperator(transaction, input.actorId);
      const inserted = await transaction.execute(
        `INSERT IGNORE INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'admin-web','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, input.idempotencyKey, input.actorId],
      );
      const operation = (await transaction.query<OperationRow[]>(
        "SELECT id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, input.idempotencyKey],
      ))[0];
      if (operation === undefined) fail("CONFIGURATION_OPERATION_MISSING", "설정 변경 operation을 찾을 수 없습니다.", 500);
      if (inserted.affectedRows === 0n) {
        if (operation.result_json === null) fail("CONFIGURATION_IDEMPOTENCY_IN_PROGRESS", "같은 설정 변경 요청을 처리 중입니다.");
        const previous = envelope(operation.result_json);
        if (previous.fingerprint !== requestFingerprint) fail("CONFIGURATION_IDEMPOTENCY_CONFLICT", "같은 Idempotency-Key에 다른 요청을 사용할 수 없습니다.");
        return { ...previous.result, replayed: true };
      }
      const state = await this.lockState(transaction, input.setCode);
      const result = await work(transaction, operation, state);
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify({ fingerprint: requestFingerprint, result } satisfies StoredEnvelope), operation.id],
      );
      return result;
    });
  }

  private async requireOperator(transaction: DatabaseTransaction, actorId: string): Promise<void> {
    const row = (await transaction.query<Array<{ id: Numeric }>>(
      "SELECT id FROM admin_operators WHERE id=? AND status='active' LIMIT 1 FOR UPDATE",
      [actorId],
    ))[0];
    if (row === undefined) fail("CONFIGURATION_OPERATOR_FORBIDDEN", "활성 관리자만 설정을 변경할 수 있습니다.", 403);
  }

  private async lockState(transaction: DatabaseTransaction, setCode: string): Promise<LockedState> {
    const rows = await transaction.query<SetRow[]>(
      "SELECT id,set_code,version,status FROM configuration_sets WHERE set_code=? ORDER BY version FOR UPDATE",
      [setCode],
    );
    const activeRows = rows.filter((row) => row.status === "active");
    if (activeRows.length > 1) fail("CONFIGURATION_ACTIVE_AMBIGUOUS", `${setCode} active 버전이 여러 개입니다.`, 500);
    const maximum = rows.reduce((result, row) => {
      const candidate = BigInt(row.version);
      return candidate > result ? candidate : result;
    }, 0n);
    return { rows, active: activeRows[0] ?? null, nextVersion: (maximum + 1n).toString() };
  }

  private async snapshot(executor: Pick<DatabaseClient, "query"> | Pick<DatabaseTransaction, "query">, definition: ConfigurationSetDefinition, row: SetRow): Promise<ConfigurationSnapshot> {
    const values = await this.values(executor, definition, row);
    return { id: text(row.id), setCode: row.set_code, version: text(row.version), status: status(row.status), values, contentHash: configurationContentHash(values) };
  }

  private async values(executor: Pick<DatabaseClient, "query"> | Pick<DatabaseTransaction, "query">, definition: ConfigurationSetDefinition, row: SetRow): Promise<readonly NormalizedConfigurationValue[]> {
    const rows = await executor.query<ValueRow[]>(
      `SELECT config_key,value_type,string_value,decimal_value,integer_value,boolean_value,json_value,validation_json
       FROM configuration_values WHERE configuration_set_id=? ORDER BY config_key`,
      [row.id],
    );
    const definitions = new Map(definition.keys.map((entry) => [entry.key, entry]));
    const values = rows.map((value) => {
      const key = definitions.get(value.config_key);
      if (key === undefined || value.value_type !== key.type) fail("CONFIGURATION_SNAPSHOT_SHAPE", `DB 설정 key/type이 정의와 다릅니다: ${value.config_key}`, 500);
      return rowValue(value, key);
    });
    validateConfigurationSnapshot(definition, values);
    return values;
  }

  private async insertSet(transaction: DatabaseTransaction, setCode: string, version: string, setStatus: "draft" | "active", approvedBy: string | null): Promise<bigint> {
    const inserted = await transaction.execute(
      `INSERT INTO configuration_sets(set_code,version,status,effective_from,approved_by,created_at)
       VALUES (?,?,?,IF(?='active',UTC_TIMESTAMP(3),NULL),?,UTC_TIMESTAMP(3))`,
      [setCode, version, setStatus, setStatus, approvedBy],
    );
    return inserted.insertId;
  }

  private async insertValues(transaction: DatabaseTransaction, setId: Numeric, values: readonly NormalizedConfigurationValue[]): Promise<void> {
    for (const value of values) {
      await transaction.execute(
        `INSERT INTO configuration_values
         (configuration_set_id,config_key,value_type,string_value,decimal_value,integer_value,boolean_value,json_value,validation_json)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [setId, value.key, value.type, ...storageColumns(value)],
      );
    }
  }

  private async complete(
    transaction: DatabaseTransaction,
    operation: OperationRow,
    action: MutationAction,
    definition: ConfigurationSetDefinition,
    before: SetRow | null,
    version: string,
    targetVersion: string | null,
    setId: Numeric,
    values: readonly NormalizedConfigurationValue[] | null,
    actorId: string,
    reason: string,
  ): Promise<ConfigurationMutationResult> {
    const snapshot: ConfigurationSnapshot | null = values === null ? null : {
      id: text(setId), setCode: definition.setCode, version,
      status: action === "draft" ? "draft" : "active",
      values, contentHash: configurationContentHash(values),
    };
    const summary = {
      action, setCode: definition.setCode, beforeVersion: currentVersion(before), version, targetVersion,
      contentHash: snapshot?.contentHash ?? null, immutableHistory: true,
    };
    await transaction.execute(
      `INSERT INTO configuration_change_log(configuration_set_id,actor_id,action_code,change_json,created_at)
       VALUES (?,?,?,?,UTC_TIMESTAMP(3))`,
      [setId, actorId, `configuration.${action}`, JSON.stringify(summary)],
    );
    const audit = await transaction.execute(
      `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
       VALUES (?,'admin_operator',?,'configuration_set',?,?, 'success',?,?,UTC_TIMESTAMP(3))`,
      [operation.id, actorId, setId, `configuration.catalog.${action}`, reason, JSON.stringify(summary)],
    );
    const outbox = await transaction.execute(
      `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
       VALUES (?,'internal',?,'configuration.changed',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
      [operation.id, definition.setCode, JSON.stringify(summary)],
    );
    return {
      action, setCode: definition.setCode, beforeVersion: currentVersion(before), version, targetVersion, snapshot,
      operationId: text(operation.id), auditId: text(audit.insertId), outboxId: text(outbox.insertId), replayed: false,
    };
  }
}
