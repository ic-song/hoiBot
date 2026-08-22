import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { GuildTerritoryReadModelService } from "../src/guild/guild-territory-read-model-service.js";
import { MariaGuildTerritoryReadModelRepository } from "../src/guild/maria-guild-territory-read-model-repository.js";

const database = createDatabaseClient(loadConfig().database);
const service = new GuildTerritoryReadModelService(new MariaGuildTerritoryReadModelRepository(database));

// Read-side table and payout-adjacent counts expose unintended mutation without operating payout logic.
async function readMutationCounts() {
  const rows = await database.query<Array<{
    seasons: bigint; snapshots: bigint; turns: bigint; rankings: bigint; rules: bigint;
    operations: bigint; audits: bigint; outboxes: bigint;
  }>>(
    `SELECT
      (SELECT COUNT(*) FROM guild_territory_seasons) AS seasons,
      (SELECT COUNT(*) FROM guild_territory_ranking_snapshots) AS snapshots,
      (SELECT COUNT(*) FROM guild_territory_turn_order_entries) AS turns,
      (SELECT COUNT(*) FROM guild_territory_ranking_entries) AS rankings,
      (SELECT COUNT(*) FROM guild_territory_reward_rule_versions) AS rules,
      (SELECT COUNT(*) FROM operations) AS operations,
      (SELECT COUNT(*) FROM command_audit) AS audits,
      (SELECT COUNT(*) FROM outbox_messages) AS outboxes`
  );
  return rows[0]!;
}

// Synthetic territory projections verify state, version, ordering, missing policy and explicit preference writes.
async function main(): Promise<void> {
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
  const afterRead = await readMutationCounts();

  assert.equal(active.season.state, "active");
  assert.equal(active.pin?.snapshotVersion, 7n);
  assert.deepEqual(active.turnOrder.map((entry) => entry.ordinal), [1, 2, 3]);
  assert.deepEqual(active.turnOrder.map((entry) => entry.player?.playerId), ["900000003", "900000001", "900000002"]);
  assert.deepEqual(active.turnOrder.map((entry) => entry.player?.rankProjection?.label),
    ["🧪테스트감마", "🧪테스트알파", "🧪테스트베타"]);
  assert.deepEqual(active.turnOrder.map((entry) => entry.player?.rankProjection?.sourceCode),
    ["synthetic-fixture", "synthetic-fixture", "synthetic-fixture"]);
  assert.deepEqual(active.turnOrder.map((entry) => entry.player?.rankProjection?.version), [1n, 1n, 1n]);
  assert.deepEqual(active.turnOrder.map((entry) => entry.visibility.visible), [true, false, false]);
  assert.equal(active.turnOrder[1]?.visibility.userEliminated, true);
  assert.equal(active.turnOrder[1]?.visibility.exclusionReasonCode, "TURN_MISMATCH");
  assert.equal(active.turnOrder[2]?.visibility.guildEliminated, true);
  assert.equal(active.turnOrder[2]?.visibility.exclusionReasonCode, "GREAT_RIFT");
  assert.equal(active.turnOrder[2]?.visibility.projectionIssue, "missing-guild");
  assert.deepEqual(active.rankingSnapshot?.entries.slice(0, 2).map((entry) => entry.guild?.guildId), ["900000001", "900000002"]);
  assert.equal(active.rankingSnapshot?.entries[2]?.guild, null);
  assert.equal(active.rankingSnapshot?.rulePin.ruleVersion, 2n);
  assert.equal(active.rewardGuide?.pin.ruleVersion, 2n);
  assert.equal(active.rememberPreference?.desiredState, true);
  assert.equal(pending.season.state, "pending");
  assert.equal(pending.rankingSnapshot, null);
  assert.deepEqual(pending.turnOrder, []);
  assert.deepEqual(noWar.season, { state: "no-war", season: null });
  assert.equal(missingSnapshot.rankingSnapshot, null);
  assert.deepEqual(missingSnapshot.turnOrder, []);
  assert.equal(missingRule.rewardGuide, null);
  assert.deepEqual(afterRead, beforeRead);

  const rememberedTrue = await service.setRememberPreference({
    territoryScope: "world-active", operatorPlayerId: "900000001", playerId: "900000003", desiredState: true
  });
  const rememberedFalse = await service.setRememberPreference({
    territoryScope: "world-active", operatorPlayerId: "900000001", playerId: "900000003", desiredState: false
  });
  assert.equal(rememberedTrue.desiredState, true);
  assert.equal(rememberedFalse.desiredState, false);

  const afterRemember = await readMutationCounts();
  assert.equal(afterRemember.seasons, beforeRead.seasons);
  assert.equal(afterRemember.snapshots, beforeRead.snapshots);
  assert.equal(afterRemember.turns, beforeRead.turns);
  assert.equal(afterRemember.rankings, beforeRead.rankings);
  assert.equal(afterRemember.rules, beforeRead.rules);
  assert.equal(afterRemember.operations, beforeRead.operations);
  assert.equal(afterRemember.audits, beforeRead.audits);
  assert.equal(afterRemember.outboxes, beforeRead.outboxes);

  console.log(JSON.stringify({ active, pending, noWar, missingSnapshot, missingRule, rememberedTrue, rememberedFalse },
    (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
