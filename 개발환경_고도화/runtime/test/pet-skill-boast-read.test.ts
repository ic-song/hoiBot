import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { formatPetSkillBoastPhrase,isPetSkillBoastReadCommand,selectPetSkillBoastPhraseIndex } from "../src/pet/pet-skill-boast-read-service.js";

describe("pet skill boast read",()=>{
  it("accepts only the exact command",()=>{assert.equal(isPetSkillBoastReadCommand("/자랑"),true);for(const value of ["/자랑 1","/자랑해"," 자랑","/자랑\n"])assert.equal(isPetSkillBoastReadCommand(value),false);});
  it("maps the lower boundary to the first phrase",()=>{assert.equal(selectPetSkillBoastPhraseIndex(0,14),0);});
  it("maps the upper boundary to the fourteenth phrase",()=>{assert.equal(selectPetSkillBoastPhraseIndex(0.999999999999,14),13);assert.throws(()=>selectPetSkillBoastPhraseIndex(1,14));});
  it("replaces every rank and name placeholder",()=>{assert.equal(formatPetSkillBoastPhrase("{rank} {name} / {name}","KING","호이"),"KING 호이 / 호이");});
});
