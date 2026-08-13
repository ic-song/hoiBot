import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideIrisChannelAccess,
  IrisChannelPolicyInspector
} from "../src/integration/iris-channel-policy.js";
import { normalizeIrisEvent } from "../src/integration/iris-normalizer.js";

const OPEN_GROUP_EVIDENCE = {
  roomType: "OM",
  linkId: "link-1",
  openLinkId: "link-1",
  openLinkActive: true,
  openLinkExpired: false
} as const;

describe("Iris channel policy", () => {
  it("allows only a designated active open group for operational processing", () => {
    const decision = decideIrisChannelAccess({
      channelId: "room-1",
      evidence: OPEN_GROUP_EVIDENCE,
      designatedChannelIds: new Set(["room-1"]),
      diagnosticChannelIds: new Set()
    });

    assert.equal(decision.mode, "operational");
    assert.equal(decision.channelClass, "open_group");
  });

  it("keeps a configured development room diagnostic-only", () => {
    const decision = decideIrisChannelAccess({
      channelId: "room-1",
      evidence: OPEN_GROUP_EVIDENCE,
      designatedChannelIds: new Set(),
      diagnosticChannelIds: new Set(["room-1"])
    });

    assert.equal(decision.mode, "diagnostic");
    assert.equal(decision.reason, "diagnostic_channel");
  });

  it("observes every other active open group only during the first-stage validation mode", () => {
    const observed = decideIrisChannelAccess({
      channelId: "room-2",
      evidence: OPEN_GROUP_EVIDENCE,
      designatedChannelIds: new Set(),
      diagnosticChannelIds: new Set(),
      observationMode: "observe_all_open"
    });
    const restricted = decideIrisChannelAccess({
      channelId: "room-2",
      evidence: OPEN_GROUP_EVIDENCE,
      designatedChannelIds: new Set(),
      diagnosticChannelIds: new Set(),
      observationMode: "designated_only"
    });

    assert.equal(observed.mode, "observation");
    assert.equal(observed.reason, "observation_period");
    assert.equal(restricted.mode, "denied");
  });

  it("denies ordinary MultiChat and an inactive open link", () => {
    assert.equal(decideIrisChannelAccess({
      channelId: "room-1",
      evidence: { roomType: "MultiChat" },
      designatedChannelIds: new Set(["room-1"]),
      diagnosticChannelIds: new Set()
    }).reason, "not_open_chat");

    assert.equal(decideIrisChannelAccess({
      channelId: "room-1",
      evidence: { ...OPEN_GROUP_EVIDENCE, openLinkActive: false },
      designatedChannelIds: new Set(["room-1"]),
      diagnosticChannelIds: new Set()
    }).reason, "inactive_open_link");
  });

  it("queries only room eligibility fields and keeps ids string-safe", async () => {
    const calls: Array<{ sql: string; bind: readonly string[] }> = [];
    const inspector = new IrisChannelPolicyInspector("http://unused", async (sql, bind) => {
      calls.push({ sql, bind });
      return [{
        room_type: "OM",
        link_id: "92233720368547758070",
        open_link_id: "92233720368547758070",
        open_link_active: "1",
        open_link_expired: "0"
      }];
    });
    const event = normalizeIrisEvent({
      json: { id: "event-1", chat_id: "18490428324717856", type: 1, v: "{\"origin\":\"MSG\"}" }
    });
    const decision = await inspector.inspect(event, new Set(["18490428324717856"]), new Set());

    assert.equal(decision.mode, "operational");
    assert.equal(decision.evidence.linkId, "92233720368547758070");
    assert.deepEqual(calls[0]?.bind, ["18490428324717856"]);
    assert.match(calls[0]?.sql ?? "", /link\.active/);
  });
});
