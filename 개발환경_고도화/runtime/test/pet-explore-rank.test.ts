import assert from "node:assert/strict";
import test from "node:test";
import { buildPetExploreRankMessage, isPetExploreRankCommand } from "../src/pet/pet-explore-rank-service.js";

test("펫탐험 순위 명령은 정확히 일치할 때만 실행된다", () => {
  assert.equal(isPetExploreRankCommand("/펫탐험순위"), true);
  assert.equal(isPetExploreRankCommand("/펫탐험순위 1"), false);
  assert.equal(isPetExploreRankCommand("/펫탐험순위 해봐"), false);
});

test("30승 미만이면 레거시 빈 결과 문구를 반환한다", () => {
  assert.equal(buildPetExploreRankMessage([
    { playerName: "미달", win: 29, lose: 0, rankLabel: "초보" }
  ], { allsee: "ALLSEE", nextIntervalText: "다음 갱신" }),
  "⛰️ [ 펫탐험 다승 순위 ] ⛰️\n(승리 → 적은 패배 → 가나다, 30승 이상만 표시)\n\n표시할 유저가 없습니다.");
});

test("승리·패배·이름 순 정렬과 5위 allsee 및 승률을 보존한다", () => {
  const message = buildPetExploreRankMessage([
    { playerName: "바", win: 31, lose: 1, rankLabel: "R바" },
    { playerName: "가", win: 31, lose: 1, rankLabel: "R가" },
    { playerName: "다", win: 32, lose: 8, rankLabel: "R다" },
    { playerName: "라", win: 31, lose: 0, rankLabel: "R라" },
    { playerName: "마", win: 30, lose: 0, rankLabel: "R마" },
    { playerName: "사", win: 30, lose: 1, rankLabel: "R사" }
  ], { allsee: "<ALLSEE>", nextIntervalText: "다음 갱신" });
  assert.ok(message.indexOf("1등 [R다]") < message.indexOf("2등 [R라]"));
  assert.ok(message.indexOf("3등 [R가]") < message.indexOf("4등 [R바]"));
  assert.match(message, /5등 \[R마\] : 30승 0패 \(100\.00%\)\n<ALLSEE>6등/);
  assert.ok(message.endsWith("다음 갱신"));
});

