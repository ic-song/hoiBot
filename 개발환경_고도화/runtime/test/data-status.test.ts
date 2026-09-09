import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDataStatus, parseDataStatusCommand, type DataStatusObject } from "../src/admin/data-status-service.js";

describe("admin data status", () => {
  it("accepts exact production and DEV commands only", () => {
    assert.equal(parseDataStatusCommand("/데이터상태"),"prod"); assert.equal(parseDataStatusCommand("dev/데이터상태"),"dev");
    assert.equal(parseDataStatusCommand("/데이터상태 "),null); assert.equal(parseDataStatusCommand("/데이터상태 1"),null); assert.equal(parseDataStatusCommand("dev//데이터상태"),null);
  });
  it("renders all twelve healthy slots in stable order", () => {
    const targets=["member","member_pet","petSkillData","petHomeActivityData"] as const,slots=["original","backup1","backup2"] as const;
    const objects:DataStatusObject[]=[];for(const target of targets)for(const slot of slots)objects.push({target,slot,exists:true,validJson:true,modifiedAt:"2026-08-28 12:00:00",errorCode:null});
    const data=formatDataStatus({environment:"prod",revisionKey:"rev-1",capturedAt:"2026-08-28 12:01:00",objects});
    assert.equal((data.match(/: 정상/g)??[]).length,12);assert.ok(data.indexOf("◼ member")<data.indexOf("◼ member_pet"));assert.match(data,/revision: rev-1/);
  });
  it("keeps missing and damaged files independent without exposing errors", () => {
    const data=formatDataStatus({environment:"dev",revisionKey:"rev-2",capturedAt:null,objects:[
      {target:"member",slot:"original",exists:false,validJson:false,modifiedAt:null,errorCode:"ENOENT:/private/path"},
      {target:"member",slot:"backup1",exists:true,validJson:false,modifiedAt:"2026-08-28 11:00:00",errorCode:"JSON_PARSE:/private/path"}
    ]});
    assert.match(data,/데이터 상태 \[DEV\]/);assert.match(data,/원본: 누락/);assert.match(data,/1차: 손상/);assert.doesNotMatch(data,/private\/path/);
  });
  it("shows an explicit empty revision state",()=>{assert.equal(formatDataStatus({environment:"prod",revisionKey:null,capturedAt:null,objects:[]}),"📦 데이터 상태 [운영]\n상태 스냅샷이 없습니다.\n백업 생성 후 다시 확인해주세요.");});
});
