import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pet-explore-notice-catalog-v2438.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || !/^hoibot_asset_pet_explore_notice(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`UNSAFE_PET_EXPLORE_NOTICE_SHADOW_DATABASE:${config.database.name}`);
const database = createDatabaseClient(config.database);
let clonedCount = 0;
try {
  await assert.rejects(database.withTransaction(async (transaction) => {
    const heads = await transaction.query<Array<{ active_configuration_set_id: bigint; version: bigint }>>("SELECT active_configuration_set_id,version FROM operation_notice_heads WHERE set_code='operation_notices' FOR UPDATE");
    const head = heads[0]!;
    const inserted = await transaction.execute("INSERT INTO configuration_sets(set_code,version,status,created_at) VALUES ('operation_notices',?,'preparing',UTC_TIMESTAMP(3))", [head.version + 1000n]);
    await transaction.execute("INSERT INTO configuration_values(configuration_set_id,config_key,value_type,string_value,validation_json) SELECT ?,config_key,value_type,string_value,validation_json FROM configuration_values WHERE configuration_set_id=?", [inserted.insertId, head.active_configuration_set_id]);
    const cloned = await transaction.query<Array<{ config_key: string; string_value: string }>>("SELECT config_key,string_value FROM configuration_values WHERE configuration_set_id=? ORDER BY config_key", [inserted.insertId]);
    clonedCount = cloned.length;
    assert.equal(cloned.find((row) => row.config_key === fixture.notice.configKey)?.string_value, fixture.notice.value);
    throw new Error("SHADOW_ROLLBACK");
  }), /SHADOW_ROLLBACK/);
  const preparing = await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM configuration_sets WHERE set_code='operation_notices' AND version>=1000");
  assert.equal(Number(preparing[0]!.count_value), 0);
  console.log(JSON.stringify({ result: "passed", matched: 1, clonedConfigurationValues: clonedCount, providerClonePreservesNotice: true, providerChanged: false, consumerChanged: false, gate8: false }));
} finally {
  await database.close();
}
