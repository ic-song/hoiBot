import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { CANONICAL_PACKAGE_ITEM_DEFINITION_SELECT } from "../src/package/canonical-item-definition-adapter.js";

interface Fixture {
  membershipSha256: string;
  lease2387FactsSha256: string;
  lease2387SourceTraceSha256: string;
  identityTable: string;
  ownershipTable: string;
  ledgerTable: string;
  canonicalReplacements: Record<string, string>;
  forbiddenOwnershipWrites: string[];
  counts: Record<string, number>;
  codes: string[];
  objectlessCodes: string[];
  runtimeConsumerCodes: string[];
  unresolvedExcludedCodes: string[];
}

interface SnapshotRow { code: string; boundary: string; stackable: boolean }
interface ObjectFact { code: string; objectKey: string; aliases: number; sourceBindings: number }

const fixture = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/fixtures/synthetic-relational/package-canonical-item-dual-consumer-parity-v1.json",
  import.meta.url,
), "utf8")) as Fixture;
const snapshot = JSON.parse(fs.readFileSync(new URL(
  "../../migration-control/fixtures/synthetic-relational/item-definition-snapshot-v1.json",
  import.meta.url,
), "utf8")) as { rows: SnapshotRow[] };
const fixtureDirectory = new URL("../../migration-control/fixtures/synthetic-relational/", import.meta.url);
const runtimeRoot = fileURLToPath(new URL("..", import.meta.url));

function readJson(name: string): unknown {
  return JSON.parse(fs.readFileSync(new URL(name, fixtureDirectory), "utf8"));
}

function objectFacts(): ObjectFact[] {
  const facts: ObjectFact[] = [];
  for (const row of readJson("direct-bag-stack-crosswalk-v1.json") as Array<{ definitionCode: string; objectKey: string }>) {
    facts.push({ code: row.definitionCode, objectKey: row.objectKey, aliases: 1, sourceBindings: 1 });
  }
  for (const row of readJson("home-building-recipe-item-crosswalk-v1.json") as Array<{ definitionCode: string; objectKey: string; sourceBindings: unknown[] }>) {
    facts.push({ code: row.definitionCode, objectKey: row.objectKey, aliases: 1, sourceBindings: row.sourceBindings.length });
  }
  for (const name of ["iteminfo-ring-definitions-v1.json", "iteminfo-raid-definitions-v1.json", "iteminfo-territory-tickets-v1.json", "iteminfo-castle-units-v1.json"]) {
    const source = readJson(name) as { rows: Array<{ itemCode: string; objectKey: string }> };
    for (const row of source.rows) facts.push({ code: row.itemCode, objectKey: row.objectKey, aliases: name.includes("castle") ? 1 : 0, sourceBindings: 1 });
  }
  return facts;
}

function walkTypeScript(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walkTypeScript(target) : target.endsWith(".ts") && !target.endsWith(".test.ts") ? [target] : [];
  });
}

function quoted(source: string, code: string): boolean {
  return source.includes(`"${code}"`) || source.includes(`'${code}'`);
}

