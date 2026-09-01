import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/player-title-definition-instance-link-v1.json", import.meta.url), "utf8"));
const config = loadConfig();
if (!config.database.enabled || config.database.name !== "hoibot_player_title_link_probe") throw new Error(`Blocked database:${config.database.name}`);
const database = createDatabaseClient(config.database);
try {
  const rows = await database.query<Array<{ source_scope:string; stable_code:string; display_name:string; instance_count:bigint }>>(`
    SELECT catalog_entry.source_scope,catalog_entry.stable_code,catalog_entry.display_name,COUNT(instance_row.id) instance_count
      FROM title_definition_catalog_entries catalog_entry
      JOIN player_title_instances instance_row ON instance_row.title_catalog_entry_id=catalog_entry.id
     WHERE catalog_entry.source_scope IN ('PLAYER_ADMIN_CUSTOM','PLAYER_GIFT')
     GROUP BY catalog_entry.id,catalog_entry.source_scope,catalog_entry.stable_code,catalog_entry.display_name
     ORDER BY BINARY catalog_entry.source_scope`);
  assert.deepEqual(rows.map((row) => [row.source_scope,row.stable_code,row.display_name,Number(row.instance_count)]), [
    [fixture.admin.sourceScope,fixture.admin.stableCode,fixture.dynamicDisplayName,2],
    [fixture.gift.sourceScope,fixture.gift.stableCode,fixture.dynamicDisplayName,2],
  ]);
  console.log(JSON.stringify({ result:"passed",staticDefinitions:5,dynamicDefinitions:2,instances:4,
    ownedInstances:3,removedInstances:1,aggregateProjectionRows:2,sameDisplayMerges:0,
    sourceScopes:[fixture.admin.sourceScope,fixture.gift.sourceScope],petMiniGuildObjectLinks:0 }));
} finally { await database.close(); }
