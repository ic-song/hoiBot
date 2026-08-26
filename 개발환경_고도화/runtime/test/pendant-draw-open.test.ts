import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPendantDrawOpenCommandCandidate, normalizePendantDrawOpenDispatchMessage, parsePendantDrawOpenCount, selectPendantDrawDefinition } from "../src/pet/pendant-draw-open-service.js";

describe("pendant draw open", () => {
  it("accepts only exact or full numeric commands", () => {
    assert.equal(isPendantDrawOpenCommandCandidate("/펜던트오픈"), true);
    assert.equal(isPendantDrawOpenCommandCandidate("/펜던트오픈 3"), true);
    assert.equal(isPendantDrawOpenCommandCandidate("/펜던트오픈 3 해봐"), false);
  });
  it("preserves default one and zero usage boundary", () => {
    assert.equal(parsePendantDrawOpenCount("/펜던트오픈"), 1n);
    assert.equal(parsePendantDrawOpenCount("/펜던트오픈 0"), 0n);
  });
  it("selects cumulative probability boundaries", () => {
    const values = [{ name: "최하급", rate: 39.89 }, { name: "하급", rate: 25 }, { name: "창조", rate: 35.11 }];
    assert.equal(selectPendantDrawDefinition(values, 0).name, "최하급");
    assert.equal(selectPendantDrawDefinition(values, 0.3989).name, "하급");
    assert.equal(selectPendantDrawDefinition(values, 0.99995).name, "창조");
  });
  it("normalizes valid numeric aliases only", () => {
    assert.equal(normalizePendantDrawOpenDispatchMessage("/펜던트오픈 10"), "/펜던트오픈");
    assert.equal(normalizePendantDrawOpenDispatchMessage("/펜던트오픈 안내"), "/펜던트오픈 안내");
  });
});
