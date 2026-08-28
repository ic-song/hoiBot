import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDataRestoreResult,
  isDataRestoreCommandCandidate,
  parseDataRestoreCommand,
} from "../src/admin/data-restore-service.js";

describe("admin data restore command", () => {
  it("accepts only exact guide and complete target-generation forms", () => {
    assert.equal(isDataRestoreCommandCandidate("/데이터복구"), true);
    assert.equal(
      isDataRestoreCommandCandidate("/데이터복구 member 1"),
      true,
    );
    assert.equal(
      isDataRestoreCommandCandidate("dev/데이터복구 petSkillData 2"),
      true,
    );
    assert.equal(
      isDataRestoreCommandCandidate("/데이터복구 member 1 실행"),
      false,
    );
    assert.equal(isDataRestoreCommandCandidate("/데이터복구 member 0"), false);
  });

  it("pins the environment, target and immutable generation", () => {
    assert.deepEqual(parseDataRestoreCommand("/데이터복구 member_pet 2"), {
      environment: "prod",
      target: "member_pet",
      generation: 2,
    });
    assert.deepEqual(
      parseDataRestoreCommand("dev/데이터복구 petHomeActivityData 1"),
      {
        environment: "dev",
        target: "petHomeActivityData",
        generation: 1,
      },
    );
  });

  it("renders a fixed guide without mutation fields", () => {
    assert.equal(
      formatDataRestoreResult({
        environment: "prod",
        target: null,
        generation: null,
        restored: false,
        sourceRevisionKey: null,
        sourceHash: null,
        beforeRevision: null,
        afterRevision: null,
      }),
      "사용법: /데이터복구 [member|member_pet|petSkillData|petHomeActivityData] [1|2]",
    );
  });

  it("keeps success and unavailable projections explicit", () => {
    assert.match(
      formatDataRestoreResult({
        environment: "dev",
        target: "member",
        generation: 1,
        restored: true,
        sourceRevisionKey: "revision-1",
        sourceHash: "hash",
        beforeRevision: "1",
        afterRevision: "2",
      }),
      /✅ 데이터 복구 완료[\s\S]*환경: DEV[\s\S]*백업: 1차/,
    );
    assert.match(
      formatDataRestoreResult({
        environment: "prod",
        target: "member",
        generation: 2,
        restored: false,
        sourceRevisionKey: null,
        sourceHash: null,
        beforeRevision: null,
        afterRevision: null,
      }),
      /❌ 데이터 복구 실패[\s\S]*손상/,
    );
  });
});
