import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import { MariaDatabaseClient } from "../src/database.js";
import { CanonicalItemInventoryRepository } from "../src/inventory/canonical-item-inventory-repository.js";
import { requireWbs790IsolatedMariaEnvironment } from "./fixtures/wbs790-isolated-maria.js";

const enabled=process.env.WBS790_ITEM_STACK_MARIADB_TEST==="true";
const guarded=enabled?requireWbs790IsolatedMariaEnvironment(process.env):undefined;
const integration=enabled?describe:describe.skip;
const playerId="w790p001",otherPlayerId="w790p002",itemId="w790i001",otherItemId="w790i002";
const audit=["wbs790","2026-09-09 09:00:00","wbs790","2026-09-09 09:00:00"] as const;
const execFileAsync=promisify(execFile);
const childPath=fileURLToPath(new URL("./fixtures/canonical-item-stack-change-restart-child.ts",import.meta.url));

describe("WBS790 isolated MariaDB startup guard",()=>{
  const safe={DATABASE_HOST:"127.0.0.1",DATABASE_PORT:"3347",DATABASE_USER:"wbs790",DATABASE_PASSWORD:"test-only",DATABASE_NAME:"hoibot_wbs790"};
  it("accepts only the exact loopback non-3306 WBS schema",()=>assert.deepEqual(requireWbs790IsolatedMariaEnvironment(safe),{host:"127.0.0.1",port:3347,user:"wbs790",password:"test-only",name:"hoibot_wbs790"}));
  it("fails closed on non-loopback, 3306, user, password, and schema drift",()=>{
    assert.throws(()=>requireWbs790IsolatedMariaEnvironment({...safe,DATABASE_HOST:"localhost"}),/HOST_FORBIDDEN/);
    assert.throws(()=>requireWbs790IsolatedMariaEnvironment({...safe,DATABASE_PORT:"3306"}),/PORT_FORBIDDEN/);
    assert.throws(()=>requireWbs790IsolatedMariaEnvironment({...safe,DATABASE_USER:"root"}),/USER_FORBIDDEN/);
    assert.throws(()=>requireWbs790IsolatedMariaEnvironment({...safe,DATABASE_PASSWORD:"wrong"}),/PASSWORD_FORBIDDEN/);
    assert.throws(()=>requireWbs790IsolatedMariaEnvironment({...safe,DATABASE_NAME:"hoibot"}),/DATABASE_NAME_FORBIDDEN/);
  });
});

