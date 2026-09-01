import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  configurationContentHash,
  ConfigurationCatalogProvider,
  ConfigurationCatalogRegistry,
  type ConfigurationCatalogRepository,
  type ConfigurationMutationResult,
  type ConfigurationSetDefinition,
  type ConfigurationSnapshot,
  type CreateConfigurationDraftInput,
  type DiscardConfigurationDraftInput,
  type NormalizedConfigurationValue,
  type PublishConfigurationDraftInput,
  type RetireConfigurationInput,
  type RollbackConfigurationInput,
  validateConfigurationSnapshot,
} from "../src/configuration/configuration-catalog.js";

const sourceHash = "a".repeat(64);
const definition: ConfigurationSetDefinition = {
  setCode: "pet.musou.rules",
  label: "펫무쌍 운영 설정",
  keys: [
    { key: "base_attacks", label: "기본 공격 횟수", type: "integer", required: true, editable: true, validation: { min: "1", max: "10", step: "1" }, source: { file: "main.js", path: "GLOBAL_CONFIG.petMusou.baseAttacks", hash: sourceHash } },
    { key: "lightning_increment", label: "벼락 증가 확률", type: "decimal", required: true, editable: true, validation: { min: "0", max: "100", step: "0.5" }, source: { file: "main.js", path: "GLOBAL_CONFIG.petMusou.lightningIncrement", hash: sourceHash } },
    { key: "title", label: "표시명", type: "string", required: true, editable: true, validation: { minLength: 1, maxLength: 30 }, source: { file: "main.js", path: "GLOBAL_CONFIG.petMusou.title", hash: sourceHash } },
    { key: "enabled", label: "활성화", type: "boolean", required: true, editable: true, source: { file: "main.js", path: "GLOBAL_CONFIG.petMusou.enabled", hash: sourceHash } },
    { key: "flags", label: "부가 설정", type: "json", required: true, editable: true, source: { file: "main.js", path: "GLOBAL_CONFIG.petMusou.flags", hash: sourceHash } },
  ],
};

const result = (action: ConfigurationMutationResult["action"]): ConfigurationMutationResult => ({
  action, setCode: definition.setCode, beforeVersion: "0", version: "1", targetVersion: null,
  snapshot: null, operationId: "1", auditId: "2", outboxId: "3", replayed: false,
});

class RecordingRepository implements ConfigurationCatalogRepository {
  public changes: readonly NormalizedConfigurationValue[] = [];
  public readCurrent(): Promise<ConfigurationSnapshot | null> { return Promise.resolve(null); }
  public readVersion(): Promise<ConfigurationSnapshot | null> { return Promise.resolve(null); }
  public createDraft(_definition: ConfigurationSetDefinition, _input: CreateConfigurationDraftInput, changes: readonly NormalizedConfigurationValue[]): Promise<ConfigurationMutationResult> { this.changes = changes; return Promise.resolve(result("draft")); }
  public publish(_definition: ConfigurationSetDefinition, _input: PublishConfigurationDraftInput): Promise<ConfigurationMutationResult> { return Promise.resolve(result("publish")); }
  public rollback(_definition: ConfigurationSetDefinition, _input: RollbackConfigurationInput): Promise<ConfigurationMutationResult> { return Promise.resolve(result("rollback")); }
  public retire(_definition: ConfigurationSetDefinition, _input: RetireConfigurationInput): Promise<ConfigurationMutationResult> { return Promise.resolve(result("retire")); }
  public discardDraft(_definition: ConfigurationSetDefinition, _input: DiscardConfigurationDraftInput): Promise<ConfigurationMutationResult> { return Promise.resolve(result("discard")); }
}

const input = {
  setCode: definition.setCode,
  actorId: "7",
  idempotencyKey: "configuration-test-1",
  reason: "합성 설정 변경 검증",
  expectedActiveVersion: "0",
  changes: [
    { key: "title", value: "펫무쌍" },
    { key: "flags", value: { timeoutElimination: true, labels: ["⚔", "⚡"] } },
    { key: "enabled", value: true },
    { key: "lightning_increment", value: "0.500" },
    { key: "base_attacks", value: 4 },
  ],
} as const;

