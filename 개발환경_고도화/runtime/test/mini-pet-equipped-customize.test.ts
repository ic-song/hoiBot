import assert from "node:assert/strict";import{describe,it}from"node:test";import{isMiniPetEquippedCustomizeCommand,parseMiniPetEquippedCustomizeCommand}from"../src/mini-pet/mini-pet-equipped-customize-service.js";
describe("mini pet equipped customize",()=>{
 it("accepts both exact command families",()=>{assert.equal(isMiniPetEquippedCustomizeCommand("/미니펫외형"),true);assert.equal(isMiniPetEquippedCustomizeCommand("/미니펫이름 호이"),true);assert.equal(isMiniPetEquippedCustomizeCommand("/미니펫외형아님"),false);});
 it("parses one whitespace-free appearance up to five UTF-16 units",()=>{assert.deepEqual(parseMiniPetEquippedCustomizeCommand("/미니펫외형 😺"),{kind:"appearance",value:"😺"});assert.deepEqual(parseMiniPetEquippedCustomizeCommand("/미니펫외형 abcde"),{kind:"appearance",value:"abcde"});});
 it("parses one whitespace-free name up to four UTF-16 units",()=>{assert.deepEqual(parseMiniPetEquippedCustomizeCommand("/미니펫이름 호이봇"),{kind:"name",value:"호이봇"});assert.deepEqual(parseMiniPetEquippedCustomizeCommand("/미니펫이름 abcd"),{kind:"name",value:"abcd"});});
 it("rejects empty, overlong, and suffix guide text",()=>{for(const v of["/미니펫외형","/미니펫외형 abcdef","/미니펫이름 abcde","/미니펫이름 호이 해봐"])assert.equal(parseMiniPetEquippedCustomizeCommand(v),undefined);});
});
