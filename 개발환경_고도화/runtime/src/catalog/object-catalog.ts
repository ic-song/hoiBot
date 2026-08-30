export const OBJECT_TYPES = [
  "ITEM", "PET", "FURNITURE", "TITLE", "PET_TITLE", "PACKAGE", "CURRENCY", "SKILL", "HOME_BUILDING"
] as const;

export type ObjectType = typeof OBJECT_TYPES[number];
export type ObjectAliasType = "display_name" | "legacy_name" | "legacy_code" | "command_name";

export interface ObjectAliasInput {
  type: ObjectAliasType;
  value: string;
}

export interface ObjectSourceBindingInput {
  system: "LEGACY_JSON" | "LEGACY_DB" | "RUNTIME_DB";
  table: string;
  key: string;
}

export interface CatalogObject {
  definitionId: string;
  objectKey: string;
  objectType: ObjectType;
  displayName: string;
  version: string;
  active: boolean;
  metadata: Record<string, unknown>;
}

export interface RegisterCatalogObjectInput {
  operationId: string;
  objectKey: string;
  objectType: ObjectType;
  displayName: string;
  active?: boolean;
  metadata?: Record<string, unknown>;
  aliases?: ObjectAliasInput[];
  sourceBindings?: ObjectSourceBindingInput[];
}

export interface UpdateCatalogObjectInput {
  operationId: string;
  objectKey: string;
  expectedVersion: string;
  displayName: string;
  active: boolean;
  metadata?: Record<string, unknown>;
  aliases?: ObjectAliasInput[];
  sourceBindings?: ObjectSourceBindingInput[];
}

export interface ObjectCatalogRepository {
  register(input: RegisterCatalogObjectInput): Promise<CatalogObject>;
  update(input: UpdateCatalogObjectInput): Promise<CatalogObject>;
  findByKey(objectKey: string, includeInactive?: boolean): Promise<CatalogObject | null>;
  findByAlias(objectType: ObjectType, aliasType: ObjectAliasType, aliasValue: string, includeInactive?: boolean): Promise<CatalogObject | null>;
  findBySource(binding: ObjectSourceBindingInput, includeInactive?: boolean): Promise<CatalogObject | null>;
}

export class ObjectCatalogError extends Error {
  constructor(
    public readonly code: "OBJECT_VALIDATION" | "OBJECT_CONFLICT" | "OBJECT_NOT_FOUND" | "OBJECT_VERSION_CONFLICT",
    message: string
  ) {
    super(message);
    this.name = "ObjectCatalogError";
  }
}

const OBJECT_KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;
const SOURCE_TABLE_PATTERN = /^[A-Za-z0-9._-]{1,191}$/;

// seq나 표시명이 object KEY로 들어오지 않도록 namespace.key 형식을 검증합니다.
function validateObjectKey(objectKey: string): void {
  if (!OBJECT_KEY_PATTERN.test(objectKey) || objectKey.length > 191) {
    throw new ObjectCatalogError("OBJECT_VALIDATION", "object_key는 namespace.key 형식의 소문자 ASCII여야 합니다.");
  }
}

// 등록 시 object type과 KEY namespace가 일치하는지 검증합니다.
function validateIdentity(objectKey: string, objectType: ObjectType): void {
  validateObjectKey(objectKey);
  if (!OBJECT_TYPES.includes(objectType)) {
    throw new ObjectCatalogError("OBJECT_VALIDATION", "지원하지 않는 object_type입니다.");
  }
  if (!objectKey.startsWith(objectType.toLowerCase() + ".")) {
    throw new ObjectCatalogError("OBJECT_VALIDATION", "object_key namespace와 object_type이 일치하지 않습니다.");
  }
}

// operation ID와 사용자 표시값의 저장 가능 범위를 검증합니다.
function validateCommon(operationId: string, displayName: string): void {
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    throw new ObjectCatalogError("OBJECT_VALIDATION", "operation_id 형식이 올바르지 않습니다.");
  }
  if (displayName.trim() === "" || displayName.length > 191) {
    throw new ObjectCatalogError("OBJECT_VALIDATION", "display_name이 비어 있거나 너무 깁니다.");
  }
}

