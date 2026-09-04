import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MariaPlayerContextProvider, type PlayerContextReadParticipant } from "../src/account-platform/player-context-provider.js";

type Row = {
  legacy_player_id: bigint | null;
  canonical_player_id: string | null;
  external_identity_id: bigint | null;
  display_name: string | null;
  rank_emoji: string | null;
  provider_code: string | null;
  caller_link_id?: string | null;
};

function participant(active: Row[], legacy: Row[] = []): { database: PlayerContextReadParticipant; statements: Array<{ sql: string; values: readonly unknown[] }> } {
  const statements: Array<{ sql: string; values: readonly unknown[] }> = [];
  return {
    statements,
    database: {
      query: async <T>(sql: string, values: readonly unknown[] = []) => {
        statements.push({ sql, values });
        return (sql.includes("FROM account_platform_identities") ? active : legacy) as T;
      }
    }
  };
}

const mapped = (overrides: Partial<Row> = {}): Row => ({
  legacy_player_id: 101n,
  canonical_player_id: "player01",
  external_identity_id: 31n,
  display_name: "가나다라",
  rank_emoji: "🌱",
  provider_code: "kakao",
  caller_link_id: "link0001",
  ...overrides
});

describe("MariaPlayerContextProvider", () => {
  it("prefers the room-scoped active player and returns the exact persisted canonical mapping", async () => {
    const scripted = participant([mapped()]);
    const result = await new MariaPlayerContextProvider().resolveSelf(scripted.database, {
      identityProviderCode: "kakao", externalUserId: "caller-1", externalContextId: "room-a"
    });
    assert.deepEqual(result, {
      canonicalPlayerId: "player01", legacyPlayerId: "101", externalIdentityId: "31",
      displayName: "가나다라", rankEmoji: "🌱", platformCode: "kakao",
      externalContextId: "room-a", selectionSource: "ACTIVE_CONTEXT"
    });
    assert.deepEqual(scripted.statements[0]!.values, ["kakao", "caller-1", "KAKAO", "room-a", "caller-1", "ROOM", "room-a"]);
    assert.match(scripted.statements[0]!.sql, /caller_link\.portal_account_id=platform_identity\.portal_account_id/);
    assert.equal(scripted.statements.length, 1);
  });

  it("uses the persisted legacy crosswalk only when no active context selection exists", async () => {
    const scripted = participant([], [mapped({ external_identity_id: 41n })]);
    const result = await new MariaPlayerContextProvider().resolveSelf(scripted.database, {
      identityProviderCode: "kakao", externalUserId: "legacy-user", externalContextId: "room-b"
    });
    assert.equal(result.selectionSource, "LEGACY_CROSSWALK");
    assert.equal(result.externalIdentityId, "41");
    assert.deepEqual(scripted.statements[1]!.values, ["kakao", "legacy-user"]);
  });

  it("deduplicates multiple identities for the same legacy/canonical player pair", async () => {
    const scripted = participant([]);
    scripted.database.query = async <T>(sql: string, values: readonly unknown[] = []) => {
      scripted.statements.push({ sql, values });
      return [mapped({ external_identity_id: 99n }), mapped({ external_identity_id: 12n, provider_code: "discord" })] as T;
    };
    const result = await new MariaPlayerContextProvider().resolveUniqueLegacyDisplayTarget(scripted.database, { targetKey: "가나다라" });
    assert.deepEqual(result, { canonicalPlayerId: "player01", legacyPlayerId: "101", displayName: "가나다라", rankEmoji: "🌱" });
    assert.equal(scripted.statements[0]!.values[0], "가나다라");
    assert.doesNotMatch(scripted.statements[0]!.sql, /(?:LEFT|SUBSTRING|SUBSTR)\s*\(/i);
  });

  it("fails closed for missing, incomplete, or ambiguous canonical mappings", async () => {
    const provider = new MariaPlayerContextProvider();
    await assert.rejects(
      provider.resolveUniqueLegacyDisplayTarget(participant([]).database, { targetKey: "없음" }),
      /PLAYER_CONTEXT_MAPPING_REQUIRED/
    );
    await assert.rejects(
      provider.resolveUniqueLegacyDisplayTarget(participant([], [mapped({ canonical_player_id: null })]).database, { targetKey: "가나다라" }),
      /PLAYER_CONTEXT_MAPPING_DRIFT/
    );
    await assert.rejects(
      provider.resolveUniqueLegacyDisplayTarget(participant([], [mapped(), mapped({ legacy_player_id: 202n, canonical_player_id: "player02" })]).database, { targetKey: "가나다라" }),
      /PLAYER_CONTEXT_MAPPING_AMBIGUOUS/
    );
  });

  it("does not fall back when an active selection exists but its canonical mapping drifted", async () => {
    const scripted = participant([mapped({ canonical_player_id: null })], [mapped()]);
    await assert.rejects(
      new MariaPlayerContextProvider().resolveSelf(scripted.database, {
        identityProviderCode: "kakao", externalUserId: "caller-1", externalContextId: "room-a"
      }),
      /PLAYER_CONTEXT_MAPPING_DRIFT/
    );
    assert.equal(scripted.statements.length, 1);
  });

  it("does not fall back when an active selection exists but the caller portal link drifted", async () => {
    const scripted = participant([mapped({ caller_link_id: null })], [mapped()]);
    await assert.rejects(
      new MariaPlayerContextProvider().resolveSelf(scripted.database, {
        identityProviderCode: "kakao", externalUserId: "caller-1", externalContextId: "room-a"
      }),
      /PLAYER_CONTEXT_MAPPING_DRIFT/
    );
    assert.equal(scripted.statements.length, 1);
    assert.match(scripted.statements[0]!.sql, /LEFT JOIN portal_game_account_links caller_link/);
  });

  it("uses one Discord platform identity with server-scoped active selections", async () => {
    const scripted = participant([mapped({ provider_code: "discord" })]);
    const result = await new MariaPlayerContextProvider().resolveSelf(scripted.database, {
      identityProviderCode: "discord", externalUserId: "discord-user", externalContextId: "server-a"
    });
    assert.equal(result.platformCode, "discord");
    assert.deepEqual(scripted.statements[0]!.values, ["discord", "discord-user", "DISCORD", "PLATFORM_ACCOUNT", "discord-user", "SERVER", "server-a"]);
  });
});
