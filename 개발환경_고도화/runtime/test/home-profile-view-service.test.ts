import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHomeProfileViewCandidate, normalizeHomeProfileViewDispatchMessage, parseHomeProfileViewCommand } from "../src/home/home-profile-view-command.js";
import { formatHomeComments, formatHomeFeeds, formatHomeProfile } from "../src/home/home-profile-view-service.js";

describe("home profile view command and projection", () => {
  it("keeps self, multiword target and adjacent command boundaries", () => {
    assert.equal(isHomeProfileViewCandidate("/펫홈"), true);
    assert.equal(isHomeProfileViewCandidate("/펫홈   "), true);
    assert.deepEqual(parseHomeProfileViewCommand("/펫홈  호이   남"), { targetName: "호이 남" });
    assert.equal(isHomeProfileViewCandidate("/펫홈순위"), false);
    assert.equal(isHomeProfileViewCandidate(" /펫홈"), false);
    assert.equal(normalizeHomeProfileViewDispatchMessage("/펫홈 호이 남"), "/펫홈");
  });
  it("renders stable furniture, feed and comment boundaries", () => {
    const home = { player_id: 2n, display_name: "대상", rank_emoji: "🌱", home_name: "집", base_experience: 10n, like_count: 2n, visit_count: 3n, floor_area: 4n, version: 1n, pet_name: "펫" };
    const profile = formatHomeProfile({ home, placed: [{ display_name: "의자", charm_snapshot: 1n }, { display_name: "침대", charm_snapshot: 2n }], followers: 5n, following: 6n, equippedBadge: "S1" });
    assert.match(profile, /🌱대상/); assert.match(profile, /\u200b{500}\n2\. 침대/);
    assert.match(formatHomeFeeds([]), /등록된 피드가 없습니다/);
    assert.match(formatHomeComments([{ author_name: "고정", body: "핀" }], [{ author_name: "일반", body: "댓글" }]), /📌 고정: 핀/);
  });
});
