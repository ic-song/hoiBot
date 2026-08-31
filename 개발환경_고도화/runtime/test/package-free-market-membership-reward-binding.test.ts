import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

type LegacyReward = { type: string; name?: string; count: number };
type LegacyPackage = { id: string; name: string; desc: string; enabled: boolean; maxUseOnce: number; rewards: LegacyReward[] };
type Fixture = {
  source: { packageId: string; displayName: string; enabled: boolean; maxUseOnce: number; rewardIndex: number; rewardType: string; rewardDisplayName: string; rewardQuantity: string; sourceRewardCount: number; scopedRewardCount: number; excludedReward: string };
  binding: { packageId: string; consumeItemCode: string; catalogVersion: string; definitionStatus: string; rewardRuleId: string; canonicalItemCode: string; itemType: string; quantity: string; ownershipTable: string; ledgerTable: string };
  counts: Record<string, number>;
  hashes: { sourceProjectionSha256: string; bindingProjectionSha256: string };
  scopeGuards: Record<string, boolean>;
};

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../migration-control/fixtures/synthetic-relational/package-free-market-membership-reward-binding-v1.json",
  import.meta.url,
)), "utf8")) as Fixture;
const legacy = JSON.parse(readFileSync(fileURLToPath(new URL("../../../data/packageInfo.json", import.meta.url)), "utf8")) as LegacyPackage[];
const migration = readFileSync(fileURLToPath(new URL("../migrations/412_package_free_market_membership_reward_binding.sql", import.meta.url)), "utf8");
const rollback = readFileSync(fileURLToPath(new URL("../../migration-control/rollback/412_package_free_market_membership_reward_binding.sql", import.meta.url)), "utf8");
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

describe("Lease2417 package_5 free market membership reward binding", () => {
  it("freezes the exact active legacy package and scoped first reward", () => {
    const source = legacy.filter((entry) => entry.id === fixture.source.packageId);
    assert.equal(source.length, 1);
    const package5 = source[0]!;
    assert.equal(package5.name, fixture.source.displayName);
    assert.equal(package5.enabled, fixture.source.enabled);
    assert.equal(package5.maxUseOnce, fixture.source.maxUseOnce);
    assert.equal(package5.rewards.length, fixture.source.sourceRewardCount);
    const reward = package5.rewards[fixture.source.rewardIndex]!;
    assert.deepEqual(reward, { type: fixture.source.rewardType, name: fixture.source.rewardDisplayName, count: Number(fixture.source.rewardQuantity) });
    assert.equal(`${package5.rewards[1]!.name}:${package5.rewards[1]!.count}`, fixture.source.excludedReward);
    assert.equal(fixture.source.scopedRewardCount, 1);
    assert.equal(sha256([package5.id, package5.name, package5.enabled, package5.maxUseOnce, fixture.source.rewardIndex, reward.type, reward.name, reward.count].join("|")), fixture.hashes.sourceProjectionSha256);
  });

  it("pins package1 and reward rule1 to the canonical STACK identity", () => {
    assert.deepEqual(fixture.counts, {
      sourcePackage: 1, catalogPackage: 1, scopedRewardRule: 1, canonicalRewardTarget: 1,
      commandAlias: 0, packageItemBalanceWrites: 0, packageItemInstanceWrites: 0, packageItemLedgerWrites: 0,
    });
    assert.equal(sha256([
      fixture.binding.packageId, fixture.binding.consumeItemCode, fixture.binding.canonicalItemCode,
      fixture.binding.quantity, fixture.binding.itemType, fixture.binding.ownershipTable, fixture.binding.ledgerTable,
    ].join("|")), fixture.hashes.bindingProjectionSha256);
    assert.match(migration, /\('package_5','LEGACY-PACKAGEINFO-v1'/);
    assert.match(migration, /'RULE-PACKAGE-5-FREE-MARKET-MEMBERSHIP-001','package_5',1,'ALL','ALL','ADD','USER',\s*\n\s*'free_market_membership',1/);
    assert.equal((migration.match(/INSERT INTO package_catalog/g) ?? []).length, 1);
    assert.equal((migration.match(/INSERT INTO package_reward_rules/g) ?? []).length, 1);
    assert.doesNotMatch(migration, /INSERT INTO package_item_(?:balances|instances|ledger)/);
  });

  it("keeps command, ownership, pass, benefit, provider and schema scope closed", () => {
    assert.match(migration, /DELETE FROM package_command_aliases WHERE package_id='package_5'/);
    assert.deepEqual(fixture.scopeGuards, {
      legacySourceDeleted: false, passModelChanged: false, marketBenefitChanged: false,
      runtimeChanged: false, providerChanged: false, schemaChanged: false,
      mainChanged: false, uiChanged: false, gate8: false,
    });
  });

  it("rolls back only the new binding and preserves the canonical reward definition", () => {
    assert.match(rollback, /DELETE FROM package_reward_rules/);
    assert.match(rollback, /DELETE FROM package_catalog WHERE package_id='package_5'/);
    assert.match(rollback, /DELETE FROM package_item_definitions WHERE item_id='package_5'/);
    assert.doesNotMatch(rollback, /WHERE (?:code|item_id)='free_market_membership'/);
    assert.match(rollback, /canonical reward target free_market_membership.*보존/);
  });

  it("replays source and binding Shadow hashes deterministically", () => {
    const source = legacy.find((entry) => entry.id === fixture.source.packageId)!;
    const reward = source.rewards[fixture.source.rewardIndex]!;
    const sourceProjection = [source.id, source.name, source.enabled, source.maxUseOnce, fixture.source.rewardIndex, reward.type, reward.name, reward.count].join("|");
    const bindingProjection = [fixture.binding.packageId, fixture.binding.consumeItemCode, fixture.binding.canonicalItemCode, fixture.binding.quantity, fixture.binding.itemType, fixture.binding.ownershipTable, fixture.binding.ledgerTable].join("|");
    assert.equal(sha256(sourceProjection), sha256(sourceProjection));
    assert.equal(sha256(bindingProjection), sha256(bindingProjection));
    assert.equal(sha256(sourceProjection), fixture.hashes.sourceProjectionSha256);
    assert.equal(sha256(bindingProjection), fixture.hashes.bindingProjectionSha256);
  });
});
