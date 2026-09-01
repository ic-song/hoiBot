import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DAILY_RESET_COUNTER_CODES, dailyResetKstPeriodKey } from "../src/admin/common-daily-reset-provider.js";

describe("common daily reset provider contract", () => {
  it("derives the reset period from KST rather than UTC", () => {
    assert.equal(dailyResetKstPeriodKey(new Date("2026-08-31T14:59:59.999Z")), "2026-08-31");
    assert.equal(dailyResetKstPeriodKey(new Date("2026-08-31T15:00:00.000Z")), "2026-09-01");
  });

  it("keeps the legacy daily counters explicit and duplicate-free", () => {
    assert.equal(new Set(DAILY_RESET_COUNTER_CODES).size, DAILY_RESET_COUNTER_CODES.length);
    const counterCodes = new Set<string>(DAILY_RESET_COUNTER_CODES);
    for (const code of ["cntlike", "dailyQuestCnt", "premiumDailyQuestCnt", "guild.markPurchaseCount"]) assert.equal(counterCodes.has(code), true);
  });
});