describe("configuration catalog typed provider", () => {
  it("normalizes all five value types and keeps a deterministic source-bound hash", async () => {
    const repository = new RecordingRepository();
    const provider = new ConfigurationCatalogProvider(new ConfigurationCatalogRegistry([definition]), repository);
    await provider.createDraft(input);
    assert.deepEqual(repository.changes.map((entry) => [entry.key, entry.value]), [
      ["base_attacks", "4"], ["enabled", true], ["flags", { timeoutElimination: true, labels: ["⚔", "⚡"] }], ["lightning_increment", "0.5"], ["title", "펫무쌍"],
    ]);
    validateConfigurationSnapshot(definition, repository.changes);
    assert.match(configurationContentHash(repository.changes), /^[a-f0-9]{64}$/);
    assert.equal(configurationContentHash(repository.changes), configurationContentHash([...repository.changes].reverse()));
    assert.deepEqual(provider.listManagedSets().map((entry) => entry.setCode), [definition.setCode]);
  });

  it("fails closed for unknown, duplicate, out-of-range and storage-incompatible values", async () => {
    const provider = new ConfigurationCatalogProvider(new ConfigurationCatalogRegistry([definition]), new RecordingRepository());
    await assert.rejects(() => provider.createDraft({ ...input, setCode: "unknown.rules" }), /관리 대상으로 등록되지 않은/);
    await assert.rejects(() => provider.createDraft({ ...input, changes: [{ key: "base_attacks", value: 4 }, { key: "base_attacks", value: 5 }] }), /중복 변경 key/);
    await assert.rejects(() => provider.createDraft({ ...input, changes: [{ key: "base_attacks", value: "9223372036854775808" }] }), /BIGINT 범위/);
    await assert.rejects(() => provider.createDraft({ ...input, changes: [{ key: "lightning_increment", value: "0.0001" }] }), /DECIMAL\(30,3\)/);
    await assert.rejects(() => provider.createDraft({ ...input, changes: [{ key: "flags", value: { invalid: undefined } }] }), /JSON 값이 올바르지/);
  });

  it("detects definition drift in validation and source bindings", async () => {
    const repository = new RecordingRepository();
    const provider = new ConfigurationCatalogProvider(new ConfigurationCatalogRegistry([definition]), repository);
    await provider.createDraft(input);
    const drifted = repository.changes.map((entry) => entry.key === "base_attacks" ? { ...entry, source: { ...entry.source, hash: "b".repeat(64) } } : entry);
    assert.throws(() => validateConfigurationSnapshot(definition, drifted), /source binding/);
  });

  it("matches the legacy scalar/bootstrap projection and excludes typed policy sets", async () => {
    const legacy = {
      baseAttacks: 4,
      lightningIncrement: "0.5",
      title: "펫무쌍",
      enabled: true,
      flags: { timeoutElimination: true, labels: ["⚔", "⚡"] },
    } as const;
    const repository = new RecordingRepository();
    const provider = new ConfigurationCatalogProvider(new ConfigurationCatalogRegistry([definition]), repository);
    await provider.createDraft({
      ...input,
      idempotencyKey: "configuration-shadow-1",
      changes: [
        { key: "base_attacks", value: legacy.baseAttacks },
        { key: "lightning_increment", value: legacy.lightningIncrement },
        { key: "title", value: legacy.title },
        { key: "enabled", value: legacy.enabled },
        { key: "flags", value: legacy.flags },
      ],
    });
    assert.deepEqual(Object.fromEntries(repository.changes.map((entry) => [entry.key, entry.value])), {
      base_attacks: "4",
      enabled: true,
      flags: legacy.flags,
      lightning_increment: "0.5",
      title: "펫무쌍",
    });
    await assert.rejects(() => provider.readCurrent("member.ticket_tier.policy"), /관리 대상으로 등록되지 않은/);
  });

  it("validates mutation metadata before repository execution", async () => {
    const provider = new ConfigurationCatalogProvider(new ConfigurationCatalogRegistry([definition]), new RecordingRepository());
    await assert.rejects(() => provider.createDraft({ ...input, actorId: "0" }), /actorId/);
    await assert.rejects(() => provider.createDraft({ ...input, expectedActiveVersion: "01" }), /정수 문자열/);
    await assert.rejects(() => provider.createDraft({ ...input, reason: "짧음" }), /5~500자/);
    await assert.rejects(() => provider.createDraft({ ...input, idempotencyKey: " " }), /Idempotency-Key/);
  });
});
