import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { FreeMarketForceCancelService } from "../src/market/free-market-force-cancel-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_market_trade_force_cancel(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic market-force-cancel probe blocked: ${config.database.name}`);
const db = createDatabaseClient(config.database);
const seller = 996100001n, adminPlayer = 996100002n, normalPlayer = 996100003n, pet = 996200001n;
const sellerUser = "market-force-seller", adminUser = "market-force-admin", normalUser = "market-force-normal", room = "synthetic-market-force-cancel";

async function event(id: string, user: string): Promise<void> {
  await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3))", [id,id,room,user]);
}

async function registrationOperation(key: string): Promise<bigint> {
  return (await db.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at,completed_at) VALUES (UUID(),'synthetic.force.registration',?,'system',NULL,'system','completed',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [key])).insertId;
}

async function listing(type: string, item: bigint | null, instance: bigint | null, quantity = 1n): Promise<bigint> {
  return (await db.execute("INSERT INTO market_listings(seller_player_id,asset_type_code,item_id,inventory_instance_id,quantity,price_currency_code,price_amount,status,created_at,expires_at) VALUES (?,?,?,?,?,'point',100,'open',UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))", [seller,type,item,instance,quantity])).insertId;
}

async function addFee(listingId: bigint, fee = 2n): Promise<void> {
  await db.execute("INSERT INTO market_listing_registration_fees(listing_id,carrot_item_id,carrot_fee,source_code) VALUES (?,996400001,?,'synthetic_force')", [listingId,fee]);
}

async function force(id: string, user = adminUser) {
  await event(id,user);
  return new FreeMarketForceCancelService(db).handle({ eventId:id,externalUserId:user,destinationId:room,message:"/거래소강제취소 1" });
}

function failedAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, parameters) => inner.query(sql, parameters), execute: (sql, parameters) => inner.execute(sql, parameters),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, parameters) => transaction.query(sql, parameters),
      execute: async (sql, parameters) => { if (sql.includes("INSERT INTO command_audit")) throw new Error("market force cancel audit failure"); return transaction.execute(sql, parameters); }
    }))
  };
}

async function state() {
  return (await db.query<Array<{ cancelled: bigint; open_count: bigint; operations_count: bigint; audits: bigint; outboxes: bigint; carrots: bigint; stack_quantity: bigint }>>(
    `SELECT (SELECT COUNT(*) FROM market_listing_cancellations) cancelled,
            (SELECT COUNT(*) FROM market_listings WHERE status='open') open_count,
            (SELECT COUNT(*) FROM operations WHERE idempotency_scope='market.free_market.force_cancel') operations_count,
            (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id=audit.operation_id WHERE operation.idempotency_scope='market.free_market.force_cancel') audits,
            (SELECT COUNT(*) FROM outbox_messages message JOIN operations operation ON operation.id=message.operation_id WHERE operation.idempotency_scope='market.free_market.force_cancel') outboxes,
            (SELECT quantity FROM inventory_stacks WHERE player_id=996100001 AND item_id=996400001) carrots,
            (SELECT quantity FROM inventory_stacks WHERE player_id=996100001 AND item_id=996400003) stack_quantity`
  ))[0]!;
}

