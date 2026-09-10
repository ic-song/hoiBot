import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPlayerTitleSelectCandidate,
  normalizePlayerTitleSelectDispatchMessage,
  parsePlayerTitleSelectIndex
} from "../src/player/player-title-select-service.js";

describe("player title select command", () => {
  it("accepts only the space-form title selection family", () => {
    for (const value of ["/타이틀 1", "/타이틀   12 ", "/타이틀 abc"]) assert.equal(isPlayerTitleSelectCandidate(value), true);
    for (const value of [undefined, "/타이틀", "/타이틀, 사용자", "/타이틀선물", "/타이틀목록"]) assert.equal(isPlayerTitleSelectCandidate(value), false);
  });

  it("normalizes only selection candidates for exact DB dispatch", () => {
    assert.equal(normalizePlayerTitleSelectDispatchMessage("/타이틀 2"), "/타이틀");
    assert.equal(normalizePlayerTitleSelectDispatchMessage("/타이틀, 사용자"), "/타이틀, 사용자");
  });

  it("parses positive safe integer indexes with legacy trailing spaces", () => {
    assert.equal(parsePlayerTitleSelectIndex("/타이틀 2"), 2);
    assert.equal(parsePlayerTitleSelectIndex("/타이틀   12  "), 12);
    assert.equal(parsePlayerTitleSelectIndex("/타이틀 0"), 0);
    assert.equal(parsePlayerTitleSelectIndex("/타이틀 9007199254740993"), 9007199254740992);
    for (const value of ["/타이틀 -1", "/타이틀 1 안내"]) assert.equal(parsePlayerTitleSelectIndex(value), null);
  });
});
