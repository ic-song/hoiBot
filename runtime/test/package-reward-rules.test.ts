import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PackageTransaction } from "../src/package-provider.js";
import {
  resolvePackageRewardMutations,
  resolvePackageRewardPlan,
  type DynamicRewardItem,
  type PackageRewardRule,
  type PackageRewardRuleRepository
} from "../src/package-reward-rules.js";

const transaction: PackageTransaction = { id: "test-transaction" };

function rule(overrides: Partial<PackageRewardRule>): PackageRewardRule {
  return {
    ruleId: "rule-1", packageId: "PKG-TEST", rewardOrder: 1, groupCode: "ALL",
    ruleMode: "ALL", operation: "ADD", ownerScope: "USER", itemId: "item.base",
    quantity: 1n, weight: null, rangeMin: null, rangeMax: null, rangeStep: null,
    targetSelector: null, metadataOverride: null, selector: null, ...overrides
  };
}

function repository(rules: readonly PackageRewardRule[], candidates: readonly DynamicRewardItem[] = []): PackageRewardRuleRepository {
  return {
    listRewardRules: async () => rules,
    listDynamicRewardItems: async () => candidates
  };
}

describe("package reward dynamic rules", () => {
  it("grants the selected weighted reward bundle in the same plan", async () => {
    const selected = rule({ ruleId: "golden", ruleMode: "WEIGHTED_ONE", groupCode: "fish", weight: 1, itemId: "fish.golden" });
    const repo: PackageRewardRuleRepository = {
      ...repository([selected]),
      listRewardBundleItems: async (parentRuleId) => parentRuleId === "golden" ? [{
        bundleItemId: "golden-title", parentRuleId, rewardOrder: 1, operation: "ADD", ownerScope: "USER",
        itemId: "title.golden-fisher", quantity: 1n, targetSelector: null, metadataOverride: { price: 0 }
      }] : []
    };
    const plan = await resolvePackageRewardPlan(repo, "PKG-TEST", 1, transaction, { userId: "user-1" }, () => 0);
    assert.deepEqual(plan.mutations.map((mutation) => mutation.itemId), ["fish.golden", "title.golden-fisher"]);
  });

  it("chooses grade weight before item weight", async () => {
    const dynamic = rule({
      ruleMode: "DYNAMIC_ITEM", itemId: null,
      selector: { catalogCode: "legacy-mini-pet", respectCapacity: false, consumeOnlyGranted: false }
    });
    const candidates: DynamicRewardItem[] = [
      { itemId: "common-a", itemType: "MINI_PET", metadata: {}, gradeCode: "common", gradeWeight: 90, itemWeight: 1 },
      { itemId: "common-b", itemType: "MINI_PET", metadata: {}, gradeCode: "common", gradeWeight: 90, itemWeight: 3 },
      { itemId: "rare", itemType: "MINI_PET", metadata: {}, gradeCode: "rare", gradeWeight: 10, itemWeight: 1 }
    ];
    const randomValues = [0.5, 0.8];
    const plan = await resolvePackageRewardPlan(repository([dynamic], candidates), "PKG-TEST", 1, transaction, { userId: "user-1" }, () => randomValues.shift()!);
    assert.equal(plan.mutations[0]?.itemId, "common-b");
  });

  it("limits grants to locked capacity and overrides package consumption", async () => {
    const dynamic = rule({
      ruleMode: "DYNAMIC_ITEM", itemId: null,
      selector: { catalogCode: "legacy-mini-pet", respectCapacity: true, consumeOnlyGranted: true }
    });
    const candidate: DynamicRewardItem = {
      itemId: "mini-pet-a", itemType: "MINI_PET", metadata: {}, gradeCode: "common", gradeWeight: 1, itemWeight: 1
    };
    const repo: PackageRewardRuleRepository = {
      ...repository([dynamic], [candidate]),
      getRemainingItemCapacity: async (ownerType, ownerId, itemType) => {
        assert.deepEqual([ownerType, ownerId, itemType], ["USER", "user-1", "MINI_PET"]);
        return 2n;
      }
    };
    const plan = await resolvePackageRewardPlan(repo, "PKG-TEST", 5, transaction, { userId: "user-1" }, () => 0);
    assert.equal(plan.consumeCountOverride, 2);
    assert.equal(plan.mutations[0]?.quantity, 2n);
  });

  it("returns an explicit zero-consumption plan when capacity is full", async () => {
    const dynamic = rule({
      ruleMode: "DYNAMIC_ITEM", itemId: null,
      selector: { catalogCode: "legacy-mini-pet", respectCapacity: true, consumeOnlyGranted: true }
    });
    const repo: PackageRewardRuleRepository = {
      ...repository([dynamic], [{ itemId: "mini-pet-a", itemType: "MINI_PET", metadata: {}, gradeCode: "common", gradeWeight: 1, itemWeight: 1 }]),
      getRemainingItemCapacity: async () => 0n
    };
    const plan = await resolvePackageRewardPlan(repo, "PKG-TEST", 3, transaction, { userId: "user-1" }, () => 0);
    assert.deepEqual(plan, { mutations: [], consumeCountOverride: 0 });
  });

  it("keeps legacy dynamic appearance selection compatible", async () => {
    const dynamic = rule({
      ruleMode: "DYNAMIC_ITEM", operation: "REPLACE", ownerScope: "TARGET_PET", itemId: null,
      targetSelector: "REQUESTED_PET", selector: { itemType: "PET_APPEARANCE" }
    });
    const mutations = await resolvePackageRewardMutations(repository([dynamic], [
      { itemId: "appearance-a", itemType: "PET_APPEARANCE", metadata: {} },
      { itemId: "appearance-b", itemType: "PET_APPEARANCE", metadata: {} }
    ]), "PKG-TEST", 1, transaction, () => 0.75);
    assert.equal(mutations[0]?.itemId, "appearance-b");
    assert.equal(mutations[0]?.operation, "REPLACE");
  });
});