async function seed(): Promise<void> {
  await db.execute("INSERT INTO players(id,status) VALUES (?,'active'),(?,'active'),(?,'active')", [seller,adminPlayer,normalPlayer]);
  await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'판매자'),(?,'총괄 운영자'),(?,'일반 사용자')", [seller,adminPlayer,normalPlayer]);
  await db.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,status) VALUES (?,?, 'kakao',?,'linked'),(?,?, 'kakao',?,'linked'),(?,?, 'kakao',?,'linked')", [seller,seller,sellerUser,adminPlayer,adminPlayer,adminUser,normalPlayer,normalPlayer,normalUser]);
  await db.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (996300001,'force-admin','총괄 운영자','synthetic','active')");
  await db.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (996300001,?)", [adminPlayer]);
  await db.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 996300001,id FROM admin_roles WHERE code='manager' AND active=TRUE");
  await db.execute("INSERT INTO item_definitions(id,code,display_name,asset_type_code,stackable,active) VALUES (996400001,'SYNTHETIC-FORCE-CARROT','합성당근🥕','item',TRUE,TRUE),(996400002,'SYNTHETIC-FORCE-PASS','자유시장회원권🏪','item',TRUE,TRUE),(996400003,'SYNTHETIC-FORCE-STACK','합성가방아이템','item',TRUE,TRUE),(996400004,'SYNTHETIC-FORCE-PENDANT','합성펜던트','item',FALSE,TRUE)");
  await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,996400001,0,1),(?,996400002,1,1),(?,996400003,0,1)", [seller,seller,seller]);
  await db.execute("INSERT INTO player_pets(id,player_id,display_name) VALUES (?,?,'합성펫')", [pet,seller]);
  await db.execute("INSERT INTO skill_definitions(id,code,display_name,rules_json,active) VALUES (996500001,'SYNTHETIC-FORCE-SKILL','합성스킬',JSON_OBJECT(),TRUE)");
  await db.execute("INSERT INTO pet_skill_inventory(player_pet_id,skill_id,quantity,version) VALUES (?,996500001,0,2)", [pet]);
  await db.execute("INSERT INTO furniture_definitions(id,code,display_name) VALUES (996600001,'SYNTHETIC-FORCE-FURNITURE','합성가구')");
  await db.execute("INSERT INTO furniture_inventory_instances(id,player_id,furniture_definition_id,charm_snapshot,grade_display_name,status,version) VALUES (996610001,?,996600001,10,'합성','listed',2)", [seller]);
  await db.execute("INSERT INTO mini_pet_definitions(id,code,display_name,active) VALUES (996700001,'SYNTHETIC-FORCE-MINI','합성미니펫',TRUE)");
  await db.execute("INSERT INTO owned_mini_pets(id,player_id,mini_pet_definition_id,custom_name) VALUES (996710001,?,996700001,'합성미니')", [seller]);
  await db.execute("INSERT INTO inventory_instances(id,player_id,item_id,status,attributes_json,version) VALUES (996800001,?,996400004,'reserved',JSON_OBJECT('objectType','pendant'),2)", [seller]);
}

