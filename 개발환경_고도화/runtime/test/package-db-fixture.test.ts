import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ItemProvider, type ItemDefinition, type ItemMutationContext, type ItemTypeHandler } from "../src/package/item-provider.js";
import { PackageProvider, type PackageCatalogRepository, type PackageTransactionManager } from "../src/package/package-provider.js";
import {
  INDEPENDENT_PACKAGE_FIXTURES,
  LEGACY_DYNAMIC_RULE_KINDS,
  LEGACY_FIXED_REWARD_COUNTS,
  type IndependentPackageFixture
} from "./fixtures/package-parity.js";

function findFixture(command: string): IndependentPackageFixture {
  const fixture = INDEPENDENT_PACKAGE_FIXTURES.find((candidate) => candidate.legacyCommand === command);
  assert.ok(fixture, `missing fixture: ${command}`);
  return fixture;
}

function makeRepository(fixture: IndependentPackageFixture): PackageCatalogRepository {
  return {
    getSnapshot: async () => ({ version: "fixture", packages: [] }),
    findByLegacyCommand: async () => undefined,
    findById: async (id) => id === fixture.packageId ? {
      id: fixture.packageId,
      catalogVersion: "fixture",
      displayName: fixture.legacyCommand,
      legacyCommand: fixture.legacyCommand,
      consumeItemId: fixture.consumeItemId,
      definitionStatus: "READY",
      enabled: true,
      maxOpenCount: 100
    } : undefined,
    listRewards: async () => fixture.fixedRewards.map((reward, index) => ({
      packageId: fixture.packageId,
      rewardOrder: index + 1,
      itemId: reward.itemId,
      quantity: reward.quantity,
      probability: null,
      targetSelector: null,
      metadataOverride: reward.metadata ?? null
    }))
  };
}

interface MutableState {
  balances: Map<string, bigint>;
  completedRequestKeys: Set<string>;
}

function cloneState(state: MutableState): MutableState {
  return {
    balances: new Map(state.balances),
    completedRequestKeys: new Set(state.completedRequestKeys)
  };
}

function restoreState(target: MutableState, snapshot: MutableState): void {
  target.balances = new Map(snapshot.balances);
  target.completedRequestKeys = new Set(snapshot.completedRequestKeys);
}

function makeStackHarness(
  fixture: IndependentPackageFixture,
  initialConsumerCount: bigint,
  failOnAddItemId?: string
): { items: ItemProvider; state: MutableState; transactions: PackageTransactionManager; calls: string[] } {
  const definitions = new Map<string, ItemDefinition>();
  definitions.set(fixture.consumeItemId, {
    id: fixture.consumeItemId, type: "STACK", name: fixture.legacyCommand, stackable: true, metadata: {}, enabled: true
  });
  for (const reward of fixture.fixedRewards) {
    definitions.set(reward.itemId, {
      id: reward.itemId, type: reward.itemType, name: reward.name,
      stackable: reward.itemType === "STACK" || reward.itemType === "POINT" || reward.itemType === "GUILD_RESOURCE",
      metadata: reward.metadata ?? {}, enabled: true
    });
  }

  const state: MutableState = {
    balances: new Map([[fixture.consumeItemId, initialConsumerCount]]),
    completedRequestKeys: new Set()
  };
  const calls: string[] = [];
  const handler: ItemTypeHandler = {
    checkAdd: async (definition, quantity, context) => {
      calls.push(`checkAdd:${definition.id}:${quantity}:${context.requestKey}`);
      assert.ok(quantity > 0n, "provider must not pass zero or negative reward quantities");
    },
    checkRemove: async (definition, quantity, context) => {
      calls.push(`checkRemove:${definition.id}:${quantity}:${context.requestKey}`);
      if (state.completedRequestKeys.has(context.requestKey)) throw new Error("DUPLICATE_REQUEST_KEY");
      if ((state.balances.get(definition.id) ?? 0n) < quantity) throw new Error("ITEM_BALANCE_INSUFFICIENT");
    },
    add: async (definition, quantity, context) => {
      calls.push(`add:${definition.id}:${quantity}:${context.requestKey}`);
      if (definition.id === failOnAddItemId) throw new Error("FIXTURE_ADD_FAILURE");
      state.balances.set(definition.id, (state.balances.get(definition.id) ?? 0n) + quantity);
    },
    remove: async (definition, quantity, context) => {
      calls.push(`remove:${definition.id}:${quantity}:${context.requestKey}`);
      state.balances.set(definition.id, (state.balances.get(definition.id) ?? 0n) - quantity);
    }
  };
  const items = new ItemProvider({ findById: async (id) => definitions.get(id) });
  for (const type of ["STACK", "POINT", "GUILD_RESOURCE", "MINI_PET", "FURNITURE", "MEMBER_TITLE"] as const) {
    items.register(type, handler);
  }
  let transactionSequence = 0;
  const transactions: PackageTransactionManager = {
    run: async (work) => {
      const snapshot = cloneState(state);
      try {
        const result = await work({ id: `fixture-tx-${++transactionSequence}` });
        const requestKey = calls.at(-1)?.split(":").at(-1);
        if (requestKey) state.completedRequestKeys.add(requestKey);
        return result;
      } catch (error) {
        restoreState(state, snapshot);
        throw error;
      }
    }
  };
  return { items, state, transactions, calls };
}

