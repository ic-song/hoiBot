import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import {
  ObjectCatalogError,
  type CatalogObject,
  type RegisterCatalogObjectInput,
  type UpdateCatalogObjectInput,
} from "../src/catalog/object-catalog.js";
import { ObjectCatalogWebAdapterProvider } from "../src/catalog/object-catalog-web-adapter-provider.js";

interface FakeState {
  authorized: boolean;
  targetExists: boolean;
  nextOperationId: bigint;
  operations: Map<string, { id: bigint; result: string | null }>;
  sql: string[];
  outboxes: number;
}

// operation replay와 원자 SQL을 기록하는 최소 provider DB를 생성합니다.
function fakeDatabase(overrides: Partial<FakeState> = {}): { database: DatabaseClient; state: FakeState } {
  const state: FakeState = {
    authorized: true,
    targetExists: true,
    nextOperationId: 1n,
    operations: new Map(),
    sql: [],
    outboxes: 0,
    ...overrides,
  };
  const transaction: DatabaseTransaction = {
    query: async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
      state.sql.push(sql);
      if (sql.includes("role.code IN")) return (state.authorized ? [{ operator_id: 1n }] : []) as T;
      if (sql.startsWith("SELECT id,result_json FROM operations")) {
        const value = state.operations.get(String(values[1]));
        return (value === undefined ? [] : [{ id: value.id, result_json: value.result }]) as T;
      }
      if (sql.startsWith("SELECT 1 present FROM")) return (state.targetExists ? [{ present: 1 }] : []) as T;
      if (sql.includes("FROM object_source_bindings")) {
        return [{ system: "RUNTIME_DB", table: "currency_definitions", key: "credit" }] as T;
      }
      return [] as T;
    },
    execute: async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
      state.sql.push(sql);
      if (sql.startsWith("INSERT IGNORE INTO operations")) {
        const key = String(values[2]);
        if (state.operations.has(key)) return { affectedRows: 0n, insertId: 0n };
        const id = state.nextOperationId++;
        state.operations.set(key, { id, result: null });
        return { affectedRows: 1n, insertId: id };
      }
      if (sql.startsWith("INSERT INTO command_audit")) return { affectedRows: 1n, insertId: 71n };
      if (sql.startsWith("INSERT INTO outbox_messages")) {
        state.outboxes += 1;
        return { affectedRows: 1n, insertId: 81n };
      }
      if (sql.startsWith("UPDATE operations SET")) {
        const id = BigInt(String(values[1]));
        const operation = [...state.operations.values()].find((value) => value.id === id)!;
        operation.result = String(values[0]);
      }
      return { affectedRows: 1n, insertId: 0n };
    },
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: transaction.query,
    execute: transaction.execute,
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined,
  };
  return { database, state };
}

// provider가 호출하는 기존 ObjectCatalogService 경계를 메모리로 대체합니다.
function fakeCatalog(initial: CatalogObject | null = null) {
  let object = initial;
  let registerCalls = 0;
  return {
    factory: () => ({
      register: async (input: RegisterCatalogObjectInput) => {
        registerCalls += 1;
        object = {
          definitionId: "9007199254740993",
          objectKey: input.objectKey,
          objectType: input.objectType,
          displayName: input.displayName,
          version: "1",
          active: input.active ?? true,
          metadata: input.metadata ?? {},
        };
        return object;
      },
      update: async (input: UpdateCatalogObjectInput) => {
        if (object === null) throw new ObjectCatalogError("OBJECT_NOT_FOUND", "not found");
        if (object.version !== input.expectedVersion) throw new ObjectCatalogError("OBJECT_VERSION_CONFLICT", "version conflict");
        object = { ...object, displayName: input.displayName, active: input.active, metadata: input.metadata ?? {}, version: (BigInt(object.version) + 1n).toString() };
        return object;
      },
      getByKey: async () => {
        if (object === null) throw new ObjectCatalogError("OBJECT_NOT_FOUND", "not found");
        return object;
      },
    }),
    registerCalls: () => registerCalls,
  };
}

const base = {
  source: "lease2373-web",
  operatorId: "9800002373",
  idempotencyKey: "register-credit",
  reason: "Lease2373 synthetic register",
  objectKey: "currency.credit",
  objectType: "CURRENCY" as const,
  displayName: "합성 크레딧",
  sourceBindings: [{ system: "RUNTIME_DB" as const, table: "currency_definitions", key: "credit" }],
};