async function probe(): Promise<void> {
  await seed();
  assert.equal((await db.query<Array<{ state: string }>>("SELECT rollout_state state FROM command_registry WHERE command_code='MARKET_TRADE_FORCE_CANCEL'"))[0]!.state,"SHADOW");

  const stack = await listing("bag",996400003n,null,3n); await addFee(stack);
  const first = await force("force-stack");
  assert.equal(first?.status,"forced_cancelled"); assert.equal(first?.sellerPlayerId,seller.toString()); assert.equal(first?.refundedCarrot,"2");
  assert.equal((await new FreeMarketForceCancelService(db).handle({ eventId:"force-stack",externalUserId:adminUser,destinationId:room,message:"/거래소강제취소 1" }))?.replayed,true);

  const pendant = await listing("instance",996400004n,996800001n); await addFee(pendant);
  assert.equal((await force("force-pendant"))?.status,"forced_cancelled");
  assert.equal((await db.query<Array<{ status: string }>>("SELECT status FROM inventory_instances WHERE id=996800001"))[0]!.status,"owned");

  const skill = await listing("pet_skill",null,null,4n), skillOp = await registrationOperation("force-skill");
  await db.execute("INSERT INTO market_skill_registration_ledger(operation_id,listing_id,player_id,player_pet_id,skill_id,source_index,quantity,price_amount,carrot_item_id,carrot_fee,skill_quantity_before,skill_quantity_after,source_version_before,source_version_after,carrot_version_before,carrot_version_after) VALUES (?,?,?,?,996500001,1,4,100,996400001,2,4,0,1,2,1,2)", [skillOp,skill,seller,pet]); await addFee(skill);
  assert.equal((await force("force-skill"))?.status,"forced_cancelled");
  assert.equal((await db.query<Array<{ quantity: bigint }>>("SELECT quantity FROM pet_skill_inventory WHERE player_pet_id=? AND skill_id=996500001", [pet]))[0]!.quantity,4n);

  const furniture = await listing("furniture",null,null), furnitureOp = await registrationOperation("force-furniture");
  await db.execute("INSERT INTO market_furniture_registration_ledger(operation_id,listing_id,player_id,furniture_definition_id,source_index,quantity,price_amount,carrot_item_id,carrot_fee,carrot_version_before,carrot_version_after) VALUES (?,?,?,?,1,1,100,996400001,2,1,2)", [furnitureOp,furniture,seller,996600001]);
  await db.execute("INSERT INTO market_furniture_registration_items(operation_id,sequence_no,furniture_instance_id,source_version_before,source_version_after) VALUES (?,1,996610001,1,2)", [furnitureOp]); await addFee(furniture);
  assert.equal((await force("force-furniture"))?.status,"forced_cancelled");
  assert.equal((await db.query<Array<{ status: string }>>("SELECT status FROM furniture_inventory_instances WHERE id=996610001"))[0]!.status,"bag");

  const mini = await listing("mini_pet",null,null); await db.execute("INSERT INTO market_mini_pet_reservations(listing_id,owned_mini_pet_id,player_id) VALUES (?,996710001,?)", [mini,seller]); await addFee(mini);
  assert.equal((await force("force-mini"))?.status,"forced_cancelled");
  assert.equal((await db.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM market_mini_pet_reservations WHERE listing_id=?", [mini]))[0]!.count,0n);

  const forbidden = await listing("bag",996400003n,null); await addFee(forbidden);
  assert.equal((await force("force-forbidden",normalUser))?.status,"forbidden");
  assert.equal((await db.query<Array<{ status: string }>>("SELECT status FROM market_listings WHERE id=?", [forbidden]))[0]!.status,"open");
  await db.execute("UPDATE market_listings SET status='cancelled',closed_at=UTC_TIMESTAMP(3) WHERE id=?", [forbidden]);
  assert.equal((await force("force-missing"))?.status,"not_found");

  const rollbackListing = await listing("bag",996400003n,null,2n); await addFee(rollbackListing);
  await event("force-rollback",adminUser); const before = await state();
  await assert.rejects(() => new FreeMarketForceCancelService(failedAudit(db)).handle({ eventId:"force-rollback",externalUserId:adminUser,destinationId:room,message:"/거래소강제취소 1" }), /market force cancel audit failure/);
  assert.deepEqual(await state(),before); assert.equal(await db.verifyRollback(),true);
  assert.equal((await force("force-after-rollback"))?.status,"forced_cancelled");
  const final = await state();
  assert.deepEqual([final.cancelled,final.open_count,final.operations_count,final.audits,final.outboxes,final.carrots,final.stack_quantity],[6n,0n,8n,8n,8n,12n,5n]);
  process.stdout.write(JSON.stringify({ mode:"probe",latestMigration:365,scenarios:["shadow-registry","manager-permission","foreign-seller","bag","pendant","pet-skill","furniture","mini-pet","seller-pass-fee-refund","forbidden","not-found","event-replay","rollback","restart"],state:final },(_key,value)=>typeof value==="bigint"?value.toString():value)+"\n");
}

async function verifyRestart(): Promise<void> {
  const current = await state();
  assert.deepEqual([current.cancelled,current.open_count,current.operations_count,current.audits,current.outboxes,current.carrots,current.stack_quantity],[6n,0n,8n,8n,8n,12n,5n]);
  process.stdout.write(JSON.stringify({ mode:"verify-restart",state:current,additionalMutation:false,operationalDataTouched:false },(_key,value)=>typeof value==="bigint"?value.toString():value)+"\n");
}

try { if (process.argv.includes("--verify-restart")) await verifyRestart(); else await probe(); } finally { await db.close(); }
