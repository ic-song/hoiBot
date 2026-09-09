import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { formatCharacterCountStats, isCharacterCountStatsCommand, projectCharacterCountStats, type CharacterCountSourceRow } from "../src/admin/character-count-stats-service.js";

const codes = ["member","pet_home","equipped_furniture","member_pet","pet_skill","member_title","pet_title","mini_pet_title","mini_pet_collection","trial_tower","pet_explore","guild","attendance_light","board","free_market"];

function row(sourceCode: string, rawJson = JSON.stringify({ [`${sourceCode}-user`]: { value: sourceCode } })): CharacterCountSourceRow {
  return { source_code:sourceCode,raw_json:rawJson,content_sha256:createHash("sha256").update(rawJson).digest("hex"),utf16_code_unit_count:BigInt(rawJson.length),entity_count:1n,read_status:"valid" };
}

describe("admin character count stats", () => {
  it("accepts only the exact command", () => {
    assert.equal(isCharacterCountStatsCommand("/글자수통계"), true);
    assert.equal(isCharacterCountStatsCommand("/글자수통계 "), false);
    assert.equal(isCharacterCountStatsCommand("/글자수통계 안내"), false);
  });

  it("projects 15 physical snapshots into 16 ordered stats with a derived pendant", () => {
    const rows = codes.map((code) => row(code, code === "member_pet" ? JSON.stringify({ "가":{ pendant:{name:"달"},pendantBag:[] },"나":{ pendant:null,pendantBag:[] },"다":{ pendantBag:[{name:"별"}] } }) : undefined));
    const stats = projectCharacterCountStats(rows);
    assert.equal(stats.length, 16);
    assert.deepEqual(stats.map((stat) => stat.label), ["멤버","펫홈","장착가구","펫멤버","펫스킬","펜던트","회원칭호","펫칭호","미니펫칭호","미니펫도감","시련의탑","펫탐험","길드","경량출석","게시판","자유시장"]);
    assert.equal(stats.find((stat) => stat.sourceCode === "pendant")?.entityCount, "2");
    const data = formatCharacterCountStats(stats, "prod", "7");
    assert.match(data, /^📊 저장 데이터 글자 수 통계 \[운영\]\nsnapshot: 7/);
    assert.match(data, /■ 핵심 데이터[\s\S]*■ 칭호·성장 데이터[\s\S]*■ 운영 데이터/);
    assert.match(data, /\/펫데이터동기화/);
    assert.match(data, /\/전체동기화$/);
  });

  it("rejects missing, extra, duplicate, invalid and hash-mismatched sources", () => {
    const rows = codes.map((code) => row(code));
    assert.throws(() => projectCharacterCountStats(rows.slice(1)), /필수 source 누락/);
    assert.throws(() => projectCharacterCountStats([...rows, row("unknown")]), /허용되지 않은 source_code/);
    assert.throws(() => projectCharacterCountStats([...rows.slice(0,-1), rows[0]!]), /중복 source_code/);
    assert.throws(() => projectCharacterCountStats(rows.map((value,index) => index === 0 ? {...value,read_status:"invalid"} : value)), /유효하지 않은 source 상태/);
    assert.throws(() => projectCharacterCountStats(rows.map((value,index) => index === 0 ? {...value,content_sha256:"0".repeat(64)} : value)), /hash 불일치/);
  });
});
