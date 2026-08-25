import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHappyFoundationCaptainCommand, normalizeHappyFoundationDispatchMessage } from "../src/foundation/happy-foundation-captain-service.js";

describe("happy foundation captain command boundary", () => {
  it("accepts only a complete target, none or release form", () => {
    for (const message of ["/행복단장변경 합성회원", "/행복단장변경 여러 단어 회원", "/행복단장변경 없음", "/행복단장변경 해제"]) {
      assert.equal(isHappyFoundationCaptainCommand(message), true);
      assert.equal(normalizeHappyFoundationDispatchMessage(message), "/행복단장변경");
    }
    for (const message of [undefined, "/행복단장변경", "/행복단장변경 ", "/행복단장변경\t"]) {
      assert.equal(isHappyFoundationCaptainCommand(message), false);
    }
  });
});
