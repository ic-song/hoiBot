import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { GuildJoinConditionService } from "../src/guild/guild-join-condition-service.js";
import { MariaGuildJoinConditionRepository } from "../src/guild/maria-guild-join-condition-repository.js";

const database = createDatabaseClient(loadConfig().database);
const eventId = process.argv[2] ?? "synthetic-guild-join-condition-event";
const externalUserId = process.argv[3] ?? "synthetic-admin-alpha";

// 합성 길드마스터의 가입조건 변경·재처리 결과를 실제 MariaDB에서 확인합니다.
async function main(): Promise<void> {
  await database.execute(
    `INSERT INTO event_inbox (event_id, provider_event_id, external_channel_id, external_user_id, event_kind, direction, payload_hash, processing_status, received_at)
     VALUES (?, ?, 'synthetic-room', ?, 'message', 'incoming', REPEAT('2', 64), 'processed', UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE processing_status = VALUES(processing_status)`,
    [eventId, eventId, externalUserId]
  );
  const service = new GuildJoinConditionService(new MariaGuildJoinConditionRepository(database));
  const input = { externalUserId, channelId: "synthetic-room", message: "/길드가입조건 12,345", eventId };
  const first = await service.handle(input);
  const replay = await service.handle(input);
  const rows = await database.query<Array<{ requirement: bigint; operations: bigint; executions: bigint; audits: bigint; outboxes: bigint }>>(
    `SELECT guild.join_requirement_experience AS requirement,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope = 'guild.join-condition:900000001' AND idempotency_key = ?) AS operations,
      (SELECT COUNT(*) FROM command_executions WHERE event_id = ? AND command_code = 'guild_join_condition') AS executions,
      (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id = audit.operation_id WHERE operation.idempotency_scope = 'guild.join-condition:900000001' AND operation.idempotency_key = ?) AS audits,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id = outbox.operation_id WHERE operation.idempotency_scope = 'guild.join-condition:900000001' AND operation.idempotency_key = ?) AS outboxes
     FROM guilds guild WHERE guild.id = 900000001`,
    [eventId, eventId, eventId, eventId]
  );
  console.log(JSON.stringify({ first, replay, database: rows[0] }, (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