describe("independent package DB parity fixture", () => {
  it("contains exactly 32 unique command, package, command-id and consumer mappings", () => {
    assert.equal(INDEPENDENT_PACKAGE_FIXTURES.length, 32);
    assert.equal(new Set(INDEPENDENT_PACKAGE_FIXTURES.map((entry) => entry.legacyCommand)).size, 32);
    assert.equal(new Set(INDEPENDENT_PACKAGE_FIXTURES.map((entry) => entry.packageId)).size, 32);
    assert.equal(new Set(INDEPENDENT_PACKAGE_FIXTURES.map((entry) => entry.commandId)).size, 32);
    assert.equal(new Set(INDEPENDENT_PACKAGE_FIXTURES.map((entry) => entry.consumeItemId)).size, 32);
    for (const entry of INDEPENDENT_PACKAGE_FIXTURES) {
      assert.match(entry.legacyCommand, /^\//);
      assert.match(entry.packageId, /^PKG-\d{3}$/);
      assert.equal(entry.packageId, `PKG-${entry.commandId}`);
      assert.equal(entry.consumeQuantity, 1n);
      assert.ok(entry.fixedRewards.length + entry.dynamicRules.length > 0, `${entry.legacyCommand} has no reward definition`);
    }
  });

  it("preserves the extracted fixed-reward row count for every legacy command", () => {
    assert.equal(Object.keys(LEGACY_FIXED_REWARD_COUNTS).length, 32);
    for (const entry of INDEPENDENT_PACKAGE_FIXTURES) {
      assert.equal(entry.fixedRewards.length, LEGACY_FIXED_REWARD_COUNTS[entry.legacyCommand], entry.legacyCommand);
      for (const reward of entry.fixedRewards) {
        assert.ok(reward.quantity > 0n, `${entry.legacyCommand}:${reward.itemId}`);
        assert.equal(reward.operation, "ADD");
        assert.ok(reward.itemId.length > 0);
        assert.ok(reward.name.length > 0);
      }
    }
  });

  it("keeps high-risk fixed parity values explicit", () => {
    const emperor = findFixture("/황제패키지오픈3");
    assert.equal(emperor.fixedRewards.find((reward) => reward.itemId === "ITEM-RWD-011")?.quantity, 3_000_000_000n);
    assert.equal(emperor.fixedRewards.find((reward) => reward.itemId === "ITEM-RWD-025")?.quantity, 100_000n);
    assert.equal(emperor.fixedRewards.find((reward) => reward.itemType === "MEMBER_TITLE")?.metadata?.price, "100000000");

    const yakitori = findFixture("/이랏싸이마쎄");
    assert.equal(yakitori.fixedRewards.filter((reward) => reward.itemType === "MINI_PET").length, 10);
    assert.equal(yakitori.fixedRewards.find((reward) => reward.itemId === "ITEM-PACKAGE-105")?.quantity, 2_500n);

    const legacyTypo = findFixture("/고생하셨습니다").fixedRewards
      .find((reward) => reward.itemId === "ITEM-RWD-004");
    assert.equal(legacyTypo?.name, "길드창고패키지🧳(/길드창고패키지오픈");
  });

  it("preserves all seven dynamic packages without flattening them into fixed grants", () => {
    assert.equal(Object.keys(LEGACY_DYNAMIC_RULE_KINDS).length, 7);
    for (const [command, expectedKinds] of Object.entries(LEGACY_DYNAMIC_RULE_KINDS)) {
      const fixture = findFixture(command);
      assert.deepEqual(fixture.dynamicRules.map((rule) => rule.kind), expectedKinds);
    }

    const fishing = findFixture("/낚시오픈").dynamicRules[0];
    assert.equal(fishing?.kind, "WEIGHTED_ONE");
    if (fishing?.kind === "WEIGHTED_ONE") {
      assert.equal(fishing.failureWeight, 0.3);
      assert.equal(fishing.legacySuccessWeightTotal, 0.861);
      assert.equal(fishing.choices.length, 20);
      assert.equal(fishing.choices.find((choice) => choice.name === "황금잉어👑")?.legacyWeight, 0.001);
    }

    const miniPetDraw = findFixture("/미니펫오픈").dynamicRules[0];
    assert.equal(miniPetDraw?.kind, "CATALOG_RANDOM");
    if (miniPetDraw?.kind === "CATALOG_RANDOM") {
      assert.equal(miniPetDraw.maxSuccessCount, 3_000);
      assert.equal(miniPetDraw.consumeOnlySuccessCount, true);
      assert.equal(miniPetDraw.capacityPolicy, "START_MUST_HAVE_SPACE");
    }
  });

  it("models signed point loss as REMOVE with an always-positive mutation quantity", () => {
    const hell = findFixture("/나락오픈").dynamicRules[0];
    assert.equal(hell?.kind, "RANDOM_INTEGER");
    if (hell?.kind !== "RANDOM_INTEGER") return;
    assert.equal(hell.min, -10_000_000n);
    assert.equal(hell.max, 19_000_000n);
    assert.equal(hell.step, 1_000_000n);
    assert.equal(hell.negativeOperation, "REMOVE");
    for (let result = hell.min; result <= hell.max; result += hell.step) {
      const selectedOperation: "ADD" | "REMOVE" = result < 0n ? hell.negativeOperation : hell.positiveOperation;
      const mutationQuantity = result < 0n ? -result : result;
      assert.ok(mutationQuantity >= 0n);
      if (result < 0n) {
        assert.equal(selectedOperation, "REMOVE");
        assert.ok(mutationQuantity > 0n);
      }
    }
  });
});

describe("package provider DB fixture safety", () => {
  it("checks all mutations, consumes openCount and scales fixed rewards", async () => {
    const fixture = findFixture("/루비오픈");
    const harness = makeStackHarness(fixture, 5n);
    const provider = new PackageProvider(makeRepository(fixture), harness.items, harness.transactions);

    await provider.use({ requestKey: "request-ruby-1", userId: "user-1", packageId: fixture.packageId, openCount: 2 });

    assert.equal(harness.state.balances.get(fixture.consumeItemId), 3n);
    assert.equal(harness.state.balances.get("ITEM-RWD-042"), 240n);
    assert.equal(harness.state.balances.get("ITEM-RWD-065"), 8n);
    assert.equal(harness.state.balances.get("ITEM-RWD-026"), 2_600n);
    assert.deepEqual(harness.calls.map((call) => call.split(":")[0]), [
      "checkRemove", "checkAdd", "checkAdd", "checkAdd", "remove", "add", "add", "add"
    ]);
    assert.ok(harness.calls.every((call) => call.endsWith(":request-ruby-1")));
  });

  it("rolls back consumer and earlier rewards when a later reward fails", async () => {
    const fixture = findFixture("/루비오픈");
    const harness = makeStackHarness(fixture, 5n, "ITEM-RWD-065");
    const provider = new PackageProvider(makeRepository(fixture), harness.items, harness.transactions);

    await assert.rejects(
      () => provider.use({ requestKey: "request-rollback-1", userId: "user-1", packageId: fixture.packageId, openCount: 2 }),
      /FIXTURE_ADD_FAILURE/
    );

    assert.deepEqual([...harness.state.balances.entries()], [[fixture.consumeItemId, 5n]]);
    assert.equal(harness.state.completedRequestKeys.has("request-rollback-1"), false);
  });

  it("rejects a completed request key before duplicate consumer or reward mutation", async () => {
    const fixture = findFixture("/루비오픈");
    const harness = makeStackHarness(fixture, 5n);
    const provider = new PackageProvider(makeRepository(fixture), harness.items, harness.transactions);
    const request = { requestKey: "request-idempotent-1", userId: "user-1", packageId: fixture.packageId, openCount: 1 };

    await provider.use(request);
    const afterFirst = [...harness.state.balances.entries()];
    await assert.rejects(() => provider.use(request), /DUPLICATE_REQUEST_KEY/);

    assert.deepEqual([...harness.state.balances.entries()], afterFirst);
    assert.equal(harness.calls.filter((call) => call.startsWith("remove:")).length, 1);
    assert.equal(harness.calls.filter((call) => call.startsWith("add:")).length, 3);
  });

  it("does not represent dynamic packages as unconditional repository rewards", async () => {
    for (const command of Object.keys(LEGACY_DYNAMIC_RULE_KINDS)) {
      const fixture = findFixture(command);
      if (fixture.fixedRewards.length > 0) continue;
      const repository = makeRepository(fixture);
      assert.deepEqual(await repository.listRewards(fixture.packageId), []);
    }
  });
});

