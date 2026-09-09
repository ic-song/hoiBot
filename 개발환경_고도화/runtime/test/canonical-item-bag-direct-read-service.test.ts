import assert from "node:assert/strict";
import test from "node:test";

import type { AppWiringReadParticipant } from "../src/dispatch/app-wiring-operation-provider.js";
import type { BagShadowParityResult } from "../src/inventory/bag-shadow-parity-provider.js";
import { CanonicalItemBagDirectReadService, isCanonicalItemBagCommand } from "../src/inventory/canonical-item-bag-direct-read-service.js";

const context = { canonicalPlayerId: "player01", legacyPlayerId: "42", externalIdentityId: "7", displayName: "회원😀", rankEmoji: "🏆", platformCode: "kakao", externalContextId: "room-1", selectionSource: "ACTIVE_CONTEXT" as const };

function parity(overrides: Partial<BagShadowParityResult> = {}): BagShadowParityResult {
  return {
    scope: "STACK_BAG", presentationScope: { header: "OUT_OF_SCOPE", ownerLabel: "OUT_OF_SCOPE", advertisement: "OUT_OF_SCOPE", itemOrderPreviewOnly: true },
    limitations: ["NON_STACK_ITEM_DOMAINS_OUT_OF_SCOPE", "EQUIPMENT_AND_PET_DOMAINS_OUT_OF_SCOPE"], parity: true, hasOutOfScopeRecords: false, cutoverReady: true,
    legacyPlayerId: "42", canonicalPlayerId: "player01",
    legacyBag: { playerId: "42", ownerLabel: "회원😀", advertisement: "", items: [] },
    canonicalBag: { playerId: "player01", ownerLabel: "회원😀", advertisement: "", items: [{ displayName: "한글상자🎁", quantity: "9007199254740993", legacyBagOrder: null }] },
    legacyItemOrderPreview: "", canonicalItemOrderPreview: "", legacyFingerprint: "a", canonicalFingerprint: "a", resultFingerprint: "a".repeat(64),
    frozenDomainCoverage: { schemaVersion: "item-bag-frozen-domain.v1", outputNeutralDomains: ["pets", "equipment"], domains: { players: [], items: [], pets: [], equipment: [] }, parity: true, fingerprint: "b".repeat(64) },
    missingItems: [], extraItems: [], quantityMismatches: [], orderMismatches: [], unsupportedDomainRecords: [], ...overrides,
  };
}

function shadow(overrides: Partial<BagShadowParityResult> = {}, options: { ownerLabel?: string | null; importReady?: boolean; intimacyKeyUnique?: boolean } = {}) {
  return { async read() { return { status: "ready" as const, context, parity: parity(overrides), ownerLabel: options.ownerLabel === undefined ? "🏆회원😀" : options.ownerLabel, importReady: options.importReady ?? true, intimacyKeyUnique: options.intimacyKeyUnique ?? true }; } };
}

function db(activeCount = 0n): AppWiringReadParticipant {
  return { async query<T>(sql: string) {
    if (sql.includes("guild_territory_start_scopes")) return [{ active: activeCount > 0n ? 1 : 0, lifecycle_state: activeCount > 0n ? "ACTIVE_READY" : "READY" }] as T;
    if (sql.includes("notice.advertisement")) return [{ version: 1n, string_value: "광고📢" }] as T;
    throw new Error(`unexpected SQL: ${sql}`);
  } };
}

test("exact /가방 aliases만 canonical ingress로 분류한다", () => {
  assert.equal(isCanonicalItemBagCommand("/가방"), true); assert.equal(isCanonicalItemBagCommand("ㄴㄴㄴ"), true);
  assert.equal(isCanonicalItemBagCommand(" /가방"), false); assert.equal(isCanonicalItemBagCommand("/가방 1"), false);
});

test("active context와 canonical import parity가 증명되면 Unicode/emoji/BigInt를 그대로 직접 응답한다", async () => {
  const result = await new CanonicalItemBagDirectReadService(shadow()).execute(db(), { providerCode: "kakao", externalUserId: "user-1", externalContextId: "room-1" });
  assert.deepEqual(result, { status: "direct_reply", consumerId: "legacy-94904fa11988ff04", playerId: "player01", parityFingerprint: "a".repeat(64), data: "[🏆회원😀]의 가방🧳\n(알림📢)후원은 봇 개발에 많은 도움이됩니다.\n   1. 한글상자🎁 x 9007199254740993" });
});

test("공성전 또는 incomplete import에서는 direct reply를 만들지 않는다", async () => {
  const service = new CanonicalItemBagDirectReadService(shadow({ cutoverReady: false }));
  const siege = await service.execute(db(1n), { providerCode: "kakao", externalUserId: "u", externalContextId: "r" });
  const incomplete = await service.execute(db(), { providerCode: "kakao", externalUserId: "u", externalContextId: "r" });
  assert.equal(siege.status, "silent"); assert.equal(incomplete.status, "legacy_reply");
});

test("resolved parity provider의 identity failure를 fail-closed한다", async () => {
  const service = new CanonicalItemBagDirectReadService({ async read() { return { status: "silent" as const, reason: "ACTIVE_PLAYER_PARITY_UNAVAILABLE" as const }; } });
  const result = await service.execute(db(), { providerCode: "kakao", externalUserId: "u", externalContextId: "r" });
  assert.deepEqual(result, { status: "silent", consumerId: "legacy-94904fa11988ff04", reason: "ACTIVE_PLAYER_PARITY_UNAVAILABLE" });
});

test("player context가 없으면 silent 처리한다", async () => {
  const service = new CanonicalItemBagDirectReadService({ async read() { return { status: "silent" as const, reason: "PLAYER_CONTEXT_UNPROVEN" as const }; } });
  const result = await service.execute(db(), { providerCode: "kakao", externalUserId: "u", externalContextId: "r" });
  assert.equal(result.status, "silent");
});

test("import provenance failure와 복수 친밀도 key도 direct reply로 승격하지 않는다", async () => {
  for (const provider of [shadow({}, { importReady: false }), shadow({}, { intimacyKeyUnique: false })]) {
    const result = await new CanonicalItemBagDirectReadService(provider).execute(db(), { providerCode: "kakao", externalUserId: "u", externalContextId: "r" });
    assert.equal(result.status, "legacy_reply");
  }
});
