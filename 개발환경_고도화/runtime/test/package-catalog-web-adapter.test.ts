import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { MariaPackageCatalogAdminRepository, MariaPackageCatalogWebAdapterRepository } from "../src/package/mariadb-package-catalog-admin.js";
import {
  PackageCatalogWebAdapter,
  type PackageCatalogWebAdapterRepository,
  type PackageCatalogWebMutationInput,
  type PackageCatalogWebMutationRequest,
} from "../src/package/package-catalog-web-adapter.js";

class RecordingWebRepository implements PackageCatalogWebAdapterRepository {
  public readonly requests: PackageCatalogWebMutationRequest[] = [];

  public async mutateForOperator(request: PackageCatalogWebMutationRequest) {
    this.requests.push(request);
    return {
      replayed: false,
      catalogVersion: request.expectedCatalogVersion + 1n,
      packageId: request.mutation.action === "ADD" ? "PKG-CUSTOM-000008" : request.mutation.packageId,
      message: "처리되었습니다.",
    };
  }
}

const base = {
  actorOperatorId: "900000010",
  sourceCode: "admin_web",
  idempotencyKey: "request-1",
  expectedCatalogVersion: 7n,
  reason: "운영 요청 반영",
} as const;

describe("package catalog web adapter", () => {
  it("creates a deterministic source/operator namespace and stable package request", async () => {
    const repository = new RecordingWebRepository();
    const adapter = new PackageCatalogWebAdapter(repository);
    const mutation = { action: "EDIT" as const, packageId: "PKG-SYNTH-002", rewards: [{ rewardType: "ITEM" as const, assetCode: "합성보상", quantity: 3n }] };
    await adapter.mutate({ ...base, mutation });
    await adapter.mutate({ ...base, mutation });
    assert.match(repository.requests[0]!.requestKey, /^web:admin_web:900000010:sha256:[a-f0-9]{64}$/);
    assert.equal(repository.requests[0]!.requestKey, repository.requests[1]!.requestKey);
    assert.equal(repository.requests[0]!.payloadFingerprint, repository.requests[1]!.payloadFingerprint);
    assert.equal(repository.requests[0]!.mutation.action === "EDIT" ? repository.requests[0]!.mutation.packageId : "", "PKG-SYNTH-002");
  });

  it("keeps the raw key namespace but changes the fingerprint for a different payload", async () => {
    const repository = new RecordingWebRepository();
    const adapter = new PackageCatalogWebAdapter(repository);
    await adapter.mutate({ ...base, mutation: { action: "ENABLE", packageId: "PKG-SYNTH-002" } });
    await adapter.mutate({ ...base, mutation: { action: "REMOVE", packageId: "PKG-SYNTH-002" } });
    assert.equal(repository.requests[0]!.requestKey, repository.requests[1]!.requestKey);
    assert.notEqual(repository.requests[0]!.payloadFingerprint, repository.requests[1]!.payloadFingerprint);
  });

  it("separates the same raw idempotency key by operator", async () => {
    const repository = new RecordingWebRepository();
    const adapter = new PackageCatalogWebAdapter(repository);
    const mutation = { action: "ENABLE" as const, packageId: "PKG-SYNTH-002" };
    await adapter.mutate({ ...base, mutation });
    await adapter.mutate({ ...base, actorOperatorId: "900000012", mutation });
    assert.notEqual(repository.requests[0]!.requestKey, repository.requests[1]!.requestKey);
  });

  it("rejects missing audit context and unsupported web source before repository access", async () => {
    const repository = new RecordingWebRepository();
    const adapter = new PackageCatalogWebAdapter(repository);
    const mutation = { action: "ENABLE" as const, packageId: "PKG-SYNTH-002" };
    await assert.rejects(() => adapter.mutate({ ...base, reason: " ", mutation }), /변경 사유/);
    await assert.rejects(() => adapter.mutate({ ...base, sourceCode: "iris", mutation }), /웹 요청 출처/);
    await assert.rejects(() => adapter.mutate({ ...base, actorOperatorId: "operator-1", mutation }), /운영자 식별자/);
    assert.equal(repository.requests.length, 0);
  });

  it("validates ADD fields and reward quantities without inventing another lifecycle", async () => {
    const repository = new RecordingWebRepository();
    const adapter = new PackageCatalogWebAdapter(repository);
    await assert.rejects(() => adapter.mutate({
      ...base,
      mutation: { action: "ADD", displayName: " ", description: "설명", rewards: [{ rewardType: "POINT", assetCode: "POINT", quantity: 1n }] },
    }), /이름과 설명/);
    await assert.rejects(() => adapter.mutate({
      ...base,
      mutation: { action: "ADD", displayName: "신규", description: "설명", rewards: [{ rewardType: "POINT", assetCode: "POINT", quantity: 0n }] },
    }), /보상 수량/);
    assert.equal(repository.requests.length, 0);
  });
});

