import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatFreeMarketHistory,
  handleFreeMarketHistoryCommand,
  isFreeMarketHistoryCommand,
  type FreeMarketHistoryRepository
} from "../src/market/free-market-history-service.js";

const entries = [{
  id: "2",
  itemName: "땅문서📜",
  quantity: "2",
  price: "350000000",
  sellerRank: "킹 판매자",
  buyerRank: "퀸 구매자",
  completedAt: "08/25 00:30",
  memberFeeApplied: true
}];

describe("free-market history read", () => {
  it("accepts only the exact command and short alias", () => {
    assert.equal(isFreeMarketHistoryCommand("/자유시장거래현황"), true);
    assert.equal(isFreeMarketHistoryCommand("ㅅㅅ"), true);
    assert.equal(isFreeMarketHistoryCommand("/자유시장거래현황 확인"), false);
    assert.equal(isFreeMarketHistoryCommand("ㅅㅅ 확인"), false);
  });

  it("renders legacy price, unit price, rank, fee marker and KST time", () => {
    const message = formatFreeMarketHistory(entries);
    assert.match(message, /땅문서📜x2개\[개당 1\.8억\]/);
    assert.match(message, /🅟350,000,000\(3\.5억\)/);
    assert.match(message, /\[킹 판매자\]🤝\[퀸 구매자\] 자회원🏪\(수수료 7%\)/);
    assert.match(message, /08\/25 00:30/);
  });

  it("preserves the legacy empty message", () => {
    assert.match(formatFreeMarketHistory([]), /최근 판매 완료된 거래가 표시됩니다\.\n\n판매 완료된 거래가 없습니다\.$/);
  });

  it("limits the repository request to the latest 100 rows", async () => {
    let limit = 0;
    const repository: FreeMarketHistoryRepository = {
      listCompleted: async (requested) => { limit = requested; return entries; }
    };
    const message = await handleFreeMarketHistoryCommand("ㅅㅅ", repository);
    assert.equal(limit, 100);
    assert.match(message!, /땅문서/);
  });

  it("does not read the repository for a suffix command", async () => {
    let called = false;
    const repository: FreeMarketHistoryRepository = {
      listCompleted: async () => { called = true; return entries; }
    };
    assert.equal(await handleFreeMarketHistoryCommand("ㅅㅅ 확인", repository), undefined);
    assert.equal(called, false);
  });
});
