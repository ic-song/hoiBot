import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isOneDayPassSubscriptionCommand, normalizeOneDayPassSubscriptionDispatchMessage } from "../src/pass/one-day-pass-subscription-command.js";

describe("one day pass subscription command", () => {
  it("accepts only the exact no-argument command", () => {
    assert.equal(isOneDayPassSubscriptionCommand("/원데이패스구독"), true);
    assert.equal(isOneDayPassSubscriptionCommand(" /원데이패스구독 "), true);
    assert.equal(isOneDayPassSubscriptionCommand("/원데이패스구독 안내"), false);
  });
  it("does not collide with base or registry commands", () => {
    assert.equal(isOneDayPassSubscriptionCommand("/원데이패스"), false);
    assert.equal(isOneDayPassSubscriptionCommand("/원데이패스추가, 대상"), false);
    assert.equal(isOneDayPassSubscriptionCommand("/원데이패스삭제, 대상"), false);
  });
  it("normalizes only the executable alias", () => {
    assert.equal(normalizeOneDayPassSubscriptionDispatchMessage("/원데이패스구독"), "/원데이패스구독");
    assert.equal(normalizeOneDayPassSubscriptionDispatchMessage("/원데이패스구독 안내"), "/원데이패스구독 안내");
  });
});
