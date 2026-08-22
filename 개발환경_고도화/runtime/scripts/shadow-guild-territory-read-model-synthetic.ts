import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { GuildTerritoryReadModelService } from "../src/guild/guild-territory-read-model-service.js";
import type { GuildTerritoryRewardTier } from "../src/guild/guild-territory-read-model-repository.js";
import { MariaGuildTerritoryReadModelRepository } from "../src/guild/maria-guild-territory-read-model-repository.js";

const phaseArgument = process.argv.find((value) => value.startsWith("--phase="));
const phase = phaseArgument?.slice("--phase=".length) ?? "initial";
const database = createDatabaseClient(loadConfig().database);
const service = new GuildTerritoryReadModelService(new MariaGuildTerritoryReadModelRepository(database));

const LEGACY_VISIBLE_TURN_GUILDS = ["900000002", "900000001"];
const LEGACY_VISIBLE_RANKING_GUILDS = ["900000001", "900000002"];
const LEGACY_RANK_FUNDS = [500000000, 400000000, 300000000, 200000000, 100000000, 50000000];
const LEGACY_FINISH_REWARDS = [
  { taxRatePercent: 15 },
  { petSkillBookFragment: 5 },
  { pendantStone: 5 },
  { petStone: 200 },
  { miniPetStone: 150 },
  { diamond: 20 },
  { guildFund: 2000000000, territoryScore: 100 }
];

// Synthetic markers and payout-adjacent tables are counted before and after Shadow reads.
async function readMutationCounts() {
  const rows = await database.query<Array<{
    seasons: bigint; snapshots: bigint; turns: bigint; rankings: bigint; rule_versions: bigint; rule_tiers: bigint;
    remember_rows: bigint; operations: bigint; audits: bigint; outboxes: bigint;
  }>>(
    `SELECT
      (SELECT COUNT(*) FROM guild_territory_seasons) AS seasons,
      (SELECT COUNT(*) FROM guild_territory_ranking_snapshots) AS snapshots,
      (SELECT COUNT(*) FROM guild_territory_turn_order_entries) AS turns,
      (SELECT COUNT(*) FROM guild_territory_ranking_entries) AS rankings,
      (SELECT COUNT(*) FROM guild_territory_reward_rule_versions) AS rule_versions,
      (SELECT COUNT(*) FROM guild_territory_reward_rule_tiers) AS rule_tiers,
      (SELECT COUNT(*) FROM guild_territory_remember_preferences) AS remember_rows,
      (SELECT COUNT(*) FROM operations) AS operations,
      (SELECT COUNT(*) FROM command_audit) AS audits,
      (SELECT COUNT(*) FROM outbox_messages) AS outboxes`
  );
  return rows[0]!;
}

// Numeric reward values are read without depending on JSON driver decoding details.
function readRewardNumber(tier: GuildTerritoryRewardTier, key: string): number {
  const reward = tier.reward as Record<string, unknown>;
  const value = reward[key];
  assert.equal(typeof value, "number");
  return value as number;
}