integration("WBS790 canonical item stack mutation on isolated MariaDB",()=>{
  let database:MariaDatabaseClient;
  before(async()=>{
    assert.ok(guarded!==undefined);
    database=new MariaDatabaseClient({enabled:true,...guarded,connectionLimit:12,connectTimeoutMs:5_000});
    await database.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?),(?,?,?,?,?,?,?)",[playerId,"SYNTHETIC","wbs790-player",...audit,otherPlayerId,"SYNTHETIC","wbs790-other",...audit]);
    await database.execute("INSERT INTO canonical_item_definitions(item_id,item_name,item_kind,stackable_flag,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,'SYNTHETIC',TRUE,TRUE,?,?,?,?),(?,?,'SYNTHETIC',TRUE,TRUE,?,?,?,?)",[itemId,"WBS790 아이템",...audit,otherItemId,"WBS790 다른 아이템",...audit]);
  });
  after(async()=>{
    await database.execute("DROP TRIGGER IF EXISTS wbs790_fail_ledger");
    await database.execute("DELETE FROM canonical_item_inventory_ledger_entries WHERE player_id IN (?,?)",[playerId,otherPlayerId]);
    await database.execute("DELETE FROM canonical_item_inventory_operations WHERE player_id IN (?,?)",[playerId,otherPlayerId]);
    await database.execute("DELETE FROM canonical_owned_item_stacks WHERE player_id IN (?,?)",[playerId,otherPlayerId]);
    await database.execute("DELETE FROM canonical_item_definitions WHERE item_id IN (?,?)",[itemId,otherItemId]);
    await database.execute("DELETE FROM canonical_players WHERE player_id IN (?,?)",[playerId,otherPlayerId]);
    await database.close();
  });

  it("commits existing and absent-stack success with exact terminal ledger binding",async()=>{
    await database.execute("INSERT INTO canonical_owned_item_stacks(owned_item_stack_id,player_id,item_id,quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,2,?,?,?,?)",["w790s001",playerId,itemId,...audit]);
    const repository=new CanonicalItemInventoryRepository(database);
    assert.deepEqual(await repository.changeStackQuantity({actor:"wbs790",playerId,itemId,requestKey:"existing-success",quantityDelta:3n,reasonType:"REWARD"}),{quantity:5n,replayed:false});
    assert.deepEqual(await repository.changeStackQuantity({actor:"wbs790",playerId,itemId:otherItemId,requestKey:"absent-success",quantityDelta:4n,reasonType:"REWARD"}),{quantity:4n,replayed:false});
    const rows=await database.query<Array<{operation_status:string;resulting_quantity:bigint;quantity_delta:bigint;reason_type:string;quantity:bigint}>>("SELECT operation.operation_status,operation.resulting_quantity,ledger.quantity_delta,ledger.reason_type,stack.quantity FROM canonical_item_inventory_operations operation JOIN canonical_item_inventory_ledger_entries ledger ON ledger.item_inventory_operation_id=operation.item_inventory_operation_id JOIN canonical_owned_item_stacks stack ON stack.owned_item_stack_id=ledger.owned_item_stack_id WHERE operation.player_id=? AND operation.request_key='existing-success'",[playerId]);
    assert.deepEqual(rows,[{operation_status:"completed",resulting_quantity:5n,quantity_delta:3n,reason_type:"REWARD",quantity:5n}]);
  });

  it("keeps insufficient debit at zero DML",async()=>{
    const repository=new CanonicalItemInventoryRepository(database);
    await assert.rejects(repository.changeStackQuantity({actor:"wbs790",playerId:otherPlayerId,itemId,requestKey:"insufficient",quantityDelta:-1n,reasonType:"USE"}),/INSUFFICIENT_QUANTITY/);
    const rows=await database.query<Array<{operation_count:bigint;ledger_count:bigint;stack_count:bigint}>>("SELECT (SELECT COUNT(*) FROM canonical_item_inventory_operations WHERE player_id=? AND request_key='insufficient') operation_count,(SELECT COUNT(*) FROM canonical_item_inventory_ledger_entries WHERE player_id=?) ledger_count,(SELECT COUNT(*) FROM canonical_owned_item_stacks WHERE player_id=?) stack_count",[otherPlayerId,otherPlayerId,otherPlayerId]);
    assert.deepEqual(rows,[{operation_count:0n,ledger_count:0n,stack_count:0n}]);
  });

  it("rolls back operation and final stack insert after a forced mid-transaction ledger fault",async()=>{
    await database.execute("CREATE TRIGGER wbs790_fail_ledger BEFORE INSERT ON canonical_item_inventory_ledger_entries FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='WBS790_FORCED_LEDGER_FAILURE'");
    await assert.rejects(new CanonicalItemInventoryRepository(database).changeStackQuantity({actor:"wbs790",playerId:otherPlayerId,itemId,requestKey:"rollback",quantityDelta:2n,reasonType:"REWARD"}),/WBS790_FORCED_LEDGER_FAILURE/);
    await database.execute("DROP TRIGGER wbs790_fail_ledger");
    const rows=await database.query<Array<{operation_count:bigint;ledger_count:bigint;stack_count:bigint}>>("SELECT (SELECT COUNT(*) FROM canonical_item_inventory_operations WHERE player_id=? AND request_key='rollback') operation_count,(SELECT COUNT(*) FROM canonical_item_inventory_ledger_entries WHERE player_id=?) ledger_count,(SELECT COUNT(*) FROM canonical_owned_item_stacks WHERE player_id=?) stack_count",[otherPlayerId,otherPlayerId,otherPlayerId]);
    assert.deepEqual(rows,[{operation_count:0n,ledger_count:0n,stack_count:0n}]);
  });

  it("replays in a distinct child PID and rejects item, delta, and reason drift without DML",async()=>{
    const requestKey="restart";
    const repository=new CanonicalItemInventoryRepository(database);
    const first=await repository.changeStackQuantity({actor:"wbs790",playerId,itemId,requestKey,quantityDelta:2n,reasonType:"REWARD"});
    const before=await counts(database,playerId);
    const child=await execFileAsync(process.execPath,["--import","tsx",childPath],{cwd:process.cwd(),encoding:"utf8",env:{...process.env,WBS790_PLAYER_ID:playerId,WBS790_ITEM_ID:itemId,WBS790_REQUEST_KEY:requestKey,WBS790_DELTA:"2",WBS790_REASON:"REWARD"}});
    const parsed=JSON.parse(child.stdout) as {pid:number;result:{quantity:string;replayed:boolean}};
    assert.notEqual(parsed.pid,process.pid); assert.deepEqual(parsed.result,{quantity:first.quantity.toString(),replayed:true});
    for(const drift of [{itemId:otherItemId,quantityDelta:2n,reasonType:"REWARD"},{itemId,quantityDelta:3n,reasonType:"REWARD"},{itemId,quantityDelta:2n,reasonType:"USE"}])await assert.rejects(repository.changeStackQuantity({actor:"wbs790",playerId,requestKey,...drift}),/REPLAY_CORRUPTED/);
    assert.deepEqual(await counts(database,playerId),before);
  });

  it("allows exactly one same-key writer and one terminal replay",async()=>{
    const repository=new CanonicalItemInventoryRepository(database),requestKey="same-key";
    const results=await Promise.all([repository.changeStackQuantity({actor:"wbs790",playerId:otherPlayerId,itemId,requestKey,quantityDelta:3n,reasonType:"REWARD"}),repository.changeStackQuantity({actor:"wbs790",playerId:otherPlayerId,itemId,requestKey,quantityDelta:3n,reasonType:"REWARD"})]);
    assert.deepEqual(results.map(row=>row.replayed).sort(),[false,true]);
    const rows=await database.query<Array<{operations:bigint;ledgers:bigint;quantity:bigint}>>("SELECT (SELECT COUNT(*) FROM canonical_item_inventory_operations WHERE player_id=? AND request_key=?) operations,(SELECT COUNT(*) FROM canonical_item_inventory_ledger_entries ledger JOIN canonical_item_inventory_operations operation ON operation.item_inventory_operation_id=ledger.item_inventory_operation_id WHERE operation.player_id=? AND operation.request_key=?) ledgers,(SELECT quantity FROM canonical_owned_item_stacks WHERE player_id=? AND item_id=?) quantity",[otherPlayerId,requestKey,otherPlayerId,requestKey,otherPlayerId,itemId]);
    assert.deepEqual(rows,[{operations:1n,ledgers:1n,quantity:3n}]);
  });

  it("serializes different-key absent credits and concurrent debits",async()=>{
    const repository=new CanonicalItemInventoryRepository(database);
    const credits=await Promise.all([repository.changeStackQuantity({actor:"wbs790",playerId:otherPlayerId,itemId:otherItemId,requestKey:"credit-a",quantityDelta:2n,reasonType:"REWARD"}),repository.changeStackQuantity({actor:"wbs790",playerId:otherPlayerId,itemId:otherItemId,requestKey:"credit-b",quantityDelta:5n,reasonType:"REWARD"})]);
    assert.equal(credits.reduce((sum,row)=>sum+(row.replayed?0n:1n),0n),2n);
    const debits=await Promise.allSettled([repository.changeStackQuantity({actor:"wbs790",playerId:otherPlayerId,itemId:otherItemId,requestKey:"debit-a",quantityDelta:-5n,reasonType:"USE"}),repository.changeStackQuantity({actor:"wbs790",playerId:otherPlayerId,itemId:otherItemId,requestKey:"debit-b",quantityDelta:-5n,reasonType:"USE"})]);
    assert.equal(debits.filter(row=>row.status==="fulfilled").length,1); assert.equal(debits.filter(row=>row.status==="rejected").length,1);
    const row=(await database.query<Array<{quantity:bigint}>>("SELECT quantity FROM canonical_owned_item_stacks WHERE player_id=? AND item_id=?",[otherPlayerId,otherItemId]))[0];
    assert.equal(row?.quantity,2n);
  });
});

async function counts(database:MariaDatabaseClient,targetPlayerId:string){
  return database.query<Array<{operations:bigint;ledgers:bigint;stacks:bigint;quantity_sum:string}>>("SELECT (SELECT COUNT(*) FROM canonical_item_inventory_operations WHERE player_id=?) operations,(SELECT COUNT(*) FROM canonical_item_inventory_ledger_entries WHERE player_id=?) ledgers,(SELECT COUNT(*) FROM canonical_owned_item_stacks WHERE player_id=?) stacks,(SELECT CAST(COALESCE(SUM(quantity),0) AS CHAR) FROM canonical_owned_item_stacks WHERE player_id=?) quantity_sum",[targetPlayerId,targetPlayerId,targetPlayerId,targetPlayerId]);
}
