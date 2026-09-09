import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { DiamondShopBuyService } from "../src/shop/diamond-shop-buy-service.js";

const database = createDatabaseClient(loadConfig().database);
const externalUserId = process.argv[2] ?? "diamond-shop-buy-probe-user";
const eventId = process.argv[3] ?? "diamond-shop-buy-probe-event";
const productId = "00000000-0000-4000-8000-000000000312";
const displayName = "다이아상점 구매 probe 아이템";

// 합성 구매의 stable item binding·원장·재시작 replay를 실제 MariaDB에서 확인합니다.
async function main(): Promise<void> {
  await database.execute("INSERT IGNORE INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','synthetic','incoming',REPEAT('3',64),'parsed','processing',UTC_TIMESTAMP(3))", [`iris:${eventId}`, eventId]);
  let identity = (await database.query<Array<{ player_id: bigint }>>("SELECT player_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [externalUserId]))[0];
  if (!identity) {
    const player = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'probe 구매자','linked')", [player.insertId, externalUserId]);
    identity = { player_id: player.insertId };
  }
  await database.execute("INSERT IGNORE INTO item_definitions(code,display_name,asset_type_code,stackable,active,version) VALUES ('DIAMOND-SHOP-PROBE',?,'STACK',1,1,1)", [displayName]);
  await database.execute("INSERT IGNORE INTO diamond_shop_catalog_items(product_id,display_name,reward_quantity,diamond_price,display_order,enabled,version) VALUES (?,?,2,5,4294967000,1,1)", [productId, displayName]);
  await database.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'diamond',100,1)", [identity.player_id]);
  const ordinal = Number((await database.query<Array<{ ordinal_no: bigint }>>("SELECT COUNT(*) ordinal_no FROM diamond_shop_catalog_items WHERE enabled=TRUE AND (display_order<4294967000 OR (display_order=4294967000 AND product_id<=?))", [productId]))[0]!.ordinal_no);
  const service = new DiamondShopBuyService(database);
  const input = { eventId, externalUserId, destinationId: "990000000000641", message: `/다이아상점구매 ${ordinal} 3` };
  const first = await service.handle(input);
  const replay = await new DiamondShopBuyService(database).handle(input);
  const evidence = (await database.query<Array<{ purchases: bigint; currency_ledgers: bigint; inventory_ledgers: bigint; bound: bigint }>>(
    `SELECT (SELECT COUNT(*) FROM diamond_shop_purchase_events WHERE product_id=? AND status_code='purchased') purchases,
      (SELECT COUNT(*) FROM currency_ledger WHERE player_id=? AND reason_code='DIAMOND_SHOP_PURCHASE') currency_ledgers,
      (SELECT COUNT(*) FROM inventory_ledger WHERE player_id=? AND reason_code='DIAMOND_SHOP_PURCHASE') inventory_ledgers,
      (SELECT reward_item_id FROM diamond_shop_catalog_items WHERE product_id=?) bound`, [productId, identity.player_id, identity.player_id, productId]))[0]!;
  console.log(JSON.stringify({ first, replay, evidence, replayAdditionalMutation: first.outboxId !== replay.outboxId }, (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

main().finally(async () => database.close());