// 별칭과 원본 연결을 한 요청 안에서 중복 없이 검증합니다.
function validateReferences(aliases: ObjectAliasInput[], sources: ObjectSourceBindingInput[]): void {
  const aliasKeys = new Set<string>();
  for (const alias of aliases) {
    if (alias.value === "" || alias.value.length > 191) {
      throw new ObjectCatalogError("OBJECT_VALIDATION", "alias_value가 비어 있거나 너무 깁니다.");
    }
    const key = alias.type + "|" + alias.value;
    if (aliasKeys.has(key)) throw new ObjectCatalogError("OBJECT_CONFLICT", "요청 안에 중복 별칭이 있습니다.");
    aliasKeys.add(key);
  }
  const sourceKeys = new Set<string>();
  for (const source of sources) {
    if (!SOURCE_TABLE_PATTERN.test(source.table) || source.key === "" || source.key.length > 191) {
      throw new ObjectCatalogError("OBJECT_VALIDATION", "원본 연결 정보가 올바르지 않습니다.");
    }
    const key = source.system + "|" + source.table + "|" + source.key;
    if (sourceKeys.has(key)) throw new ObjectCatalogError("OBJECT_CONFLICT", "요청 안에 중복 원본 연결이 있습니다.");
    sourceKeys.add(key);
  }
}

export class ObjectCatalogService {
  constructor(private readonly repository: ObjectCatalogRepository) {}

  async register(input: RegisterCatalogObjectInput): Promise<CatalogObject> {
    validateIdentity(input.objectKey, input.objectType);
    validateCommon(input.operationId, input.displayName);
    validateReferences(input.aliases ?? [], input.sourceBindings ?? []);
    return this.repository.register({
      ...input,
      displayName: input.displayName.trim(),
      active: input.active ?? true,
      metadata: input.metadata ?? {},
      aliases: input.aliases ?? [],
      sourceBindings: input.sourceBindings ?? []
    });
  }

  async update(input: UpdateCatalogObjectInput): Promise<CatalogObject> {
    if (!/^[1-9][0-9]*$/.test(input.expectedVersion)) {
      throw new ObjectCatalogError("OBJECT_VALIDATION", "expected_version이 올바르지 않습니다.");
    }
    validateObjectKey(input.objectKey);
    validateCommon(input.operationId, input.displayName);
    validateReferences(input.aliases ?? [], input.sourceBindings ?? []);
    return this.repository.update({ ...input, displayName: input.displayName.trim(), metadata: input.metadata ?? {} });
  }

  async getByKey(objectKey: string, includeInactive = false): Promise<CatalogObject> {
    validateObjectKey(objectKey);
    const value = await this.repository.findByKey(objectKey, includeInactive);
    if (value === null) throw new ObjectCatalogError("OBJECT_NOT_FOUND", "object_key를 찾을 수 없습니다.");
    return value;
  }

  async getByAlias(
    objectType: ObjectType,
    aliasType: ObjectAliasType,
    aliasValue: string,
    includeInactive = false
  ): Promise<CatalogObject> {
    if (!OBJECT_TYPES.includes(objectType)) {
      throw new ObjectCatalogError("OBJECT_VALIDATION", "지원하지 않는 object_type입니다.");
    }
    if (aliasValue === "") throw new ObjectCatalogError("OBJECT_VALIDATION", "alias_value가 비어 있습니다.");
    const value = await this.repository.findByAlias(objectType, aliasType, aliasValue, includeInactive);
    if (value === null) throw new ObjectCatalogError("OBJECT_NOT_FOUND", "별칭에 연결된 object를 찾을 수 없습니다.");
    return value;
  }

  async getBySource(binding: ObjectSourceBindingInput, includeInactive = false): Promise<CatalogObject> {
    validateReferences([], [binding]);
    const value = await this.repository.findBySource(binding, includeInactive);
    if (value === null) throw new ObjectCatalogError("OBJECT_NOT_FOUND", "원본에 연결된 object를 찾을 수 없습니다.");
    return value;
  }
}
