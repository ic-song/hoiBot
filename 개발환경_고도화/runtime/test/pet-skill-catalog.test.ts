import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
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
} from "../src/configuration/configuration-catalog.js";
import {
  PET_SKILL_CATALOG_CONFIGURATION,
  PET_SKILL_CATALOG_SET_CODE,
  PetSkillCatalogCrudProvider,
  normalizePetSkillCatalog,
  petSkillCatalogContentHash,
  type PetSkillCatalogInput,
} from "../src/pet/pet-skill-catalog.js";

const sourceHash = "a".repeat(64);

const catalog = (): PetSkillCatalogInput => ({
  catalogVersion: "synthetic-pet-skill-v1",
  definitions: [
    { code: "pet_skill_ten_won", name: "십원", grade: "B", rate: 1, sourceKey: "skill_001", sourceHash, effect: "십원 합성 효과", active: true, sourceIndex: 0 },
    { code: "pet_skill_salvation", name: "구원", grade: "B", rate: 1, sourceKey: "skill_002", sourceHash, effect: "구원 합성 효과", active: true, sourceIndex: 1 },
    { code: "pet_skill_musou_myth", name: "무쌍신화", grade: "B", rate: 0.5, sourceKey: "skill_003", sourceHash, effect: "공격 횟수 증가", active: true, fixedRate: true, sourceIndex: 2 },
    { code: "pet_skill_musou_ghost", name: "무쌍귀신", grade: "B", rate: 0.5, sourceKey: "skill_004", sourceHash, effect: "공격 횟수 증가", active: true, openable: false, sourceIndex: 3 },
  ],
  compatibilityGroups: [
    { code: "musou_myth_ghost", displayOrder: 1, active: true, members: ["pet_skill_musou_myth", "pet_skill_musou_ghost"] },
  ],
  drawPolicy: { gradeWeightTotals: { B: 20 } },
});

const mutationResult = (action: ConfigurationMutationResult["action"]): ConfigurationMutationResult => ({
  action,
  setCode: PET_SKILL_CATALOG_SET_CODE,
  beforeVersion: "1",
  version: "2",
  targetVersion: null,
  snapshot: null,
  operationId: "1",
  auditId: "2",
  outboxId: "3",
  replayed: false,
});

function snapshot(version: string, status: ConfigurationSnapshot["status"], input: PetSkillCatalogInput): ConfigurationSnapshot {
  const valuesByKey: Record<string, unknown> = {
    catalog_version: input.catalogVersion,
    compatibility_groups: input.compatibilityGroups,
    definitions: input.definitions,
    draw_policy: input.drawPolicy,
  };
  const values: NormalizedConfigurationValue[] = PET_SKILL_CATALOG_CONFIGURATION.keys.map((key) => ({
    key: key.key,
    type: key.type,
    value: valuesByKey[key.key] as NormalizedConfigurationValue["value"],
    validation: key.validation ?? {},
    source: key.source,
  }));
  return { id: version, setCode: PET_SKILL_CATALOG_SET_CODE, version, status, values, contentHash: sourceHash };
}

class RecordingRepository implements ConfigurationCatalogRepository {
  public changes: readonly NormalizedConfigurationValue[] = [];
  public readonly versions = new Map<string, ConfigurationSnapshot>();
  public published = false;
  public rolledBack = false;

  public readCurrent(): Promise<ConfigurationSnapshot | null> { return Promise.resolve(this.versions.get("current") ?? null); }
  public readVersion(_definition: ConfigurationSetDefinition, version: string): Promise<ConfigurationSnapshot | null> { return Promise.resolve(this.versions.get(version) ?? null); }
  public createDraft(_definition: ConfigurationSetDefinition, _input: CreateConfigurationDraftInput, changes: readonly NormalizedConfigurationValue[]): Promise<ConfigurationMutationResult> { this.changes = changes; return Promise.resolve(mutationResult("draft")); }
  public publish(_definition: ConfigurationSetDefinition, _input: PublishConfigurationDraftInput): Promise<ConfigurationMutationResult> { this.published = true; return Promise.resolve(mutationResult("publish")); }
  public rollback(_definition: ConfigurationSetDefinition, _input: RollbackConfigurationInput): Promise<ConfigurationMutationResult> { this.rolledBack = true; return Promise.resolve(mutationResult("rollback")); }
  public retire(_definition: ConfigurationSetDefinition, _input: RetireConfigurationInput): Promise<ConfigurationMutationResult> { return Promise.resolve(mutationResult("retire")); }
  public discardDraft(_definition: ConfigurationSetDefinition, _input: DiscardConfigurationDraftInput): Promise<ConfigurationMutationResult> { return Promise.resolve(mutationResult("discard")); }
}