const mariaConfigured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
const primaryOperatorId = "900000020";
const secondaryOperatorId = "900000021";

// 격리 MariaDB 설정으로 재시작 가능한 client를 생성합니다.
function openDatabase(): DatabaseClient {
  return createDatabaseClient({
    enabled: true,
    host: required("DATABASE_HOST"),
    port: Number(required("DATABASE_PORT")),
    user: required("DATABASE_USER"),
    password: required("DATABASE_PASSWORD"),
    name: required("DATABASE_NAME"),
    connectionLimit: 8,
    connectTimeoutMs: 5_000,
  });
}

// 실패 지점 이전의 실제 DB 쓰기를 같은 transaction에서 강제로 rollback시킵니다.
class FailAfterAuditDatabaseClient implements DatabaseClient {
  public constructor(private readonly delegate: DatabaseClient) {}

  public ping(): Promise<void> { return this.delegate.ping(); }
  public verifyRollback(): Promise<boolean> { return this.delegate.verifyRollback(); }
  public query<T>(sql: string, values?: readonly unknown[]): Promise<T> { return this.delegate.query<T>(sql, values); }
  public execute(sql: string, values?: readonly unknown[]) { return this.delegate.execute(sql, values); }
  public close(): Promise<void> { return this.delegate.close(); }

  public withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    return this.delegate.withTransaction((transaction) => work({
      query: <R>(sql: string, values?: readonly unknown[]) => transaction.query<R>(sql, values),
      execute: (sql: string, values?: readonly unknown[]) => {
        if (/INSERT\s+INTO\s+package_catalog_mutations/i.test(sql)) {
          throw new Error("SYNTHETIC_AFTER_AUDIT_FAILURE");
        }
        return transaction.execute(sql, values);
      },
    }));
  }
}

// PackageCatalogCommandError의 안정적인 code를 검증합니다.
function hasErrorCode(expected: string): (error: unknown) => boolean {
  return (error) => typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === expected;
}

