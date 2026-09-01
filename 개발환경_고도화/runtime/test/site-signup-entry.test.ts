import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSiteSignupEntryMessage, isSiteSignupEntryCommand } from "../src/signup/site-signup-entry.js";

describe("site signup command entry", () => {
  it("accepts only the exact general signup command", () => {
    assert.equal(isSiteSignupEntryCommand("/가입"), true);
    for (const message of ["/가입한다", "/가입 해줘", " /가입", "/가입 ", undefined]) {
      assert.equal(isSiteSignupEntryCommand(message), false);
    }
  });

  it("guides the user through the web and Kakao verification steps", () => {
    const message = buildSiteSignupEntryMessage();
    assert.match(message, /\/signup/);
    assert.match(message, /\/인증 코드/);
    assert.match(message, /ABCD2345/);
  });
});
