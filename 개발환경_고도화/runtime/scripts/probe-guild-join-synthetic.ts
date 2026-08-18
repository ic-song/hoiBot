import { createDatabaseClient } from "../src/database.js";
import { loadConfig } from "../src/config.js";
import { GuildJoinService } from "../src/guild/guild-join-service.js";
import { MariaGuildJoinRepository } from "../src/guild/maria-guild-join-repository.js";

const mode = process.argv[2];
if (mode !== "request" && mode !== "confirm") throw new Error("Usage: probe-guild-join-synthetic.ts <request|confirm>");

const PLAYER_ID = "910000001";
const EXTERNAL_USER_ID = "synthetic-guild-join-candidate";
const REQUEST_EVENT_ID = "synthetic-guild-join-request-9uhpkj";
const CONFIRM_EVENT_ID = "synthetic-guild-join-confirm-9uhpkj";
const CHANNEL_ID = "synthetic-room-guild-join";
const config = loadConfig();
if (!/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) throw new Error("Guild join probe requires a rehearsal database.");

const database = createDatabaseClient(config.database);
try {
  if (mode === "request") {
    await database.execute("INSERT INTO players (id, status, version) VALUES (?, 'active', 1)", [PLAYER_ID]);
    await database.execute(
      "INSERT INTO external_identities (id, player_id, provider_code, external_user_id, display_name, status) VALUES (910000001, ?, 'kakao', ?, '합성가입 남', 'linked')",
      [PLAYER_ID, EXTERNAL_USER_ID]
    );
    await database.execute(
      `INSERT INTO player_profiles (player_id, current_display_name, joined_at, level, experience, rebirth_count, game_server_id, tier_code, terms_agreed, first_sponsor, version)
       VALUES (?, '합성가입 남', UTC_TIMESTAMP(3), 10, 500, 0, 900000001, 'starter', TRUE, FALSE, 1)`, [PLAYER_ID]
    );
    await database.execute(
      "INSERT INTO inventory_stacks (player_id, item_id, quantity, version) SELECT ?, id, 1, 1 FROM item_definitions WHERE code = 'legacy-guild-join-ticket'",
      [PLAYER_ID]
    );
    await database.execute(
      "INSERT INTO event_inbox (event_id, provider_event_id, external_channel_id, external_user_id, event_kind, direction, payload_hash, processing_status, received_at) VALUES (?, ?, ?, ?, 'message', 'incoming', REPEAT('0', 64), 'processed', UTC_TIMESTAMP(3))",
      [REQUEST_EVENT_ID, REQUEST_EVENT_ID, CHANNEL_ID, EXTERNAL_USER_ID]
    );
    const result = await new GuildJoinService(new MariaGuildJoinRepository(database)).handle({
      externalUserId: EXTERNAL_USER_ID, channelId: CHANNEL_ID, message: "/길드가입 1", eventId: REQUEST_EVENT_ID
    });
    const pending = await database.query<Array<{ status: string; guild_id: bigint }>>(
      "SELECT status, guild_id FROM guild_join_requests WHERE player_id = ?", [PLAYER_ID]
    );
    if (result.status !== "pending" || pending[0]?.status !== "pending") throw new Error("Guild join request was not persisted.");
    process.stdout.write(JSON.stringify({ phase: "request", status: result.status, guildId: result.guildId, pending: pending[0]?.status }));
  } else {
    await database.execute(
      "INSERT INTO event_inbox (event_id, provider_event_id, external_channel_id, external_user_id, event_kind, direction, payload_hash, processing_status, received_at) VALUES (?, ?, ?, ?, 'message', 'incoming', REPEAT('1', 64), 'processed', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status = VALUES(processing_status)",
      [CONFIRM_EVENT_ID, CONFIRM_EVENT_ID, CHANNEL_ID, EXTERNAL_USER_ID]
    );
    const service = new GuildJoinService(new MariaGuildJoinRepository(database));
    const result = await service.handle({ externalUserId: EXTERNAL_USER_ID, channelId: CHANNEL_ID, message: "가입한다", eventId: CONFIRM_EVENT_ID });
    const replay = await service.handle({ externalUserId: EXTERNAL_USER_ID, channelId: CHANNEL_ID, message: "가입한다", eventId: CONFIRM_EVENT_ID });
    const rows = await database.query<Array<{ membership_count: bigint; ticket_quantity: bigint; pending_status: string; operation_count: bigint; execution_count: bigint; audit_count: bigint; outbox_count: bigint }>>(
      `SELECT
        (SELECT COUNT(*) FROM guild_members WHERE player_id = ?) AS membership_count,
        (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id WHERE stack.player_id = ? AND item.code = 'legacy-guild-join-ticket') AS ticket_quantity,
        (SELECT status FROM guild_join_requests WHERE player_id = ?) AS pending_status,
        (SELECT COUNT(*) FROM operations WHERE idempotency_scope = CONCAT('guild.join:guild_join_confirm:', ?)) AS operation_count,
        (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'guild_join_confirm') AS execution_count,
        (SELECT COUNT(*) FROM command_audit WHERE actor_type = 'player' AND actor_id = ? AND action_code = 'guild.join.completed') AS audit_count,
        (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id = outbox.operation_id WHERE operation.idempotency_scope = CONCAT('guild.join:guild_join_confirm:', ?)) AS outbox_count`,
      [PLAYER_ID, PLAYER_ID, PLAYER_ID, PLAYER_ID, CONFIRM_EVENT_ID, PLAYER_ID, PLAYER_ID]
    );
    const row = rows[0]!;
    if (result.status !== "completed" || replay.outboxId !== result.outboxId || row.membership_count !== 1n
      || row.ticket_quantity !== 0n || row.pending_status !== "completed" || row.operation_count !== 1n
      || row.execution_count !== 1n || row.audit_count !== 1n || row.outbox_count !== 1n) {
      throw new Error(`Guild join confirmation parity failed: ${JSON.stringify(row, (_key, value) => typeof value === "bigint" ? value.toString() : value)}`);
    }
    process.stdout.write(JSON.stringify({ phase: "confirm", status: result.status, replayStable: true,
      membership: row.membership_count.toString(), ticket: row.ticket_quantity.toString(), pending: row.pending_status,
      operations: row.operation_count.toString(), executions: row.execution_count.toString(), audits: row.audit_count.toString(), outboxes: row.outbox_count.toString() }));
  }
} finally {
  await database.close();
}
