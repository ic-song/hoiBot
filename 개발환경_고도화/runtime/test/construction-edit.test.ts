import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConstructionEditRepository, ConstructionEditRequest, ConstructionEditResult } from "../src/home/construction-edit.js";
import {
  buildConstructionEditCompletedMessage,
  findLegacyHomeName,
  parseConstructionEditCommand
} from "../src/home/construction-edit-policy.js";
import { ConstructionEditService } from "../src/home/construction-edit-service.js";

// 건설 수정 서비스의 권한과 repository 호출을 기록하는 메모리 저장소를 만듭니다.
function memory(authorized = true) {
  const adjusted: ConstructionEditRequest[] = [];
  const repository: ConstructionEditRepository = {
    async findAuthorizedOperator() { return authorized ? "11" : null; },
    async adjust(request) {
      adjusted.push(request);
      return { status: "completed", data: "완료", floorArea: request.floorArea, homeName: request.homeName };
    }
  };
  return { service: new ConstructionEditService(repository), adjusted };
}

describe("construction edit policy", () => {
  it("accepts only an exact command token and a final numeric floor", () => {
    assert.deepEqual(parseConstructionEditCommand("/건설수정"), { kind: "usage" });
    assert.equal(parseConstructionEditCommand("/건설수정 테스트 베타 5").kind, "edit");
    assert.deepEqual(parseConstructionEditCommand("/건설수정테스트 베타 5"), { kind: "ignored" });
    assert.deepEqual(parseConstructionEditCommand("/건설수정 테스트베타 5 해봐"), { kind: "numeric_error" });
    assert.deepEqual(parseConstructionEditCommand("/건설수정 테스트베타 5abc"), { kind: "numeric_error" });
  });

  it("preserves legacy home catalog gaps and first-match duplicates", () => {
    assert.equal(findLegacyHomeName(1), "서울역 4번출구🚉");
    assert.equal(findLegacyHomeName(189), undefined);
    assert.equal(findLegacyHomeName(190), "갤러리아 호레🏠");
    assert.equal(findLegacyHomeName(207), undefined);
    assert.equal(findLegacyHomeName(210), "아프로 호월포레스트🏠");
    assert.equal(findLegacyHomeName(211), " 호월 리버파크🏠");
    assert.equal(findLegacyHomeName(263), "더 넥스트 호월 뷰🏠");
    assert.equal(findLegacyHomeName(300), "더 펜트호월스 🏠");
  });

  it("keeps the legacy success reply including the accumulated-charm heart", () => {
    assert.equal(buildConstructionEditCompletedMessage({
      targetName: "테스트베타", floorArea: 55, homeName: "마당 있는 이층집🏠", baseExperience: "30"
    }), "✅ 건설 수정 완료\n대상: 테스트베타\n변경 평수: 55평\n집 이름: 마당 있는 이층집🏠\n누적 매력: 30💕");
  });
});

describe("construction edit service", () => {
  const input = { externalUserId: "admin", channelId: "room", message: "/건설수정 테스트 베타 55", eventId: "event" };

  it("keeps unauthorized requests silent", async () => {
    const result = await memory(false).service.handle(input);
    assert.deepEqual(result, { status: "ignored_forbidden" });
  });

  it("delegates a valid free-form nickname and legacy house name", async () => {
    const state = memory();
    const result: ConstructionEditResult = await state.service.handle(input);
    assert.equal(result.status, "completed");
    assert.equal(state.adjusted[0]?.targetName, "테스트 베타");
    assert.equal(state.adjusted[0]?.floorArea, 55);
    assert.equal(state.adjusted[0]?.homeName, "마당 있는 이층집🏠");
  });

  it("rejects missing, nonnumeric, and unavailable floors without mutation", async () => {
    const state = memory();
    assert.equal((await state.service.handle({ ...input, message: "/건설수정 테스트베타" })).status, "invalid_command");
    assert.equal((await state.service.handle({ ...input, message: "/건설수정 테스트베타 오" })).status, "invalid_command");
    assert.equal((await state.service.handle({ ...input, message: "/건설수정 테스트베타 189" })).status, "invalid_floor");
    assert.equal(state.adjusted.length, 0);
  });
});
