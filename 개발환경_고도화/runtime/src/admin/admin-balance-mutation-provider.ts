import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import type { AdminBalanceDomain, AdminBalanceDomainProjection, AdminBalanceValueProjection } from "./admin-balance-read-model.js";

export interface AdminBalanceValueChangeInput {
  key: string;
  value: string;
}

export interface AdminBalanceProjectedChange {
  key: string;
  label: string;
  before: string;
  after: string;
  unit: string;
}

interface PreviewBase {
  domain: AdminBalanceDomain;
  operatorId: string;
  expectedVersion: string;
  reason: string;
}

export interface AdminBalanceApplyPreviewInput extends PreviewBase {
  mode: "apply";
  changes: readonly AdminBalanceValueChangeInput[];
}

export interface AdminBalanceRollbackPreviewInput extends PreviewBase {
  mode: "rollback";
  targetVersion: string;
}

export type AdminBalanceMutationPreviewInput = AdminBalanceApplyPreviewInput | AdminBalanceRollbackPreviewInput;

export interface AdminBalanceMutationPreview {
  mode: "apply" | "rollback";
  domain: AdminBalanceDomain;
  expectedVersion: string;
  targetVersion: string | null;
  changes: readonly AdminBalanceProjectedChange[];
  confirmationToken: string;
}

interface ExecuteBase extends PreviewBase {
  idempotencyKey: string;
  confirmationToken: string;
  confirmed: true;
}

export interface AdminBalanceApplyInput extends ExecuteBase {
  changes: readonly AdminBalanceValueChangeInput[];
}

export interface AdminBalanceRollbackInput extends ExecuteBase {
  targetVersion: string;
}

export interface AdminBalanceMutationResult {
  mode: "apply" | "rollback";
  domain: AdminBalanceDomain;
  beforeVersion: string;
  version: string;
  targetVersion: string | null;
  changes: readonly AdminBalanceProjectedChange[];
  operationId: string;
  auditId: string;
  outboxId: string;
  replayed: boolean;
}

export interface AdminBalanceActivationInput {
  mode: "apply" | "rollback";
  domain: AdminBalanceDomain;
  currentVersion: string;
  targetVersion: string | null;
  changes: readonly AdminBalanceValueChangeInput[];
  operationId: bigint;
}

export interface AdminBalanceMutationRepository {
  readCurrent(domain: AdminBalanceDomain, transaction?: DatabaseTransaction): Promise<AdminBalanceDomainProjection>;
  readVersion(domain: AdminBalanceDomain, version: string, transaction?: DatabaseTransaction): Promise<AdminBalanceDomainProjection | undefined>;
  activate(transaction: DatabaseTransaction, input: AdminBalanceActivationInput): Promise<AdminBalanceDomainProjection>;
}

interface StoredEnvelope {
  fingerprint: string;
  result: AdminBalanceMutationResult;
}

function fail(code: string, message: string, statusCode = 422, details?: Record<string, unknown>): never {
  throw new ApplicationError(code, message, statusCode, details);
}

function normalizeReason(reason: string): string {
  const value = reason.trim();
  if (value.length < 5 || value.length > 500 || /[\u0000-\u001f]/.test(value)) {
    fail("BALANCE_REASON_INVALID", "변경 사유는 제어문자 없이 5~500자로 입력해주세요.");
  }
  return value;
}

function normalizeVersion(value: string, field: string): string {
  if (!/^(0|[1-9]\d*)$/.test(value)) fail("BALANCE_VERSION_INVALID", `${field}은 0 이상의 정수 문자열이어야 합니다.`);
  return value;
}

function decimal(value: string, field: string): { normalized: string; fraction: number } {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (match === null) fail("BALANCE_VALUE_INVALID", `${field} 값은 0 이상의 십진 문자열이어야 합니다.`);
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  return { normalized: fraction === "" ? match[1]! : `${match[1]}.${fraction}`, fraction: fraction.length };
}

function scaled(value: string, scale: number): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * (10n ** BigInt(scale)) + BigInt(fraction.padEnd(scale, "0"));
}

