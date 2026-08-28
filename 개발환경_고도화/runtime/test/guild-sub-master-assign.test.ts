import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import { isGuildSubMasterAssignCandidate, parseGuildSubMasterAssign } from "../src/guild/guild-sub-master-assign-service.js";

describe("guild sub-master assign boundary", () => {
  it("recognizes only the exact namespace", () => { assert.equal(isGuildSubMasterAssignCandidate("/부길마"), true); assert.equal(isGuildSubMasterAssignCandidate("/부길마 2 3"), true); for (const value of [undefined,"/부길마안내","안내 /부길마 2"]) assert.equal(isGuildSubMasterAssignCandidate(value), false); });
  it("parses one or two positive member numbers", () => { assert.deepEqual(parseGuildSubMasterAssign("/부길마 2"), { memberNumbers: [2] }); assert.deepEqual(parseGuildSubMasterAssign("/부길마 2 7"), { memberNumbers: [2,7] }); });
  it("rejects bare, extra and non-numeric arguments", () => { for (const value of ["/부길마","/부길마 이름","/부길마 1 2 3","/부길마 1 안내"]) assert.throws(() => parseGuildSubMasterAssign(value), (error: unknown) => error instanceof ApplicationError && error.code === "GUILD_SUB_MASTER_USAGE"); });
  it("rejects zero and duplicate numbers", () => { assert.throws(() => parseGuildSubMasterAssign("/부길마 0"), (error: unknown) => error instanceof ApplicationError && error.code === "GUILD_SUB_MASTER_NUMBER_REQUIRED"); assert.throws(() => parseGuildSubMasterAssign("/부길마 2 2"), (error: unknown) => error instanceof ApplicationError && error.code === "GUILD_SUB_MASTER_DUPLICATE"); });
});
