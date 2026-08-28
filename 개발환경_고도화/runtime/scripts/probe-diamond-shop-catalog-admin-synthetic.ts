import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { DiamondShopCatalogAdminService } from "../src/shop/diamond-shop-catalog-admin-service.js";
const database=createDatabaseClient(loadConfig().database);
const eventId=process.argv[2]??"diamond-shop-probe-add",externalUserId=process.argv[3]??"diamond-shop-admin";
// 합성 관리자 추가의 stable ID·원장·재시작 replay를 실제 MariaDB에서 확인합니다.
async function main():Promise<void>{
  await database.execute("INSERT IGNORE INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','synthetic','incoming',REPEAT('8',64),'parsed','processing',UTC_TIMESTAMP(3))",[eventId,eventId]);
  const service=new DiamondShopCatalogAdminService(database),input={externalUserId,channelId:"990000000000630",message:"/다이아상점추가 probe item 0 0",eventId};
  const first=await service.handle(input),replay=await service.handle(input),snapshot=await service.readSnapshot();
  const rows=(await database.query<Array<{events:bigint;executions:bigint;audits:bigint;outboxes:bigint}>>(`SELECT (SELECT COUNT(*) FROM diamond_shop_catalog_events) events,(SELECT COUNT(*) FROM command_executions WHERE command_code IN ('DIAMOND_SHOP_CATALOG_ADD','DIAMOND_SHOP_CATALOG_DELETE')) executions,(SELECT COUNT(*) FROM command_audit WHERE action_code LIKE 'diamond.shop.catalog.%') audits,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='diamond.shop.catalog.mutate') outboxes`))[0];
  console.log(JSON.stringify({first,replay,snapshot:{catalogVersion:snapshot.catalogVersion,bootstrapSource:snapshot.bootstrapSource,bootstrapStatus:snapshot.bootstrapStatus,activeItems:snapshot.items.length},database:rows,replayAdditionalMutation:first?.outboxId!==replay?.outboxId},(_k,v)=>typeof v==="bigint"?v.toString():v));
}
main().finally(async()=>database.close());
