import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLordIncomeCommandCandidate } from "../src/admin/iris-admin-command-service.js";
import { formatLordIncomeRanking } from "../src/admin/lord-income-service.js";

describe("lord income rank command boundary", () => {
  it("accepts only the two exact commands", () => {
    assert.equal(isLordIncomeCommandCandidate("/영주수익순위"), true);
    assert.equal(isLordIncomeCommandCandidate("/영주수익순위초기화"), true);
    for (const message of ["/영주수익순위 안내", "/영주수익순위초기화 해줘", "/영주수익순위초기화2"]) assert.equal(isLordIncomeCommandCandidate(message), false);
  });

  it("formats zero, nine and eleven rows without crossing the array boundary", () => {
    assert.equal(formatLordIncomeRanking([]).startsWith("🏰 영주 수익 순위 🏰\n\n"), true);
    const rows = Array.from({ length: 11 }, (_, index) => ({ playerId: String(index + 1), displayName: `회원${index + 1}`, amount: String((11 - index) * 1000) }));
    const nine = formatLordIncomeRanking(rows.slice(0, 9));
    assert.equal(nine.includes("회원9 - 👑: 3,000"), true);
    const eleven = formatLordIncomeRanking(rows);
    assert.equal(eleven.includes("10위 회원10 - 👑: 2,000"), true);
    assert.equal(eleven.includes("11위 회원11 - 👑: 1,000"), true);
    assert.equal((eleven.match(/\u200b/g) ?? []).length, 500);
  });
});
