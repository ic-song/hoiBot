import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GuildTerritoryReadModelService } from "../src/guild/guild-territory-read-model-service.js";
import type {
  GuildTerritoryReadModel,
  GuildTerritoryReadModelRepository,
  GuildTerritoryReadRequest,
  GuildTerritoryRememberPreference,
  SetGuildTerritoryRememberPreference
} from "../src/guild/guild-territory-read-model-repository.js";

const emptyModel: GuildTerritoryReadModel = {
  season: { state: "no-war", season: null }, pin: null, turnOrder: [], rankingSnapshot: null,
  rewardGuide: null, rememberPreference: null
};

// Territory service inputs and repository results are captured without DB or fixture access.
function createRepository(model: GuildTerritoryReadModel = emptyModel) {
  const reads: GuildTerritoryReadRequest[] = [];
  const writes: SetGuildTerritoryRememberPreference[] = [];
  const repository: GuildTerritoryReadModelRepository = {
    readConsistent: async (request) => { reads.push(request); return model; },
    setRememberPreference: async (command): Promise<GuildTerritoryRememberPreference> => {
      writes.push(command);
      return { ...command, version: 1n };
    }
  };
  return { repository, reads, writes };
}

describe("guild territory read-model service", () => {
  it("expresses no-war and missing projections as null and empty values", async () => {
    const scripted = createRepository();
    const result = await new GuildTerritoryReadModelService(scripted.repository).read({ territoryScope: "world" });
    assert.deepEqual(result, emptyModel);
    assert.deepEqual(scripted.reads, [{ territoryScope: "world", seasonPin: undefined, rulePin: undefined, remember: undefined }]);
  });

  it("preserves season, snapshot and rule pins for deterministic projection reads", async () => {
    const scripted = createRepository();
    await new GuildTerritoryReadModelService(scripted.repository).read({
      territoryScope: " world ",
      seasonPin: { seasonId: "77", snapshotVersion: 4n },
      rulePin: { territoryScope: "world", ruleVersion: 9n }
    });
    assert.deepEqual(scripted.reads[0], {
      territoryScope: "world", seasonPin: { seasonId: "77", snapshotVersion: 4n },
      rulePin: { territoryScope: "world", ruleVersion: 9n }, remember: undefined
    });
  });

  it("keeps an explicit false desired state for operator and player scope", async () => {
    const scripted = createRepository();
    const result = await new GuildTerritoryReadModelService(scripted.repository).setRememberPreference({
      territoryScope: "world", operatorPlayerId: "10", playerId: "20", desiredState: false
    });
    assert.equal(result.desiredState, false);
    assert.deepEqual(scripted.writes, [{ territoryScope: "world", operatorPlayerId: "10", playerId: "20", desiredState: false }]);
  });

  it("does not expose payout mutation ownership", () => {
    const scripted = createRepository();
    const service = new GuildTerritoryReadModelService(scripted.repository);
    assert.equal("payout" in service, false);
  });
});
