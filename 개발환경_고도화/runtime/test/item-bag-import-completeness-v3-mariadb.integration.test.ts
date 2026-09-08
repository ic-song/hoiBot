import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { assertObjectDomainImportDatabaseName } from "../src/data-migration/object-domain-importer.js";

const integration = process.env.RUN_ITEM_BAG_COMPLETENESS_MARIADB_INTEGRATION === "true" ? describe : describe.skip;
const hash = "a".repeat(64);
const audit = ["wbs777-maria", "2026-09-08 12:30:00", "wbs777-maria", "2026-09-08 12:30:00"];

integration("WBS777 item bag completeness isolated MariaDB", () => {
  let database: DatabaseClient;

  before(async () => {
    const name = process.env.DATABASE_NAME ?? "hoibot_rehearsal_wbs777";
    assertObjectDomainImportDatabaseName(name);
    assert.equal(name, "hoibot_rehearsal_wbs777");
    database = createDatabaseClient({ enabled: true, host: process.env.DATABASE_HOST ?? "127.0.0.1", port: Number(process.env.DATABASE_PORT ?? "3331"), user: process.env.DATABASE_USER ?? "wbs777_test", password: process.env.DATABASE_PASSWORD ?? "wbs777_local", name, connectionLimit: 2, connectTimeoutMs: 5000 });
    await database.execute("CREATE TABLE canonical_players(player_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY) ENGINE=InnoDB");
    await database.execute("CREATE TABLE data_migration_object_domain_import_runs(object_domain_import_run_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY) ENGINE=InnoDB");
    await database.execute("CREATE TABLE data_migration_common_staging_records(common_staging_record_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY) ENGINE=InnoDB");
    await database.execute(readFileSync(new URL("../migrations/488_item_bag_import_completeness.sql", import.meta.url), "utf8"));
  });

  after(async () => {
    await database.execute("DROP TABLE IF EXISTS player_item_bag_import_completeness_projections");
    await database.execute("DROP TABLE IF EXISTS data_migration_common_staging_records");
    await database.execute("DROP TABLE IF EXISTS data_migration_object_domain_import_runs");
    await database.execute("DROP TABLE IF EXISTS canonical_players");
    await database.close();
  });

  it("persists an empty BAG_CONTAINER baseline and enforces one active projection", async () => {
    await database.execute("INSERT INTO canonical_players(player_id) VALUES('play0001')");
    await database.execute("INSERT INTO data_migration_object_domain_import_runs(object_domain_import_run_id) VALUES('run00001')");
    await database.execute("INSERT INTO data_migration_common_staging_records(common_staging_record_id) VALUES('wit00001')");
    await database.execute("INSERT INTO player_item_bag_import_completeness_projections(player_item_bag_import_completeness_projection_id,player_id,object_domain_import_run_id,common_staging_record_id,projection_version,profile_semantic_sha256,import_contract_sha256,source_locator_sha256,source_payload_fingerprint,expected_source_key_count,projected_stack_count,quarantined_source_key_count,ignored_source_key_count,stack_set_fingerprint,item_ledger_entry_count,item_ledger_set_fingerprint,completeness_fingerprint,revision,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('proj0001','play0001','run00001','wit00001','OBJECT_DOMAIN_IMPORT_RELEVANT_V3',?,?,?,?,0,0,0,0,?,0,?,?,1,TRUE,?,?,?,?)", [hash, hash, hash, hash, hash, hash, hash, ...audit]);
    const rows = await database.query<Array<{ expected_source_key_count: number; projected_stack_count: number; item_ledger_entry_count: bigint }>>("SELECT expected_source_key_count,projected_stack_count,item_ledger_entry_count FROM player_item_bag_import_completeness_projections");
    assert.deepEqual(rows, [{ expected_source_key_count: 0, projected_stack_count: 0, item_ledger_entry_count: 0n }]);
    await assert.rejects(() => database.execute("INSERT INTO player_item_bag_import_completeness_projections(player_item_bag_import_completeness_projection_id,player_id,object_domain_import_run_id,common_staging_record_id,projection_version,profile_semantic_sha256,import_contract_sha256,source_locator_sha256,source_payload_fingerprint,expected_source_key_count,projected_stack_count,quarantined_source_key_count,ignored_source_key_count,stack_set_fingerprint,item_ledger_entry_count,item_ledger_set_fingerprint,completeness_fingerprint,revision,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('proj0002','play0001','run00001','wit00001','OBJECT_DOMAIN_IMPORT_RELEVANT_V3',?,?,?,?,0,0,0,0,?,0,?,?,2,TRUE,?,?,?,?)", [hash, hash, hash, hash, hash, hash, hash, ...audit]), /Duplicate entry/);
  });
});
