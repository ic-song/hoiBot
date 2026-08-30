import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import {
  ObjectCatalogError,
  ObjectCatalogService,
  type CatalogObject,
  type ObjectAliasType,
  type ObjectCatalogRepository,
  type ObjectSourceBindingInput,
  type ObjectType
} from "../src/catalog/object-catalog.js";
import { MariaObjectCatalogRepository } from "../src/catalog/maria-object-catalog-repository.js";

const base: CatalogObject = {
  definitionId: "1",
  objectKey: "item.test_potion",
  objectType: "ITEM",
  displayName: "테스트 물약",
  version: "1",
  active: true,
  metadata: {}
};

// Service 검증에 필요한 최소 in-memory repository를 생성합니다.
function memoryRepository(): ObjectCatalogRepository {
  return {
    register: async (input) => ({
      ...base,
      objectKey: input.objectKey,
      objectType: input.objectType,
      displayName: input.displayName
    }),
    update: async (input) => ({
      ...base,
      objectKey: input.objectKey,
      displayName: input.displayName,
      active: input.active,
      version: "2"
    }),
    findByKey: async (key, includeInactive) =>
      key === base.objectKey && (base.active || includeInactive === true) ? base : null,
    findByAlias: async (type: ObjectType, aliasType: ObjectAliasType, value: string) =>
      type === "ITEM" && aliasType === "legacy_name" && value === "물약" ? base : null,
    findBySource: async (source: ObjectSourceBindingInput) =>
      source.system === "LEGACY_JSON" && source.table === "itemInfo" && source.key === "물약" ? base : null
  };
}

// Maria repository가 실행한 SQL과 transaction 경계를 기록합니다.
function scriptedDatabase(queryResults: unknown[], insertIds: bigint[] = [1n]) {
  const queued = [...queryResults];
  const ids = [...insertIds];
  const sql: string[] = [];
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      return (queued.shift() ?? []) as T;
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement);
      return { affectedRows: 1n, insertId: ids.shift() ?? 0n };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: transaction.query,
    execute: transaction.execute,
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
  return { database, sql };
}

describe("common object catalog", () => {
  it("accepts all ten definition types behind immutable object keys", async () => {
    const service = new ObjectCatalogService(memoryRepository());
    for (const objectType of ["ITEM", "PET", "FURNITURE", "TITLE", "PET_TITLE", "PACKAGE", "CURRENCY", "SKILL", "HOME_BUILDING", "MINI_PET"] as const) {
      const result = await service.register({
        operationId: "register:" + objectType,
        objectKey: objectType.toLowerCase() + ".test",
        objectType,
        displayName: objectType
      });
      assert.equal(result.objectType, objectType);
    }
  });

  it("rejects display names or unstable values as object keys", async () => {
    const service = new ObjectCatalogService(memoryRepository());
    for (const objectKey of ["테스트물약", "ITEM.TEST", "1", "item..test"]) {
      await assert.rejects(
        service.register({ operationId: "invalid:key", objectKey, objectType: "ITEM", displayName: "테스트" }),
        (error: unknown) => error instanceof ObjectCatalogError && error.code === "OBJECT_VALIDATION"
      );
    }
  });

  it("rejects duplicate typed aliases before database work", async () => {
    const service = new ObjectCatalogService(memoryRepository());
    await assert.rejects(
      service.register({
        operationId: "duplicate:alias",
        objectKey: "item.test",
        objectType: "ITEM",
        displayName: "테스트",
        aliases: [
          { type: "legacy_name", value: "테스트" },
          { type: "legacy_name", value: "테스트" }
        ]
      }),
      (error: unknown) => error instanceof ObjectCatalogError && error.code === "OBJECT_CONFLICT"
    );
  });

  it("resolves alias and source only with their explicit namespace", async () => {
    const service = new ObjectCatalogService(memoryRepository());
    assert.equal((await service.getByAlias("ITEM", "legacy_name", "물약")).objectKey, base.objectKey);
    assert.equal(
      (await service.getBySource({ system: "LEGACY_JSON", table: "itemInfo", key: "물약" })).objectKey,
      base.objectKey
    );
    await assert.rejects(service.getByAlias("PET", "legacy_name", "물약"), /찾을 수 없습니다/);
  });

  it("registers registry, aliases, source bindings and audit in one transaction", async () => {
    const row = {
      id: 7n,
      object_key: "item.test_potion",
      object_type: "ITEM",
      display_name: "테스트 물약",
      version: 1n,
      active: 1,
      metadata_json: "{}"
    };
    const scripted = scriptedDatabase([[], [row]], [7n]);
    const repository = new MariaObjectCatalogRepository(scripted.database);
    const result = await repository.register({
      operationId: "register:item.test_potion",
      objectKey: "item.test_potion",
      objectType: "ITEM",
      displayName: "테스트 물약",
      aliases: [{ type: "legacy_name", value: "물약" }],
      sourceBindings: [{ system: "LEGACY_JSON", table: "itemInfo", key: "물약" }]
    });
    assert.equal(result.definitionId, "7");
    assert.ok(scripted.sql.some((statement) => statement.includes("INSERT INTO object_registry")));
    assert.ok(scripted.sql.some((statement) => statement.includes("INSERT INTO object_aliases")));
    assert.ok(scripted.sql.some((statement) => statement.includes("INSERT INTO object_source_bindings")));
    assert.ok(scripted.sql.some((statement) => statement.includes("INSERT INTO object_catalog_change_log")));
  });

  it("returns an idempotent operation replay without a second object", async () => {
    const row = {
      id: 7n,
      object_key: "item.test_potion",
      object_type: "ITEM",
      display_name: "테스트 물약",
      version: 1n,
      active: 1,
      metadata_json: "{}"
    };
    const scripted = scriptedDatabase([[{ object_id: 7n }], [row]]);
    const repository = new MariaObjectCatalogRepository(scripted.database);
    await repository.register({
      operationId: "register:item.test_potion",
      objectKey: "item.test_potion",
      objectType: "ITEM",
      displayName: "테스트 물약"
    });
    assert.equal(scripted.sql.some((statement) => statement.includes("INSERT INTO object_registry")), false);
  });

  it("rejects stale expected versions before mutation", async () => {
    const row = {
      id: 7n,
      object_key: "item.test_potion",
      object_type: "ITEM",
      display_name: "테스트 물약",
      version: 2n,
      active: 1,
      metadata_json: "{}"
    };
    const scripted = scriptedDatabase([[], [row]]);
    const repository = new MariaObjectCatalogRepository(scripted.database);
    await assert.rejects(
      repository.update({
        operationId: "update:item.test_potion:1",
        objectKey: "item.test_potion",
        expectedVersion: "1",
        displayName: "새 이름",
        active: true
      }),
      (error: unknown) => error instanceof ObjectCatalogError && error.code === "OBJECT_VERSION_CONFLICT"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("UPDATE object_registry")), false);
  });

  it("keeps inactive objects hidden unless explicitly requested", async () => {
    const inactive = { ...base, active: false };
    const repository: ObjectCatalogRepository = {
      ...memoryRepository(),
      findByKey: async (_key, includeInactive) => includeInactive === true ? inactive : null
    };
    const service = new ObjectCatalogService(repository);
    await assert.rejects(service.getByKey(base.objectKey), /찾을 수 없습니다/);
    assert.equal((await service.getByKey(base.objectKey, true)).active, false);
  });
});
