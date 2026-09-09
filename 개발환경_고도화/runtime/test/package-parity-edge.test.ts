import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ItemProvider, type ItemDefinition, type ItemMutationContext, type ItemTypeHandler } from "../src/package/item-provider.js";
import { PackageProvider, type PackageCatalogRepository } from "../src/package/package-provider.js";
import { parsePackageCommand } from "../src/package/package-command.js";

describe("package command legacy boundary parity", () => {
  it("accepts legacy whitespace forms and the maximum open count", () => {
    assert.deepEqual(parsePackageCommand("/패키지사용  1"), { kind: "PACKAGE_USE", bagNumber: 1, openCount: 1 });
    assert.deepEqual(parsePackageCommand("/패키지사용\t1\t1000"), { kind: "PACKAGE_USE", bagNumber: 1, openCount: 1000 });
  });

  it("rejects negative, decimal, suffix and outer whitespace forms", () => {
    for (const message of [
      "/패키지사용 -1",
      "/패키지사용 1.5",
      "/패키지사용 1 2 안내",
      " /패키지사용 1",
      "/패키지사용 1 ",
    ]) {
      assert.equal(parsePackageCommand(message).kind, "INVALID", message);
    }
    assert.deepEqual(parsePackageCommand("/패키지사용 1 0"), { kind: "INVALID", reason: "OPEN_COUNT" });
    assert.deepEqual(parsePackageCommand("/패키지사용 1 1001"), { kind: "INVALID", reason: "OPEN_COUNT" });
  });
});

describe("empty package reward parity", () => {
  it("commits only the package consumption when an enabled rule repository resolves no rewards", async () => {
    const consumer: ItemDefinition = {
      id: "ITEM-EMPTY-PACKAGE",
      type: "STACK",
      name: "빈 패키지",
      stackable: true,
      metadata: {},
      enabled: true,
    };
    let balance = 2n;
    const handler: ItemTypeHandler = {
      checkAdd: async () => undefined,
      checkRemove: async (_definition, quantity) => {
        if (balance < quantity) throw new Error("ITEM_BALANCE_INSUFFICIENT");
      },
      add: async () => undefined,
      remove: async (_definition, quantity) => { balance -= quantity; },
    };
    const items = new ItemProvider({ findById: async () => consumer });
    items.register("STACK", handler);
    const repository: PackageCatalogRepository & {
      listRewardRules: () => Promise<[]>;
      listDynamicRewardItems: () => Promise<[]>;
    } = {
      getSnapshot: async () => ({ version: "edge", packages: [] }),
      findByLegacyCommand: async () => undefined,
      findById: async () => ({
        id: "PKG-EMPTY",
        catalogVersion: "edge",
        displayName: "빈 패키지",
        legacyCommand: "/빈패키지",
        consumeItemId: consumer.id,
        definitionStatus: "READY",
        enabled: true,
        maxOpenCount: 10,
      }),
      listRewards: async () => [],
      listRewardRules: async () => [],
      listDynamicRewardItems: async () => [],
    };
    const transactionHandle = {};
    const provider = new PackageProvider(repository, items, {
      run: async (work) => work({ id: "edge-tx", handle: transactionHandle }),
    });
    const result = await provider.use({
      requestKey: "edge-empty",
      userId: "1",
      packageId: "PKG-EMPTY",
      openCount: 1,
    });
    assert.deepEqual(result, { packageId: "PKG-EMPTY", openCount: 1, rewardCount: 0 });
    assert.equal(balance, 1n);
  });
});