describe("pet skill catalog typed CRUD adapter", () => {
  it("validates the durable synthetic fixture contract", () => {
    const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-skill-catalog-crud-v1.json", import.meta.url), "utf8")) as {
      definitions: PetSkillCatalogInput["definitions"];
      compatibilityGroups: PetSkillCatalogInput["compatibilityGroups"];
      drawPolicy: PetSkillCatalogInput["drawPolicy"];
      catalogVersion: string;
      expected: { definitionCount: number; drawWeights: number[]; drawWeightTotal: number };
    };
    const normalized = normalizePetSkillCatalog(fixture);
    assert.equal(normalized.definitions.length, fixture.expected.definitionCount);
    assert.deepEqual(normalized.definitions.map((entry) => entry.drawWeight), fixture.expected.drawWeights);
    assert.equal(normalized.definitions.reduce((sum, entry) => sum + entry.drawWeight, 0), fixture.expected.drawWeightTotal);
  });

  it("keeps similar names distinct and projects deterministic eligible draw weights", () => {
    const input = catalog();
    const normalized = normalizePetSkillCatalog(input);
    assert.deepEqual(normalized.definitions.map((entry) => entry.code), [
      "pet_skill_ten_won", "pet_skill_salvation", "pet_skill_musou_myth", "pet_skill_musou_ghost",
    ]);
    assert.deepEqual(normalized.definitions.map((entry) => entry.name).slice(0, 2), ["십원", "구원"]);
    assert.deepEqual(normalized.definitions.map((entry) => entry.drawWeight), [9.75, 9.75, 0.5, 0]);
    assert.equal(normalized.definitions.reduce((sum, entry) => sum + entry.drawWeight, 0), 20);
    assert.equal(Math.round(normalized.definitions.reduce((sum, entry) => sum + entry.actualRate, 0)), 100);
    assert.notEqual(normalized.definitions[0]!.effectIdentity, normalized.definitions[1]!.effectIdentity);
    assert.equal(petSkillCatalogContentHash(input), petSkillCatalogContentHash({ ...input, definitions: [...input.definitions].reverse() }));
  });

  it("fails closed for duplicate identities, unknown compatibility and invalid probability allocation", () => {
    const input = catalog();
    assert.throws(() => normalizePetSkillCatalog({ ...input, definitions: [...input.definitions, { ...input.definitions[0]!, sourceKey: "skill_999" }] }), /stable code가 중복/);
    assert.throws(() => normalizePetSkillCatalog({ ...input, definitions: [...input.definitions, { ...input.definitions[0]!, code: "pet_skill_other" }] }), /source key가 중복/);
    assert.throws(() => normalizePetSkillCatalog({ ...input, compatibilityGroups: [{ ...input.compatibilityGroups[0]!, members: ["pet_skill_musou_myth", "pet_skill_missing"] }] }), /정의되지 않은 호환 멤버/);
    assert.throws(() => normalizePetSkillCatalog({ ...input, drawPolicy: { gradeWeightTotals: { B: 0.1 } } }), /고정 확률 합이 등급 총량보다 큽니다/);
    const fixedOnly = { ...input, definitions: input.definitions.map((entry) => ({ ...entry, fixedRate: true, openable: true })) };
    assert.throws(() => normalizePetSkillCatalog({ ...fixedOnly, drawPolicy: { gradeWeightTotals: { B: 20 } } }), /잔여 확률을 배분할 스킬이 없습니다/);
  });

  it("rejects non-JSON metadata and circular catalog input", () => {
    const input = catalog();
    assert.throws(() => normalizePetSkillCatalog({ ...input, definitions: [{ ...input.definitions[0]!, rate: 101 }, ...input.definitions.slice(1)] }), /숫자 값이 올바르지/);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.throws(() => normalizePetSkillCatalog({ ...input, definitions: [{ ...input.definitions[0]!, metadata: circular }, ...input.definitions.slice(1)] }), /순환 참조/);
  });

  it("fails closed for malformed persisted JSON shapes", () => {
    const input = catalog();
    assert.throws(() => normalizePetSkillCatalog({ ...input, catalogVersion: null } as unknown as PetSkillCatalogInput), /카탈로그 버전/);
    assert.throws(() => normalizePetSkillCatalog({ ...input, definitions: null } as unknown as PetSkillCatalogInput), /정의 수/);
    assert.throws(() => normalizePetSkillCatalog({ ...input, compatibilityGroups: null } as unknown as PetSkillCatalogInput), /호환 그룹 형식/);
    assert.throws(() => normalizePetSkillCatalog({ ...input, drawPolicy: null } as unknown as PetSkillCatalogInput), /추첨 정책 형식/);
    const withoutOpenableRate = input.definitions.map((entry, index) => index === 3 ? (({ rate: _rate, ...definition }) => definition)(entry) : entry);
    assert.equal(normalizePetSkillCatalog({ ...input, definitions: withoutOpenableRate }).definitions[3]!.drawWeight, 0);
    const withoutRequiredRate = input.definitions.map((entry, index) => index === 0 ? (({ rate: _rate, ...definition }) => definition)(entry) : entry);
    assert.throws(() => normalizePetSkillCatalog({ ...input, definitions: withoutRequiredRate }), /오픈 가능한 펫스킬 확률/);
  });

  it("delegates full-catalog drafts without persisting computed projection fields", async () => {
    const repository = new RecordingRepository();
    const provider = new PetSkillCatalogCrudProvider(new ConfigurationCatalogProvider(new ConfigurationCatalogRegistry([PET_SKILL_CATALOG_CONFIGURATION]), repository));
    await provider.createDraft({ actorId: "7", idempotencyKey: "pet-skill-draft-1", reason: "합성 펫스킬 카탈로그 초안", expectedActiveVersion: "1", catalog: catalog() });
    assert.deepEqual(repository.changes.map((entry) => entry.key), ["catalog_version", "compatibility_groups", "definitions", "draw_policy"]);
    const definitions = repository.changes.find((entry) => entry.key === "definitions")!.value as Array<Record<string, unknown>>;
    assert.equal(definitions.length, 4);
    assert.equal("drawWeight" in definitions[0]!, false);
    assert.equal("actualRate" in definitions[0]!, false);
    assert.equal("effectIdentity" in definitions[0]!, false);
  });

  it("validates draft and rollback targets before delegating lifecycle mutations", async () => {
    const repository = new RecordingRepository();
    const provider = new PetSkillCatalogCrudProvider(new ConfigurationCatalogProvider(new ConfigurationCatalogRegistry([PET_SKILL_CATALOG_CONFIGURATION]), repository));
    await assert.rejects(() => provider.publish({ actorId: "7", idempotencyKey: "publish-missing", reason: "없는 초안 게시 검증", expectedActiveVersion: "1", draftVersion: "2" }), /버전이 없습니다/);
    repository.versions.set("2", snapshot("2", "draft", catalog()));
    await provider.publish({ actorId: "7", idempotencyKey: "publish-present", reason: "합성 초안 게시 검증", expectedActiveVersion: "1", draftVersion: "2" });
    assert.equal(repository.published, true);
    repository.versions.set("2", snapshot("2", "active", catalog()));
    await provider.publish({ actorId: "7", idempotencyKey: "publish-present", reason: "합성 초안 게시 검증", expectedActiveVersion: "1", draftVersion: "2" });
    await assert.rejects(() => provider.rollback({ actorId: "7", idempotencyKey: "rollback-missing", reason: "없는 복구 대상 검증", expectedActiveVersion: "2", targetVersion: "9" }), /복구할 펫스킬 카탈로그 버전/);
    repository.versions.set("1", snapshot("1", "retired", catalog()));
    await provider.rollback({ actorId: "7", idempotencyKey: "rollback-present", reason: "합성 카탈로그 복구 검증", expectedActiveVersion: "2", targetVersion: "1" });
    assert.equal(repository.rolledBack, true);
  });
});