// Legacy-visible territory behavior and provider safety additions are compared in one isolated Shadow pass.
async function main(): Promise<void> {
  let passCount = 0;
  const beforeRead = await readMutationCounts();
  const active = await service.read({
    territoryScope: "world-active",
    remember: { operatorPlayerId: "900000001", playerId: "900000002" }
  });
  const pending = await service.read({ territoryScope: "world-pending" });
  const noWar = await service.read({ territoryScope: "world-empty" });
  const missingSnapshot = await service.read({
    territoryScope: "world-active", seasonPin: { seasonId: "910000001", snapshotVersion: 999n }
  });
  const missingRule = await service.read({
    territoryScope: "world-active", rulePin: { territoryScope: "world", ruleVersion: 999n }
  });
  const finishGuide = await service.read({
    territoryScope: "world-empty", rulePin: { territoryScope: "world-finish", ruleVersion: 1n }
  });
  const afterRead = await readMutationCounts();

  assert.equal(active.season.state, "active");
  assert.equal(active.pin?.snapshotVersion, 7n);
  passCount++;
  assert.equal(pending.season.state, "pending");
  assert.equal(pending.rankingSnapshot, null);
  passCount++;
  assert.deepEqual(noWar.season, { state: "no-war", season: null });
  passCount++;

  const visibleTurns = active.turnOrder.filter((entry) => entry.guild !== null).map((entry) => entry.guild!.guildId);
  assert.deepEqual(visibleTurns, LEGACY_VISIBLE_TURN_GUILDS);
  passCount++;
  assert.equal(active.turnOrder[2]?.guild, null);
  passCount++;

  const visibleRanking = active.rankingSnapshot!.entries.filter((entry) => entry.guild !== null).map((entry) => entry.guild!.guildId);
  assert.deepEqual(visibleRanking, LEGACY_VISIBLE_RANKING_GUILDS);
  passCount++;
  assert.deepEqual(active.rankingSnapshot!.entries.slice(0, 2).map((entry) => [entry.score, entry.lastScoredAt, entry.guild!.guildId]), [
    [5000n, active.rankingSnapshot!.entries[0]!.lastScoredAt, "900000001"],
    [5000n, active.rankingSnapshot!.entries[0]!.lastScoredAt, "900000002"]
  ]);
  passCount++;

  assert.equal(active.rankingSnapshot!.rulePin.ruleVersion, 2n);
  assert.deepEqual(active.rewardGuide!.tiers.map((tier) => readRewardNumber(tier, "fund")), LEGACY_RANK_FUNDS);
  passCount++;
  const finishTiers = finishGuide.rewardGuide!.tiers;
  assert.deepEqual(finishTiers.map((tier, index) => {
    const expected = LEGACY_FINISH_REWARDS[index]!;
    return Object.fromEntries(Object.keys(expected).map((key) => [key, readRewardNumber(tier, key)]));
  }), LEGACY_FINISH_REWARDS);
  passCount++;

  assert.equal(missingSnapshot.rankingSnapshot, null);
  assert.deepEqual(missingSnapshot.turnOrder, []);
  assert.equal(missingRule.rewardGuide, null);
  passCount++;
  assert.deepEqual(afterRead, beforeRead);
  passCount++;

  const trueResult = await service.setRememberPreference({
    territoryScope: "world-active", operatorPlayerId: "900000001", playerId: "900000003", desiredState: true
  });
  const falseResult = await service.setRememberPreference({
    territoryScope: "world-active", operatorPlayerId: "900000001", playerId: "900000003", desiredState: false
  });
  const beforeDuplicate = await readMutationCounts();
  const duplicateFalse = await service.setRememberPreference({
    territoryScope: "world-active", operatorPlayerId: "900000001", playerId: "900000003", desiredState: false
  });
  const afterDuplicate = await readMutationCounts();
  assert.equal(trueResult.desiredState, true);
  assert.equal(falseResult.desiredState, false);
  assert.equal(duplicateFalse.desiredState, false);
  passCount++;
  assert.equal(afterDuplicate.remember_rows, beforeDuplicate.remember_rows);
  assert.deepEqual({ ...afterDuplicate, remember_rows: beforeDuplicate.remember_rows }, beforeDuplicate);
  passCount++;

  console.log(JSON.stringify({
    phase, passCount, snapshotVersion: active.pin?.snapshotVersion, ruleVersion: active.rewardGuide?.pin.ruleVersion,
    visibleTurns, visibleRanking, missingGuild: active.rankingSnapshot?.entries[2]?.guild ?? null,
    remember: { trueVersion: trueResult.version, falseVersion: falseResult.version, duplicateVersion: duplicateFalse.version,
      desiredState: duplicateFalse.desiredState, rowCount: afterDuplicate.remember_rows },
    mutationZero: afterRead
  }, (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