describe("object catalog web adapter provider", () => {
  it("registers through the existing catalog boundary and commits audit/outbox metadata", async () => {
    const { database, state } = fakeDatabase();
    const catalog = fakeCatalog();
    const result = await new ObjectCatalogWebAdapterProvider(database, catalog.factory).register(base);
    assert.equal(result.status, "registered");
    assert.equal(result.object.definitionId, "9007199254740993");
    assert.equal(result.object.version, "1");
    assert.equal(result.auditId, "71");
    assert.equal(state.outboxes, 1);
    assert.equal(state.sql.some((sql) => sql.includes("currency_definitions")), true);
    assert.equal(state.sql.some((sql) => sql.startsWith("INSERT INTO command_audit")), true);
  });

  it("returns exact replay and rejects a different payload on the same namespaced key", async () => {
    const { database } = fakeDatabase();
    const catalog = fakeCatalog();
    const provider = new ObjectCatalogWebAdapterProvider(database, catalog.factory);
    const first = await provider.register(base);
    const replay = await provider.register(base);
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.operationId, first.operationId);
    assert.equal(catalog.registerCalls(), 1);
    await assert.rejects(
      () => provider.register({ ...base, displayName: "다른 크레딧" }),
      (value: unknown) => value instanceof ApplicationError && value.code === "OBJECT_CATALOG_IDEMPOTENCY_CONFLICT" && value.statusCode === 409,
    );
  });

  it("rechecks manager/super_admin authorization before creating an operation", async () => {
    const { database, state } = fakeDatabase({ authorized: false });
    await assert.rejects(
      () => new ObjectCatalogWebAdapterProvider(database, fakeCatalog().factory).register(base),
      (value: unknown) => value instanceof ApplicationError && value.code === "OBJECT_CATALOG_ADMIN_REQUIRED" && value.statusCode === 403,
    );
    assert.equal(state.operations.size, 0);
  });

  it("rejects cross-domain runtime bindings and missing canonical targets", async () => {
    const first = fakeDatabase();
    await assert.rejects(
      () => new ObjectCatalogWebAdapterProvider(first.database, fakeCatalog().factory).register({
        ...base,
        sourceBindings: [{ system: "RUNTIME_DB", table: "item_definitions", key: "credit" }],
      }),
      (value: unknown) => value instanceof ApplicationError && value.code === "OBJECT_CATALOG_SOURCE_DOMAIN_MISMATCH",
    );
    const second = fakeDatabase({ targetExists: false });
    await assert.rejects(
      () => new ObjectCatalogWebAdapterProvider(second.database, fakeCatalog().factory).register(base),
      (value: unknown) => value instanceof ApplicationError && value.code === "OBJECT_CATALOG_SOURCE_TARGET_NOT_FOUND",
    );
  });

  it("preserves stable objectKey while updating with decimal-string expectedVersion", async () => {
    const existing: CatalogObject = {
      definitionId: "18446744073709551615",
      objectKey: base.objectKey,
      objectType: base.objectType,
      displayName: base.displayName,
      version: "9007199254740993",
      active: true,
      metadata: {},
    };
    const { database } = fakeDatabase();
    const result = await new ObjectCatalogWebAdapterProvider(database, fakeCatalog(existing).factory).update({
      ...base,
      idempotencyKey: "update-credit",
      expectedVersion: existing.version,
      displayName: "수정 크레딧",
      active: true,
    });
    assert.equal(result.status, "updated");
    assert.equal(result.object.objectKey, base.objectKey);
    assert.equal(result.object.version, "9007199254740994");
  });

  it("exposes only the core soft active update and rejects unchanged state", async () => {
    const existing: CatalogObject = {
      definitionId: "1",
      objectKey: base.objectKey,
      objectType: base.objectType,
      displayName: base.displayName,
      version: "4",
      active: true,
      metadata: {},
    };
    const first = fakeDatabase();
    const result = await new ObjectCatalogWebAdapterProvider(first.database, fakeCatalog(existing).factory).setActive({
      source: base.source,
      operatorId: base.operatorId,
      idempotencyKey: "disable-credit",
      reason: "Lease2373 synthetic disable",
      objectKey: base.objectKey,
      objectType: base.objectType,
      expectedVersion: "4",
      active: false,
    });
    assert.equal(result.status, "deactivated");
    assert.equal(result.object.active, false);
    const second = fakeDatabase();
    await assert.rejects(() => new ObjectCatalogWebAdapterProvider(second.database, fakeCatalog(existing).factory).setActive({
      source: base.source,
      operatorId: base.operatorId,
      idempotencyKey: "same-active-credit",
      reason: "Lease2373 unchanged active",
      objectKey: base.objectKey,
      objectType: base.objectType,
      expectedVersion: "4",
      active: true,
    }), (value: unknown) => value instanceof ApplicationError && value.code === "OBJECT_CATALOG_ACTIVE_STATE_UNCHANGED");
  });
});
