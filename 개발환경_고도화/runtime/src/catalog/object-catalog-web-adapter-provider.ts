import { createHash, randomUUID } from "node:crypto";
import { createScopedDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { MariaObjectCatalogRepository } from "./maria-object-catalog-repository.js";
import {
  ObjectCatalogError,
  ObjectCatalogService,
  type CatalogObject,
  type ObjectAliasInput,
  type ObjectSourceBindingInput,
  type ObjectType,
  type RegisterCatalogObjectInput,
  type UpdateCatalogObjectInput,
} from "./object-catalog.js";

interface WebRequestBase {
  source: string;
  operatorId: string;
  idempotencyKey: string;
  reason: string;
}

export interface ObjectCatalogWebRegisterRequest extends WebRequestBase {
  objectKey: string;
  objectType: ObjectType;
  displayName: string;
  active?: boolean;
  metadata?: Record<string, unknown>;
  aliases?: readonly ObjectAliasInput[];
  sourceBindings: readonly ObjectSourceBindingInput[];
}

export interface ObjectCatalogWebUpdateRequest extends WebRequestBase {
  objectKey: string;
  objectType: ObjectType;
  expectedVersion: string;
  displayName: string;
  active: boolean;
  metadata?: Record<string, unknown>;
  aliases?: readonly ObjectAliasInput[];
  sourceBindings?: readonly ObjectSourceBindingInput[];
}

export interface ObjectCatalogWebSetActiveRequest extends WebRequestBase {
  objectKey: string;
  objectType: ObjectType;
  expectedVersion: string;
  active: boolean;
}

export interface ObjectCatalogWebMutationResult {
  status: "registered" | "updated" | "activated" | "deactivated";
  replayed: boolean;
  object: CatalogObject;
  operationId: string;
  auditId: string;
}

type NormalizedMutation =
  | (WebRequestBase & {
      action: "REGISTER";
      objectKey: string;
      objectType: ObjectType;
      displayName: string;
      active: boolean;
      metadata: Record<string, unknown>;
      aliases: ObjectAliasInput[];
      sourceBindings: ObjectSourceBindingInput[];
    })
  | (WebRequestBase & {
      action: "UPDATE";
      objectKey: string;
      objectType: ObjectType;
      expectedVersion: string;
      displayName: string;
      active: boolean;
      metadata: Record<string, unknown>;
      aliases?: ObjectAliasInput[];
      sourceBindings?: ObjectSourceBindingInput[];
    })
  | (WebRequestBase & {
      action: "SET_ACTIVE";
      objectKey: string;
      objectType: ObjectType;
      expectedVersion: string;
      active: boolean;
    });

interface OperationRow {
  id: bigint | number | string;
  result_json: string | StoredMutationEnvelope | null;
}

interface StoredMutationEnvelope {
  payloadFingerprint: string;
  result: ObjectCatalogWebMutationResult;
}

interface CatalogWriter {
  register(input: RegisterCatalogObjectInput): Promise<CatalogObject>;
  update(input: UpdateCatalogObjectInput): Promise<CatalogObject>;
  getByKey(objectKey: string, includeInactive?: boolean): Promise<CatalogObject>;
}

type CatalogFactory = (transaction: DatabaseTransaction) => CatalogWriter;

interface RuntimeTarget {
  table: string;
  keyColumn: string;
}

const IDEMPOTENCY_SCOPE = "object.catalog.web";
const OPERATION_SOURCE_CODE = "admin_web";
const SOURCE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;

const RUNTIME_TARGETS: Record<ObjectType, RuntimeTarget> = {
  ITEM: { table: "item_definitions", keyColumn: "code" },
  PET: { table: "pet_definitions", keyColumn: "code" },
  FURNITURE: { table: "furniture_definitions", keyColumn: "code" },
  TITLE: { table: "title_definitions", keyColumn: "code" },
  PET_TITLE: { table: "title_definitions", keyColumn: "code" },
  PACKAGE: { table: "package_catalog", keyColumn: "package_id" },
  CURRENCY: { table: "currency_definitions", keyColumn: "code" },
  SKILL: { table: "skill_definitions", keyColumn: "code" },
  HOME_BUILDING: { table: "home_building_progression", keyColumn: "source_index" },
  MINI_PET: { table: "mini_pet_definitions", keyColumn: "code" },
};

const LEGACY_JSON_TABLES: Record<ObjectType, readonly string[]> = {
  ITEM: ["itemInfo", "itemList"],
  PET: ["member_pet"],
  FURNITURE: ["petSweetHomeInfo"],
  TITLE: ["member_title"],
  PET_TITLE: ["pet_title"],
  PACKAGE: ["packageInfo"],
  CURRENCY: ["member"],
  SKILL: ["PET_SKILL_LIST"],
  HOME_BUILDING: ["HOME_BUILDING_LIST"],
  MINI_PET: ["miniPetInfo", "MINI_PET_LIST"],
};

function error(code: string, message: string, statusCode: number): ApplicationError {
  return new ApplicationError(code, message, statusCode);
}

function nonempty(value: string, code: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw error(code, `${label} 값이 올바르지 않습니다.`, 422);
  }
  return normalized;
}

