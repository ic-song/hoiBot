import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccountPlatformActiveMemberAuthorityProvider } from "../src/account-platform/active-member-authority-provider.js";

function database(queryRows: readonly (readonly object[])[]) {
  const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
  let index = 0;
  return { queries, participant: { query: async <T>(sql: string, values: readonly unknown[] = []) => { queries.push({ sql, values }); return (queryRows[index++] ?? []) as T; } } };
}

const owner = (canonicalPlayerId: string, sourceIdentifier: string) => ({ canonical_player_id: canonicalPlayerId, source_system: "LEGACY_DB", source_identifier: sourceIdentifier });
const member = (legacyPlayerId: bigint, overrides: object = {}) => ({ legacy_player_id: legacyPlayerId, player_status: "active", deleted_at: null, profile_player_id: legacyPlayerId, portal_game_account_link_id: null, link_status: null, portal_account_status: null, ...overrides });

describe("account platform active member authority", () => {
  it("preserves active representative, sub, and unlinked legacy owners without using room selections as global membership", async () => {
    const current = database([[owner("player01", "11"), owner("player02", "22"), owner("player03", "33")], [], [{ legacy_player_id: 11n, canonical_player_id: "player01" }, { legacy_player_id: 22n, canonical_player_id: "player02" }, { legacy_player_id: 33n, canonical_player_id: "player03" }], [], [member(11n, { portal_game_account_link_id: "link0001", link_status: "ACTIVE", portal_account_status: "ACTIVE" }), member(22n, { portal_game_account_link_id: "link0002", link_status: "ACTIVE", portal_account_status: "ACTIVE" }), member(33n)]]);
    assert.deepEqual((await new AccountPlatformActiveMemberAuthorityProvider().lockSnapshot(current.participant)).activeCanonicalPlayerIds, ["player01", "player02", "player03"]);
    assert.equal(current.queries.some(({ sql }) => /account_platform_(?:contexts|context_memberships|active_player_selections)/.test(sql)), false);
    assert.deepEqual(current.queries[4]!.values, ["11", "22", "33"]);
  });

  it("uses a linked crosswalk for non-numeric canonical source and fails on linked identity status drift", async () => {
    const valid = database([[{ canonical_player_id: "player01", source_system: "LEGACY_JSON", source_identifier: "member-hash" }], [{ canonical_player_id: "player01", canonical_player_identity_crosswalk_id: "cross001", crosswalk_status: "LINKED", legacy_player_id: 11n, external_identity_status: "linked" }], [], [{ legacy_player_id: 11n, canonical_player_id: "player01" }], [member(11n)]]);
    assert.deepEqual((await new AccountPlatformActiveMemberAuthorityProvider().lockSnapshot(valid.participant)).activeCanonicalPlayerIds, ["player01"]);
    const drift = database([[{ canonical_player_id: "player01", source_system: "LEGACY_JSON", source_identifier: "member-hash" }], [{ canonical_player_id: "player01", canonical_player_identity_crosswalk_id: "cross001", crosswalk_status: "LINKED", legacy_player_id: 11n, external_identity_status: "revoked" }]]);
    await assert.rejects(() => new AccountPlatformActiveMemberAuthorityProvider().lockSnapshot(drift.participant), /ACTIVE_MEMBER_AUTHORITY_CROSSWALK_DRIFT/);
  });

  it("treats legacy inactive state as authoritative removal even when a portal link is stale", async () => {
    const inactive = database([[owner("player01", "11")], [], [{ legacy_player_id: 11n, canonical_player_id: "player01" }], [], [member(11n, { player_status: "inactive" })]]);
    assert.deepEqual((await new AccountPlatformActiveMemberAuthorityProvider().lockSnapshot(inactive.participant)).activeCanonicalPlayerIds, []);
    const staleLink = database([[owner("player01", "11")], [], [{ legacy_player_id: 11n, canonical_player_id: "player01" }], [], [member(11n, { player_status: "inactive", portal_game_account_link_id: "link0001", link_status: "ACTIVE", portal_account_status: "ACTIVE" })]]);
    assert.deepEqual((await new AccountPlatformActiveMemberAuthorityProvider().lockSnapshot(staleLink.participant)).activeCanonicalPlayerIds, []);
  });

  it("fails closed on forward and reverse identity ambiguity", async () => {
    const forward = database([[owner("player01", "11")], [{ canonical_player_id: "player01", canonical_player_identity_crosswalk_id: "cross001", crosswalk_status: "LINKED", legacy_player_id: 22n, external_identity_status: "linked" }]]);
    await assert.rejects(() => new AccountPlatformActiveMemberAuthorityProvider().lockSnapshot(forward.participant), /ACTIVE_MEMBER_AUTHORITY_AMBIGUOUS/);
    const reverse = database([[owner("player01", "11"), owner("player02", "11")], []]);
    await assert.rejects(() => new AccountPlatformActiveMemberAuthorityProvider().lockSnapshot(reverse.participant), /ACTIVE_MEMBER_AUTHORITY_REVERSE_AMBIGUOUS/);
    const outsideCandidate = database([[owner("player01", "11")], [], [{ legacy_player_id: 11n, canonical_player_id: "player01" }, { legacy_player_id: 11n, canonical_player_id: "player99" }], []]);
    await assert.rejects(() => new AccountPlatformActiveMemberAuthorityProvider().lockSnapshot(outsideCandidate.participant), /ACTIVE_MEMBER_AUTHORITY_REVERSE_AMBIGUOUS/);
  });

  it("fails closed on invalid portal status combinations", async () => {
    const pending = database([[owner("player01", "11")], [], [{ legacy_player_id: 11n, canonical_player_id: "player01" }], [], [member(11n, { portal_game_account_link_id: "link0001", link_status: "ACTIVE", portal_account_status: "PENDING" })]]);
    await assert.rejects(() => new AccountPlatformActiveMemberAuthorityProvider().lockSnapshot(pending.participant), /ACTIVE_MEMBER_AUTHORITY_PORTAL_DRIFT/);
    const duplicate = database([[owner("player01", "11")], [], [{ legacy_player_id: 11n, canonical_player_id: "player01" }], [], [member(11n, { portal_game_account_link_id: "link0001", link_status: "ACTIVE", portal_account_status: "ACTIVE" }), member(11n, { portal_game_account_link_id: "link0002", link_status: "ACTIVE", portal_account_status: "SUSPENDED" })]]);
    await assert.rejects(() => new AccountPlatformActiveMemberAuthorityProvider().lockSnapshot(duplicate.participant), /ACTIVE_MEMBER_AUTHORITY_PORTAL_AMBIGUOUS/);
  });

  it("fails closed when a mapped legacy player or required profile disappears", async () => {
    const missingPlayer = database([[owner("player01", "11")], [], [{ legacy_player_id: 11n, canonical_player_id: "player01" }], [], []]);
    await assert.rejects(() => new AccountPlatformActiveMemberAuthorityProvider().lockSnapshot(missingPlayer.participant), /ACTIVE_MEMBER_AUTHORITY_INCOMPLETE/);
    const missingProfile = database([[owner("player01", "11")], [], [{ legacy_player_id: 11n, canonical_player_id: "player01" }], [], [member(11n, { profile_player_id: null })]]);
    await assert.rejects(() => new AccountPlatformActiveMemberAuthorityProvider().lockSnapshot(missingProfile.participant), /ACTIVE_MEMBER_AUTHORITY_PROFILE_DRIFT/);
  });
});
