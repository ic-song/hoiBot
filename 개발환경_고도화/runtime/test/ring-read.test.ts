import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRingRewardStatsMessage, isRingReadCommandCandidate, parseRingReadCommand } from "../src/ring/ring-read-service.js";

describe("ring read slice", () => {
  it("accepts only the three exact legacy commands", () => {
    for (const command of ["/반지보상통계", "/반지순위", "/반지정보"]) assert.equal(isRingReadCommandCandidate(command), true);
    for (const command of ["/반지보상통계 1", "/반지순위 안내", "/반지정보 "]) assert.equal(isRingReadCommandCandidate(command), false);
  });

  it("preserves retired replies and legacy role boundaries", () => {
    assert.deepEqual(parseRingReadCommand("/반지순위"), { commandCode: "RING_RANK_RETIRED", handlerKey: "ring_rank_retired", kind: "fixed", requiredRole: "none", fixedData: "반지순위는 펜던트 콘텐츠 전환으로 종료되었습니다." });
    assert.equal(parseRingReadCommand("/반지정보")?.requiredRole, "super_admin");
    assert.equal(parseRingReadCommand("/반지보상통계")?.requiredRole, "operator");
  });

  it("formats the exact statistics order with allsee and comma values", () => {
    const data = buildRingRewardStatsMessage({ totalPetUserCount: 5000n, claimedUserCount: 2n, claimedRewardTotal: 3000n,
      claimedRewardRemainTotal: 700n, pendingRingUserCount: 2n, pendingRewardTotal: 500n, claimedWithRingCount: 1n, rewardCalcErrorCount: 1n });
    assert.equal((data.match(/\u200b/g) ?? []).length, 500);
    assert.match(data, /전체 펫 유저 : 5,000명/);
    assert.match(data, /사용 추정 : 2,300개/);
    assert.match(data, /완료 flag \+ ring 잔존 : 1명\n계산 오류 : 1명$/);
  });

  it("clamps estimated use to zero when remaining inventory exceeds grants", () => {
    const data = buildRingRewardStatsMessage({ totalPetUserCount: 0n, claimedUserCount: 1n, claimedRewardTotal: 2n,
      claimedRewardRemainTotal: 3n, pendingRingUserCount: 0n, pendingRewardTotal: 0n, claimedWithRingCount: 0n, rewardCalcErrorCount: 0n });
    assert.match(data, /사용 추정 : 0개/);
  });
});
