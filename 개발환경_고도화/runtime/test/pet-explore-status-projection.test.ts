import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatPetExploreMap, formatPetExploreUserCheck, parsePetExploreStatusProjectionCommand } from "../src/pet/pet-explore-status-projection-service.js";

const participation = { participation_id: 1n, player_id: 10n, display_name: "호이", destination_code: "pet_enhancement_mine", threshold_components_json: { base: 500, tier: 100, experience: 200, lord: 0, trait: 0, pendant: 50, homeBadge: 50, upItem: 0, penalty: 0, premium: 0 }, source_gap_codes_json: [] };

describe("pet explore status projection", () => {
  it("accepts only exact map and full user-check patterns", () => {
    assert.deepEqual(parsePetExploreStatusProjectionCommand("/지도"), { kind: "map", slot: null });
    assert.deepEqual(parsePetExploreStatusProjectionCommand("/탐험유저확인 10"), { kind: "user_check", slot: 10 });
    assert.equal(parsePetExploreStatusProjectionCommand("/지도 보여줘"), null);
    assert.equal(parsePetExploreStatusProjectionCommand("/탐험유저확인 11"), null);
  });

  it("renders current destination, threshold components and event availability", () => {
    const data = formatPetExploreMap({ playerId: 10n, participations: [participation], fixed: [{ player_id: 10n, display_name: "호이", destination_code: "luck_mine" }], runtime: { event_mine_active: 0, guild_raid_active: 1 }, scheduler: { next_run_at: null, interval_minutes: 60 } });
    assert.match(data, /^🗺️ 펫탐험 지도🗺️/);
    assert.match(data, /현재 탐험: 펫강화 광산/);
    assert.match(data, /성공률 9%/);
    assert.doesNotMatch(data, /0\. 다이아 광산/);
    assert.match(data, /10\. 길드레이드 던전/);
  });

  it("renders slot participants, records, fixed users and cleanup counts", () => {
    const data = formatPetExploreUserCheck({ slot: 1, participations: [participation], fixed: [{ player_id: 10n, display_name: "호이", destination_code: "pet_enhancement_mine" }], records: [{ player_name: "호이", win_count: 7n, lose_count: 2n }], cleanup: { participation: 1, fixed: 2, record: 3 } });
    assert.match(data, /1\. 펫강화 광산/);
    assert.match(data, /7승 2패/);
    assert.match(data, /현재참여 1건 \/ 자동탐고정 2건 \/ 전적 3건/);
  });
});
