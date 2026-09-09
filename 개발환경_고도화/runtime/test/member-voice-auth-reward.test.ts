import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPointEditCommandCandidate } from "../src/admin/iris-admin-command-service.js";
import {
  isMemberVoiceAuthRewardCommandCandidate,
  normalizeMemberVoiceAuthRewardDispatchMessage
} from "../src/admin/member-voice-auth-reward-service.js";

describe("member voice auth reward command boundary", () => {
  it("accepts one complete target and rejects incomplete or suffix commands", () => {
    for (const message of ["/인증 회원", "/인증 홍 길동", "/인증 🌟합성 회원"]) {
      assert.equal(isMemberVoiceAuthRewardCommandCandidate(message), true);
      assert.equal(isPointEditCommandCandidate(message), true);
      assert.equal(normalizeMemberVoiceAuthRewardDispatchMessage(message), "/인증");
    }
    for (const message of ["/인증", "/인증 ", "/인증회원", "인증 회원", "/인증 회원 "]) {
      assert.equal(isMemberVoiceAuthRewardCommandCandidate(message), false);
    }
    assert.equal(isMemberVoiceAuthRewardCommandCandidate("/인증 ABCD2345"), false);
    assert.equal(normalizeMemberVoiceAuthRewardDispatchMessage("/인증 ABCD2345"), "/인증 ABCD2345");
  });
});
