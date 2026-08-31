import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";
const open = (): DatabaseClient => createDatabaseClient({
  enabled: true,
  host: required("DATABASE_HOST"),
  port: Number(required("DATABASE_PORT")),
  user: required("DATABASE_USER"),
  password: required("DATABASE_PASSWORD"),
  name: required("DATABASE_NAME"),
  connectionLimit: 3,
  connectTimeoutMs: 5_000
});

describe("admin pet explore package grant data-only MariaDB parity", { skip: !enabled }, () => {
  let database: DatabaseClient;

  before(() => { database = open(); });
  after(async () => { if (database) await database.close(); });

  it("keeps PKG-186 linked once, rejects executable aliases, rolls back, and survives reconnect", async () => {
    const source = (await database.query<Array<{
      package_id: string; source_command: string; source_kind: string; canonical_route: string;
      executable: number; metadata_json: string;
    }>>(
      "SELECT package_id,source_command,source_kind,canonical_route,executable,CAST(metadata_json AS CHAR) metadata_json FROM package_catalog_source_commands WHERE package_id='PKG-186' AND source_command='/펫탐'"
    ))[0]!;
    assert.deepEqual([source.package_id, source.source_command, source.source_kind, source.canonical_route, source.executable],
      ["PKG-186", "/펫탐", "LEGACY_ADMIN_GRANT", "/패키지지급", 0]);
    assert.deepEqual(JSON.parse(source.metadata_json), {
      sourceCommandId: "CMD-10-0037",
      legacyPattern: "/펫탐[N], 대상",
      legacyItemName: "펫탐험패키지⛰️[1](/펫탐험오픈1)",
      migrationPolicy: "CATALOG_SEED_ONLY"
    });

    const catalog = (await database.query<Array<{ consume_item_id: string; metadata_json: string }>>(
      `SELECT catalog.consume_item_id,CAST(item.metadata_json AS CHAR) metadata_json
       FROM package_catalog catalog JOIN package_item_definitions item ON item.item_id=catalog.consume_item_id
       WHERE catalog.package_id='PKG-186'`
    ))[0]!;
    assert.equal(catalog.consume_item_id, "ITEM-PACKAGE-186");
    const metadata = JSON.parse(catalog.metadata_json) as Record<string, unknown>;
    assert.deepEqual([metadata.sourceGrantCommand, metadata.grantRoute, metadata.useRoute, metadata.migrationPolicy],
      ["/펫탐", "/패키지지급", "/패키지사용", "CATALOG_SEED_ONLY"]);

    const aliases = (await database.query<Array<{ alias_count: bigint }>>(
      `SELECT
        (SELECT COUNT(*) FROM package_command_aliases WHERE command_text='/펫탐')
        + (SELECT COUNT(*) FROM command_aliases WHERE command_text='/펫탐') alias_count`
    ))[0]!;
    assert.equal(Number(aliases.alias_count), 0);

    await assert.rejects(() => database.withTransaction(async (transaction) => {
      await transaction.execute("DELETE FROM package_catalog_source_commands WHERE package_id='PKG-186' AND source_command='/펫탐'");
      throw new Error("synthetic rollback");
    }), /synthetic rollback/);
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>(
      "SELECT COUNT(*) count_value FROM package_catalog_source_commands WHERE package_id='PKG-186' AND source_command='/펫탐'"
    ))[0]!.count_value), 1);

    await database.close();
    database = open();
    assert.equal(Number((await database.query<Array<{ count_value: bigint }>>(
      "SELECT COUNT(*) count_value FROM package_catalog_source_commands WHERE package_id='PKG-186' AND source_command='/펫탐' AND executable=0"
    ))[0]!.count_value), 1);
  });
});
