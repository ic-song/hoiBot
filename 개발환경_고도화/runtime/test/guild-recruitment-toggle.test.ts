import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isGuildRecruitmentToggleCommand } from "../src/guild/guild-recruitment-toggle-service.js";

describe("guild recruitment toggle command boundary", () => {
  it("accepts only two exact inverse commands", () => {
    assert.equal(isGuildRecruitmentToggleCommand("/길드인원마감"), true);
    assert.equal(isGuildRecruitmentToggleCommand("/길드인원마감해제"), true);
    for (const message of [undefined, "/길드인원마감 ", "/길드인원마감 안내", "/길드인원마감해제 ", "/길드인원마감해제 안내"]) {
      assert.equal(isGuildRecruitmentToggleCommand(message), false);
    }
  });
});
