import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import {
  ObjectCatalogError,
  type CatalogObject,
  type ObjectAliasInput,
  type ObjectAliasType,
  type ObjectCatalogRepository,
  type ObjectSourceBindingInput,
  type ObjectType,
  type RegisterCatalogObjectInput,
  type UpdateCatalogObjectInput
} from "./object-catalog.js";

interface ObjectRow {
  id: bigint;
  object_key: string;
  object_type: ObjectType;
  display_name: string;
  version: bigint;
  active: number;
  metadata_json: string | Record<string, unknown>;
}

type QueryExecutor = Pick<DatabaseClient, "query"> | Pick<DatabaseTransaction, "query">;

const OBJECT_SELECT =
  "SELECT r.id, r.object_key, r.object_type, r.display_name, r.version, r.active, r.metadata_json FROM object_registry r";

// MariaDB JSON 값을 API 객체로 안전하게 변환합니다.
function parseMetadata(value: string | Record<string, unknown>): Record<string, unknown> {
  return typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value;
}

// DB object row를 공통 정의 참조 모델로 변환합니다.
function mapObject(row: ObjectRow): CatalogObject {
  return {
    definitionId: row.id.toString(),
    objectKey: row.object_key,
    objectType: row.object_type,
    displayName: row.display_name,
    version: row.version.toString(),
    active: Boolean(row.active),
    metadata: parseMetadata(row.metadata_json)
  };
}

// transaction 또는 client에서 object ID 한 건을 읽습니다.
async function findById(executor: QueryExecutor, objectId: bigint): Promise<CatalogObject | null> {
  const rows = await executor.query<ObjectRow[]>(OBJECT_SELECT + " WHERE id = ?", [objectId]);
  return rows[0] === undefined ? null : mapObject(rows[0]);
}

// operation replay 결과를 읽어 중복 요청을 동일 결과로 반환합니다.
async function findReplay(executor: QueryExecutor, operationId: string): Promise<CatalogObject | null> {
  const rows = await executor.query<Array<{ object_id: bigint }>>(
    "SELECT object_id FROM object_catalog_change_log WHERE operation_id = ?",
    [operationId]
  );
  return rows[0] === undefined ? null : findById(executor, rows[0].object_id);
}

// object의 typed alias를 transaction 안에서 교체합니다.
async function replaceAliases(
  transaction: DatabaseTransaction,
  objectId: bigint,
  objectType: ObjectType,
  aliases: ObjectAliasInput[]
): Promise<void> {
  await transaction.execute("DELETE FROM object_aliases WHERE object_id = ?", [objectId]);
  for (const alias of aliases) {
    await transaction.execute(
      "INSERT INTO object_aliases (object_id, object_type, alias_type, alias_value) VALUES (?, ?, ?, ?)",
      [objectId, objectType, alias.type, alias.value]
    );
  }
}

// object의 legacy/runtime source binding을 transaction 안에서 교체합니다.
async function replaceSources(
  transaction: DatabaseTransaction,
  objectId: bigint,
  objectType: ObjectType,
  sources: ObjectSourceBindingInput[]
): Promise<void> {
  await transaction.execute("DELETE FROM object_source_bindings WHERE object_id = ?", [objectId]);
  for (const source of sources) {
    await transaction.execute(
      "INSERT INTO object_source_bindings (object_id, object_type, source_system, source_table, source_key) VALUES (?, ?, ?, ?, ?)",
      [objectId, objectType, source.system, source.table, source.key]
    );
  }
}

export class MariaObjectCatalogRepository implements ObjectCatalogRepository {
  constructor(private readonly database: DatabaseClient) {}

  async register(input: RegisterCatalogObjectInput): Promise<CatalogObject> {
    return this.database.withTransaction(async (transaction) => {
      const replay = await findReplay(transaction, input.operationId);
      if (replay !== null) return replay;
      const write = await transaction.execute(
        "INSERT INTO object_registry (object_key, object_type, display_name, active, metadata_json) VALUES (?, ?, ?, ?, ?)",
        [input.objectKey, input.objectType, input.displayName, input.active ?? true, JSON.stringify(input.metadata ?? {})]
      );
      await replaceAliases(transaction, write.insertId, input.objectType, input.aliases ?? []);
      await replaceSources(transaction, write.insertId, input.objectType, input.sourceBindings ?? []);
      const created = await findById(transaction, write.insertId);
      if (created === null) throw new Error("등록한 object를 다시 읽지 못했습니다.");
      await transaction.execute(
        "INSERT INTO object_catalog_change_log " +
        "(operation_id, object_id, action_code, expected_version, result_version, before_json, after_json) " +
        "VALUES (?, ?, 'REGISTER', NULL, ?, NULL, ?)",
        [input.operationId, write.insertId, created.version, JSON.stringify(created)]
      );
      return created;
    });
  }

