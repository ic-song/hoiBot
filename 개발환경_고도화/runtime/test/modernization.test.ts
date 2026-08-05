import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeIrisEvent } from "../src/integration/iris-normalizer.js";
import { formatLegacyMyProfile } from "../src/player/legacy-profile-formatter.js";
import type { ProfileView } from "../src/player/profile.js";

describe("Iris normalization", () => {
  it("preserves external ids as strings and prefers provider event id", () => {
    const event = normalizeIrisEvent({
      msg: "/ping",
      sender: "테스터",
      json: { id: "92233720368547758070", _id: 12, chat_id: 34, user_id: "56", type: 1, origin: "MSG", v: "{\"isMine\":false}" }
    });
    assert.equal(event.eventId, "iris:92233720368547758070");
    assert.equal(event.channelId, "34");
    assert.equal(event.userId, "56");
    assert.equal(event.direction, "incoming");
    assert.equal(event.origin, "MSG");
    assert.equal(event.message, "/ping");
    assert.match(event.payloadHash, /^[a-f0-9]{64}$/);
  });

  it("reads origin from the encoded v metadata when the top level has no origin", () => {
    const event = normalizeIrisEvent({
      msg: "/info",
      json: { id: "1", v: "{\"origin\":\"WRITE\",\"isMine\":true}" }
    });

    assert.equal(event.origin, "WRITE");
    assert.equal(event.direction, "outgoing");
  });

  it("uses a deterministic hash when Iris has no event cursor", () => {
    const payload = { msg: "hello", json: { chat_id: "1" } };
    assert.equal(normalizeIrisEvent(payload).eventId, normalizeIrisEvent(payload).eventId);
  });
});

describe("legacy profile formatter", () => {
  it("keeps decimal currency as a string and reproduces profile sections", () => {
    const profile: ProfileView = {
      playerId: "1", displayName: "테스터", profileVersion: "2",
      server: { code: "alpha", displayName: "1서버" }, joinedAt: "2026-08-03T15:00:00.000Z",
      level: "10", accumulatedLevel: "120", experience: { current: "20", next: null }, rebirthCount: "2",
      termsAgreed: true, firstSponsor: true,
      passes: [{ code: "premium", enabled: true, permanent: false, endsAt: null }],
      currencies: { point: "1234567890123456.1", diamond: "7.000" },
      counters: { "attendance:lifetime": "9", "like:current": "3", "like:lifetime": "13", "carrot:lifetime": "2", "thermo:lifetime": "4" },
      activeTitle: "칭호", titleCount: "1", petTitleCount: "0", guild: null, pet: null,
      equippedMiniPet: null, home: null, ranks: {}, badges: ["⭐"]
    };
    const output = formatLegacyMyProfile(profile);
    assert.match(output, /🅟1,234,567,890,123,456\.1/);
    assert.match(output, /\[🐺호이패스 프리미엄🐺\]/);
    assert.match(output, /• 경험치: 20 \/ 144 \(13%\)/);
    assert.match(output, /내정보 상세보기/);
  });
});
