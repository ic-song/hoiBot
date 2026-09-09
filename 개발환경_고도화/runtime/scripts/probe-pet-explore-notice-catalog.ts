import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-explore-notice-catalog-v2438.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_pet_explore_notice(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`UNSAFE_PET_EXPLORE_NOTICE_DATABASE:${config.database.name}`);
let database = createDatabaseClient(config.database);
const checks: string[] = [];
try {
  const catalogs = await database.query<Array<{ id: bigint; configuration_set_id: bigint; source_sha256: string; config_key: string; notice_sha256: string; utf16_length: bigint; utf8_bytes: bigint; line_count: bigint; mutation_scope: string; binding_mode: string }>>(
    "SELECT id,configuration_set_id,source_sha256,config_key,notice_sha256,utf16_length,utf8_bytes,line_count,mutation_scope,binding_mode FROM pet_explore_notice_catalog_versions WHERE catalog_version=? AND active=TRUE AND publication_status='SHADOW'", [fixture.catalogVersion]
  );
  assert.equal(catalogs.length, 1);
  const catalog = catalogs[0]!;
  assert.deepEqual([catalog.source_sha256, catalog.config_key, catalog.notice_sha256, Number(catalog.utf16_length), Number(catalog.utf8_bytes), Number(catalog.line_count), catalog.mutation_scope, catalog.binding_mode], [fixture.sourceGitSha256, fixture.notice.configKey, fixture.notice.valueSha256, 66, 108, 3, "operation.notice.mutate", "EXISTING_PROVIDER_DEPENDENCY"]);
  checks.push("active immutable catalog");

  const heads = await database.query<Array<{ active_configuration_set_id: bigint }>>("SELECT active_configuration_set_id FROM operation_notice_heads WHERE set_code='operation_notices'");
  assert.equal(heads.length, 1);
  assert.equal(heads[0]!.active_configuration_set_id, catalog.configuration_set_id);
  checks.push("existing provider head binding");

  const values = await database.query<Array<{ config_key: string; string_value: string }>>("SELECT config_key,string_value FROM configuration_values WHERE configuration_set_id=? ORDER BY config_key", [catalog.configuration_set_id]);
  assert.deepEqual(values.map((row) => row.config_key), ["notice.advertisement", "notice.cleanup", "notice.package_bag", "notice.pet_explore"]);
  assert.equal(values.find((row) => row.config_key === fixture.notice.configKey)?.string_value, fixture.notice.value);
  checks.push("exact notice plus existing keys");

  await assert.rejects(database.withTransaction(async (transaction) => {
    await transaction.execute("UPDATE configuration_values SET string_value='rollback sentinel' WHERE configuration_set_id=? AND config_key=?", [catalog.configuration_set_id, fixture.notice.configKey]);
    throw new Error("ROLLBACK_SENTINEL");
  }), /ROLLBACK_SENTINEL/);
  assert.equal((await database.query<Array<{ string_value: string }>>("SELECT string_value FROM configuration_values WHERE configuration_set_id=? AND config_key=?", [catalog.configuration_set_id, fixture.notice.configKey]))[0]!.string_value, fixture.notice.value);
  checks.push("transaction rollback");

  await database.close();
  database = createDatabaseClient(config.database);
  assert.equal((await database.query<Array<{ string_value: string }>>("SELECT string_value FROM configuration_values WHERE configuration_set_id=? AND config_key=?", [catalog.configuration_set_id, fixture.notice.configKey]))[0]!.string_value, fixture.notice.value);
  checks.push("reconnect read");
  console.log(JSON.stringify({ result: "passed", checks, total: checks.length, noticeValues: 1, utf16Length: 66, utf8Bytes: 108, providerChanged: false, consumerChanged: false, operationalDataTouched: false, gate8: false }));
} finally {
  await database.close();
}
