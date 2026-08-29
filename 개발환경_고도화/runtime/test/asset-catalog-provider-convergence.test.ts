import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ItemProvider,
  type ItemDefinition,
  type ItemMutationContext,
  type ItemType,
  type ItemTypeHandler,
} from "../src/package/item-provider.js";
import { PackageRewardTargetRegistry } from "../src/package/reward-target-registry.js";

const definition = (type: ItemType): ItemDefinition => ({
  id: `TEST-${type}`,
  type,
  name: type,
  stackable: type === "STACK",
  metadata: {},
  enabled: true,
});

class RecordingHandler implements ItemTypeHandler {
  calls = 0;
  async checkAdd(): Promise<void> { this.calls += 1; }
  async checkRemove(): Promise<void> { this.calls += 1; }
  async add(): Promise<void> { this.calls += 1; }
  async remove(): Promise<void> { this.calls += 1; }
}

const context = (overrides: Partial<ItemMutationContext> = {}): ItemMutationContext => ({
  ownerType: "USER",
  ownerId: "player-1",
  actorUserId: "player-1",
  transactionId: "tx-1",
  requestKey: "request-1",
  operation: "ADD",
  ...overrides,
});

const providerFor = (type: ItemType): [ItemProvider, RecordingHandler] => {
  const handler = new RecordingHandler();
  const provider = new ItemProvider(
    { findById: async () => definition(type) },
    new PackageRewardTargetRegistry(),
  );
  provider.register(type, handler);
  return [provider, handler];
};

describe("asset catalog provider convergence", () => {
  it("routes user stack rewards through the canonical ItemProvider", async () => {
    const [provider, handler] = providerFor("STACK");
    await provider.add("TEST-STACK", 2n, context());
    assert.equal(handler.calls, 1);
  });

  it("rejects a guild resource routed to a user owner", async () => {
    const [provider, handler] = providerFor("GUILD_RESOURCE");
    await assert.rejects(
      provider.add("TEST-GUILD_RESOURCE", 1n, context()),
      /PACKAGE_REWARD_OWNER_INVALID:GUILD_RESOURCE:GUILD/,
    );
    assert.equal(handler.calls, 0);
  });

  it("requires a stable pet target for pet titles", async () => {
    const [provider, handler] = providerFor("PET_TITLE");
    await assert.rejects(
      provider.add("TEST-PET_TITLE", 1n, context({ ownerType: "PET", ownerId: "pet-1" })),
      /PACKAGE_REWARD_TARGET_REQUIRED:PET_TITLE/,
    );
    await provider.add("TEST-PET_TITLE", 1n, context({
      ownerType: "PET",
      ownerId: "pet-1",
      targetSelector: "pet-1",
    }));
    assert.equal(handler.calls, 1);
  });

  it("allows pet appearance only as a replace mutation", async () => {
    const [provider, handler] = providerFor("PET_APPEARANCE");
    const pet = { ownerType: "PET" as const, ownerId: "pet-1", targetSelector: "pet-1" };
    await assert.rejects(
      provider.add("TEST-PET_APPEARANCE", 1n, context(pet)),
      /PACKAGE_REWARD_REPLACE_REQUIRED:PET_APPEARANCE/,
    );
    await provider.add("TEST-PET_APPEARANCE", 1n, context({ ...pet, operation: "REPLACE" }));
    assert.equal(handler.calls, 1);
  });
});
