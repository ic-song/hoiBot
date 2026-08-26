import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPointEditCommandCandidate } from "../src/admin/iris-admin-command-service.js";
import { formatGuildTerritoryDimensionGateReply, isGuildTerritoryDimensionGateCommand, parseGuildTerritoryDimensionGateCommand } from "../src/guild/guild-territory-dimension-gate-service.js";

describe("guild territory dimension gate command boundary", () => {
  it("accepts the four exact legacy aliases only", () => {
    for (const message of ["/차원의문on", "/차원의문온"]) {
      assert.deepEqual(parseGuildTerritoryDimensionGateCommand(message), { enabled: true });
      assert.equal(isPointEditCommandCandidate(message), true);
    }
    for (const message of ["/차원의문off", "/차원의문오프"]) {
      assert.deepEqual(parseGuildTerritoryDimensionGateCommand(message), { enabled: false });
      assert.equal(isPointEditCommandCandidate(message), true);
    }
    for (const message of ["/차원의문on ", "/차원의문off 안내", "/차원의문", "차원의문온"]) {
      assert.equal(isGuildTerritoryDimensionGateCommand(message), false);
      assert.equal(isPointEditCommandCandidate(message), false);
    }
  });

  it("keeps the legacy ON and OFF replies", () => {
    assert.equal(formatGuildTerritoryDimensionGateReply(true), "✅ 차원의 문 🌀 이벤트가 ON 상태로 변경되었습니다.");
    assert.equal(formatGuildTerritoryDimensionGateReply(false), "✅ 차원의 문 🌀 이벤트가 OFF 상태로 변경되었습니다.");
  });
});
