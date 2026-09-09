import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPetSkillBulkGrantCandidate, normalizePetSkillBulkGrantDispatchMessage, parsePetSkillGrantLine } from "../src/pet/pet-skill-bulk-grant-service.js";
describe("pet skill bulk grant command", () => {
  it("keeps the two legacy operator candidates separate", () => { assert.equal(isPetSkillBulkGrantCandidate("/펫스킬가방추가 대상, 장미칼 1"), true); assert.equal(isPetSkillBulkGrantCandidate("/펫스킬일괄지급\n대상, 장미칼 1"), true); assert.equal(isPetSkillBulkGrantCandidate("/펫스킬가방추가"), false); });
  it("parses names with spaces and a uint64 quantity", () => { assert.deepEqual(parsePetSkillGrantLine("호이 남, 하느님 위에 갓물주 12"), { targetName: "호이 남", skillName: "하느님 위에 갓물주", count: 12n }); });
  it("preserves zero for the legacy quantity error and rejects overflow or malformed lines", () => { assert.equal(parsePetSkillGrantLine("호이, 장미칼 0")?.count, 0n); assert.equal(parsePetSkillGrantLine("호이, 장미칼 18446744073709551616"), null); assert.equal(parsePetSkillGrantLine("호이 장미칼 1"), null); });
  it("normalizes each command to its own registry alias", () => { assert.equal(normalizePetSkillBulkGrantDispatchMessage("/펫스킬가방추가 호이, 장미칼 1"), "/펫스킬가방추가"); assert.equal(normalizePetSkillBulkGrantDispatchMessage("/펫스킬일괄지급\n호이, 장미칼 1"), "/펫스킬일괄지급"); });
});
