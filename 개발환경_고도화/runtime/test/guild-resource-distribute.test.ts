import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatGuildResourceDistribution, normalizeGuildResourceDistributeDispatchMessage, parseGuildResourceDistributeCommand } from "../src/guild/guild-resource-distribute-service.js";

describe("guild resource distribute", () => {
  it("accepts only exact all or full positive member-number commands", () => {
    assert.deepEqual(parseGuildResourceDistributeCommand("/길드분배"), { kind: "all" });
    assert.deepEqual(parseGuildResourceDistributeCommand("/길드분배 2 3 5"), { kind: "selected", memberNumbers: [2, 3, 5] });
    for (const message of ["/길드분배 ", "/길드분배 0", "/길드분배 -1", "/길드분배 1 안내", "/길드분배1", " /길드분배"]) assert.equal(parseGuildResourceDistributeCommand(message), null);
  });

  it("normalizes only executable commands", () => {
    assert.equal(normalizeGuildResourceDistributeDispatchMessage("/길드분배 1 2"), "/길드분배");
    assert.equal(normalizeGuildResourceDistributeDispatchMessage("/길드분배 0"), "/길드분배 0");
  });

  it("formats recipient and six-resource reconciliation", () => {
    const data = formatGuildResourceDistribution({ guildName: "호이 길드", recipientNames: ["둘", "셋"], resources: [{ code: "diamond", label: "다이아", storage: "currency", before: "7", perMember: "3", debited: "6", remainder: "1" }] });
    assert.equal(data, "✅ [호이 길드] 길드 자원 분배가 완료되었습니다.\n지급 대상: 2명 (둘, 셋)\n\n다이아: 1인당 3 · 총 6 · 잔여 1");
  });
});