function compareDecimal(left: string, right: string): number {
  const scale = Math.max(decimal(left, "left").fraction, decimal(right, "right").fraction);
  const difference = scaled(left, scale) - scaled(right, scale);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function validateStep(value: string, item: AdminBalanceValueProjection): void {
  const parts = [value, item.min ?? "0", item.max ?? "0", item.step].map((entry) => decimal(entry, item.key));
  const scale = Math.max(...parts.map((entry) => entry.fraction));
  const base = scaled(parts[1]!.normalized, scale);
  const step = scaled(parts[3]!.normalized, scale);
  if (step <= 0n || (scaled(parts[0]!.normalized, scale) - base) % step !== 0n) {
    fail("BALANCE_STEP_INVALID", `${item.label} 값은 ${item.step} 단위여야 합니다.`);
  }
}

function sumExactly100(items: readonly AdminBalanceValueProjection[]): boolean {
  const parsed = items.map((item) => decimal(item.value, item.key));
  const scale = Math.max(0, ...parsed.map((entry) => entry.fraction));
  const sum = parsed.reduce((total, entry) => total + scaled(entry.normalized, scale), 0n);
  return sum === 100n * (10n ** BigInt(scale));
}

export function projectAdminBalanceChanges(
  current: AdminBalanceDomainProjection,
  requested: readonly AdminBalanceValueChangeInput[],
): { values: readonly AdminBalanceValueProjection[]; changes: readonly AdminBalanceProjectedChange[]; normalized: readonly AdminBalanceValueChangeInput[] } {
  if (requested.length === 0 || requested.length > 500) fail("BALANCE_CHANGES_INVALID", "변경 항목은 1~500개여야 합니다.");
  const byKey = new Map(current.values.map((item) => [item.key, item]));
  const seen = new Set<string>();
  const normalized = requested.map((input) => {
    if (seen.has(input.key)) fail("BALANCE_CHANGE_DUPLICATE", `중복 변경 키입니다: ${input.key}`);
    seen.add(input.key);
    const item = byKey.get(input.key);
    if (item === undefined || !item.editable) fail("BALANCE_KEY_NOT_EDITABLE", `변경할 수 없는 키입니다: ${input.key}`);
    const value = decimal(input.value, input.key).normalized;
    if (item.min !== null && compareDecimal(value, item.min) < 0) fail("BALANCE_MIN_INVALID", `${item.label} 최솟값은 ${item.min}${item.unit}입니다.`);
    if (item.max !== null && compareDecimal(value, item.max) > 0) fail("BALANCE_MAX_INVALID", `${item.label} 최댓값은 ${item.max}${item.unit}입니다.`);
    validateStep(value, item);
    if (compareDecimal(value, item.value) === 0) fail("BALANCE_VALUE_UNCHANGED", `${item.label} 값이 변경되지 않았습니다.`);
    return { key: input.key, value };
  }).sort((left, right) => left.key.localeCompare(right.key));
  const replacement = new Map(normalized.map((entry) => [entry.key, entry.value]));
  const values = current.values.map((item) => ({ ...item, value: replacement.get(item.key) ?? item.value }));
  const touchedSumGroups = new Set(values.filter((item) => replacement.has(item.key) && item.sumGroup !== null).map((item) => item.sumGroup!));
  for (const sumGroup of touchedSumGroups) {
    if (!sumExactly100(values.filter((item) => item.sumGroup === sumGroup))) {
      fail("BALANCE_SUM_INVALID", `${sumGroup} 합계는 정확히 100%여야 합니다.`);
    }
  }
  const changes = normalized.map((entry) => {
    const item = byKey.get(entry.key)!;
    return { key: entry.key, label: item.label, before: item.value, after: entry.value, unit: item.unit };
  });
  return { values, changes, normalized };
}

function rollbackChanges(current: AdminBalanceDomainProjection, target: AdminBalanceDomainProjection): readonly AdminBalanceValueChangeInput[] {
  const targetByKey = new Map(target.values.map((item) => [item.key, item]));
  const currentEditable = current.values.filter((item) => item.editable);
  if (targetByKey.size !== target.values.length || currentEditable.some((item) => targetByKey.get(item.key)?.editable !== true)) {
    fail("BALANCE_ROLLBACK_SHAPE_INVALID", "대상 버전의 수치 구조가 현재 버전과 다릅니다.", 409);
  }
  return currentEditable.flatMap((item) => {
    const targetItem = targetByKey.get(item.key)!;
    return compareDecimal(item.value, targetItem.value) === 0 ? [] : [{ key: item.key, value: targetItem.value }];
  });
}

function previewToken(input: {
  mode: "apply" | "rollback";
  domain: AdminBalanceDomain;
  operatorId: string;
  expectedVersion: string;
  targetVersion: string | null;
  reason: string;
  changes: readonly AdminBalanceValueChangeInput[];
}): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
}

