import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import { isGuildNameRenameCandidate, parseGuildNameRename } from "../src/guild/guild-name-rename-service.js";

describe("guild name rename boundary", () => {
  it("preserves the broad legacy namespace candidate", () => {
    assert.equal(isGuildNameRenameCandidate("/길드이름변경 새길드"), true);
    assert.equal(isGuildNameRenameCandidate("/길드이름변경안내"), true);
    assert.equal(isGuildNameRenameCandidate("안내 /길드이름변경 새길드"), false);
  });
  it("parses a whitespace-free name and pins NFC", () => {
    assert.deepEqual(parseGuildNameRename("/길드이름변경  새길드  "), { displayName:"새길드",normalizedName:"새길드" });
    assert.equal(parseGuildNameRename("/길드이름변경 가").normalizedName,"가");
  });
  it("keeps the legacy UTF-16 ten-code-unit boundary", () => {
    assert.equal(parseGuildNameRename(`/길드이름변경 ${"가".repeat(10)}`).displayName.length,10);
    assert.throws(()=>parseGuildNameRename(`/길드이름변경 ${"가".repeat(11)}`),(error:unknown)=>error instanceof ApplicationError&&error.code==="GUILD_NAME_RENAME_USAGE");
    assert.equal(parseGuildNameRename(`/길드이름변경 ${"🐰".repeat(5)}`).displayName.length,10);
    assert.throws(()=>parseGuildNameRename(`/길드이름변경 ${"🐰".repeat(6)}`),ApplicationError);
  });
  it("rejects missing whitespace and control-name boundaries", () => {
    for(const value of ["/길드이름변경","/길드이름변경 두 글자","/길드이름변경 새\n길드","/길드이름변경 \u0000"]){
      assert.throws(()=>parseGuildNameRename(value),(error:unknown)=>error instanceof ApplicationError&&error.code==="GUILD_NAME_RENAME_USAGE");
    }
  });
});
