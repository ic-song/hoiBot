import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPlayerTitleSellCandidate, normalizePlayerTitleSellDispatchMessage, parsePlayerTitleSellCommand, playerTitleSalePrice } from "../src/player/player-title-sell-service.js";

describe("player title sell command", () => {
  it("accepts only complete positive single and range forms", () => {
    for (const value of ["/타이틀판매 1", "/타이틀판매   12 ", "/타이틀지정판매 1~3", "/타이틀지정판매   2~9 "]) assert.equal(isPlayerTitleSellCandidate(value), true);
    for (const value of [undefined, "/타이틀판매", "/타이틀판매 0", "/타이틀판매 1 안내", "/타이틀지정판매 0~2", "/타이틀지정판매 3~2"]) assert.equal(isPlayerTitleSellCandidate(value), false);
  });

  it("normalizes only executable aliases", () => {
    assert.equal(normalizePlayerTitleSellDispatchMessage("/타이틀판매 2"), "/타이틀판매");
    assert.equal(normalizePlayerTitleSellDispatchMessage("/타이틀지정판매 2~8"), "/타이틀지정판매");
    assert.equal(normalizePlayerTitleSellDispatchMessage("/타이틀판매 2 안내"), "/타이틀판매 2 안내");
  });

  it("parses uint64 indexes and rejects reverse or overflow ranges", () => {
    assert.deepEqual(parsePlayerTitleSellCommand("/타이틀판매 2"), { mode: "single", start: 2n, end: 2n });
    assert.deepEqual(parsePlayerTitleSellCommand("/타이틀지정판매 2~9"), { mode: "range", start: 2n, end: 9n });
    for (const value of ["/타이틀지정판매 9~2", "/타이틀판매 18446744073709551616", "/타이틀판매 -1"]) assert.equal(parsePlayerTitleSellCommand(value), null);
  });

  it("preserves the fixed minimum and thirty-percent sale rule", () => {
    assert.equal(playerTitleSalePrice("9999.000"), 1000000n);
    assert.equal(playerTitleSalePrice("10000.000"), 3000n);
    assert.equal(playerTitleSalePrice("9007199254740993.000"), 2702159776422297n);
  });
});