describe("package canonical item dual-consumer parity", () => {
  it("freezes only B76 and excludes A74/D1", () => {
    assert.equal(fixture.codes.length, 76);
    assert.equal(new Set(fixture.codes).size, 76);
    assert.equal(fixture.objectlessCodes.length, 15);
    assert.equal(fixture.runtimeConsumerCodes.length, 36);
    assert.deepEqual(fixture.canonicalReplacements, {
      castle_coin: "ITEM-RWD-042",
      "ITEM-RWD-026": "pet_enhance_stone",
      "ITEM-RWD-046": "ITEM-RWD-018",
      "ITEM-RWD-RANDOM-SPIRIT-BOX": "spirit_box",
      "ITEM-RWD-SEASONED-CHICKEN": "legacy-seasoned-chicken",
    });
    assert.deepEqual(fixture.unresolvedExcludedCodes, ["free_market_membership"]);
    const packageRows = snapshot.rows.filter((row) => row.boundary === "PACKAGE_COMPATIBILITY");
    const byCode = new Map(packageRows.map((row) => [row.code, row]));
    assert.equal(packageRows.length, 151);
    for (const code of fixture.codes) assert.equal(byCode.get(code)?.stackable, true, code);
    assert.equal(packageRows.filter((row) => !fixture.codes.includes(row.code) && row.code !== "free_market_membership").length, 74);
    assert.equal(fixture.membershipSha256, "cbf8ce772ac8b0f00ca3c35b8a85306a443e693efc3971aec9bb38da363ab816");
    assert.equal(fixture.lease2387FactsSha256, "916013af83469208e71496addd255d45c1031a2cac71f4ea0db36eec2772f4b7");
    assert.equal(fixture.lease2387SourceTraceSha256, "c646533d9cccc1786872b18ae5513a75aedba690ad2c828e8916ce2ad0cec0a7");
  });

  it("preserves object61 aliases and source bindings without creating objectless B15", () => {
    const selected = objectFacts().filter((row) => fixture.codes.includes(row.code));
    assert.equal(selected.length, 61);
    assert.equal(new Set(selected.map((row) => row.objectKey)).size, 61);
    assert.equal(selected.reduce((sum, row) => sum + row.aliases, 0), 60);
    assert.equal(selected.reduce((sum, row) => sum + row.sourceBindings, 0), 72);
    const selectedCodes = new Set(selected.map((row) => row.code));
    assert.deepEqual(fixture.objectlessCodes.filter((code) => selectedCodes.has(code)), []);
    assert.equal(fixture.codes.filter((code) => !selectedCodes.has(code)).length, 15);
  });

  it("proves every B code has package consume or reward seed evidence", () => {
    const migrationDirectory = path.join(runtimeRoot, "migrations");
    const statements = fs.readdirSync(migrationDirectory)
      .filter((name) => name.endsWith(".sql"))
      .flatMap((name) => fs.readFileSync(path.join(migrationDirectory, name), "utf8").split(/;\s*(?:\r?\n|$)/));
    const packageStatements = statements.filter((statement) =>
      /package_catalog|package_rewards|package_reward_rules|package_reward_bundle_items|package_contents/i.test(statement)
    );
    for (const code of fixture.codes) {
      assert.equal(packageStatements.some((statement) => quoted(statement, code)), true, code);
    }
  });

  it("tracks all 36 non-package runtime consumers by the same stable code", () => {
    const sources = walkTypeScript(path.join(runtimeRoot, "src"))
      .filter((name) => !name.includes(`${path.sep}package${path.sep}`))
      .map((name) => fs.readFileSync(name, "utf8"));
    for (const code of fixture.runtimeConsumerCodes) {
      assert.equal(sources.some((source) => quoted(source, code)), true, code);
    }
  });

  it("keeps canonical lookup and ownership mutation on item inventory tables", () => {
    assert.equal(fixture.identityTable, "item_definitions");
    assert.equal(fixture.ownershipTable, "inventory_stacks");
    assert.equal(fixture.ledgerTable, "inventory_ledger");
    assert.match(CANONICAL_PACKAGE_ITEM_DEFINITION_SELECT, /LEFT JOIN item_definitions canonical/);
    assert.match(CANONICAL_PACKAGE_ITEM_DEFINITION_SELECT, /canonical\.id IS NOT NULL/);
    assert.doesNotMatch(CANONICAL_PACKAGE_ITEM_DEFINITION_SELECT, /canonical_gap/);
    const providerSource = fs.readFileSync(new URL("../src/package/domain-item-provider.ts", import.meta.url), "utf8");
    assert.match(providerSource, /INSERT INTO inventory_stacks/);
    assert.match(providerSource, /INSERT INTO inventory_ledger/);
    for (const table of fixture.forbiddenOwnershipWrites) {
      assert.doesNotMatch(providerSource, new RegExp(`(?:INSERT|UPDATE|DELETE)\\s+(?:INTO\\s+|FROM\\s+)?${table}`, "i"));
    }
  });
});
