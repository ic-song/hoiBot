import assert from "node:assert/strict";
import { createDatabaseClient } from "../../src/database.js";
function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
async function main(): Promise<void> {
  const database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 2, connectTimeoutMs: 5_000 });
  const rows = await database.query<Array<{ definition_count: bigint; invalid_link_count: bigint; assignment_count: bigint; reward_scope_count: bigint }>>(`
    SELECT
      (SELECT COUNT(*) FROM title_definition_catalog_entries WHERE source_scope = 'MINI_PET_COLLECTION' AND definition_version = 1 AND lifecycle_code = 'ACTIVE') AS definition_count,
      (SELECT COUNT(*) FROM player_mini_pet_collection_title_sources AS source LEFT JOIN title_definition_catalog_entries AS catalog ON catalog.id = source.title_catalog_entry_id LEFT JOIN player_title_instances AS instance_row ON instance_row.id = source.canonical_instance_id WHERE catalog.source_scope <> 'MINI_PET_COLLECTION' OR instance_row.player_id <> source.player_id OR instance_row.title_id <> source.title_id) AS invalid_link_count,
      (SELECT COUNT(*) FROM mini_pet_title_assignments) AS assignment_count,
      (SELECT COUNT(*) FROM title_definition_catalog_entries WHERE source_scope IN ('MINI_PET_GRADE_REWARD', 'MINI_PET_STAGE_REWARD')) AS reward_scope_count
  `);
  const row = rows[0]!;
  assert.equal(Number(row.definition_count), 100);
  assert.equal(Number(row.invalid_link_count), 0);
  assert.equal(Number(row.reward_scope_count), 0);
  console.log(JSON.stringify({ definitionCount: 100, invalidLinks: 0, assignmentCountObservedOnly: Number(row.assignment_count), rewardDefinitions: 0 }));
  await database.close();
}
void main();
