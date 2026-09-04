import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MariaPlayerContextProvider, type PlayerContextReadParticipant } from "../src/account-platform/player-context-provider.js";

type Row = { legacy_player_id: bigint | null; canonical_player_id: string | null; external_identity_id: bigint | null; display_name: string | null; rank_emoji: string | null; provider_code: string | null; caller_link_id?: string | null };
const mapped = (overrides: Partial<Row> = {}): Row => ({ legacy_player_id: 101n, canonical_player_id: "player01", external_identity_id: 31n, display_name: "가나다라", rank_emoji: "🌱", provider_code: "kakao", caller_link_id: "link0001", ...overrides });
function participant(active: Row[], legacy: Row[] = []) {
  const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  const database: PlayerContextReadParticipant = { query: async <T>(sql: string, values: readonly unknown[] = []) => { calls.push({ sql, values }); return (sql.includes("FROM account_platform_identities") ? active : legacy) as T; } };
  return { database, calls };
}

describe("MariaPlayerContextProvider", () => {
  it("prefers the room active player and preserves canonical identity", async () => {
    const fixture = participant([mapped()]);
    const result = await new MariaPlayerContextProvider().resolveSelf(fixture.database, { identityProviderCode: "kakao", externalUserId: "caller", externalContextId: "room-a" });
    assert.deepEqual(result, { canonicalPlayerId: "player01", legacyPlayerId: "101", externalIdentityId: "31", displayName: "가나다라", rankEmoji: "🌱", platformCode: "kakao", externalContextId: "room-a", selectionSource: "ACTIVE_CONTEXT" });
    assert.equal(fixture.calls.length, 1);
  });

  it("falls back only when no active selection exists", async () => {
    const fixture = participant([], [mapped({ external_identity_id: 41n })]);
    const result = await new MariaPlayerContextProvider().resolveSelf(fixture.database, { identityProviderCode: "kakao", externalUserId: "legacy", externalContextId: "room-b" });
    assert.equal(result.selectionSource, "LEGACY_CROSSWALK");
    assert.equal(result.externalIdentityId, "41");
    assert.match(fixture.calls[1]!.sql, /NOT EXISTS\s*\([\s\S]*portal_game_account_links linked_account/);
  });

  it("deduplicates target identities but rejects different player pairs", async () => {
    const provider = new MariaPlayerContextProvider();
    const one: PlayerContextReadParticipant = { query: async <T>() => [mapped({ external_identity_id: 99n }), mapped({ external_identity_id: 12n, provider_code: "discord" })] as T };
    assert.deepEqual(await provider.resolveUniqueLegacyDisplayTarget(one, { targetKey: "가나다라" }), { canonicalPlayerId: "player01", legacyPlayerId: "101", displayName: "가나다라", rankEmoji: "🌱" });
    const two: PlayerContextReadParticipant = { query: async <T>() => [mapped(), mapped({ legacy_player_id: 202n, canonical_player_id: "player02" })] as T };
    await assert.rejects(provider.resolveUniqueLegacyDisplayTarget(two, { targetKey: "가나다라" }), /PLAYER_CONTEXT_MAPPING_AMBIGUOUS/);
  });

  it("fails closed instead of falling back from an active mapping drift", async () => {
    const fixture = participant([mapped({ canonical_player_id: null })], [mapped()]);
    await assert.rejects(new MariaPlayerContextProvider().resolveSelf(fixture.database, { identityProviderCode: "kakao", externalUserId: "caller", externalContextId: "room-a" }), /PLAYER_CONTEXT_MAPPING_DRIFT/);
    assert.equal(fixture.calls.length, 1);
  });

  it("does not fall back when an active selection exists but the caller portal link drifted", async () => {
    const fixture = participant([mapped({ caller_link_id: null })], [mapped()]);
    await assert.rejects(new MariaPlayerContextProvider().resolveSelf(fixture.database, { identityProviderCode: "kakao", externalUserId: "caller", externalContextId: "room-a" }), /PLAYER_CONTEXT_MAPPING_DRIFT/);
    assert.equal(fixture.calls.length, 1);
    assert.match(fixture.calls[0]!.sql, /LEFT JOIN portal_game_account_links caller_link/);
  });
});