function key(value: string): string {
  if (value === "") fail("BALANCE_IDEMPOTENCY_REQUIRED", "Idempotency-Key가 필요합니다.");
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseEnvelope(value: string | StoredEnvelope): StoredEnvelope {
  return typeof value === "string" ? JSON.parse(value) as StoredEnvelope : value;
}

export class AdminBalanceMutationProvider {
  public constructor(private readonly database: DatabaseClient, private readonly repository: AdminBalanceMutationRepository) {}

  // 현재 version을 기준으로 변경 또는 rollback 결과와 확인 토큰을 미리 계산합니다.
  public async preview(input: AdminBalanceMutationPreviewInput): Promise<AdminBalanceMutationPreview> {
    const normalized = await this.prepare(input);
    return {
      mode: input.mode,
      domain: input.domain,
      expectedVersion: normalized.current.version,
      targetVersion: input.mode === "rollback" ? input.targetVersion : null,
      changes: normalized.projected.changes,
      confirmationToken: normalized.token,
    };
  }

  public async apply(input: AdminBalanceApplyInput): Promise<AdminBalanceMutationResult> {
    return this.execute("apply", input, null);
  }

  public async rollback(input: AdminBalanceRollbackInput): Promise<AdminBalanceMutationResult> {
    return this.execute("rollback", input, input.targetVersion);
  }

  private async prepare(input: AdminBalanceMutationPreviewInput, transaction?: DatabaseTransaction) {
    const reason = normalizeReason(input.reason);
    const expectedVersion = normalizeVersion(input.expectedVersion, "expectedVersion");
    const current = await this.repository.readCurrent(input.domain, transaction);
    if (current.version !== expectedVersion) fail("BALANCE_VERSION_CONFLICT", "수치 버전이 먼저 변경되었습니다.", 409, { currentVersion: current.version });
    let requested: readonly AdminBalanceValueChangeInput[];
    let targetVersion: string | null = null;
    if (input.mode === "apply") {
      requested = input.changes;
    } else {
      targetVersion = normalizeVersion(input.targetVersion, "targetVersion");
      if (targetVersion === current.version) fail("BALANCE_ROLLBACK_CURRENT", "현재 버전으로는 rollback할 수 없습니다.", 409);
      const target = await this.repository.readVersion(input.domain, targetVersion, transaction);
      if (target === undefined) fail("BALANCE_ROLLBACK_NOT_FOUND", "rollback 대상 버전을 찾을 수 없습니다.", 404);
      requested = rollbackChanges(current, target);
      if (requested.length === 0) fail("BALANCE_ROLLBACK_UNCHANGED", "rollback 대상과 현재 수치가 같습니다.", 409);
    }
    const projected = projectAdminBalanceChanges(current, requested);
    const token = previewToken({ mode: input.mode, domain: input.domain, operatorId: input.operatorId, expectedVersion, targetVersion, reason, changes: projected.normalized });
    return { reason, current, targetVersion, projected, token };
  }

  private async execute(mode: "apply" | "rollback", input: AdminBalanceApplyInput | AdminBalanceRollbackInput, targetVersion: string | null): Promise<AdminBalanceMutationResult> {
    if (input.confirmed !== true || input.confirmationToken === "") fail("BALANCE_CONFIRMATION_REQUIRED", "preview 확인 토큰이 필요합니다.");
    const idempotencyKey = key(input.idempotencyKey);
    const scope = `admin.balance.${mode}:${input.domain}:${input.operatorId}`;
    const payload = mode === "apply"
      ? { mode, domain: input.domain, operatorId: input.operatorId, expectedVersion: input.expectedVersion, reason: input.reason, changes: (input as AdminBalanceApplyInput).changes }
      : { mode, domain: input.domain, operatorId: input.operatorId, expectedVersion: input.expectedVersion, reason: input.reason, targetVersion };
    const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    return this.database.withTransaction(async (transaction) => {
      const prior = (await transaction.query<Array<{ result_json: string | StoredEnvelope | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, idempotencyKey],
      ))[0];
      if (prior?.result_json != null) {
        const envelope = parseEnvelope(prior.result_json);
        if (envelope.fingerprint !== fingerprint) fail("BALANCE_IDEMPOTENCY_CONFLICT", "같은 Idempotency-Key에 다른 요청을 사용할 수 없습니다.", 409);
        return { ...envelope.result, replayed: true };
      }
      const operator = (await transaction.query<Array<{ id: bigint }>>(
        "SELECT id FROM admin_operators WHERE id=? AND status='active' LIMIT 1 FOR UPDATE",
        [input.operatorId],
      ))[0];
      if (operator === undefined) fail("BALANCE_OPERATOR_FORBIDDEN", "활성 관리자만 수치를 변경할 수 있습니다.", 403);
      const previewInput: AdminBalanceMutationPreviewInput = mode === "apply"
        ? { mode, domain: input.domain, operatorId: input.operatorId, expectedVersion: input.expectedVersion, reason: input.reason, changes: (input as AdminBalanceApplyInput).changes }
        : { mode, domain: input.domain, operatorId: input.operatorId, expectedVersion: input.expectedVersion, reason: input.reason, targetVersion: targetVersion! };
      const prepared = await this.prepare(previewInput, transaction);
      if (prepared.token !== input.confirmationToken) fail("BALANCE_CONFIRMATION_STALE", "preview 결과가 오래되었거나 요청 내용이 달라졌습니다.", 409);
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'admin-web','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, idempotencyKey, input.operatorId],
      );
      const after = await this.repository.activate(transaction, {
        mode,
        domain: input.domain,
        currentVersion: prepared.current.version,
        targetVersion: prepared.targetVersion,
        changes: prepared.projected.normalized,
        operationId: operation.insertId,
      });
      await transaction.execute(
        `INSERT INTO configuration_sets(set_code,version,status,effective_from,approved_by)
         VALUES (?,?,'active',UTC_TIMESTAMP(3),?)`,
        [`admin.balance.${input.domain}`, after.version, input.operatorId],
      );
      const configSet = (await transaction.query<Array<{ id: bigint }>>(
        "SELECT id FROM configuration_sets WHERE set_code=? AND version=? LIMIT 1",
        [`admin.balance.${input.domain}`, after.version],
      ))[0]!;
      const summary = {
        mode,
        domain: input.domain,
        reason: prepared.reason,
        beforeVersion: prepared.current.version,
        version: after.version,
        targetVersion: prepared.targetVersion,
        changes: prepared.projected.changes,
        sourceBefore: prepared.current.source,
        sourceAfter: after.source,
      };
      await transaction.execute(
        `INSERT INTO configuration_change_log(configuration_set_id,actor_id,action_code,change_json,created_at)
         VALUES (?,?,?,?,UTC_TIMESTAMP(3))`,
        [configSet.id, input.operatorId, `admin.balance.${mode}`, JSON.stringify(summary)],
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'balance_domain',NULL,?,'success',?,?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, `admin.balance.${mode}`, prepared.reason, JSON.stringify(summary)],
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'admin-web',?,'balance_change',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, `operator:${input.operatorId}`, JSON.stringify({ type: "admin.balance.changed", ...summary })],
      );
      const result: AdminBalanceMutationResult = {
        mode,
        domain: input.domain,
        beforeVersion: prepared.current.version,
        version: after.version,
        targetVersion: prepared.targetVersion,
        changes: prepared.projected.changes,
        operationId: operation.insertId.toString(),
        auditId: audit.insertId.toString(),
        outboxId: outbox.insertId.toString(),
        replayed: false,
      };
      const envelope: StoredEnvelope = { fingerprint, result };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(envelope), operation.insertId]);
      return result;
    });
  }
}
