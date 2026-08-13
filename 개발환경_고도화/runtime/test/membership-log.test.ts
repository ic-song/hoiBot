import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient } from "../src/database.js";
import { formatIrisEventMonitorMessage } from "../src/integration/iris-event-monitor.js";
import { MembershipLogService } from "../src/integration/membership-log-service.js";
import type { NormalizedIrisEvent } from "../src/integration/iris-normalizer.js";
import { AdminDirectoryService } from "../src/admin/directory-service.js";

describe("membership visit logging", () => {
  it("builds a room-scoped summary without storing chat bodies", async () => {
    const database: DatabaseClient = {
      ping: async () => undefined,
      verifyRollback: async () => true,
      query: async <T>(sql: string) => {
        if (sql.includes("FROM channels AS channel")) {
          return [{ channel_id: 1n, external_identity_id: 2n, system_account_name: "호이 남" }] as T;
        }
        if (sql.includes("SUM(event.membership_event_code")) {
          return [{ visit_count: 2n, current_occurred_at: new Date("2026-08-07T00:04:20Z"),
            first_joined_at: new Date("2026-03-02T08:59:11Z"), previous_departed_at: new Date("2026-03-14T12:41:32Z") }] as T;
        }
        if (sql.includes("channel_activity_daily")) return [{ message_count: 280n }] as T;
        if (sql.includes("moderation_incidents")) return [{ deletion_count: 2n }] as T;
        if (sql.includes("external_identity_names")) {
          return [{ display_name: "현재 이름" }, { display_name: "이전 이름" }] as T;
        }
        if (sql.includes("SELECT membership_event_code")) {
          return [
            { membership_event_code: "joined", occurred_at: new Date("2026-08-07T00:04:20Z") },
            { membership_event_code: "departed", occurred_at: new Date("2026-03-14T12:41:32Z") }
          ] as T;
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
      execute: async () => { throw new Error("Unexpected execute."); },
      withTransaction: async () => { throw new Error("Unexpected transaction."); },
      close: async () => undefined
    };

    const summary = await new MembershipLogService(database).getSummary("room-1", "user-1");

    assert.equal(summary?.visitCount, "2");
    assert.equal(summary?.messageCount, "280");
    assert.equal(summary?.deletionCount, "2");
    assert.deepEqual(summary?.previousDisplayNames, ["이전 이름"]);
  });

  it("formats the supported visit history in the hoiBot style", () => {
    const event: NormalizedIrisEvent = {
      eventId: "iris:join-1",
      providerEventId: "join-1",
      providerCode: "iris",
      eventKind: "0",
      origin: "NEWMEM",
      direction: "incoming",
      channelId: "room-1",
      userId: "user-1",
      displayName: "현재 이름",
      displayNameSource: "kakao_db",
      displayNameTrust: "trusted",
      eventCode: "member.joined",
      eventCategory: "membership",
      monitoringGroup: "membership",
      eventMetadata: {},
      payloadHash: "hash"
    };
    const output = formatIrisEventMonitorMessage({}, event, "모니터링", undefined, {
      systemAccountName: "호이 남",
      visitCount: "2",
      messageCount: "280",
      deletionCount: "2",
      currentOccurredAt: new Date("2026-08-07T00:04:20Z"),
      firstJoinedAt: new Date("2026-03-02T08:59:11Z"),
      previousDepartedAt: new Date("2026-03-14T12:41:32Z"),
      previousDisplayNames: ["이전 이름"],
      recentEntries: [
        { eventCode: "joined", occurredAt: new Date("2026-08-07T00:04:20Z") },
        { eventCode: "departed", occurredAt: new Date("2026-03-14T12:41:32Z") }
      ]
    });

    assert.match(output, /🚪 \[입장 기록\]/);
    assert.match(output, /📍 방: 모니터링/);
    assert.match(output, /👤 사용자: 현재 이름/);
    assert.match(output, /🪪 계정: 호이 남/);
    assert.match(output, /총 2회 방문/);
    assert.match(output, /채팅 280회 · 삭제 2회/);
    assert.match(output, /2026\.08\.07 09:04:20/);
    assert.match(output, /이전 이름/);
    assert.doesNotMatch(output, /Iris|BLUE|강제 퇴장/);
  });

  it("lists users with at least two joins or departures in the same room without a time window", async () => {
    const observedSql: string[] = [];
    const database: DatabaseClient = {
      ping: async () => undefined,
      verifyRollback: async () => true,
      query: async <T>(sql: string) => {
        observedSql.push(sql);
        if (sql.includes("FROM channel_membership_events membership")) {
          return [{
            channel_id: 1n, external_identity_id: 2n, external_channel_id: "room-1",
            external_user_id: "user-1", channel_name: "테스트방", verified_display_name: "테스 남",
            joined_count: 3n, departed_count: 2n, last_occurred_at: new Date("2026-08-07T03:00:00Z")
          }] as T;
        }
        if (sql.includes("SELECT COUNT(*) AS total FROM (")) return [{ total: 1n }] as T;
        throw new Error(`Unexpected query: ${sql}`);
      },
      execute: async () => { throw new Error("Unexpected execute."); },
      withTransaction: async () => { throw new Error("Unexpected transaction."); },
      close: async () => undefined
    };

    const result = await new AdminDirectoryService(database).listMembershipPatterns(100, 0);

    assert.equal(result.total, 1);
    assert.equal(result.items[0]?.repeatCount, "3");
    assert.equal(result.items[0]?.channelName, "테스트방");
    assert.equal(result.items[0]?.verifiedDisplayName, "테스 남");
    assert.equal(observedSql.some((sql) => sql.includes("INTERVAL 24 HOUR")), false);
    assert.equal(observedSql.some((sql) => sql.includes("joined_count >= 2 OR departed_count >= 2")), true);
  });

  it("filters membership detail by one room and one user", async () => {
    const calls: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const database: DatabaseClient = {
      ping: async () => undefined,
      verifyRollback: async () => true,
      query: async <T>(sql: string, parameters?: readonly unknown[]) => {
        calls.push({ sql, parameters });
        if (sql.includes("SELECT membership.id")) return [{
          id: 7n, channel_id: 11n, external_identity_id: 22n,
          membership_event_code: "joined", occurred_at: new Date("2026-08-07T03:00:00Z"),
          external_channel_id: "room-1", external_user_id: "user-1",
          channel_name: "테스트방", verified_display_name: "테스 남"
        }] as T;
        return [{ total: 1n }] as T;
      },
      execute: async () => { throw new Error("Unexpected execute."); },
      withTransaction: async () => { throw new Error("Unexpected transaction."); },
      close: async () => undefined
    };

    const result = await new AdminDirectoryService(database).listMembershipEvents(200, 0, {
      channelId: "11",
      externalIdentityId: "22"
    });

    assert.equal(result.total, 1);
    assert.equal(result.items[0]?.membershipEventCode, "joined");
    assert.deepEqual(calls[0]?.parameters, ["11", "22", 200, 0]);
    assert.match(calls[0]?.sql ?? "", /membership\.channel_id = \? AND membership\.external_identity_id = \?/);
  });
});
