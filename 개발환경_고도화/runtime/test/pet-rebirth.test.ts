import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculatePetRebirth, normalizePetRebirthDispatchMessage, parsePetRebirthCommand } from "../src/pet/pet-rebirth-service.js";

describe("pet rebirth command", () => {
  it("separates exact self rebirth from the full admin target form", () => {
    assert.deepEqual(parsePetRebirthCommand("/환생"), { kind: "self" });
    assert.deepEqual(parsePetRebirthCommand("/환생 대상 남"), { kind: "admin", targetName: "대상 남" });
    assert.equal(parsePetRebirthCommand("/환생 "), null);
    assert.equal(parsePetRebirthCommand("/환생대상"), null);
  });

  it("normalizes only the argument form for exact DB dispatch", () => {
    assert.equal(normalizePetRebirthDispatchMessage("/환생"), "/환생");
    assert.equal(normalizePetRebirthDispatchMessage("/환생 대상"), "/환생 [유저명]");
  });

  it("keeps accumulated level and rebirth count BIGINT-safe", () => {
    assert.deepEqual(calculatePetRebirth({ level: 9007199254740993n, accumulated_level_offset: 7n, rebirth_count: 3n }), {
      level: 1n, accumulatedLevel: 9007199254741000n, rebirthCount: 4n,
    });
  });
});
