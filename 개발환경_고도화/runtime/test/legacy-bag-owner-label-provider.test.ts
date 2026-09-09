import assert from "node:assert/strict";
import test from "node:test";

import { LEGACY_GUILD_RANK_SYMBOLS, LegacyBagOwnerLabelProvider } from "../src/inventory/legacy-bag-owner-label-provider.js";
import type { PlayerContext } from "../src/account-platform/player-context-provider.js";

// main.js getGuildMasterRankEmoji rank 1..20을 코드와 독립된 frozen oracle로 고정합니다.
const LEGACY_ORACLE = ["☬", "♔", "♛", "♕", "⚝", "❁", "⌺", "⍌", "⍫", "⚔︎", "⚚", "✥", "❖", "◈", "◉", "◍", "◌", "△", "◇", "◻︎"];

test("guild rank 1..20 suffix가 legacy oracle과 byte-exact하다", () => {
  assert.equal(LEGACY_GUILD_RANK_SYMBOLS.length, 20);
  for (let rank = 1; rank <= 20; rank += 1) {
    assert.equal(Buffer.from(LEGACY_GUILD_RANK_SYMBOLS[rank - 1]!, "utf8").toString("hex"), Buffer.from(LEGACY_ORACLE[rank - 1]!, "utf8").toString("hex"));
  }
});

const actor: PlayerContext = { canonicalPlayerId: "player01", legacyPlayerId: "42", externalIdentityId: "7", displayName: "회원", rankEmoji: "🎖", platformCode: "kakao", externalContextId: "room", selectionSource: "ACTIVE_CONTEXT" };
const markerKinds = ["CASTLE_LORD", "STAR", "CARROT", "THERMO", "MINI_PET", "TOP_LEVEL", "MC", "INTIMACY"];
function markers(direct = -1) { return markerKinds.map((marker_kind, index) => ({ marker_kind, marker_priority: index + 1, assignment_status: index === 0 || index === direct ? "ASSIGNED" : "UNASSIGNED", player_id: index === 0 ? "lord0001" : index === direct ? "player01" : null, legacy_player_id: index === 0 ? 99n : index === direct ? 42n : null, source_fingerprint: "a".repeat(64), revision: 1n })); }
function db(markerRows: ReturnType<typeof markers>, memberships: unknown[]) { let query = 0; return { async query<T>() { query += 1; return (query === 1 ? markerRows : memberships) as T; } }; }

test("8 marker priority, castle-guild override, direct marker와 guild suffix를 exact 적용한다", async () => {
  const provider = new LegacyBagOwnerLabelProvider();
  assert.equal(await provider.resolve(db(markers(2), [{ player_id: 42n, guild_id: 1n, ordinal_value: 1, snapshot_id: 5n, current_snapshot_id: 5n }, { player_id: 99n, guild_id: 2n, ordinal_value: 2, snapshot_id: 5n, current_snapshot_id: 5n }]), actor), "🥕회원_☬");
  assert.equal(await provider.resolve(db(markers(), [{ player_id: 42n, guild_id: 1n, ordinal_value: 20, snapshot_id: 5n, current_snapshot_id: 5n }, { player_id: 99n, guild_id: 1n, ordinal_value: 2, snapshot_id: 5n, current_snapshot_id: 5n }]), actor), "🏰회원_◻︎");
});

test("current guild rank snapshot drift는 owner label을 fail-closed한다", async () => {
  assert.equal(await new LegacyBagOwnerLabelProvider().resolve(db(markers(), [{ player_id: 42n, guild_id: 1n, ordinal_value: 1, snapshot_id: 4n, current_snapshot_id: 5n }, { player_id: 99n, guild_id: 2n, ordinal_value: 2, snapshot_id: 5n, current_snapshot_id: 5n }]), actor), null);
});
