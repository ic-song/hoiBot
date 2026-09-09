import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaPendantPolicyCatalogRepository } from "../src/pet/maria-pendant-policy-catalog-repository.js";
import { PendantPolicyCatalogReadProvider } from "../src/pet/pendant-policy-catalog.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/pendant-policy-catalog-v1.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || config.database.name !== "hoibot_pendant_policy_catalog_probe") throw new Error(`Blocked database:${config.database.name}`);
const database = createDatabaseClient(config.database);
try {
  const policy = await new PendantPolicyCatalogReadProvider(new MariaPendantPolicyCatalogRepository(database)).readPublished(fixture.policyCode);
  assert.equal(policy.sourceHash, fixture.sourceHash);
  assert.equal(policy.levels.length, 30);
  policy.levels.forEach((level, index) => assert.deepEqual(
    [level.targetLevel, Number(level.successRate), Number(level.charmIncrement), Number(level.exploreIncrement), level.pointCost.toString(), Number(level.stoneCost)],
    fixture.levels[index],
  ));
  console.log(JSON.stringify({ result: "passed", policyCode: policy.policyCode, policyVersion: policy.policyVersion,
    publishState: policy.publishState, sourceHash: policy.sourceHash, matchedLevels: policy.levels.length,
    consumerTransitioned: false, ownershipRowsMutated: 0 }));
} finally { await database.close(); }
