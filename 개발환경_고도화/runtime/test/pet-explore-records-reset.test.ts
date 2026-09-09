import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isPetExploreRecordsResetCommand, normalizePetExploreRecordsResetDispatchMessage } from "../src/pet/pet-explore-records-reset-command.js";
import { buildPetExploreRecordsResetMessage } from "../src/pet/pet-explore-records-reset-service.js";

describe("pet explore records reset", () => {
  it("accepts only the exact destructive command", () => {
    assert.equal(isPetExploreRecordsResetCommand("/펫탐험전체전적초기화"), true);
    assert.equal(isPetExploreRecordsResetCommand("/펫탐험전체전적초기화 해줘"), false);
    assert.equal(isPetExploreRecordsResetCommand("/펫탐험전체전적초기화1"), false);
  });

  it("normalizes only an executable request", () => {
    assert.equal(normalizePetExploreRecordsResetDispatchMessage("/펫탐험전체전적초기화"), "/펫탐험전체전적초기화");
    assert.equal(normalizePetExploreRecordsResetDispatchMessage("/펫탐험전체전적초기화 해줘"), "/펫탐험전체전적초기화 해줘");
  });

  it("preserves the legacy destructive scope and target count reply", () => {
    const message = buildPetExploreRecordsResetMessage(1234n);
    assert.match(message, /^🧹\/펫탐험전체전적초기화/);
    assert.match(message, /승\/패\/승률 기록을 모두 삭제합니다/);
    assert.match(message, /초기화 완료 ✅ \(대상: 1234명\)$/);
  });
});
