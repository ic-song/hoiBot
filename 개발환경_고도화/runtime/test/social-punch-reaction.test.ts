import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { drawSocialPunch,formatSocialPunchReply,isSocialPunchReactionCommandCandidate,normalizeSocialPunchReactionDispatchMessage,parseSocialPunchReactionCommand } from "../src/social/social-punch-reaction-service.js";

describe("social punch reaction",()=>{
  it("trims and preserves the full target suffix",()=>{assert.deepEqual(parseSocialPunchReactionCommand("/명치한대 대상 이름  "),{targetName:"대상 이름"});assert.deepEqual(parseSocialPunchReactionCommand("/명치한대    "),{targetName:""});});
  it("keeps exact prefix boundaries",()=>{assert.equal(isSocialPunchReactionCommandCandidate("/명치한대 대상"),true);assert.equal(isSocialPunchReactionCommandCandidate("/명치한대"),false);assert.equal(isSocialPunchReactionCommandCandidate(" /명치한대 대상"),false);});
  it("normalizes candidates to the registry alias",()=>{assert.equal(normalizeSocialPunchReactionDispatchMessage("/명치한대 대상"),"/명치한대");assert.equal(normalizeSocialPunchReactionDispatchMessage("/명치한대"),"/명치한대");});
  it("preserves the 10/30/30/30 tier boundaries",()=>{assert.equal(drawSocialPunch(()=>0).tier,"critical");let values=[0.1,0];assert.equal(drawSocialPunch(()=>values.shift()!).tier,"strong");values=[0.4,0];assert.equal(drawSocialPunch(()=>values.shift()!).tier,"light");values=[0.7,0];assert.equal(drawSocialPunch(()=>values.shift()!).tier,"evade");});
  it("always consumes two draws and exposes reactions only for strong hits",()=>{let count=0,values=[0.2,0.6];const strong=drawSocialPunch(()=>{count+=1;return values.shift()!;});assert.equal(count,2);assert.match(formatSocialPunchReply("호이 남","대상",strong),/반격/);values=[0,0.6];const critical=drawSocialPunch(()=>{count+=1;return values.shift()!;});assert.equal(count,4);assert.doesNotMatch(formatSocialPunchReply("호이 남","대상",critical),/반격/);});
});
