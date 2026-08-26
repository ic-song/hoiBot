import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMatzangParticipantJoin, isMatzangParticipantJoinCommand } from "../src/battle/matzang-participant-join-service.js";

describe("matzang participant join boundary", () => {
  it("accepts only the exact legacy command and alias", () => {
    assert.equal(isMatzangParticipantJoinCommand("/참여"), true);
    assert.equal(isMatzangParticipantJoinCommand("ㅊㅇ"), true);
    assert.equal(isMatzangParticipantJoinCommand("/참여 1"), false);
    assert.equal(isMatzangParticipantJoinCommand("ㅊㅇ 지금"), false);
  });

  it("formats joined state with the persisted count and participant list", () => {
    const data = formatMatzangParticipantJoin({ status: "joined", displayName: "알파", remaining: 9, maxCount: 10, pt: "3", resting: true, participantNames: ["알파", "베타"] });
    assert.match(data, /휴식 시간/);
    assert.match(data, /남은 횟수: 9 \/ 10/);
    assert.match(data, /누적: 3pt/);
    assert.match(data, /현재 참여자: 2명/);
    assert.match(data, /1\. \[알파\]\n2\. \[베타\]/);
    assert.equal((data.match(/​/g) ?? []).length, 500);
  });

  it("preserves inactive, duplicate, and completed guard messages", () => {
    const base = { displayName: "알파", remaining: 0, maxCount: 10, pt: "0", resting: false, participantNames: [] };
    assert.match(formatMatzangParticipantJoin({ ...base, status: "inactive" }), /진행 중이 아닙니다/);
    assert.match(formatMatzangParticipantJoin({ ...base, status: "already_joined" }), /이미.*참여 중/);
    assert.match(formatMatzangParticipantJoin({ ...base, status: "complete" }), /10회를 모두 소진/);
  });
});
