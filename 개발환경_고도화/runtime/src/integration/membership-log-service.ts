import type { DatabaseClient } from "../database.js";

export interface MembershipLogEntry {
  eventCode: "joined" | "departed";
  occurredAt: Date;
}

export interface MembershipLogSummary {
  systemAccountName?: string;
  visitCount: string;
  messageCount: string;
  deletionCount: string;
  currentOccurredAt: Date;
  firstJoinedAt?: Date;
  previousDepartedAt?: Date;
  previousDisplayNames: string[];
  recentEntries: MembershipLogEntry[];
}

// 방·Kakao user_id 기준으로 입퇴장과 최소 활동 통계를 조회합니다.
export class MembershipLogService {
  constructor(private readonly database: DatabaseClient) {}

  async getSummary(externalChannelId: string, externalUserId: string): Promise<MembershipLogSummary | null> {
    const identities = await this.database.query<Array<{
      channel_id: bigint;
      external_identity_id: bigint;
      system_account_name: string | null;
    }>>(
      `SELECT channel.id AS channel_id, identity.id AS external_identity_id,
              account.system_account_name
         FROM channels AS channel
         JOIN external_identities AS identity
           ON identity.provider_code = 'kakao' AND identity.external_user_id = ?
         LEFT JOIN user_accounts AS account ON account.player_id = identity.player_id
        WHERE channel.provider_code = 'kakao' AND channel.external_channel_id = ?
        LIMIT 1`,
      [externalUserId, externalChannelId]
    );
    const identity = identities[0];
    if (identity === undefined) return null;
    const [membershipRows, activityRows, deletionRows, nameRows, recentEntries] = await Promise.all([
      this.database.query<Array<{
        visit_count: bigint;
        current_occurred_at: Date;
        first_joined_at: Date | null;
        previous_departed_at: Date | null;
      }>>(
        `SELECT SUM(event.membership_event_code = 'joined') AS visit_count,
                MAX(event.occurred_at) AS current_occurred_at,
                MIN(CASE WHEN event.membership_event_code = 'joined' THEN event.occurred_at END) AS first_joined_at,
                MAX(CASE WHEN event.membership_event_code = 'departed' THEN event.occurred_at END) AS previous_departed_at
           FROM channel_membership_events AS event
          WHERE event.channel_id = ? AND event.external_identity_id = ?`,
        [identity.channel_id, identity.external_identity_id]
      ),
      this.database.query<Array<{ message_count: bigint }>>(
        `SELECT COALESCE(SUM(message_count), 0) AS message_count
           FROM channel_activity_daily
          WHERE channel_id = ? AND external_identity_id = ?`,
        [identity.channel_id, identity.external_identity_id]
      ),
      this.database.query<Array<{ deletion_count: bigint }>>(
        `SELECT COUNT(*) AS deletion_count
           FROM moderation_incidents
          WHERE channel_id = ? AND external_identity_id = ? AND incident_type = 'message_deleted'`,
        [identity.channel_id, identity.external_identity_id]
      ),
      this.database.query<Array<{ display_name: string }>>(
        `SELECT display_name
           FROM external_identity_names
          WHERE external_identity_id = ? AND trust_status = 'verified'
          ORDER BY observed_at DESC, id DESC
          LIMIT 10`,
        [identity.external_identity_id]
      ),
      this.database.query<Array<{ membership_event_code: "joined" | "departed"; occurred_at: Date }>>(
        `SELECT membership_event_code, occurred_at
           FROM channel_membership_events
          WHERE channel_id = ? AND external_identity_id = ?
          ORDER BY occurred_at DESC, id DESC
          LIMIT 5`,
        [identity.channel_id, identity.external_identity_id]
      )
    ]);
    const membership = membershipRows[0];
    if (membership?.current_occurred_at === undefined) return null;
    const uniqueNames = [...new Set(nameRows.map((row) => row.display_name))];
    return {
      systemAccountName: identity.system_account_name ?? undefined,
      visitCount: (membership.visit_count ?? 0n).toString(),
      messageCount: (activityRows[0]?.message_count ?? 0n).toString(),
      deletionCount: (deletionRows[0]?.deletion_count ?? 0n).toString(),
      currentOccurredAt: membership.current_occurred_at,
      firstJoinedAt: membership.first_joined_at ?? undefined,
      previousDepartedAt: membership.previous_departed_at ?? undefined,
      previousDisplayNames: uniqueNames.slice(1, 6),
      recentEntries: recentEntries.map((row) => ({
        eventCode: row.membership_event_code,
        occurredAt: row.occurred_at
      }))
    };
  }
}
