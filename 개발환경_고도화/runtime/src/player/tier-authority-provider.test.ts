import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { calculateTierTransitionDelta, resolveTierByTickets, validateTierDefinitions, type TierDefinition } from "./tier-authority-provider.js";

// 합성 41단계 티어 정의를 생성합니다.
function definitions(): TierDefinition[] {
  return Array.from({ length: 41 }, (_, tierOrder) => ({
    tierCode: `tier_${createHash("sha256").update(`tier-${tierOrder}`).digest("hex").slice(0, 16)}`,
    displayName: tierOrder === 0 ? "새싹" : `합성티어${tierOrder}`,
    tierOrder,
    regularTicketThreshold: BigInt(tierOrder * 100),
    advancedTicketThreshold: BigInt(Math.max(0, tierOrder - 9) * 10),
    rankEmoji: `T${tierOrder}`,
    petExperienceDelta: BigInt(tierOrder * 10)
  }));
}

describe("tier authority provider", () => {
  it("validates all 41 ordered identities and rejects drift", () => {
    const rows = definitions();
    validateTierDefinitions(rows);
    assert.throws(() => validateTierDefinitions(rows.slice(0, 40)), /COUNT_INVALID/);
    const drift = rows.map((row) => ({ ...row }));
    drift[20] = { ...drift[20]!, tierOrder: 21 };
    assert.throws(() => validateTierDefinitions(drift), /ORDER_GAP/);
  });

  it("requires both regular and advanced ticket thresholds", () => {
    const rows = definitions();
    assert.equal(resolveTierByTickets(rows, 1000n, 0n).tierOrder, 9);
    assert.equal(resolveTierByTickets(rows, 1000n, 10n).tierOrder, 10);
    assert.equal(resolveTierByTickets(rows, 4099n, 310n).tierOrder, 40);
    assert.throws(() => resolveTierByTickets(rows, -1n, 0n), /COUNT_NEGATIVE/);
  });

  it("matches the legacy cumulative promotion and demotion delta", () => {
    const rows = definitions();
    assert.equal(calculateTierTransitionDelta(rows, rows[2]!.tierCode, rows[5]!.tierCode), 120n);
    assert.equal(calculateTierTransitionDelta(rows, rows[5]!.tierCode, rows[2]!.tierCode), -120n);
    assert.equal(calculateTierTransitionDelta(rows, rows[5]!.tierCode, rows[5]!.tierCode), 0n);
    assert.throws(() => calculateTierTransitionDelta(rows, "tier_missing", rows[0]!.tierCode), /TIER_REQUIRED/);
  });
});
