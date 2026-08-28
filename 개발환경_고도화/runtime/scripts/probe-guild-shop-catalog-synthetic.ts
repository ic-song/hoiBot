import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { GuildShopCatalogService } from "../src/guild/guild-shop-catalog-service.js";

const database = createDatabaseClient(loadConfig().database);
const eventId = process.argv[2] ?? "guild-shop-probe-list";
const externalUserId = process.argv[3] ?? "guild-shop-user";

// 격리 fixture의 카탈로그·원장·재시작 replay 상태를 실제 MariaDB에서 확인합니다.
async function main(): Promise<void> {
  const service = new GuildShopCatalogService(database);
  await database.execute(
    "INSERT IGNORE INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','synthetic','incoming',REPEAT('9',64),'parsed','processing',UTC_TIMESTAMP(3))",
    [eventId, eventId]
  );
  const first = await service.handle({ externalUserId, channelId: "990000000000629", message: "/길드상점", eventId });
  const replay = await service.handle({ externalUserId, channelId: "990000000000629", message: "/길드상점", eventId });
  const rows = await database.query<Array<{ catalog_version: bigint; enabled_items: bigint; events: bigint; executions: bigint; audits: bigint; outboxes: bigint }>>(
    `SELECT state.catalog_version,
      (SELECT COUNT(*) FROM guild_shop_items WHERE enabled=TRUE) enabled_items,
      (SELECT COUNT(*) FROM guild_shop_catalog_events) events,
      (SELECT COUNT(*) FROM command_executions WHERE command_code IN ('GUILD_SHOP_LIST','GUILD_SHOP_ADD','GUILD_SHOP_DELETE')) executions,
      (SELECT COUNT(*) FROM command_audit WHERE action_code LIKE 'guild.shop.catalog.%') audits,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope LIKE 'guild.shop.catalog.%') outboxes
     FROM guild_shop_catalog_state state WHERE state.singleton_id=1`
  );
  console.log(JSON.stringify({ first, replay, database: rows[0], replayAdditionalMutation: first?.outboxId !== replay?.outboxId }, (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
