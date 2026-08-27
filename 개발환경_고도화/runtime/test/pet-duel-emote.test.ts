import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { choosePetDuelEmote, normalizePetDuelEmoteDispatchMessage, parsePetDuelEmoteCommand } from "../src/pet/pet-duel-emote-service.js";

describe("pet duel emote command", () => {
  it("accepts only exact usage and a non-empty target form", () => {
    assert.deepEqual(parsePetDuelEmoteCommand("/결투"), { kind: "usage" });
    assert.deepEqual(parsePetDuelEmoteCommand("/결투 대상 남"), { kind: "duel", targetName: "대상 남" });
    assert.equal(parsePetDuelEmoteCommand("/결투 "), null);
    assert.equal(parsePetDuelEmoteCommand("/결투대상"), null);
  });

  it("normalizes only the target form for exact dispatch", () => {
    assert.equal(normalizePetDuelEmoteDispatchMessage("/결투"), "/결투");
    assert.equal(normalizePetDuelEmoteDispatchMessage("/결투 대상"), "/결투 [유저명]");
  });

  it("preserves the 70 percent branch and deterministic phrase selection", () => {
    const success = choosePetDuelEmote((() => { const values = [0.699999, 0]; return () => values.shift()!; })());
    const failure = choosePetDuelEmote((() => { const values = [0.7, 0.999999]; return () => values.shift()!; })());
    assert.equal(success.outcome, "success"); assert.equal(success.phraseIndex, 0);
    assert.equal(failure.outcome, "failure"); assert.equal(failure.phraseIndex, 9);
  });
});
