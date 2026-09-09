import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MariaDatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { CanonicalItemInventoryRepository } from "../src/inventory/canonical-item-inventory-repository.js";

const root = resolve(import.meta.dirname, "../../..");
const evidence = resolve(root, "개발환경_고도화/migration-control/evidence/wbs790-gate6-lease2622/run2");
const phase = process.argv[2];
assert.ok(phase === "mutation" || phase === "restart-shadow");
assert.equal(process.env.DATABASE_HOST, "127.0.0.1");
assert.equal(process.env.DATABASE_PORT, "3358");
assert.equal(process.env.DATABASE_NAME, "hoibot_wbs790_lease2622");
assert.equal(process.env.DATABASE_USER, "root");
assert.equal(process.env.DATABASE_PASSWORD, "lease2622-isolated-only");
const db = new MariaDatabaseClient({enabled:true, host:"127.0.0.1", port:3358, name:"hoibot_wbs790_lease2622", user:"root", password:"lease2622-isolated-only", connectionLimit:12, connectTimeoutMs:5000});
const receiptsPath = resolve(root, "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave23-v1.json");
const prefixHash = createHash("sha256").update(readFileSync(receiptsPath)).digest("hex");
const tables = ["canonical_players", "canonical_item_definitions", "canonical_owned_item_stacks", "canonical_owned_item_instances", "canonical_item_inventory_operations", "canonical_item_inventory_ledger_entries", "canonical_item_inventory_ledger_heads", "canonical_item_inventory_ledger_orderings"];
const audit = ["lease2622", "2026-09-09 13:30:00", "lease2622", "2026-09-09 13:30:00"];
const itemId = "l2622i01", playerId = "l2622p01";
let dmlCalls = 0;
let arrivals = 0;
let releaseBarrier: (()=>void) | undefined;
let barrier: Promise<void> | undefined;
// 실제 transaction execute를 계측하되 root capability와 query 의미를 보존한다.
function observed(tx: DatabaseTransaction): DatabaseTransaction {
  return {query: tx.query.bind(tx), execute: async (sql, values) => {dmlCalls++; return tx.execute(sql, values);}};
}
const measured = new Proxy(db, {get(target, property) {
  if (property === "withTransaction" || property === "withRootTransaction") return <T>(work:(tx:DatabaseTransaction)=>Promise<T>) => target.withRootTransaction(async tx => {
    if(barrier) { arrivals++; if(arrivals===2) releaseBarrier?.(); await barrier; }
    return work(observed(tx));
  });
  const value = Reflect.get(target, property);
  return typeof value === "function" ? value.bind(target) : value;
}});
const repo = new CanonicalItemInventoryRepository(measured);
// BigInt를 정밀도 손실 없이 evidence JSON으로 직렬화한다.
function json(value:unknown):string {return JSON.stringify(value, (_key, entry:unknown) => typeof entry === "bigint" ? entry.toString() : entry);}
// 테스트 전용 DB 전체 관련 행을 정렬하여 감사값과 490 순서 원장까지 비교한다.
async function snapshot(query: DatabaseTransaction["query"] = db.query.bind(db)) {
  const state: Record<string,unknown> = {};
  for (const table of tables) {
    const rows = await query<Record<string,unknown>[]>(`SELECT * FROM ${table}`);
    state[table] = rows.map(row => JSON.parse(json(row)) as unknown).sort((a,b) => json(a).localeCompare(json(b)));
  }
  return state;
}
// DB 최종 수량과 terminal receipt의 소유자·FK·delta를 독립 SQL로 대사한다.
async function verify(requestKey:string, expectedQuantity:bigint, delta:bigint, targetPlayer=playerId) {
  const rows = await db.query<Record<string,unknown>[]>(`SELECT o.operation_status,o.resulting_quantity,l.quantity_delta,l.player_id,l.item_id,l.reason_type,s.quantity,
    r.ledger_sequence,h.last_ledger_sequence
    FROM canonical_item_inventory_operations o JOIN canonical_item_inventory_ledger_entries l USING(item_inventory_operation_id)
    JOIN canonical_owned_item_stacks s ON s.owned_item_stack_id=l.owned_item_stack_id AND s.player_id=l.player_id AND s.item_id=l.item_id
    JOIN canonical_item_inventory_ledger_orderings r ON r.item_inventory_ledger_entry_id=l.item_inventory_ledger_entry_id AND r.player_id=l.player_id
    JOIN canonical_item_inventory_ledger_heads h ON h.player_id=l.player_id WHERE o.player_id=? AND o.request_key=?`, [targetPlayer,requestKey]);
  assert.equal(rows.length,1);
  const row=rows[0]!;
  assert.equal(row.operation_status,"completed"); assert.equal(BigInt(String(row.resulting_quantity)),expectedQuantity);
  assert.equal(BigInt(String(row.quantity)),expectedQuantity); assert.equal(BigInt(String(row.quantity_delta)),delta);
  assert.equal(row.player_id,targetPlayer); assert.equal(row.item_id,itemId); assert.equal(row.reason_type,"REWARD");
  assert.equal(row.ledger_sequence,row.last_ledger_sequence);
  return JSON.parse(json(row)) as unknown;
}
const request = {actor:"lease2622", playerId, itemId, requestKey:"restart", quantityDelta:3n, reasonType:"REWARD"};
try {
  const manifest=JSON.parse(readFileSync(resolve(root,"개발환경_고도화/migration-control/contracts/object-data-model-standard.v1.json"),"utf8"));
  const sourcePaths=["개발환경_고도화/runtime/src/inventory/canonical-item-inventory-repository.ts","개발환경_고도화/runtime/src/database.ts","개발환경_고도화/runtime/src/shared/maria-database-error-policy.ts","개발환경_고도화/runtime/scripts/rehearse-wbs790-lease2622.ts","개발환경_고도화/runtime/scripts/rehearse-wbs790-lease2622.ps1","개발환경_고도화/migration-control/contracts/object-data-model-standard.v1.json"];
  const sourceHashes=Object.fromEntries(sourcePaths.map(path=>[path,createHash("sha256").update(readFileSync(resolve(root,path),"utf8").replace(/\r\n?/g,"\n")).digest("hex")]));
  assert.equal(JSON.parse(readFileSync(receiptsPath,"utf8")).receipts.length,243);
  assert.equal(manifest.tables.length,119);
  const existing = await db.query<{TABLE_NAME:string}[]>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
  const names = new Set(existing.map(row=>row.TABLE_NAME));
  for(const table of manifest.tables) assert.ok(names.has(table.table ?? table.tableName ?? table.name), `registered table missing: ${json(table)}`);
  const migrations=await db.query<{count:bigint}[]>("SELECT COUNT(*) count FROM schema_migrations");
  assert.equal(Number(migrations[0]!.count),478);
  if(phase === "mutation") {
    for(const id of [playerId,"l2622p02","l2622p03"]) await db.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,'SYNTHETIC',?,?,?,?,?)",[id,id,...audit]);
    await db.execute("INSERT INTO canonical_item_definitions(item_id,item_name,item_kind,stackable_flag,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,'합성 아이템','SYNTHETIC',TRUE,TRUE,?,?,?,?)",[itemId,...audit]);
    const outcomes: Record<string,unknown> = {};
    assert.deepEqual(await repo.changeStackQuantity({...request,requestKey:"seed",quantityDelta:2n}),{quantity:2n,replayed:false});
    assert.deepEqual(await repo.changeStackQuantity(request),{quantity:5n,replayed:false});
    outcomes.MUTATION_SUCCESS=await verify("restart",5n,3n);
    let before=await snapshot(); dmlCalls=0;
    assert.deepEqual(await repo.changeStackQuantity(request),{quantity:5n,replayed:true});
    assert.equal(dmlCalls,0); assert.deepEqual(await snapshot(),before);
    outcomes.DUPLICATE_REPLAY_DML_ZERO={dmlCalls,snapshotEqual:true};
    for(const drift of [{quantityDelta:4n},{reasonType:"USE"},{itemId:"l2622i02"}]) {
      dmlCalls=0; await assert.rejects(repo.changeStackQuantity({...request,...drift}),/REPLAY_CORRUPTED/);
      assert.equal(dmlCalls,0); assert.deepEqual(await snapshot(),before);
    }
    outcomes.PAYLOAD_DRIFT_FAIL_CLOSED={variants:3,dmlCalls:0,snapshotEqual:true};
    dmlCalls=0; await assert.rejects(repo.changeStackQuantity({...request,requestKey:"insufficient",quantityDelta:-6n}),/INSUFFICIENT_QUANTITY/);
    assert.equal(dmlCalls,0); assert.deepEqual(await snapshot(),before);
    outcomes.INSUFFICIENT_QUANTITY={dmlCalls:0,snapshotEqual:true};
    await db.execute("CREATE TRIGGER lease2622_fail BEFORE UPDATE ON canonical_item_inventory_operations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='LEASE2622_FORCED_FAILURE'");
    try {await assert.rejects(repo.changeStackQuantity({...request,requestKey:"rollback",quantityDelta:7n}),/LEASE2622_FORCED_FAILURE/);} finally {await db.execute("DROP TRIGGER lease2622_fail");}
    assert.deepEqual(await snapshot(),before); outcomes.DOMAIN_FAILURE_ROLLBACK={snapshotEqual:true,includesLedgerOrdering:true};
    const concurrent={...request,playerId:"l2622p02",requestKey:"same-key",quantityDelta:7n};
    barrier=new Promise<void>(resolve=>{releaseBarrier=resolve;});
    const result=await Promise.all([repo.changeStackQuantity(concurrent),repo.changeStackQuantity(concurrent)]);
    barrier=undefined; assert.ok(arrivals>=2);
    assert.deepEqual(result.map(v=>v.replayed).sort(),[false,true]);
    outcomes.CONCURRENCY_SINGLE_WRITER={rootTransactionsAtBarrier:arrivals,results:JSON.parse(json(result)),receipt:await verify("same-key",7n,7n,"l2622p02")};
    before=await snapshot();
    const output={format:"wbs790-lease2622-evidence-v1",phase,pid:process.pid,registeredTables:119,migrations:478,prefixHash,sourceHashes,outcomes,snapshot:before};
    writeFileSync(resolve(evidence,"mutation.json"),JSON.stringify(output,null,2)+"\n");
    process.stdout.write("WBS790_MUTATION_PASS scenarios=6 registeredTables=119 migration490OrderingVerified=true\n");
  } else {
    const prior=JSON.parse(readFileSync(resolve(evidence,"mutation.json"),"utf8"));
    assert.notEqual(prior.pid,process.pid); assert.equal(prior.prefixHash,prefixHash);
    assert.deepEqual(prior.sourceHashes,sourceHashes);
    assert.deepEqual(await snapshot(),prior.snapshot); dmlCalls=0;
    assert.deepEqual(await repo.changeStackQuantity(request),{quantity:5n,replayed:true});
    assert.equal(dmlCalls,0); assert.deepEqual(await snapshot(),prior.snapshot);
    const shadow=await db.withReadOnlySnapshot(async tx=>{
      const state=await snapshot(tx.query.bind(tx));
      assert.deepEqual(state,prior.snapshot);
      const rows=await tx.query<{quantity:bigint}[]>("SELECT quantity FROM canonical_owned_item_stacks WHERE player_id=? AND item_id=?",[playerId,itemId]);
      assert.equal(rows[0]!.quantity,2n+3n);
      return {scope:"READ_ONLY_SNAPSHOT_SMOKE",snapshotEqual:true,quantity:String(rows[0]!.quantity),gate7Complete:false};
    });
    assert.deepEqual(await snapshot(),prior.snapshot);
    const output={format:"wbs790-lease2622-evidence-v1",phase,pid:process.pid,priorPid:prior.pid,prefixHash,sourceHashes,restartReplay:{quantity:"5",replayed:true,dmlCalls,snapshotEqual:true},shadow};
    writeFileSync(resolve(evidence,"restart-shadow.json"),JSON.stringify(output,null,2)+"\n");
    process.stdout.write("WBS790_RESTART_SNAPSHOT_SMOKE_PASS distinctPid=true replayDml=0 readOnlySnapshot=true snapshotEqual=true gate7Complete=false\n");
  }
  assert.equal(createHash("sha256").update(readFileSync(receiptsPath)).digest("hex"),prefixHash);
} finally {await db.close();}
