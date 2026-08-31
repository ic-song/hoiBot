import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import {
  ConfigurationCatalogProvider,
  ConfigurationCatalogRegistry,
  type ConfigurationSetDefinition,
} from "../src/configuration/configuration-catalog.js";
import { MariaConfigurationCatalogRepository } from "../src/configuration/maria-configuration-catalog-repository.js";

const integration = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;
const suffix = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
const setCode = `configuration.test.${suffix}`;
const keyPrefix = `configuration-${suffix}`;
const sourceHash = "c".repeat(64);

const definition: ConfigurationSetDefinition = {
  setCode,
  label: "합성 공용 설정",
  keys: [
    { key: "base_attacks", label: "기본 공격", type: "integer", required: true, editable: true, validation: { min: "1", max: "10", step: "1" }, source: { file: "main.js", path: "GLOBAL_CONFIG.petMusou.baseAttacks", hash: sourceHash } },
    { key: "lightning_increment", label: "벼락 증가", type: "decimal", required: true, editable: true, validation: { min: "0", max: "100", step: "0.5" }, source: { file: "main.js", path: "GLOBAL_CONFIG.petMusou.lightningIncrement", hash: sourceHash } },
    { key: "enabled", label: "활성화", type: "boolean", required: true, editable: true, source: { file: "main.js", path: "GLOBAL_CONFIG.petMusou.enabled", hash: sourceHash } },
    { key: "title", label: "표시명", type: "string", required: true, editable: true, validation: { minLength: 1, maxLength: 30 }, source: { file: "main.js", path: "GLOBAL_CONFIG.petMusou.title", hash: sourceHash } },
    { key: "flags", label: "부가 설정", type: "json", required: true, editable: true, source: { file: "main.js", path: "GLOBAL_CONFIG.petMusou.flags", hash: sourceHash } },
  ],
};

const changes = [
  { key: "base_attacks", value: "4" },
  { key: "lightning_increment", value: "0.5" },
  { key: "enabled", value: true },
  { key: "title", value: "펫무쌍" },
  { key: "flags", value: { timeoutElimination: true } },
] as const;