  async update(input: UpdateCatalogObjectInput): Promise<CatalogObject> {
    return this.database.withTransaction(async (transaction) => {
      const replay = await findReplay(transaction, input.operationId);
      if (replay !== null) return replay;
      const rows = await transaction.query<ObjectRow[]>(
        OBJECT_SELECT + " WHERE object_key = ? FOR UPDATE",
        [input.objectKey]
      );
      const current = rows[0];
      if (current === undefined) throw new ObjectCatalogError("OBJECT_NOT_FOUND", "object_key를 찾을 수 없습니다.");
      if (current.version.toString() !== input.expectedVersion) {
        throw new ObjectCatalogError("OBJECT_VERSION_CONFLICT", "object version이 변경되었습니다.");
      }
      const write = await transaction.execute(
        "UPDATE object_registry SET display_name = ?, active = ?, metadata_json = ?, " +
        "version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND version = ?",
        [input.displayName, input.active, JSON.stringify(input.metadata ?? {}), current.id, current.version]
      );
      if (write.affectedRows !== 1n) {
        throw new ObjectCatalogError("OBJECT_VERSION_CONFLICT", "object version이 변경되었습니다.");
      }
      if (input.aliases !== undefined) {
        await replaceAliases(transaction, current.id, current.object_type, input.aliases);
      }
      if (input.sourceBindings !== undefined) {
        await replaceSources(transaction, current.id, current.object_type, input.sourceBindings);
      }
      const updated = await findById(transaction, current.id);
      if (updated === null) throw new Error("수정한 object를 다시 읽지 못했습니다.");
      await transaction.execute(
        "INSERT INTO object_catalog_change_log " +
        "(operation_id, object_id, action_code, expected_version, result_version, before_json, after_json) " +
        "VALUES (?, ?, 'UPDATE', ?, ?, ?, ?)",
        [
          input.operationId,
          current.id,
          current.version,
          updated.version,
          JSON.stringify(mapObject(current)),
          JSON.stringify(updated)
        ]
      );
      return updated;
    });
  }

  async findByKey(objectKey: string, includeInactive = false): Promise<CatalogObject | null> {
    const rows = await this.database.query<ObjectRow[]>(
      OBJECT_SELECT + " WHERE object_key = ?" + (includeInactive ? "" : " AND active = TRUE"),
      [objectKey]
    );
    return rows[0] === undefined ? null : mapObject(rows[0]);
  }

  async findByAlias(
    objectType: ObjectType,
    aliasType: ObjectAliasType,
    aliasValue: string,
    includeInactive = false
  ): Promise<CatalogObject | null> {
    const rows = await this.database.query<ObjectRow[]>(
      OBJECT_SELECT +
      " JOIN object_aliases a ON a.object_id = r.id AND a.object_type = r.object_type " +
      "WHERE a.object_type = ? AND a.alias_type = ? AND a.alias_value = ?" +
      (includeInactive ? "" : " AND r.active = TRUE"),
      [objectType, aliasType, aliasValue]
    );
    return rows[0] === undefined ? null : mapObject(rows[0]);
  }

  async findBySource(binding: ObjectSourceBindingInput, includeInactive = false): Promise<CatalogObject | null> {
    const rows = await this.database.query<ObjectRow[]>(
      OBJECT_SELECT +
      " JOIN object_source_bindings s ON s.object_id = r.id AND s.object_type = r.object_type " +
      "WHERE s.source_system = ? AND s.source_table = ? AND s.source_key = ?" +
      (includeInactive ? "" : " AND r.active = TRUE"),
      [binding.system, binding.table, binding.key]
    );
    return rows[0] === undefined ? null : mapObject(rows[0]);
  }
}
