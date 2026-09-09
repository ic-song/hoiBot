import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaPendantPolicyCatalogRepository } from "../src/pet/maria-pendant-policy-catalog-repository.js";
import { PendantPolicyCatalogReadProvider } from "../src/pet/pendant-policy-catalog.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pendant-policy-catalog-v1.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || config.database.name !== "hoibot_pendant_policy_catalog_probe") throw new Error(`Blocked database:${config.database.name}`);
let database = createDatabaseClient(config.database);
const checks: string[] = [];

async function verify() {
  const policy = await new PendantPolicyCatalogReadProvider(new MariaPendantPolicyCatalogRepository(database)).readPublished(fixture.policyCode);
  assert.equal(policy.policyVersion, fixture.policyVersion);
  assert.equal(policy.publishState, fixture.publishState);
  assert.equal(policy.sourceHash, fixture.sourceHash);
  assert.equal(policy.levels.length, fixture.levelRows);
  policy.levels.forEach((level, index) => {
    const expected = fixture.levels[index];
    assert.deepEqual([level.targetLevel, Number(level.successRate), Number(level.charmIncrement), Number(level.exploreIncrement), level.pointCost.toString(), Number(level.stoneCost)], expected);
  });
  checks.push("repository exact 30-level parity");
  const counts = (await database.query<Array<Record<string, bigint>>>(`SELECT
    (SELECT COUNT(*) FROM pendant_upgrade_policy_versions WHERE policy_code='PENDANT_ENHANCE_LEGACY' AND policy_version=1 AND publish_state='PUBLISHED' AND source_hash=?) headers,
    (SELECT COUNT(*) FROM pendant_upgrade_policy_levels level_row JOIN pendant_upgrade_policy_versions version_row ON version_row.id=level_row.policy_id WHERE version_row.source_hash=?) levels,
    (SELECT COUNT(*) FROM item_definitions WHERE asset_type_code='PENDANT') pendant_items,
    (SELECT COUNT(*) FROM inventory_instances) inventory_instances,
    (SELECT COUNT(*) FROM player_pet_pendants) equip_projection,
    (SELECT COUNT(*) FROM pendant_upgrade_confirmations) enhance_confirmations,
    (SELECT COUNT(*) FROM object_registry WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.catalogVersion'))='ASSET-FREEZE-v2.400-pendant-object-link-01') pendant_objects`, [fixture.sourceHash, fixture.sourceHash]))[0]!;
  const numeric = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)]));
  assert.deepEqual(numeric, { headers: 1, levels: 30, pendant_items: 13, inventory_instances: 0, equip_projection: 0, enhance_confirmations: 0, pendant_objects: 13 });
  checks.push("protected ownership consumer object boundaries");
  assert.equal(await database.verifyRollback(), true);
  checks.push("transaction rollback");
  return numeric;
}

try {
  const counts = await verify();
  await database.close();
  database = createDatabaseClient(config.database);
  const reconnect = await new PendantPolicyCatalogReadProvider(new MariaPendantPolicyCatalogRepository(database)).readPublished(fixture.policyCode);
  assert.equal(reconnect.levels.length, 30);
  checks.push("reconnect");
  console.log(JSON.stringify({ result: "passed", checks, total: checks.length, counts, sourceHash: reconnect.sourceHash }));
} finally { await database.close(); }
