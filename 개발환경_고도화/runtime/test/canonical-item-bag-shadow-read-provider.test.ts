import assert from "node:assert/strict";
import test from "node:test";

import type { AppWiringReadParticipant } from "../src/dispatch/app-wiring-operation-provider.js";
import type { BagShadowParityResult } from "../src/inventory/bag-shadow-parity-provider.js";
import { CanonicalItemBagShadowReadProvider } from "../src/inventory/canonical-item-bag-shadow-read-provider.js";

const context = { legacyPlayerId: "22", canonicalPlayerId: "player-22", externalIdentityId: "identity-1", displayName: "부계정", rankEmoji: null, platformCode: "KAKAO", externalContextId: "room-1", selectionSource: "ACTIVE_CONTEXT" as const };
const bag = (displayName = "상자") => ({ items: [{ displayName, quantity: 1n, legacyBagOrder: 1 }], fingerprint: "a".repeat(64) });
const parity = (displayName?: string): BagShadowParityResult => ({ legacyPlayerId: "22", canonicalPlayerId: "player-22", legacyBag: bag(displayName), canonicalBag: bag(displayName), parity: true } as unknown as BagShadowParityResult);
const database = { async query<T>(): Promise<T> { return [] as T; } } as AppWiringReadParticipant;

function provider(compare: (db: AppWiringReadParticipant) => Promise<BagShadowParityResult>) {
  return new CanonicalItemBagShadowReadProvider(
    { async resolveSelf() { return context; }, async resolveUniqueLegacyDisplayTarget() { throw new Error("unused"); } },
    { async compare(db) { return compare(db); } },
    { async resolve() { return "♔부계정_길드"; } },
    { async inspect() { return true; } },
  );
}

test("binds the resolved active player and removes each known inactive-item filter exactly once", async () => {
  const forwarded: string[] = [];
  const delegate = { async query<T>(sql: string): Promise<T> { forwarded.push(sql); return [] as T; } };
  const result = await provider(async (db) => {
    const identity = await db.query<Array<{ legacy_player_id: bigint; canonical_player_id: string }>>("SELECT x FROM external_identities identity LEFT JOIN canonical_player_identity_crosswalks crosswalk ON TRUE");
    assert.deepEqual([identity[0]?.legacy_player_id, identity[0]?.canonical_player_id], ["22", "player-22"]);
    await db.query("SELECT x FROM inventory_stacks stack JOIN item_definitions item ON TRUE WHERE stack.player_id=? AND item.active=TRUE");
    await db.query("SELECT x FROM canonical_owned_item_stacks stack JOIN canonical_item_definitions item ON TRUE WHERE stack.player_id=? AND item.active_flag=TRUE");
    return parity();
  }).read(delegate, { providerCode: "kakao", externalUserId: "u", externalContextId: "r" });
  assert.equal(result.status, "ready");
  assert.deepEqual(forwarded, [
    "SELECT x FROM inventory_stacks stack JOIN item_definitions item ON TRUE WHERE stack.player_id=?",
    "SELECT x FROM canonical_owned_item_stacks stack JOIN canonical_item_definitions item ON TRUE WHERE stack.player_id=?",
  ]);
});

test("fails closed when a known parity query omits or duplicates its exact active filter", async () => {
  for (const sql of [
    "SELECT x FROM inventory_stacks stack JOIN item_definitions item ON TRUE WHERE stack.player_id=?",
    "SELECT x FROM inventory_stacks stack WHERE 1 AND item.active=TRUE AND item.active=TRUE",
    "SELECT x FROM canonical_owned_item_stacks stack WHERE stack.player_id=?",
  ]) {
    const result = await provider(async (db) => { await db.query(sql); return parity(); }).read(database, { providerCode: "kakao", externalUserId: "u", externalContextId: "r" });
    assert.deepEqual(result, { status: "silent", reason: "ACTIVE_PLAYER_PARITY_UNAVAILABLE" });
  }
});

test("reports multiple dynamic intimacy keys as not cutover-safe", async () => {
  const name = "펫 친밀도🐾 [Lv.1](1/1000)+1💕";
  const result = await provider(async () => {
    const value = parity(name);
    return { ...value, legacyBag: { ...value.legacyBag, items: [...value.legacyBag.items, { ...value.legacyBag.items[0]!, displayName: "펫 친밀도🐾 [Lv.2](2/1000)+2💕" }] } };
  }).read(database, { providerCode: "kakao", externalUserId: "u", externalContextId: "r" });
  assert.equal(result.status, "ready");
  if (result.status === "ready") assert.equal(result.intimacyKeyUnique, false);
});