integration("configuration catalog MariaDB immutable lifecycle", () => {
  let database: DatabaseClient;
  let operatorId: string;
  let provider: ConfigurationCatalogProvider;

  before(async () => {
    database = createDatabaseClient(loadConfig().database);
    const inserted = await database.execute(
      "INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,?,'active')",
      [`config-${suffix}`, "합성 설정 관리자", "synthetic"],
    );
    operatorId = inserted.insertId.toString();
    provider = new ConfigurationCatalogProvider(new ConfigurationCatalogRegistry([definition]), new MariaConfigurationCatalogRepository(database));
  });

  after(async () => {
    const operationIds = await database.query<Array<{ id: bigint }>>(
      "SELECT id FROM operations WHERE idempotency_key LIKE ?",
      [`${keyPrefix}%`],
    );
    for (const operation of operationIds) {
      await database.execute("DELETE FROM outbox_messages WHERE operation_id=?", [operation.id]);
      await database.execute("DELETE FROM command_audit WHERE operation_id=?", [operation.id]);
    }
    await database.execute("DELETE FROM configuration_change_log WHERE configuration_set_id IN (SELECT id FROM configuration_sets WHERE set_code=?)", [setCode]);
    await database.execute("DELETE FROM configuration_sets WHERE set_code=?", [setCode]);
    await database.execute("DELETE FROM operations WHERE idempotency_key LIKE ?", [`${keyPrefix}%`]);
    await database.execute("DELETE FROM admin_operators WHERE id=?", [operatorId]);
    await database.close();
  });

  it("preserves every version through draft revision, publish, rollback, retire and discard", async () => {
    const draft1 = await provider.createDraft({ setCode, actorId: operatorId, idempotencyKey: `${keyPrefix}-draft-1`, reason: "최초 합성 초안 생성", expectedActiveVersion: "0", changes });
    assert.equal(draft1.version, "1");
    assert.equal(draft1.snapshot?.status, "draft");
    const publish1Input = { setCode, actorId: operatorId, idempotencyKey: `${keyPrefix}-publish-1`, reason: "최초 합성 설정 게시", expectedActiveVersion: "0", draftVersion: "1" };
    const publish1 = await provider.publish(publish1Input);
    assert.equal(publish1.snapshot?.values.find((entry) => entry.key === "lightning_increment")?.value, "0.5");
    const replay = await provider.publish(publish1Input);
    assert.equal(replay.replayed, true);
    await assert.rejects(() => provider.publish({ ...publish1Input, reason: "같은 키의 다른 게시 요청" }), /다른 요청/);

    const draft2 = await provider.createDraft({ setCode, actorId: operatorId, idempotencyKey: `${keyPrefix}-draft-2`, reason: "공격 횟수 변경 초안", expectedActiveVersion: "1", changes: [{ key: "base_attacks", value: "5" }] });
    assert.equal(draft2.version, "2");
    const draft3 = await provider.createDraft({ setCode, actorId: operatorId, idempotencyKey: `${keyPrefix}-draft-3`, reason: "기존 초안 개정 생성", expectedActiveVersion: "1", baseVersion: "2", changes: [{ key: "title", value: "펫무쌍 개정" }] });
    assert.equal(draft3.version, "3");
    const draft2State = await provider.readVersion(setCode, "2");
    assert.equal(draft2State?.status, "retired");
    await provider.publish({ setCode, actorId: operatorId, idempotencyKey: `${keyPrefix}-publish-3`, reason: "개정 합성 설정 게시", expectedActiveVersion: "1", draftVersion: "3" });
    await assert.rejects(() => provider.retire({ setCode, actorId: operatorId, idempotencyKey: `${keyPrefix}-stale`, reason: "오래된 버전 충돌 검증", expectedActiveVersion: "1" }), /현재 설정 버전은 3/);

    const rollback = await provider.rollback({ setCode, actorId: operatorId, idempotencyKey: `${keyPrefix}-rollback`, reason: "최초 버전 복구 검증", expectedActiveVersion: "3", targetVersion: "1" });
    assert.equal(rollback.version, "4");
    assert.equal(rollback.targetVersion, "1");
    assert.equal(rollback.snapshot?.contentHash, publish1.snapshot?.contentHash);
    assert.equal((await provider.readVersion(setCode, "1"))?.status, "retired");
    await provider.retire({ setCode, actorId: operatorId, idempotencyKey: `${keyPrefix}-retire`, reason: "활성 합성 설정 종료", expectedActiveVersion: "4" });
    assert.equal(await provider.readCurrent(setCode), null);

    const draft5 = await provider.createDraft({ setCode, actorId: operatorId, idempotencyKey: `${keyPrefix}-draft-5`, reason: "종료 버전 기반 초안", expectedActiveVersion: "0", baseVersion: "4", changes: [{ key: "enabled", value: false }] });
    await provider.discardDraft({ setCode, actorId: operatorId, idempotencyKey: `${keyPrefix}-discard-5`, reason: "미게시 합성 초안 폐기", draftVersion: draft5.version });
    assert.equal((await provider.readVersion(setCode, draft5.version))?.status, "retired");

    const counts = (await database.query<Array<{ active_count: bigint; version_count: bigint; log_count: bigint }>>(
      `SELECT SUM(status='active') active_count,COUNT(*) version_count,
       (SELECT COUNT(*) FROM configuration_change_log log WHERE log.configuration_set_id IN (SELECT id FROM configuration_sets WHERE set_code=?)) log_count
       FROM configuration_sets WHERE set_code=?`,
      [setCode, setCode],
    ))[0]!;
    assert.equal(Number(counts.active_count), 0);
    assert.equal(Number(counts.version_count), 5);
    assert.equal(Number(counts.log_count), 9);
  });

  it("rolls back configuration, operation, audit and outbox together on a late failure", async () => {
    const draft = await provider.createDraft({ setCode, actorId: operatorId, idempotencyKey: `${keyPrefix}-fault-draft`, reason: "실패 주입용 초안 생성", expectedActiveVersion: "0", baseVersion: "4", changes: [{ key: "title", value: "실패 주입" }] });
    const faultDatabase: DatabaseClient = {
      ping: () => database.ping(),
      verifyRollback: () => database.verifyRollback(),
      query: <T>(sql: string, values?: readonly unknown[]) => database.query<T>(sql, values),
      execute: (sql: string, values?: readonly unknown[]) => database.execute(sql, values),
      withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => database.withTransaction((transaction) => work({
        ...transaction,
        execute: (sql, values) => sql.includes("INSERT INTO command_audit") ? Promise.reject(new Error("synthetic audit failure")) : transaction.execute(sql, values),
      })),
      close: () => Promise.resolve(),
    };
    const faultProvider = new ConfigurationCatalogProvider(new ConfigurationCatalogRegistry([definition]), new MariaConfigurationCatalogRepository(faultDatabase));
    await assert.rejects(() => faultProvider.publish({ setCode, actorId: operatorId, idempotencyKey: `${keyPrefix}-fault-publish`, reason: "감사 실패 rollback 검증", expectedActiveVersion: "0", draftVersion: draft.version }), /synthetic audit failure/);
    assert.equal((await provider.readVersion(setCode, draft.version))?.status, "draft");
    assert.equal(await provider.readCurrent(setCode), null);
    const residue = (await database.query<Array<{ operation_count: bigint; outbox_count: bigint }>>(
      `SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) operation_count,
              (SELECT COUNT(*) FROM outbox_messages message JOIN operations operation ON operation.id=message.operation_id WHERE operation.idempotency_key=?) outbox_count`,
      [`${keyPrefix}-fault-publish`, `${keyPrefix}-fault-publish`],
    ))[0]!;
    assert.equal(Number(residue.operation_count), 0);
    assert.equal(Number(residue.outbox_count), 0);
    await provider.discardDraft({ setCode, actorId: operatorId, idempotencyKey: `${keyPrefix}-fault-discard`, reason: "실패 검증 초안 정리", draftVersion: draft.version });
  });
});
