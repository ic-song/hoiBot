import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { GuildForceExpelService } from "../src/guild/guild-force-expel-service.js";
import { MariaGuildForceExpelRepository } from "../src/guild/maria-guild-force-expel-repository.js";

const database = createDatabaseClient(loadConfig().database);
const eventId = process.argv[2] ?? "synthetic-guild-force-expel-event";

// 합성 관리자의 길드 강제제명과 동일 이벤트 재처리를 실제 MariaDB에서 확인합니다.
async function main(): Promise<void> {
  await database.execute(
    `INSERT INTO event_inbox (event_id, provider_event_id, external_channel_id, external_user_id, event_kind, direction, payload_hash, processing_status, received_at)
     VALUES (?, ?, 'synthetic-room', 'synthetic-admin-alpha', 'message', 'incoming', REPEAT('3', 64), 'processed', UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE processing_status = VALUES(processing_status)`,
    [eventId, eventId]
  );
  const service = new GuildForceExpelService(new MariaGuildForceExpelRepository(database));
  const input = { externalUserId: "synthetic-admin-alpha", channelId: "synthetic-room", message: "/길드강제제명 테스트베타", eventId };
  const first = await service.handle(input);
  const replay = await service.handle(input);
  const rows = await database.query<Array<{ memberships: bigint; operations: bigint; executions: bigint; audits: bigint; outboxes: bigint }>>(
    `SELECT
      (SELECT COUNT(*) FROM guild_members WHERE guild_id = 900000001 AND player_id = 900000002) AS memberships,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'guild.force-expel:900000001' AND idempotency_key = ?) AS operations,
      (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'guild_force_expel') AS executions,
      (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id = audit.operation_id WHERE operation.idempotency_scope = 'guild.force-expel:900000001' AND operation.idempotency_key = ?) AS audits,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id = outbox.operation_id WHERE operation.idempotency_scope = 'guild.force-expel:900000001' AND operation.idempotency_key = ?) AS outboxes`,
    [eventId, eventId, eventId, eventId]
  );
  console.log(JSON.stringify({ first, replay, database: rows[0] }, (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