function normalizeBase(input: WebRequestBase): WebRequestBase {
  const operatorId = nonempty(input.operatorId, "OBJECT_CATALOG_OPERATOR_INVALID", "operatorId", 20);
  if (!/^[1-9][0-9]*$/.test(operatorId) || BigInt(operatorId) > 18446744073709551615n) {
    throw error("OBJECT_CATALOG_OPERATOR_INVALID", "operatorId 값이 올바르지 않습니다.", 422);
  }
  const source = nonempty(input.source, "OBJECT_CATALOG_SOURCE_INVALID", "source", 64);
  if (!SOURCE_PATTERN.test(source) || source === "iris") {
    throw error("OBJECT_CATALOG_SOURCE_INVALID", "웹 요청 출처가 올바르지 않습니다.", 422);
  }
  return {
    source,
    operatorId,
    idempotencyKey: nonempty(input.idempotencyKey, "OBJECT_CATALOG_IDEMPOTENCY_INVALID", "idempotencyKey", 500),
    reason: nonempty(input.reason, "OBJECT_CATALOG_REASON_REQUIRED", "reason", 500),
  };
}

function normalizeExpectedVersion(value: string): string {
  const normalized = value.trim();
  if (!/^[1-9][0-9]*$/.test(normalized) || BigInt(normalized) > 18446744073709551615n) {
    throw error("OBJECT_CATALOG_VERSION_INVALID", "expectedVersion 값이 올바르지 않습니다.", 422);
  }
  return normalized;
}

function normalizeMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> {
  const metadata = value ?? {};
  try {
    JSON.stringify(metadata);
  } catch {
    throw error("OBJECT_CATALOG_METADATA_INVALID", "metadata는 JSON으로 저장할 수 있어야 합니다.", 422);
  }
  return metadata;
}

function normalizeAliases(values: readonly ObjectAliasInput[] | undefined): ObjectAliasInput[] | undefined {
  if (values === undefined) return undefined;
  return values.map((value) => ({ type: value.type, value: value.value.trim() }))
    .sort((left, right) => `${left.type}|${left.value}`.localeCompare(`${right.type}|${right.value}`));
}

function normalizeSources(values: readonly ObjectSourceBindingInput[] | undefined): ObjectSourceBindingInput[] | undefined {
  if (values === undefined) return undefined;
  return values.map((value) => ({ system: value.system, table: value.table.trim(), key: value.key.trim() }))
    .sort((left, right) => `${left.system}|${left.table}|${left.key}`.localeCompare(`${right.system}|${right.table}|${right.key}`));
}

function normalizeRegister(input: ObjectCatalogWebRegisterRequest): NormalizedMutation {
  return {
    ...normalizeBase(input),
    action: "REGISTER",
    objectKey: input.objectKey.trim(),
    objectType: input.objectType,
    displayName: input.displayName.trim(),
    active: input.active ?? true,
    metadata: normalizeMetadata(input.metadata),
    aliases: normalizeAliases(input.aliases) ?? [],
    sourceBindings: normalizeSources(input.sourceBindings) ?? [],
  };
}

function normalizeUpdate(input: ObjectCatalogWebUpdateRequest): NormalizedMutation {
  return {
    ...normalizeBase(input),
    action: "UPDATE",
    objectKey: input.objectKey.trim(),
    objectType: input.objectType,
    expectedVersion: normalizeExpectedVersion(input.expectedVersion),
    displayName: input.displayName.trim(),
    active: input.active,
    metadata: normalizeMetadata(input.metadata),
    aliases: normalizeAliases(input.aliases),
    sourceBindings: normalizeSources(input.sourceBindings),
  };
}

function normalizeSetActive(input: ObjectCatalogWebSetActiveRequest): NormalizedMutation {
  return {
    ...normalizeBase(input),
    action: "SET_ACTIVE",
    objectKey: input.objectKey.trim(),
    objectType: input.objectType,
    expectedVersion: normalizeExpectedVersion(input.expectedVersion),
    active: input.active,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]));
  }
  return typeof value === "bigint" ? value.toString() : value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function namespacedRequestKey(input: NormalizedMutation): string {
  return `sha256:${sha256(JSON.stringify([IDEMPOTENCY_SCOPE, input.source, input.operatorId, input.idempotencyKey]))}`;
}

