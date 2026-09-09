import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppWiringReadParticipant } from "../src/dispatch/app-wiring-operation-provider.js";
import type { NormalizedIrisEvent } from "../src/integration/iris-normalizer.js";
import { MariaPetDataCompareShadowEvaluator } from "../src/admin/pet-data-compare-shadow-snapshot-provider.js";

function event(overrides: Partial<NormalizedIrisEvent> = {}): NormalizedIrisEvent {
  return {
    eventId: "iris:pet-data-compare-1",
    providerEventId: "pet-data-compare-1",
    providerCode: "iris",
    eventKind: "1",
    direction: "incoming",
    channelId: "room-1",
    userId: "operator-external-1",
    displayName: "관리자",
    displayNameSource: "kakao_db",
    displayNameTrust: "trusted",
    message: "/펫데이터비교",
    eventCode: "message.created",
    eventCategory: "message",
    monitoringGroup: "text",
    eventMetadata: {},
    payloadHash: "a".repeat(64),
    ...overrides,
  };
}

function strictParticipant(options: {
  authorized?: boolean;
  counts?: Record<string, bigint | number | string>;
} = {}): { participant: AppWiringReadParticipant; statements: Array<{ sql: string; values: readonly unknown[] }> } {
  const statements: Array<{ sql: string; values: readonly unknown[] }> = [];
  const participant: AppWiringReadParticipant = {
    query: async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
      statements.push({ sql, values });
      if (statements.length === 1) {
        assert.match(sql, /JOIN admin_operator_external_identities/);
        assert.match(sql, /role\.code='super_admin'/);
        assert.deepEqual(values, ["operator-external-1"]);
        return (options.authorized === false ? [] : [{ operator_id: 7n }]) as T;
      }
      if (statements.length === 2) {
        assert.match(sql, /FROM player_profiles/);
        assert.match(sql, /FROM player_pets/);
        assert.match(sql, /FROM canonical_players WHERE source_system='LEGACY_JSON'/);
        assert.match(sql, /FROM canonical_owned_pet_instances owned_pet\s+JOIN canonical_players player ON player\.player_id=owned_pet\.player_id/);
        assert.match(sql, /WHERE owned_pet\.ownership_status='owned' AND player\.source_system='LEGACY_JSON'/);
        assert.deepEqual(values, []);
        return [{
          legacy_player_count: 10n,
          legacy_pet_count: 8n,
          canonical_player_count: 12n,
          canonical_owned_pet_count: 7n,
          ...options.counts,
        }] as T;
      }
      throw new Error(`UNEXPECTED_SQL:${sql}`);
    },
  };
  return { participant, statements };
}

describe("MariaPetDataCompareShadowEvaluator", () => {
  it("authorizes first, then compares the explicit legacy import cohort in one participant", async () => {
    const strict = strictParticipant();
    const result = await new MariaPetDataCompareShadowEvaluator().preview(strict.participant, event());
    assert.equal(strict.statements.length, 2);
    assert.deepEqual(result.counts, {
      legacyPlayerCount: "10",
      legacyPetCount: "8",
      canonicalPlayerCount: "12",
      canonicalOwnedPetCount: "7",
    });
    assert.deepEqual(result.deltas, {
      canonicalMinusLegacyPlayerCount: "2",
      canonicalMinusLegacyPetCount: "-1",
    });
    assert.deepEqual(result.summary, { authorized: true, ...result.counts, ...result.deltas });
    assert.match(result.resultFingerprint, /^[0-9a-f]{64}$/);
    assert.equal(strict.statements.some(({ sql }) => /FOR UPDATE|\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql)), false);
  });

  it("stops an unauthorized operator after the sole authority query", async () => {
    const strict = strictParticipant({ authorized: false });
    const first = await new MariaPetDataCompareShadowEvaluator().preview(strict.participant, event());
    assert.equal(strict.statements.length, 1);
    assert.equal(first.authorized, false);
    assert.deepEqual(first.summary, { authorized: false });
    const secondRun = strictParticipant({ authorized: false });
    const second = await new MariaPetDataCompareShadowEvaluator().preview(secondRun.participant, event());
    assert.equal(first.resultFingerprint, second.resultFingerprint);
  });

  it("preserves counts beyond Number precision and emits deterministic signed deltas", async () => {
    const counts = {
      legacy_player_count: "900719925474099312345",
      legacy_pet_count: 900719925474099312344n,
      canonical_player_count: "900719925474099312347",
      canonical_owned_pet_count: 900719925474099312340n,
    };
    const firstRun = strictParticipant({ counts });
    const secondRun = strictParticipant({ counts });
    const first = await new MariaPetDataCompareShadowEvaluator().preview(firstRun.participant, event());
    const second = await new MariaPetDataCompareShadowEvaluator().preview(secondRun.participant, event());
    assert.equal(first.counts.legacyPlayerCount, "900719925474099312345");
    assert.equal(first.deltas.canonicalMinusLegacyPlayerCount, "2");
    assert.equal(first.deltas.canonicalMinusLegacyPetCount, "-4");
    assert.equal(first.resultFingerprint, second.resultFingerprint);
  });

  it("fails closed for a missing or non-canonical count row", async () => {
    const missing: AppWiringReadParticipant = { query: async <T>(sql: string) => (sql.includes("mapping.operator_id") ? [{ operator_id: 7n }] : []) as T };
    await assert.rejects(() => new MariaPetDataCompareShadowEvaluator().preview(missing, event()), /PET_DATA_COMPARE_SHADOW_COUNTS_MISSING/);
    const invalid = strictParticipant({ counts: { canonical_owned_pet_count: "01" } });
    await assert.rejects(() => new MariaPetDataCompareShadowEvaluator().preview(invalid.participant, event()), /PET_DATA_COMPARE_SHADOW_COUNT_INVALID:canonical_owned_pet_count/);
    const unsafe = strictParticipant({ counts: { canonical_owned_pet_count: Number.MAX_SAFE_INTEGER + 1 } });
    await assert.rejects(() => new MariaPetDataCompareShadowEvaluator().preview(unsafe.participant, event()), /PET_DATA_COMPARE_SHADOW_COUNT_INVALID:canonical_owned_pet_count/);
  });
});
