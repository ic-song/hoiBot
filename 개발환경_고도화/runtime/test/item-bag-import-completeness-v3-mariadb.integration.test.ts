import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { assertObjectDomainImportDatabaseName, rollbackCanonicalItemLedgerExactTail } from "../src/data-migration/object-domain-importer.js";
import { createObjectAuditValues } from "../src/identity/object-identity-audit-provider.js";

const integration = process.env.RUN_ITEM_BAG_COMPLETENESS_MARIADB_INTEGRATION === "true" ? describe : describe.skip;
const hash = "a".repeat(64);
const audit = ["wbs777-maria", "2026-09-08 12:30:00", "wbs777-maria", "2026-09-08 12:30:00"];

function migration(name: string): string {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

async function executeScript(database: DatabaseClient, source: string): Promise<void> {
  let delimiter = ";";
  let statement = "";
  for (const line of source.replace(/\r\n/g, "\n").split("\n")) {
    const directive = /^DELIMITER\s+(\S+)\s*$/i.exec(line.trim());
    if (directive !== null) {
      assert.equal(statement.trim(), "");
      delimiter = directive[1]!;
      continue;
    }
    statement += `${line}\n`;
    if (!statement.trimEnd().endsWith(delimiter)) continue;
    const sql = statement.trimEnd().slice(0, -delimiter.length).trim();
    statement = "";
    if (sql !== "") await database.execute(sql);
  }
  assert.equal(statement.trim(), "");
}

integration("WBS777 item bag completeness isolated MariaDB", () => {
  let database: DatabaseClient;

  before(async () => {
    const name = process.env.DATABASE_NAME ?? "hoibot_rehearsal_wbs777";
    assertObjectDomainImportDatabaseName(name);
    assert.equal(name, "hoibot_rehearsal_wbs777");
    database = createDatabaseClient({ enabled: true, host: process.env.DATABASE_HOST ?? "127.0.0.1", port: Number(process.env.DATABASE_PORT ?? "3331"), user: process.env.DATABASE_USER ?? "wbs777_test", password: process.env.DATABASE_PASSWORD ?? "wbs777_local", name, connectionLimit: 4, connectTimeoutMs: 5000 });
    await executeScript(database, migration("444_canonical_item_inventory.sql"));
    await database.execute("CREATE TABLE data_migration_object_domain_import_runs(object_domain_import_run_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY) ENGINE=InnoDB");
    await database.execute("CREATE TABLE data_migration_common_staging_records(common_staging_record_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY) ENGINE=InnoDB");
    await database.execute(migration("488_item_bag_import_completeness.sql"));
    await database.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('play0001','LEGACY_JSON','owner-1',?,?,?,?),('play0002','LEGACY_JSON','owner-2',?,?,?,?)", [...audit, ...audit]);
    await database.execute("INSERT INTO canonical_item_definitions(item_id,item_name,item_kind,stackable_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('item0001','아이템','ITEM',TRUE,?,?,?,?)", audit);
    await database.execute("INSERT INTO canonical_owned_item_stacks(owned_item_stack_id,player_id,item_id,quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('stack001','play0001','item0001',2,?,?,?,?)", audit);
    await database.execute("INSERT INTO canonical_item_inventory_operations(item_inventory_operation_id,player_id,request_key,operation_status,resulting_quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('oper0001','play0001','r1','COMPLETE',1,?,?,?,?),('oper0002','play0001','r2','COMPLETE',2,?,?,?,?)", [...audit, ...audit]);
    // Deliberately insert lexical-later CUID first. Migration 490 only promises a deterministic baseline ordinal, never historical time.
    await database.execute("INSERT INTO canonical_item_inventory_ledger_entries(item_inventory_ledger_entry_id,item_inventory_operation_id,player_id,item_id,owned_item_stack_id,owned_item_id,quantity_delta,reason_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('zzzz0001','oper0001','play0001','item0001','stack001',NULL,1,'IMPORT',?,?,?,?),('aaaa0001','oper0002','play0001','item0001','stack001',NULL,1,'IMPORT',?,?,?,?)", [...audit, ...audit]);
    await executeScript(database, migration("490_item_bag_import_baseline_ordering.sql"));
  });

  after(async () => {
    await database.execute("DROP TRIGGER IF EXISTS trg_item_inventory_ledger_order_after_insert");
    for (const table of ["player_item_bag_import_ledger_baselines", "player_item_bag_import_stack_baselines", "canonical_item_inventory_ledger_orderings", "canonical_item_inventory_ledger_heads", "player_item_bag_import_completeness_projections", "data_migration_common_staging_records", "data_migration_object_domain_import_runs", "canonical_item_inventory_ledger_entries", "canonical_item_inventory_operations", "canonical_owned_item_instances", "canonical_owned_item_stacks", "canonical_item_definition_imports", "canonical_item_definitions", "canonical_players"]) await database.execute(`DROP TABLE IF EXISTS ${table}`);
    await database.close();
  });

  it("backfills a deterministic baseline ordinal without claiming CUID time order", async () => {
    const rows = await database.query<Array<{ item_inventory_ledger_entry_id: string; ledger_sequence: bigint }>>("SELECT item_inventory_ledger_entry_id,ledger_sequence FROM canonical_item_inventory_ledger_orderings WHERE player_id='play0001' ORDER BY ledger_sequence");
    assert.deepEqual(rows, [{ item_inventory_ledger_entry_id: "aaaa0001", ledger_sequence: 1n }, { item_inventory_ledger_entry_id: "zzzz0001", ledger_sequence: 2n }]);
  });

  it("atomically allocates unique consecutive sequences for concurrent same-player inserts", async () => {
    await database.execute("INSERT INTO canonical_item_inventory_operations(item_inventory_operation_id,player_id,request_key,operation_status,resulting_quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('oper0003','play0001','r3','COMPLETE',3,?,?,?,?),('oper0004','play0001','r4','COMPLETE',4,?,?,?,?)", [...audit, ...audit]);
    await Promise.all([
      database.execute("INSERT INTO canonical_item_inventory_ledger_entries(item_inventory_ledger_entry_id,item_inventory_operation_id,player_id,item_id,owned_item_stack_id,owned_item_id,quantity_delta,reason_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('mmmm0001','oper0003','play0001','item0001','stack001',NULL,1,'MUTATION',?,?,?,?)", audit),
      database.execute("INSERT INTO canonical_item_inventory_ledger_entries(item_inventory_ledger_entry_id,item_inventory_operation_id,player_id,item_id,owned_item_stack_id,owned_item_id,quantity_delta,reason_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('bbbb0001','oper0004','play0001','item0001','stack001',NULL,1,'MUTATION',?,?,?,?)", audit)
    ]);
    const sequences = await database.query<Array<{ ledger_sequence: bigint }>>("SELECT ledger_sequence FROM canonical_item_inventory_ledger_orderings WHERE item_inventory_ledger_entry_id IN('mmmm0001','bbbb0001') ORDER BY ledger_sequence");
    assert.deepEqual(sequences.map((row) => row.ledger_sequence), [3n, 4n]);
    const heads = await database.query<Array<{ last_ledger_sequence: bigint }>>("SELECT last_ledger_sequence FROM canonical_item_inventory_ledger_heads WHERE player_id='play0001'");
    assert.deepEqual(heads, [{ last_ledger_sequence: 4n }]);
  });

  it("fails closed for arbitrary DELETE and permits only locked tail rewind before reimport", async () => {
    await assert.rejects(() => database.execute("DELETE FROM canonical_item_inventory_ledger_entries WHERE item_inventory_ledger_entry_id='aaaa0001'"), /foreign key constraint fails/i);
    await assert.rejects(() => database.withTransaction((tx) => rollbackCanonicalItemLedgerExactTail(tx, "aaaa0001", createObjectAuditValues("object-domain-import-rollback", new Date("2026-09-08T03:30:00Z")))), /ROLLBACK_NOT_EXACT_TAIL/);
    await assert.rejects(() => database.withTransaction((tx) => rollbackCanonicalItemLedgerExactTail(tx, "aaaa0001", createObjectAuditValues("object-domain-import-rollback", new Date("2026-09-08T03:30:00Z")))), /ROLLBACK_NOT_EXACT_TAIL/);
    const tail = await database.query<Array<{ item_inventory_ledger_entry_id: string; ledger_sequence: bigint }>>("SELECT item_inventory_ledger_entry_id,ledger_sequence FROM canonical_item_inventory_ledger_orderings WHERE player_id='play0001' ORDER BY ledger_sequence DESC LIMIT 1");
    assert.equal(tail[0]!.ledger_sequence, 4n);
    await database.withTransaction(async (tx) => {
      await rollbackCanonicalItemLedgerExactTail(tx, tail[0]!.item_inventory_ledger_entry_id, createObjectAuditValues("object-domain-import-rollback", new Date("2026-09-08T03:30:00Z")));
      await tx.execute("DELETE FROM canonical_item_inventory_ledger_entries WHERE item_inventory_ledger_entry_id=?", [tail[0]!.item_inventory_ledger_entry_id]);
    });
    await database.execute("INSERT INTO canonical_item_inventory_operations(item_inventory_operation_id,player_id,request_key,operation_status,resulting_quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('oper0005','play0001','reimport','COMPLETE',4,?,?,?,?)", audit);
    await database.execute("INSERT INTO canonical_item_inventory_ledger_entries(item_inventory_ledger_entry_id,item_inventory_operation_id,player_id,item_id,owned_item_stack_id,owned_item_id,quantity_delta,reason_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('cccc0001','oper0005','play0001','item0001','stack001',NULL,1,'REIMPORT',?,?,?,?)", audit);
    const rows = await database.query<Array<{ ledger_sequence: bigint }>>("SELECT ledger_sequence FROM canonical_item_inventory_ledger_orderings WHERE item_inventory_ledger_entry_id='cccc0001'");
    assert.deepEqual(rows, [{ ledger_sequence: 4n }]);
  });

  it("preserves zero-row completeness and typed baseline ownership, and blocks unsafe migration rollback", async () => {
    await database.execute("INSERT INTO data_migration_object_domain_import_runs(object_domain_import_run_id) VALUES('run00001'),('run00002')");
    await database.execute("INSERT INTO data_migration_common_staging_records(common_staging_record_id) VALUES('wit00001'),('wit00002')");
    await database.execute("INSERT INTO player_item_bag_import_completeness_projections(player_item_bag_import_completeness_projection_id,player_id,object_domain_import_run_id,common_staging_record_id,projection_version,profile_semantic_sha256,import_contract_sha256,source_locator_sha256,source_payload_fingerprint,expected_source_key_count,projected_stack_count,quarantined_source_key_count,ignored_source_key_count,stack_set_fingerprint,item_ledger_entry_count,baseline_ledger_head_sequence,item_ledger_set_fingerprint,completeness_fingerprint,revision,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('proj0001','play0001','run00001','wit00001','OBJECT_DOMAIN_IMPORT_RELEVANT_V3',?,?,?,?,1,1,0,0,?,4,4,?,?,1,TRUE,?,?,?,?),('proj0002','play0002','run00002','wit00002','OBJECT_DOMAIN_IMPORT_RELEVANT_V3',?,?,?,?,0,0,0,0,?,0,0,?,?,1,TRUE,?,?,?,?)", [hash,hash,hash,hash,hash,hash,hash,...audit,hash,hash,hash,hash,hash,hash,hash,...audit]);
    await database.execute("INSERT INTO player_item_bag_import_stack_baselines(player_item_bag_import_stack_baseline_id,player_item_bag_import_completeness_projection_id,player_id,item_id,owned_item_stack_id,baseline_quantity,stack_entry_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('base0001','proj0001','play0001','item0001','stack001',2,?,?,?,?,?)", [hash, ...audit]);
    const ledger = await database.query<Array<{ item_inventory_operation_id: string; ledger_sequence: bigint }>>("SELECT ledger.item_inventory_operation_id,ordering.ledger_sequence FROM canonical_item_inventory_ledger_entries ledger JOIN canonical_item_inventory_ledger_orderings ordering ON ordering.item_inventory_ledger_entry_id=ledger.item_inventory_ledger_entry_id WHERE ledger.item_inventory_ledger_entry_id='aaaa0001'");
    await database.execute("INSERT INTO player_item_bag_import_ledger_baselines(player_item_bag_import_ledger_baseline_id,player_item_bag_import_completeness_projection_id,player_id,item_inventory_ledger_entry_id,item_inventory_operation_id,ledger_sequence,item_id,owned_item_stack_id,owned_item_id,quantity_delta,reason_type,ledger_entry_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('lbase001','proj0001','play0001','aaaa0001',?,?,'item0001','stack001',NULL,1,'IMPORT',?,?,?,?,?)", [ledger[0]!.item_inventory_operation_id, ledger[0]!.ledger_sequence, hash, ...audit]);
    const empty = await database.query<Array<{ baseline_ledger_head_sequence: bigint }>>("SELECT baseline_ledger_head_sequence FROM player_item_bag_import_completeness_projections WHERE player_id='play0002'");
    assert.deepEqual(empty, [{ baseline_ledger_head_sequence: 0n }]);
    await assert.rejects(() => executeScript(database, migration("rollback/490_item_bag_import_baseline_ordering.rollback.sql")), /ROLLBACK_490_SEQUENCE_EVIDENCE_EXISTS/);
  });
});