function payloadFingerprint(input: NormalizedMutation): string {
  return sha256(JSON.stringify(canonicalize(input)));
}

function storedEnvelope(value: string | StoredMutationEnvelope): StoredMutationEnvelope {
  return typeof value === "string" ? JSON.parse(value) as StoredMutationEnvelope : value;
}

function mapCatalogError(value: unknown): never {
  if (!(value instanceof ObjectCatalogError)) throw value;
  const status = value.code === "OBJECT_NOT_FOUND" ? 404
    : value.code === "OBJECT_VALIDATION" ? 422
      : 409;
  throw error(value.code, value.message, status);
}

async function requireOperator(transaction: DatabaseTransaction, operatorId: string): Promise<void> {
  const rows = await transaction.query<Array<{ operator_id: bigint }>>(
    `SELECT operator.id operator_id FROM admin_operators operator
     JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
     JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
     WHERE operator.id=? AND operator.status='active' AND role.code IN ('manager','super_admin') LIMIT 1`,
    [operatorId],
  );
  if (rows[0] === undefined) {
    throw error("OBJECT_CATALOG_ADMIN_REQUIRED", "object catalog 관리 권한이 없습니다.", 403);
  }
}

async function readExistingSources(
  transaction: DatabaseTransaction,
  objectKey: string,
  objectType: ObjectType,
): Promise<ObjectSourceBindingInput[]> {
  return transaction.query<ObjectSourceBindingInput[]>(
    `SELECT source_system system,source_table \`table\`,source_key \`key\`
     FROM object_source_bindings source
     JOIN object_registry object ON object.id=source.object_id AND object.object_type=source.object_type
     WHERE object.object_key=? AND object.object_type=? ORDER BY source.id`,
    [objectKey, objectType],
  );
}

async function validateCanonicalSources(
  transaction: DatabaseTransaction,
  objectType: ObjectType,
  sources: readonly ObjectSourceBindingInput[],
): Promise<void> {
  if (sources.length === 0) {
    throw error("OBJECT_CATALOG_SOURCE_REQUIRED", "canonical source binding이 필요합니다.", 422);
  }
  const runtimeTarget = RUNTIME_TARGETS[objectType];
  for (const source of sources) {
    if (source.system === "LEGACY_JSON") {
      if (!LEGACY_JSON_TABLES[objectType].includes(source.table)) {
        throw error("OBJECT_CATALOG_SOURCE_DOMAIN_MISMATCH", "objectType과 legacy source binding이 일치하지 않습니다.", 422);
      }
      continue;
    }
    if (source.table !== runtimeTarget.table) {
      throw error("OBJECT_CATALOG_SOURCE_DOMAIN_MISMATCH", "objectType과 canonical DB target이 일치하지 않습니다.", 422);
    }
    const rows = await transaction.query<Array<{ present: number }>>(
      `SELECT 1 present FROM ${runtimeTarget.table} WHERE ${runtimeTarget.keyColumn}=? LIMIT 1`,
      [source.key],
    );
    if (rows[0] === undefined) {
      throw error("OBJECT_CATALOG_SOURCE_TARGET_NOT_FOUND", "canonical DB target을 찾을 수 없습니다.", 422);
    }
  }
}

function defaultCatalogFactory(transaction: DatabaseTransaction): CatalogWriter {
  const scoped = createScopedDatabaseClient(transaction);
  return new ObjectCatalogService(new MariaObjectCatalogRepository(scoped));
}

export class ObjectCatalogWebAdapterProvider {
  public constructor(
    private readonly database: DatabaseClient,
    private readonly createCatalog: CatalogFactory = defaultCatalogFactory,
  ) {}

  public async register(input: ObjectCatalogWebRegisterRequest): Promise<ObjectCatalogWebMutationResult> {
    return this.mutate(normalizeRegister(input));
  }

  public async update(input: ObjectCatalogWebUpdateRequest): Promise<ObjectCatalogWebMutationResult> {
    return this.mutate(normalizeUpdate(input));
  }

  public async setActive(input: ObjectCatalogWebSetActiveRequest): Promise<ObjectCatalogWebMutationResult> {
    return this.mutate(normalizeSetActive(input));
  }

