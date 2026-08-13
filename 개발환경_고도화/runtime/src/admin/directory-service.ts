import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export class AdminDirectoryService {
  constructor(private readonly database: DatabaseClient) {}

  async listGameServers(): Promise<Array<{ id: string; code: string; displayName: string; active: boolean; version: string }>> {
    const rows = await this.database.query<Array<{ id: bigint; code: string; display_name: string; active: number; version: bigint }>>(
      "SELECT id, code, display_name, active, version FROM game_servers ORDER BY id"
    );
    return rows.map((row) => ({ id: row.id.toString(), code: row.code, displayName: row.display_name, active: Boolean(row.active), version: row.version.toString() }));
  }

  async listExternalIdentities(status: string | undefined, limit: number, offset: number): Promise<{ items: Array<{ id: string; providerCode: string; externalUserId: string; displayName: string | null; observedDisplayName: string | null; observedNameTrust: string | null; playerId: string | null; status: string }>; total: number }> {
    const where = status === undefined || status === "" ? "" : " WHERE status = ?";
    const values: unknown[] = status === undefined || status === "" ? [] : [status];
    const rows = await this.database.query<Array<{ id: bigint; provider_code: string; external_user_id: string; display_name: string | null; observed_display_name: string | null; observed_name_trust: string | null; player_id: bigint | null; status: string }>>(
      `SELECT identity.id, identity.provider_code, identity.external_user_id, identity.display_name,
        (SELECT observed.display_name FROM external_identity_names observed
         WHERE observed.external_identity_id = identity.id ORDER BY observed.observed_at DESC, observed.id DESC LIMIT 1) AS observed_display_name,
        (SELECT observed.trust_status FROM external_identity_names observed
         WHERE observed.external_identity_id = identity.id ORDER BY observed.observed_at DESC, observed.id DESC LIMIT 1) AS observed_name_trust,
        identity.player_id, identity.status
       FROM external_identities identity${where} ORDER BY identity.id LIMIT ? OFFSET ?`, [...values, limit, offset]
    );
    const counts = await this.database.query<Array<{ total: bigint }>>(`SELECT COUNT(*) AS total FROM external_identities${where}`, values);
    return { items: rows.map((row) => ({ id: row.id.toString(), providerCode: row.provider_code, externalUserId: row.external_user_id, displayName: row.display_name, observedDisplayName: row.observed_display_name, observedNameTrust: row.observed_name_trust, playerId: row.player_id?.toString() ?? null, status: row.status })), total: Number(counts[0]?.total ?? 0n) };
  }

  async approveIdentity(input: { identityId: string; playerId: string; actorId: string; reason: string; idempotencyKey: string }): Promise<{ identityId: string; playerId: string; auditId: string }> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `identity.approve:${input.identityId}`;
      const previous = await transaction.query<Array<{ result_json: string | Record<string, string> }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, input.idempotencyKey]
      );
      if (previous[0]?.result_json !== undefined) {
        return typeof previous[0].result_json === "string" ? JSON.parse(previous[0].result_json) : previous[0].result_json as { identityId: string; playerId: string; auditId: string };
      }
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'admin_operator', ?, 'admin_api', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, input.idempotencyKey, input.actorId]
      );
      const update = await transaction.execute(
        `UPDATE external_identities SET player_id = ?, status = 'linked', updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND status = 'candidate'`,
        [input.playerId, input.identityId]
      );
      if (update.affectedRows !== 1n) throw new ApplicationError("IDENTITY_CANDIDATE_NOT_FOUND", "승인할 identity 후보가 없습니다.", 404);
      await transaction.execute(
        `UPDATE legacy_identity_map SET candidate_external_identity_id = ?, resolution_status = 'approved',
          approved_by = ?, approved_at = UTC_TIMESTAMP(3)
         WHERE player_id = ? AND resolution_status = 'unresolved'`,
        [input.identityId, input.actorId, input.playerId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, created_at)
         VALUES (?, 'admin_operator', ?, 'external_identity', ?, 'identity.approve', 'success', ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, input.actorId, input.identityId, input.reason]
      );
      const result = { identityId: input.identityId, playerId: input.playerId, auditId: audit.insertId.toString() };
      await transaction.execute("UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  async listAudit(limit: number, offset: number): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const rows = await this.database.query<Array<{ id: bigint; operation_id: bigint; actor_type: string; actor_id: bigint | null; target_type: string | null; target_id: bigint | null; action_code: string; result_code: string; reason: string | null; created_at: Date }>>(
      `SELECT id, operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, created_at
       FROM command_audit ORDER BY id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const counts = await this.database.query<Array<{ total: bigint }>>("SELECT COUNT(*) AS total FROM command_audit");
    return { items: rows.map((row) => ({ id: row.id.toString(), operationId: row.operation_id.toString(), actorType: row.actor_type, actorId: row.actor_id?.toString() ?? null, targetType: row.target_type, targetId: row.target_id?.toString() ?? null, actionCode: row.action_code, resultCode: row.result_code, reason: row.reason, createdAt: row.created_at.toISOString() })), total: Number(counts[0]?.total ?? 0n) };
  }

  async listChannelActivity(limit: number, offset: number): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const rows = await this.database.query<Array<{ channel_id: bigint; external_identity_id: bigint; activity_date: Date; message_count: bigint; media_count: bigint; reply_count: bigint; mention_count: bigint; event_count: bigint; last_event_at: Date; external_channel_id: string; display_name: string | null; observed_display_name: string | null }>>(
      `SELECT activity.channel_id, activity.external_identity_id, activity.activity_date,
        activity.message_count, activity.media_count, activity.reply_count, activity.mention_count,
        activity.event_count, activity.last_event_at, channel.external_channel_id, identity.display_name,
        (SELECT observed.display_name FROM external_identity_names observed
         WHERE observed.external_identity_id = identity.id ORDER BY observed.observed_at DESC, observed.id DESC LIMIT 1) AS observed_display_name
       FROM channel_activity_daily activity
       JOIN channels channel ON channel.id = activity.channel_id
       JOIN external_identities identity ON identity.id = activity.external_identity_id
       ORDER BY activity.activity_date DESC, activity.event_count DESC, activity.external_identity_id
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const counts = await this.database.query<Array<{ total: bigint }>>("SELECT COUNT(*) AS total FROM channel_activity_daily");
    return {
      items: rows.map((row) => ({
        channelId: row.channel_id.toString(), externalChannelId: row.external_channel_id,
        externalIdentityId: row.external_identity_id.toString(), verifiedDisplayName: row.display_name,
        observedDisplayName: row.observed_display_name, activityDate: row.activity_date.toISOString().slice(0, 10),
        messageCount: row.message_count.toString(), mediaCount: row.media_count.toString(),
        replyCount: row.reply_count.toString(), mentionCount: row.mention_count.toString(),
        eventCount: row.event_count.toString(), lastEventAt: row.last_event_at.toISOString()
      })),
      total: Number(counts[0]?.total ?? 0n)
    };
  }

  async listModerationIncidents(
    limit: number,
    offset: number,
    kind: "all" | "deleted" | "edited" = "all"
  ): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const incidentTypes = kind === "deleted"
      ? ["message_deleted", "message_hidden_by_host"]
      : kind === "edited" ? ["message_edited"] : [];
    const filterSql = incidentTypes.length === 0 ? "" : `WHERE incident.incident_type IN (${incidentTypes.map(() => "?").join(", ")})`;
    const rows = await this.database.query<Array<{ id: bigint; event_id: string; incident_type: string; target_provider_event_id: string | null; status: string; occurred_at: Date; channel_id: bigint | null; external_identity_id: bigint | null; external_channel_id: string | null; channel_name: string | null; display_name: string | null }>>(
      `SELECT incident.id, incident.event_id, incident.incident_type, incident.target_provider_event_id,
        incident.status, incident.occurred_at, incident.channel_id, incident.external_identity_id,
        channel.external_channel_id,
        (SELECT names.display_name FROM channel_name_observations names
         WHERE names.channel_id = incident.channel_id ORDER BY names.observed_at DESC, names.id DESC LIMIT 1) AS channel_name,
        COALESCE(identity.display_name,
          (SELECT observed.display_name FROM external_identity_names observed
           WHERE observed.external_identity_id = incident.external_identity_id AND observed.trust_status = 'verified'
           ORDER BY observed.observed_at DESC, observed.id DESC LIMIT 1)) AS display_name
       FROM moderation_incidents incident
       LEFT JOIN channels channel ON channel.id = incident.channel_id
       LEFT JOIN external_identities identity ON identity.id = incident.external_identity_id
       ${filterSql}
       ORDER BY incident.occurred_at DESC, incident.id DESC LIMIT ? OFFSET ?`,
      [...incidentTypes, limit, offset]
    );
    const counts = await this.database.query<Array<{ total: bigint }>>(
      `SELECT COUNT(*) AS total FROM moderation_incidents ${incidentTypes.length === 0 ? "" : `WHERE incident_type IN (${incidentTypes.map(() => "?").join(", ")})`}`,
      incidentTypes
    );
    return {
      items: rows.map((row) => ({
        id: row.id.toString(), eventId: row.event_id, incidentType: row.incident_type,
        targetProviderEventId: row.target_provider_event_id, status: row.status,
        channelId: row.channel_id?.toString() ?? null, externalChannelId: row.external_channel_id,
        channelName: row.channel_name,
        externalIdentityId: row.external_identity_id?.toString() ?? null,
        verifiedDisplayName: row.display_name, occurredAt: row.occurred_at.toISOString()
      })),
      total: Number(counts[0]?.total ?? 0n)
    };
  }

  async listMonitoringEvents(
    limit: number,
    offset: number,
    group: "all" | "media" | "event" = "all"
  ): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const groupCondition = group === "all"
      ? "normalized.monitoring_group <> 'text'"
      : "normalized.monitoring_group = ?";
    const groupParameters = group === "all" ? [] : [group];
    const rows = await this.database.query<Array<{
      id: bigint; event_id: string; event_code: string; event_category: string; monitoring_group: string;
      target_provider_event_id: string | null; metadata_json: string | Record<string, unknown> | null;
      created_at: Date; direction: string; event_kind: string; event_origin: string | null;
      external_channel_id: string | null; channel_name: string | null; external_user_id: string | null;
      verified_display_name: string | null;
    }>>(
      `SELECT normalized.id, normalized.event_id, normalized.event_code, normalized.event_category,
        normalized.monitoring_group,
        normalized.target_provider_event_id, normalized.metadata_json, normalized.created_at,
        inbox.direction, inbox.event_kind, inbox.event_origin, inbox.external_channel_id,
        inbox.external_user_id,
        (SELECT names.display_name FROM channel_name_observations names
         WHERE names.channel_id = inbox.channel_id ORDER BY names.observed_at DESC, names.id DESC LIMIT 1) AS channel_name,
        COALESCE(identity.display_name,
          (SELECT observed.display_name FROM external_identity_names observed
           WHERE observed.external_identity_id = inbox.external_identity_id AND observed.trust_status = 'verified'
           ORDER BY observed.observed_at DESC, observed.id DESC LIMIT 1)) AS verified_display_name
       FROM normalized_provider_events normalized
       JOIN event_inbox inbox ON inbox.event_id = normalized.event_id
       LEFT JOIN external_identities identity ON identity.id = inbox.external_identity_id
       WHERE ${groupCondition}
       ORDER BY normalized.created_at DESC, normalized.id DESC LIMIT ? OFFSET ?`,
      [...groupParameters, limit, offset]
    );
    const counts = await this.database.query<Array<{ total: bigint }>>(
      `SELECT COUNT(*) AS total FROM normalized_provider_events normalized WHERE ${groupCondition}`,
      groupParameters
    );
    return {
      items: rows.map((row) => ({
        id: row.id.toString(), eventId: row.event_id, eventCode: row.event_code,
        eventCategory: row.event_category, monitoringGroup: row.monitoring_group,
        targetProviderEventId: row.target_provider_event_id,
        metadata: typeof row.metadata_json === "string" ? JSON.parse(row.metadata_json) : row.metadata_json,
        direction: row.direction, eventKind: row.event_kind, origin: row.event_origin,
        externalChannelId: row.external_channel_id, channelName: row.channel_name,
        externalUserId: row.external_user_id, verifiedDisplayName: row.verified_display_name,
        occurredAt: row.created_at.toISOString()
      })),
      total: Number(counts[0]?.total ?? 0n)
    };
  }

  async listRetainedEventContents(limit: number, offset: number): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const rows = await this.database.query<Array<{
      id: bigint; event_id: string; content_kind: string; status: string; mime_type: string | null; byte_size: bigint | null;
      expires_at: Date; created_at: Date; event_code: string; external_channel_id: string | null;
      channel_name: string | null; verified_display_name: string | null;
    }>>(
      `SELECT content.id, content.event_id, content.content_kind, content.status, content.mime_type, content.byte_size,
        content.expires_at, content.created_at, normalized.event_code, inbox.external_channel_id,
        (SELECT names.display_name FROM channel_name_observations names
         WHERE names.channel_id = inbox.channel_id ORDER BY names.observed_at DESC, names.id DESC LIMIT 1) AS channel_name,
        COALESCE(identity.display_name,
          (SELECT observed.display_name FROM external_identity_names observed
           WHERE observed.external_identity_id = inbox.external_identity_id AND observed.trust_status = 'verified'
           ORDER BY observed.observed_at DESC, observed.id DESC LIMIT 1)) AS verified_display_name
       FROM retained_event_contents content
       JOIN event_inbox inbox ON inbox.event_id = content.event_id
       JOIN normalized_provider_events normalized ON normalized.event_id = content.event_id
       LEFT JOIN external_identities identity ON identity.id = inbox.external_identity_id
       WHERE content.status <> 'purged'
       ORDER BY content.created_at DESC, content.id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const counts = await this.database.query<Array<{ total: bigint }>>(
      "SELECT COUNT(*) AS total FROM retained_event_contents WHERE status <> 'purged'"
    );
    return {
      items: rows.map((row) => ({
        id: row.id.toString(), eventId: row.event_id, contentKind: row.content_kind, eventCode: row.event_code,
        status: row.status, mimeType: row.mime_type, byteSize: row.byte_size?.toString() ?? null,
        externalChannelId: row.external_channel_id, channelName: row.channel_name,
        verifiedDisplayName: row.verified_display_name,
        occurredAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString()
      })),
      total: Number(counts[0]?.total ?? 0n)
    };
  }

  async listMembershipEvents(
    limit: number,
    offset: number,
    filter?: { channelId: string; externalIdentityId: string }
  ): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const filterCondition = filter === undefined
      ? ""
      : "WHERE membership.channel_id = ? AND membership.external_identity_id = ?";
    const filterParameters = filter === undefined ? [] : [filter.channelId, filter.externalIdentityId];
    const rows = await this.database.query<Array<{
      id: bigint; channel_id: bigint; external_identity_id: bigint; membership_event_code: string; occurred_at: Date; external_channel_id: string;
      external_user_id: string; channel_name: string | null; verified_display_name: string | null;
    }>>(
      `SELECT membership.id, membership.channel_id, membership.external_identity_id,
        membership.membership_event_code, membership.occurred_at,
        channel.external_channel_id, identity.external_user_id,
        (SELECT names.display_name FROM channel_name_observations names
         WHERE names.channel_id = membership.channel_id ORDER BY names.observed_at DESC, names.id DESC LIMIT 1) AS channel_name,
        COALESCE(identity.display_name,
          (SELECT observed.display_name FROM external_identity_names observed
           WHERE observed.external_identity_id = membership.external_identity_id AND observed.trust_status = 'verified'
           ORDER BY observed.observed_at DESC, observed.id DESC LIMIT 1)) AS verified_display_name
       FROM channel_membership_events membership
       JOIN channels channel ON channel.id = membership.channel_id
       JOIN external_identities identity ON identity.id = membership.external_identity_id
       ${filterCondition}
       ORDER BY membership.occurred_at DESC, membership.id DESC LIMIT ? OFFSET ?`,
      [...filterParameters, limit, offset]
    );
    const counts = await this.database.query<Array<{ total: bigint }>>(
      `SELECT COUNT(*) AS total FROM channel_membership_events membership ${filterCondition}`,
      filterParameters
    );
    return {
      items: rows.map((row) => ({
        id: row.id.toString(), channelId: row.channel_id.toString(),
        externalIdentityId: row.external_identity_id.toString(), membershipEventCode: row.membership_event_code,
        externalChannelId: row.external_channel_id, channelName: row.channel_name,
        externalUserId: row.external_user_id, verifiedDisplayName: row.verified_display_name,
        occurredAt: row.occurred_at.toISOString()
      })),
      total: Number(counts[0]?.total ?? 0n)
    };
  }

  async listMembershipPatterns(limit: number, offset: number): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const rows = await this.database.query<Array<{
      channel_id: bigint; external_identity_id: bigint; external_channel_id: string;
      external_user_id: string; channel_name: string | null; verified_display_name: string | null;
      joined_count: bigint; departed_count: bigint; last_occurred_at: Date;
    }>>(
      `SELECT membership.channel_id, membership.external_identity_id, channel.external_channel_id,
        identity.external_user_id,
        (SELECT names.display_name FROM channel_name_observations names
         WHERE names.channel_id = membership.channel_id ORDER BY names.observed_at DESC, names.id DESC LIMIT 1) AS channel_name,
        COALESCE(identity.display_name,
          (SELECT observed.display_name FROM external_identity_names observed
           WHERE observed.external_identity_id = membership.external_identity_id AND observed.trust_status = 'verified'
           ORDER BY observed.observed_at DESC, observed.id DESC LIMIT 1)) AS verified_display_name,
        SUM(CASE WHEN membership.membership_event_code = 'joined' THEN 1 ELSE 0 END) AS joined_count,
        SUM(CASE WHEN membership.membership_event_code = 'departed' THEN 1 ELSE 0 END) AS departed_count,
        MAX(membership.occurred_at) AS last_occurred_at
       FROM channel_membership_events membership
       JOIN channels channel ON channel.id = membership.channel_id
       JOIN external_identities identity ON identity.id = membership.external_identity_id
       GROUP BY membership.channel_id, membership.external_identity_id,
         channel.external_channel_id, identity.external_user_id, identity.display_name
       HAVING joined_count >= 2 OR departed_count >= 2
       ORDER BY joined_count DESC, departed_count DESC, last_occurred_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const counts = await this.database.query<Array<{ total: bigint }>>(
      `SELECT COUNT(*) AS total FROM (
         SELECT channel_id, external_identity_id
         FROM channel_membership_events
         GROUP BY channel_id, external_identity_id
         HAVING SUM(membership_event_code = 'joined') >= 2
             OR SUM(membership_event_code = 'departed') >= 2
       ) detected`
    );
    return {
      items: rows.map((row) => ({
        channelId: row.channel_id.toString(), externalIdentityId: row.external_identity_id.toString(),
        channelName: row.channel_name, externalChannelId: row.external_channel_id,
        verifiedDisplayName: row.verified_display_name, externalUserId: row.external_user_id,
        joinedCount: row.joined_count.toString(), departedCount: row.departed_count.toString(),
        repeatCount: (row.joined_count > row.departed_count ? row.joined_count : row.departed_count).toString(),
        lastOccurredAt: row.last_occurred_at.toISOString()
      })),
      total: Number(counts[0]?.total ?? 0n)
    };
  }

  async listDeliveryFailures(limit: number, offset: number): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const rows = await this.database.query<Array<{
      id: bigint; provider_code: string; destination_id: string; status: string;
      attempt_count: bigint; last_error_code: string | null; created_at: Date;
    }>>(
      `SELECT id, provider_code, destination_id, status, attempt_count, last_error_code, created_at
       FROM outbox_messages
       WHERE status IN ('failed', 'dead_letter')
       ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const counts = await this.database.query<Array<{ total: bigint }>>(
      "SELECT COUNT(*) AS total FROM outbox_messages WHERE status IN ('failed', 'dead_letter')"
    );
    return {
      items: rows.map((row) => ({
        id: row.id.toString(), providerCode: row.provider_code, status: row.status,
        attemptCount: row.attempt_count.toString(), errorCode: row.last_error_code,
        createdAt: row.created_at.toISOString()
      })),
      total: Number(counts[0]?.total ?? 0n)
    };
  }
}
