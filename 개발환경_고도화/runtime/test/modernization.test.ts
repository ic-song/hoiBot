import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeIrisEvent } from "../src/integration/iris-normalizer.js";
import { classifyMonitoringGroup } from "../src/integration/iris-event-classifier.js";
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
    assert.equal(event.displayNameSource, "iris_cache");
    assert.equal(event.displayNameTrust, "untrusted");
    assert.equal(event.eventCode, "message.created.text");
    assert.equal(event.monitoringGroup, "text");
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

  it("normalizes deletion correlation without retaining the original message body", () => {
    const event = normalizeIrisEvent({
      msg: JSON.stringify({ logId: "target-1", hidden: true, byHost: false, message: "민감한 원문" }),
      sender: "캐시 이름",
      json: { id: "delete-1", type: 0, v: JSON.stringify({ origin: "SYNCDLMSG", isMine: false }) }
    });

    assert.equal(event.eventCode, "message.deleted");
    assert.equal(event.eventCategory, "moderation");
    assert.equal(event.monitoringGroup, "moderation");
    assert.equal(event.targetProviderEventId, "target-1");
    assert.deepEqual(event.eventMetadata, {
      classificationStatus: "live_confirmed",
      classificationRule: "moderation.message_deleted",
      hidden: true,
      byHost: false
    });
    assert.equal(JSON.stringify(event.eventMetadata).includes("민감한 원문"), false);
  });

  it("preserves a 64-bit rewrite target and classifies an open-chat host blind", () => {
    const event = normalizeIrisEvent({
      msg: "재작성",
      json: {
        id: "3901203055167588353",
        chat_id: "18490428324717856",
        user_id: "4809244158090851808",
        type: 0,
        message: "{\"feedType\":26,\"coverType\":\"openchat_blind\",\"hidden\":false,\"chatLogInfos\":[{\"logId\":3901202722747983874,\"type\":1}],\"logId\":3901202722747983874}",
        v: JSON.stringify({ origin: "SYNCREWR", isMine: false })
      }
    });

    assert.equal(event.eventCode, "message.hidden_by_host");
    assert.equal(event.targetProviderEventId, "3901202722747983874");
    assert.deepEqual(event.eventMetadata, {
      classificationStatus: "live_confirmed",
      classificationRule: "moderation.host_hide",
      feedType: 26,
      hidden: false,
      coverType: "openchat_blind",
      targetType: 1
    });
  });

  it("keeps departure generic until kick discrimination is verified", () => {
    const event = normalizeIrisEvent({
      msg: "퇴장",
      sender: "오래된 캐시 이름",
      json: {
        id: "leave-1",
        user_id: "999",
        type: 0,
        message: "{\"feedType\":2,\"member\":{\"userId\":4809244158090851808,\"nickName\":\"실제 퇴장 사용자\"}}",
        v: JSON.stringify({ origin: "DELMEM", isMine: false })
      }
    });

    assert.equal(event.eventCode, "member.departed");
    assert.notEqual(event.eventCode, "member.kicked");
    assert.equal(event.userId, "4809244158090851808");
    assert.equal(event.displayName, "실제 퇴장 사용자");
    assert.equal(event.displayNameSource, "kakao_db");
    assert.equal(event.displayNameTrust, "trusted");
    assert.equal(event.eventMetadata.membershipIdentitySource, "kakao_system_feed");
  });

  it("reads the single joined user from the NEWMEM members array", () => {
    const event = normalizeIrisEvent({
      msg: "입장",
      json: {
        id: "join-1",
        user_id: "999",
        type: 0,
        message: "{\"feedType\":4,\"members\":[{\"userId\":4809244158090851809,\"nickName\":\"실제 입장 사용자\"}]}",
        v: JSON.stringify({ origin: "NEWMEM", isMine: false })
      }
    });

    assert.equal(event.eventCode, "member.joined");
    assert.equal(event.userId, "4809244158090851809");
    assert.equal(event.displayName, "실제 입장 사용자");
    assert.equal(event.eventMetadata.membershipMemberCount, 1);
  });

  it("separates an upstream thread reply from an ordinary reply", () => {
    const event = normalizeIrisEvent({
      msg: "thread reply",
      json: {
        id: "thread-reply-1",
        type: 26,
        attachment: JSON.stringify({ src_logId: "92233720368547758070", src_isThread: true }),
        v: JSON.stringify({ origin: "MSG", isMine: false })
      }
    });

    assert.equal(event.eventCode, "message.created.thread_reply");
    assert.equal(event.targetProviderEventId, "92233720368547758070");
    assert.equal(event.eventMetadata.classificationStatus, "upstream_confirmed");
    assert.equal(event.monitoringGroup, "event");
  });

  it("keeps an unisolated type 12 sticker as a DB-confirmed candidate", () => {
    const event = normalizeIrisEvent({
      msg: "이모티콘",
      json: { id: "sticker-1", type: 12, attachment: "{}", v: JSON.stringify({ origin: "MSG" }) }
    });

    assert.equal(event.eventCode, "media.sticker_candidate");
    assert.equal(event.eventCategory, "candidate");
    assert.equal(event.monitoringGroup, "event");
    assert.equal(event.eventMetadata.classificationStatus, "db_confirmed");
  });

  it("records only field names for an unknown event", () => {
    const event = normalizeIrisEvent({
      msg: "민감한 원문",
      json: {
        id: "unknown-1",
        type: 72,
        attachment: JSON.stringify({ url: "https://private.example", custom: "secret" }),
        v: JSON.stringify({ origin: "MSG" })
      }
    });

    assert.equal(event.eventCode, "iris.unknown");
    assert.equal(event.monitoringGroup, "event");
    assert.equal(event.eventMetadata.attachmentKeys, "custom,url");
    assert.equal(JSON.stringify(event.eventMetadata).includes("private.example"), false);
  });

  it("maps every administrator monitoring family to a persisted group", () => {
    assert.deepEqual([
      classifyMonitoringGroup("message.created.text"),
      classifyMonitoringGroup("media.video"),
      classifyMonitoringGroup("message.created.reply"),
      classifyMonitoringGroup("message.deleted"),
      classifyMonitoringGroup("member.joined"),
      classifyMonitoringGroup("content.rich_card")
    ], ["text", "media", "event", "moderation", "membership", "event"]);
    assert.equal(classifyMonitoringGroup("media.animated_sticker"), "event");
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
      currencyAccounts: [{ code: "point", balance: "1234567890123456.1", version: "2" }, { code: "diamond", balance: "7.000", version: "1" }],
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