  private async mutate(input: NormalizedMutation): Promise<ObjectCatalogWebMutationResult> {
    const requestKey = namespacedRequestKey(input);
    const fingerprint = payloadFingerprint(input);
    return this.database.withTransaction(async (transaction) => {
      await requireOperator(transaction, input.operatorId);
      const inserted = await transaction.execute(
        `INSERT IGNORE INTO operations
         (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,?,'processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), IDEMPOTENCY_SCOPE, requestKey, input.operatorId, OPERATION_SOURCE_CODE],
      );
      const operation = (await transaction.query<OperationRow[]>(
        "SELECT id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [IDEMPOTENCY_SCOPE, requestKey],
      ))[0];
      if (operation === undefined) throw new Error("OBJECT_CATALOG_WEB_OPERATION_NOT_FOUND");
      if (inserted.affectedRows === 0n) {
        if (operation.result_json === null) {
          throw error("OBJECT_CATALOG_IDEMPOTENCY_IN_PROGRESS", "같은 요청을 처리 중입니다.", 409);
        }
        const prior = storedEnvelope(operation.result_json);
        if (prior.payloadFingerprint !== fingerprint) {
          throw error("OBJECT_CATALOG_IDEMPOTENCY_CONFLICT", "같은 idempotency key에 다른 요청 payload를 사용할 수 없습니다.", 409);
        }
        return { ...prior.result, replayed: true };
      }

      const operationId = String(operation.id);
      const changeOperationId = `${IDEMPOTENCY_SCOPE}:${operationId}`;
      const catalog = this.createCatalog(transaction);
      let before: CatalogObject | null = null;
      let object: CatalogObject;
      try {
        if (input.action === "REGISTER") {
          await validateCanonicalSources(transaction, input.objectType, input.sourceBindings);
          object = await catalog.register({
            operationId: changeOperationId,
            objectKey: input.objectKey,
            objectType: input.objectType,
            displayName: input.displayName,
            active: input.active,
            metadata: input.metadata,
            aliases: input.aliases,
            sourceBindings: input.sourceBindings,
          });
        } else {
          before = await catalog.getByKey(input.objectKey, true);
          if (before.objectType !== input.objectType) {
            throw error("OBJECT_CATALOG_SOURCE_DOMAIN_MISMATCH", "objectKey와 objectType이 일치하지 않습니다.", 422);
          }
          const sources = input.action === "UPDATE" && input.sourceBindings !== undefined
            ? input.sourceBindings
            : await readExistingSources(transaction, input.objectKey, input.objectType);
          await validateCanonicalSources(transaction, input.objectType, sources);
          if (input.action === "SET_ACTIVE" && before.active === input.active) {
            throw error("OBJECT_CATALOG_ACTIVE_STATE_UNCHANGED", "object active 상태가 이미 요청 값과 같습니다.", 409);
          }
          object = await catalog.update(input.action === "UPDATE" ? {
            operationId: changeOperationId,
            objectKey: input.objectKey,
            expectedVersion: input.expectedVersion,
            displayName: input.displayName,
            active: input.active,
            metadata: input.metadata,
            aliases: input.aliases,
            sourceBindings: input.sourceBindings,
          } : {
            operationId: changeOperationId,
            objectKey: input.objectKey,
            expectedVersion: input.expectedVersion,
            displayName: before.displayName,
            active: input.active,
            metadata: before.metadata,
          });
        }
      } catch (value) {
        mapCatalogError(value);
      }

      const status = input.action === "REGISTER" ? "registered"
        : input.action === "UPDATE" ? "updated"
          : input.active ? "activated" : "deactivated";
      const actionCode = `object.catalog.web.${input.action.toLowerCase()}`;
      const changeSummary = {
        source: input.source,
        objectKey: object.objectKey,
        objectType: object.objectType,
        before,
        after: object,
      };
      const audit = await transaction.execute(
        `INSERT INTO command_audit
         (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'object_catalog_object',?,?, 'success',?,?,UTC_TIMESTAMP(3))`,
        [operation.id, input.operatorId, object.definitionId, actionCode, input.reason, JSON.stringify(changeSummary)],
      );
      const result: ObjectCatalogWebMutationResult = {
        status,
        replayed: false,
        object,
        operationId,
        auditId: audit.insertId.toString(),
      };
      await transaction.execute(
        `INSERT INTO outbox_messages
         (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'internal',?,'object_catalog.changed',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.id, object.objectKey, JSON.stringify({ source: input.source, reason: input.reason, result })],
      );
      const envelope: StoredMutationEnvelope = { payloadFingerprint: fingerprint, result };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(envelope), operation.id],
      );
      return result;
    });
  }
}
