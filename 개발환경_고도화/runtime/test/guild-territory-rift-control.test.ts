import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateAppliedCount,
  decimalToMilli,
  milliToDecimal,
  normalizeGuildTerritoryRiftControlDispatchMessage,
  parseGuildTerritoryRiftControlCommand,
} from "../src/guild/guild-territory-rift-control-service.js";

describe("guild territory rift control", () => {
  it("accepts exact commands and one allowed count only", () => {
    assert.deepEqual(parseGuildTerritoryRiftControlCommand("/균열"), { kind: "rift_guide", commandText: "/균열", requestedCount: 1n });
    assert.deepEqual(parseGuildTerritoryRiftControlCommand("/불안정 20"), { kind: "instability_up", commandText: "/불안정", requestedCount: 20n });
    assert.deepEqual(parseGuildTerritoryRiftControlCommand("/안정 0"), { kind: "instability_down", commandText: "/안정", requestedCount: 0n });
    assert.deepEqual(parseGuildTerritoryRiftControlCommand("/대균열"), { kind: "great_rift_guide", commandText: "/대균열", requestedCount: 1n });
    for (const value of ["/대균열 1", "/균열 1 추가", "/균열 -1", "/균열 1.5", " /균열", "/균열 ", "/균열 18446744073709551616"]) {
      assert.equal(parseGuildTerritoryRiftControlCommand(value), null);
    }
  });

  it("normalizes only executable parameterized commands", () => {
    assert.equal(normalizeGuildTerritoryRiftControlDispatchMessage("/균열 3"), "/균열");
    assert.equal(normalizeGuildTerritoryRiftControlDispatchMessage("/불안정 20"), "/불안정");
    assert.equal(normalizeGuildTerritoryRiftControlDispatchMessage("/대균열 2"), "/대균열 2");
  });

  it("converts signed decimal values without floating point drift", () => {
    assert.equal(decimalToMilli("10.000"), 10_000n);
    assert.equal(decimalToMilli("-0.500"), -500n);
    assert.equal(milliToDecimal(-10_000n), "-10.000");
    assert.equal(milliToDecimal(30_000n), "30.000");
  });

  it("clamps applied count by request, inventory and policy room", () => {
    assert.equal(calculateAppliedCount({ requested: 5n, available: 9n, currentMilli: 0n, adjustmentMilli: 10_000n, minimumMilli: -70_000n, maximumMilli: 30_000n }), 3n);
    assert.equal(calculateAppliedCount({ requested: 100n, available: 100n, currentMilli: 10_000n, adjustmentMilli: -500n, minimumMilli: -10_000n, maximumMilli: 10_000n }), 40n);
    assert.equal(calculateAppliedCount({ requested: 3n, available: 0n, currentMilli: 0n, adjustmentMilli: 500n, minimumMilli: -10_000n, maximumMilli: 10_000n }), 0n);
  });
});
