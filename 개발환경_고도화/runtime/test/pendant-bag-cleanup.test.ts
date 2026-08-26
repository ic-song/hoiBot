import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPendantBagCleanupCommandCandidate, normalizePendantBagCleanupDispatchMessage, parsePendantBagCleanupCommand } from "../src/pet/pendant-bag-cleanup-service.js";

describe("pendant bag cleanup command", () => {
  it("keeps the broad legacy candidate but parses only a complete numeric range", () => {
    for (const value of ["/펜던트가방정리", "/펜던트가방정리 안내", "/펜던트가방정리 1~2"]) assert.equal(isPendantBagCleanupCommandCandidate(value), true);
    for (const value of ["펜던트가방정리", "/펜던트가방정리 "]) assert.equal(isPendantBagCleanupCommandCandidate(value), false);
    assert.equal(normalizePendantBagCleanupDispatchMessage("/펜던트가방정리 1~2"), "/펜던트가방정리");
    assert.deepEqual(parsePendantBagCleanupCommand("/펜던트가방정리 2~5"), { start: 2n, end: 5n });
  });
  it("normalizes a reversed range and preserves zero for range validation", () => {
    assert.deepEqual(parsePendantBagCleanupCommand("/펜던트가방정리 5~2"), { start: 2n, end: 5n });
    assert.deepEqual(parsePendantBagCleanupCommand("/펜던트가방정리 0~2"), { start: 0n, end: 2n });
  });
  it("rejects suffix, decimal, negative and whitespace-separated ranges", () => {
    for (const value of ["/펜던트가방정리 1~2 안내", "/펜던트가방정리 1.0~2", "/펜던트가방정리 -1~2", "/펜던트가방정리 1 ~ 2"]) assert.equal(parsePendantBagCleanupCommand(value), null);
  });
});