(mariaConfigured ? describe : describe.skip)("package catalog web adapter MariaDB integration", { concurrency: false }, () => {
  let database: DatabaseClient;
  let adapter: PackageCatalogWebAdapter;
  let roleId: bigint;

  before(async () => {
    database = openDatabase();
    await database.execute(
      `INSERT INTO admin_operators(id,login_id,display_name,password_hash,status)
       VALUES (?, 'lease2362_primary', 'Lease2362 주 운영자', 'synthetic-not-for-login', 'active'),
              (?, 'lease2362_secondary', 'Lease2362 보조 운영자', 'synthetic-not-for-login', 'active')
       ON DUPLICATE KEY UPDATE status='active'`,
      [primaryOperatorId, secondaryOperatorId],
    );
    await database.execute(
      "INSERT INTO admin_roles(code,display_name,active) VALUES ('lease2362_package_catalog','Lease2362 패키지 관리',1) ON DUPLICATE KEY UPDATE active=1",
    );
    const roles = await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='lease2362_package_catalog'");
    roleId = roles[0]!.id;
    await database.execute(
      "INSERT INTO admin_role_permissions(role_id,permission_code) VALUES (?,'package.catalog.manage') ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code)",
      [roleId],
    );
    await database.execute(
      "INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?),(?,?) ON DUPLICATE KEY UPDATE role_id=VALUES(role_id)",
      [primaryOperatorId, roleId, secondaryOperatorId, roleId],
    );
    await database.execute(
      "INSERT INTO package_item_definitions(item_id,item_type,item_name,stackable,metadata_json,enabled,row_version) VALUES ('ITEM-LEASE2362-REWARD','ITEM','Lease2362 합성보상',1,'{}',1,1) ON DUPLICATE KEY UPDATE enabled=1",
    );
    await database.execute(
      "INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES ('ITEM-LEASE2362-REWARD','Lease2362 합성보상','ITEM',1,'{}',1,1) ON DUPLICATE KEY UPDATE active=1",
    );
    adapter = new PackageCatalogWebAdapter(new MariaPackageCatalogWebAdapterRepository(database));
  });

  after(async () => {
    await database.close();
  });

  // 현재 catalog head를 caller expected version으로 사용합니다.
  async function currentVersion(): Promise<bigint> {
    const rows = await database.query<Array<{ version: bigint }>>(
      "SELECT version FROM package_catalog_heads WHERE catalog_key='PACKAGE_CATALOG'",
    );
    return rows[0]!.version;
  }

  // 공통 웹 경계 필드를 포함한 합성 요청을 구성합니다.
  function webInput(overrides: Partial<PackageCatalogWebMutationInput> & Pick<PackageCatalogWebMutationInput, "mutation">): PackageCatalogWebMutationInput {
    return {
      actorOperatorId: primaryOperatorId,
      sourceCode: "lease2362_web",
      idempotencyKey: "lease2362-default",
      expectedCatalogVersion: 1n,
      reason: "Lease2362 합성 검증",
      ...overrides,
    };
  }

  it("atomically records reason and stable ID without Iris execution/outbox, then authorizes replay first", async () => {
    const reason = "Lease2362 원자 감사 및 replay 권한 검증";
    const input = webInput({
      idempotencyKey: "atomic-replay",
      expectedCatalogVersion: await currentVersion(),
      reason,
      mutation: {
        action: "ADD",
        displayName: "Lease2362 원자 패키지",
        description: "원자 감사 합성 데이터",
        rewards: [{ rewardType: "ITEM", assetCode: "ITEM-LEASE2362-REWARD", quantity: 2n }],
      },
    });
    const created = await adapter.mutate(input);
    assert.equal(created.replayed, false);
    assert.match(created.packageId, /^PKG-CUSTOM-/);

    const audits = await database.query<Array<{
      operation_id: bigint;
      reason: string;
      change_summary_json: string | Record<string, unknown>;
    }>>(
      "SELECT operation_id,reason,change_summary_json FROM command_audit WHERE reason=?",
      [reason],
    );
    assert.equal(audits.length, 1);
    const summary = typeof audits[0]!.change_summary_json === "string"
      ? JSON.parse(audits[0]!.change_summary_json) as Record<string, unknown>
      : audits[0]!.change_summary_json;
    assert.equal(summary.packageId, created.packageId);
    assert.equal(summary.reason, reason);
    assert.equal(summary.sourceCode, "lease2362_web");
    const changes = await database.query<Array<{ change_count: bigint }>>(
      "SELECT COUNT(*) AS change_count FROM configuration_change_log WHERE JSON_UNQUOTE(JSON_EXTRACT(change_json,'$.reason'))=? AND JSON_UNQUOTE(JSON_EXTRACT(change_json,'$.packageId'))=?",
      [reason, created.packageId],
    );
    const sideEffects = await database.query<Array<{ outbox_count: bigint; execution_count: bigint }>>(
      `SELECT
       (SELECT COUNT(*) FROM outbox_messages WHERE operation_id=?) AS outbox_count,
       (SELECT COUNT(*) FROM command_executions WHERE operation_id=?) AS execution_count`,
      [audits[0]!.operation_id, audits[0]!.operation_id],
    );
    assert.equal(changes[0]!.change_count, 1n);
    assert.deepEqual(sideEffects[0], { outbox_count: 0n, execution_count: 0n });

    const replay = await adapter.mutate(input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.catalogVersion, created.catalogVersion);
    await database.execute("DELETE FROM admin_operator_roles WHERE operator_id=? AND role_id=?", [primaryOperatorId, roleId]);
    try {
      await assert.rejects(() => adapter.mutate(input), hasErrorCode("FORBIDDEN"));
    } finally {
      await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [primaryOperatorId, roleId]);
    }
    const replayAudits = await database.query<Array<{ audit_count: bigint }>>(
      "SELECT COUNT(*) AS audit_count FROM command_audit WHERE reason=?",
      [reason],
    );
    assert.equal(replayAudits[0]!.audit_count, 1n);
  });

  it("serializes concurrent duplicates and rejects the same key with a different payload", async () => {
    const reason = "Lease2362 동시 멱등 검증";
    const input = webInput({
      idempotencyKey: "concurrent-duplicate",
      expectedCatalogVersion: await currentVersion(),
      reason,
      mutation: {
        action: "ADD",
        displayName: "Lease2362 동시 패키지",
        description: "동시 중복 합성 데이터",
        rewards: [{ rewardType: "ITEM", assetCode: "ITEM-LEASE2362-REWARD", quantity: 3n }],
      },
    });
    const results = await Promise.all([adapter.mutate(input), adapter.mutate(input)]);
    assert.deepEqual(results.map((result) => result.replayed).sort(), [false, true]);
    assert.equal(results[0]!.packageId, results[1]!.packageId);
    const counts = await database.query<Array<{ package_count: bigint; audit_count: bigint; change_count: bigint }>>(
      `SELECT
       (SELECT COUNT(*) FROM package_catalog WHERE display_name='Lease2362 동시 패키지') AS package_count,
       (SELECT COUNT(*) FROM command_audit WHERE reason=?) AS audit_count,
       (SELECT COUNT(*) FROM configuration_change_log WHERE JSON_UNQUOTE(JSON_EXTRACT(change_json,'$.reason'))=?) AS change_count`,
      [reason, reason],
    );
    assert.deepEqual(counts[0], { package_count: 1n, audit_count: 1n, change_count: 1n });
    await assert.rejects(
      () => adapter.mutate({ ...input, mutation: { action: "REMOVE", packageId: results[0]!.packageId } }),
      hasErrorCode("PACKAGE_CATALOG_IDEMPOTENCY_CONFLICT"),
    );
  });

  it("separates the same raw key by operator and enforces caller catalog version", async () => {
    const rawKey = "same-key-different-operator";
    const first = await adapter.mutate(webInput({
      idempotencyKey: rawKey,
      expectedCatalogVersion: await currentVersion(),
      reason: "Lease2362 주 운영자 namespace",
      mutation: {
        action: "ADD",
        displayName: "Lease2362 주 운영자 패키지",
        description: "운영자 namespace A",
        rewards: [{ rewardType: "ITEM", assetCode: "ITEM-LEASE2362-REWARD", quantity: 1n }],
      },
    }));
    const second = await adapter.mutate(webInput({
      actorOperatorId: secondaryOperatorId,
      idempotencyKey: rawKey,
      expectedCatalogVersion: first.catalogVersion,
      reason: "Lease2362 보조 운영자 namespace",
      mutation: {
        action: "ADD",
        displayName: "Lease2362 보조 운영자 패키지",
        description: "운영자 namespace B",
        rewards: [{ rewardType: "ITEM", assetCode: "ITEM-LEASE2362-REWARD", quantity: 1n }],
      },
    }));
    assert.notEqual(first.packageId, second.packageId);
    const keys = await database.query<Array<{ actor_id: bigint; idempotency_key: string }>>(
      "SELECT actor_id,idempotency_key FROM operations WHERE source_code='lease2362_web' AND actor_id IN (?,?) AND idempotency_key LIKE 'web:lease2362_web:%' ORDER BY actor_id,id",
      [primaryOperatorId, secondaryOperatorId],
    );
    const primaryKey = keys.find((row) => row.actor_id.toString() === primaryOperatorId && row.idempotency_key.includes(":900000020:"));
    const secondaryKey = keys.find((row) => row.actor_id.toString() === secondaryOperatorId && row.idempotency_key.includes(":900000021:"));
    assert.ok(primaryKey);
    assert.ok(secondaryKey);
    assert.notEqual(primaryKey.idempotency_key, secondaryKey.idempotency_key);

    const staleSource = "lease2362_version_conflict";
    const versionBefore = await currentVersion();
    await assert.rejects(() => adapter.mutate(webInput({
      sourceCode: staleSource,
      idempotencyKey: "stale-version",
      expectedCatalogVersion: versionBefore - 1n,
      reason: "Lease2362 version conflict",
      mutation: {
        action: "ADD",
        displayName: "Lease2362 stale 패키지",
        description: "version conflict 합성 데이터",
        rewards: [{ rewardType: "ITEM", assetCode: "ITEM-LEASE2362-REWARD", quantity: 1n }],
      },
    })), hasErrorCode("PACKAGE_CATALOG_VERSION_CONFLICT"));
    const staleWrites = await database.query<Array<{ operation_count: bigint; package_count: bigint }>>(
      `SELECT
       (SELECT COUNT(*) FROM operations WHERE source_code=?) AS operation_count,
       (SELECT COUNT(*) FROM package_catalog WHERE display_name='Lease2362 stale 패키지') AS package_count`,
      [staleSource],
    );
    assert.deepEqual(staleWrites[0], { operation_count: 0n, package_count: 0n });
  });

  it("rolls back catalog, operation, change log and audit when a post-audit write fails", async () => {
    const sourceCode = "lease2362_rollback";
    const reason = "Lease2362 audit rollback";
    const versionBefore = await currentVersion();
    const rollbackAdapter = new PackageCatalogWebAdapter(
      new MariaPackageCatalogWebAdapterRepository(new FailAfterAuditDatabaseClient(database)),
    );
    await assert.rejects(() => rollbackAdapter.mutate(webInput({
      sourceCode,
      idempotencyKey: "rollback-after-audit",
      expectedCatalogVersion: versionBefore,
      reason,
      mutation: {
        action: "ADD",
        displayName: "Lease2362 rollback 패키지",
        description: "rollback 합성 데이터",
        rewards: [{ rewardType: "ITEM", assetCode: "ITEM-LEASE2362-REWARD", quantity: 4n }],
      },
    })), /SYNTHETIC_AFTER_AUDIT_FAILURE/);
    assert.equal(await currentVersion(), versionBefore);
    const rollbackCounts = await database.query<Array<{
      operation_count: bigint;
      package_count: bigint;
      audit_count: bigint;
      change_count: bigint;
    }>>(
      `SELECT
       (SELECT COUNT(*) FROM operations WHERE source_code=?) AS operation_count,
       (SELECT COUNT(*) FROM package_catalog WHERE display_name='Lease2362 rollback 패키지') AS package_count,
       (SELECT COUNT(*) FROM command_audit WHERE reason=?) AS audit_count,
       (SELECT COUNT(*) FROM configuration_change_log WHERE JSON_UNQUOTE(JSON_EXTRACT(change_json,'$.reason'))=?) AS change_count`,
      [sourceCode, reason, reason],
    );
    assert.deepEqual(rollbackCounts[0], { operation_count: 0n, package_count: 0n, audit_count: 0n, change_count: 0n });
  });

  it("replays after client restart and matches the canonical snapshot as Shadow evidence", async () => {
    const reason = "Lease2362 restart Shadow";
    const input = webInput({
      sourceCode: "lease2362_restart_shadow",
      idempotencyKey: "restart-replay",
      expectedCatalogVersion: await currentVersion(),
      reason,
      mutation: {
        action: "ADD",
        displayName: "Lease2362 restart 패키지",
        description: "restart 및 Shadow 합성 데이터",
        rewards: [{ rewardType: "ITEM", assetCode: "ITEM-LEASE2362-REWARD", quantity: 5n }],
      },
    });
    const created = await adapter.mutate(input);
    await database.close();
    database = openDatabase();
    adapter = new PackageCatalogWebAdapter(new MariaPackageCatalogWebAdapterRepository(database));
    const replay = await adapter.mutate(input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.packageId, created.packageId);
    assert.equal(replay.catalogVersion, created.catalogVersion);
    const snapshot = await new MariaPackageCatalogAdminRepository(database).readSnapshot();
    const canonical = snapshot.entries.find((entry) => entry.packageId === created.packageId);
    assert.ok(canonical);
    assert.equal(canonical.displayName, "Lease2362 restart 패키지");
    assert.equal(canonical.active, true);
    assert.equal(snapshot.catalogVersion, created.catalogVersion);
    const evidence = await database.query<Array<{ audit_count: bigint; change_count: bigint }>>(
      `SELECT
       (SELECT COUNT(*) FROM command_audit WHERE reason=?) AS audit_count,
       (SELECT COUNT(*) FROM configuration_change_log WHERE JSON_UNQUOTE(JSON_EXTRACT(change_json,'$.reason'))=?) AS change_count`,
      [reason, reason],
    );
    assert.deepEqual(evidence[0], { audit_count: 1n, change_count: 1n });
  });
});
