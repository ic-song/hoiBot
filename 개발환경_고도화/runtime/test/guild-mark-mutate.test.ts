import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import { isGuildMarkMutateCandidate, parseGuildMarkMutate } from "../src/guild/guild-mark-mutate-service.js";

describe("guild mark mutate boundary", () => {
  it("preserves the broad legacy namespace candidate", () => {
    assert.equal(isGuildMarkMutateCandidate("/길드마크변경 🐰"), true);
    assert.equal(isGuildMarkMutateCandidate("/길드마크변경안내"), true);
    assert.equal(isGuildMarkMutateCandidate("안내 /길드마크변경 🐰"), false);
  });
  it("trims and accepts a whitespace-free mark", () => {
    assert.deepEqual(parseGuildMarkMutate("/길드마크변경  🐰  "), { mark:"🐰" });
    assert.deepEqual(parseGuildMarkMutate("/길드마크변경안내"), { mark:"안내" });
  });
  it("keeps the legacy UTF-16 ten-code-unit boundary", () => {
    assert.equal(parseGuildMarkMutate(`/길드마크변경 ${"가".repeat(10)}`).mark.length,10);
    assert.equal(parseGuildMarkMutate(`/길드마크변경 ${"🐰".repeat(5)}`).mark.length,10);
    assert.throws(()=>parseGuildMarkMutate(`/길드마크변경 ${"🐰".repeat(6)}`),ApplicationError);
  });
  it("rejects empty, whitespace, control and overlong marks", () => {
    for(const value of ["/길드마크변경","/길드마크변경 두 글자","/길드마크변경 새\n마크","/길드마크변경 \u0000",`/길드마크변경 ${"가".repeat(11)}`]){
      assert.throws(()=>parseGuildMarkMutate(value),(error:unknown)=>error instanceof ApplicationError&&error.code==="GUILD_MARK_MUTATE_USAGE");
    }
  });
});
