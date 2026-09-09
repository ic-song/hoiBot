import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const migrationPath = new URL("../migrations/478_guild_territory_attack_runtime_item_policy.sql", import.meta.url);
const servicePath = new URL("../src/guild/guild-territory-attack-service.ts", import.meta.url);
const providerPath = new URL("../src/guild/guild-territory-attack-runtime4-policy-provider.ts", import.meta.url);
const contractPath = new URL("../../migration-control/contracts/object-data-model-standard.v1.json", import.meta.url);

describe("guild territory attack runtime-four policy", () => {
  it("defines a CUID8 PK, matching FKs, and all four KST audit columns", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const contract = JSON.parse(await readFile(contractPath, "utf8")) as { registeredMigrations: string[]; tables: Array<{ table: string }>; integrationOnlyTables?: Array<{ table: string; integrationMigration: string }> };
    assert.match(sql, /guild_territory_attack_item_candidate_id CHAR\(8\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/);
    assert.match(sql, /PRIMARY KEY \(guild_territory_attack_item_candidate_id\)/);
    assert.match(sql, /FOREIGN KEY \(policy_scope_code, policy_version\)[\s\S]*REFERENCES guild_territory_attack_policy_versions\(policy_scope_code, policy_version\)/);
    assert.match(sql, /item_id CHAR\(8\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/);
    assert.match(sql, /FOREIGN KEY \(item_id\) REFERENCES canonical_item_definitions\(item_id\)/);
    for (const column of ["INSERT_USER", "INSERT_TIME", "UPDATE_USER", "UPDATE_TIME"]) assert.match(sql, new RegExp(`\\b${column}\\b`));
    assert.ok(contract.registeredMigrations.includes("478_guild_territory_attack_runtime_item_policy.sql"));
    assert.ok(contract.tables.some((table) => table.table === "guild_territory_attack_item_candidates"));
    assert.ok(contract.integrationOnlyTables?.some((table) => table.table === "guild_territory_attack_policy_versions" && table.integrationMigration === "353_guild_territory_attack_execute.sql"));
  });

  it("provisions only the independent runtime four through canonical item imports", async () => {
    const source = await readFile(providerPath, "utf8");
    const expected = [
      "role: \"DEFENSE\" as const, priority: 1, sourceIdentifier: \"ITEM-TERRITORY-DEFENSE-50\"",
      "role: \"DEFENSE\" as const, priority: 2, sourceIdentifier: \"ITEM-TERRITORY-DEFENSE-20\"",
      "role: \"ATTACK\" as const, priority: 1, sourceIdentifier: \"ITEM-TERRITORY-AMBUSH-40\"",
      "role: \"ATTACK\" as const, priority: 2, sourceIdentifier: \"ITEM-TERRITORY-AMBUSH-10\"",
    ] as const;
    let previous = -1;
    for (const needle of expected) {
      const position = source.indexOf(needle);
      assert.ok(position > previous, needle);
      previous = position;
    }
    for (const forbidden of ["AMBUSH-90", "AMBUSH-60", "AMBUSH-20", "DEFENSE-80", "DEFENSE-25", "castlePremiumItem", "guild_territory_ticket_definitions"]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
    assert.match(source, /new CanonicalItemInventoryRepository\(this\.database\)/);
    assert.match(source, /sourceSystem: "RUNTIME_DB"[\s\S]*sourceNamespace: "item_definitions"/);
    assert.match(source, /definitionOptions: \{ domain: "guild_territory_attack" \}/);
    assert.doesNotMatch(source, /definitionOptions: \{[^}]*successBps/);
    assert.match(source, /SELECT display_name,active FROM item_definitions WHERE code=\?/);
    assert.match(source, /insertWithCuid8CollisionRetry/);
    assert.match(source, /createObjectAuditValues/);
  });

  it("selects one owned candidate before rolling and decrements only on hit before cube defense", async () => {
    const source = await readFile(servicePath, "utf8");
    const defenseDraw = source.indexOf("persistItemDraw(transaction, operationId, input, war, generationVersion, \"defense_ticket\"");
    const defenseConsume = source.indexOf("consumeItemById(transaction, operationId, target.owner_player_id");
    const attackDraw = source.indexOf("persistItemDraw(transaction, operationId, input, war, generationVersion, \"attack_ticket\"");
    const attackConsume = source.indexOf("consumeItemById(transaction, operationId, actor.player_id");
    const cubeDraw = source.indexOf("\"contribution_cube_defense\"");
    assert.ok(defenseDraw >= 0 && defenseDraw < defenseConsume);
    assert.ok(attackDraw >= 0 && attackDraw < attackConsume && attackConsume < cubeDraw);
    assert.match(source, /candidates\.find\(\(candidate\) => BigInt\(candidate\.quantity \?\? 0n\) > 0n\)/);
    assert.match(source, /return drawBps <= thresholdBps/);
    assert.match(source, /JOIN canonical_item_definition_imports import_row/);
    assert.match(source, /new GuildTerritoryAttackRuntime4PolicyProvider\(this\.database\)\.apply\("guild-territory-attack-runtime"\)/);
  });
});
