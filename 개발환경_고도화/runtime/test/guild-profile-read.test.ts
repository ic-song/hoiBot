import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatGuildProfile, isGuildProfileReadCommand } from "../src/guild/guild-profile-read-service.js";

describe("guild profile read", () => {
  it("accepts only the two exact legacy aliases", () => {
    assert.equal(isGuildProfileReadCommand("/길드정보"), true);
    assert.equal(isGuildProfileReadCommand("ㄱㄱㄱ"), true);
    assert.equal(isGuildProfileReadCommand("/길드정보 1"), false);
    assert.equal(isGuildProfileReadCommand("ㄱㄱㄱ 안내"), false);
  });
  it("formats DB-authoritative profile, member, resource, warehouse and territory fields", () => {
    const data = formatGuildProfile({ guild: { guild_id: 1n, guild_name: "호이 길드", guild_code: "HOI", level_value: 3n, experience: 40n, territory_booster: 2n, join_condition_experience: 10n, recruitment_closed: 0, mark_text: "⭐", server_display_name: "호1", tax_rate: "3.000", charm_value: 900n }, members: [{ player_id: 1n, display_name: "길드장", role_code: "master", pet_name: "펫", contribution_value: 7n }, { player_id: 2n, display_name: "부마", role_code: "sub_master", pet_name: null, contribution_value: 2n }], resources: [{ currency_code: "point", balance: "100.000" }], warehouse: [{ item_code: "ITEM-1", display_name: "상자", quantity: 2n }], territories: [{ territory_no: 1n, territory_name: "호이 평원" }] });
    assert.match(data, /⭐호이 길드/); assert.match(data, /서버: 호1/); assert.match(data, /세율: 3.000%/); assert.match(data, /공헌 7/); assert.match(data, /호이 평원/);
  });
  it("keeps missing optional projections explicit", () => {
    const data = formatGuildProfile({ guild: { guild_id: 1n, guild_name: "빈 길드", guild_code: "EMPTY", level_value: 1n, experience: 0n, territory_booster: 0n, join_condition_experience: 0n, recruitment_closed: 1, mark_text: null, server_display_name: null, tax_rate: "0.000", charm_value: 0n }, members: [], resources: [], warehouse: [], territories: [] });
    assert.match(data, /서버: 미확인/); assert.match(data, /회원 수: 0/); assert.match(data, /\[보유 영지\]\n없음/);
  });
});
