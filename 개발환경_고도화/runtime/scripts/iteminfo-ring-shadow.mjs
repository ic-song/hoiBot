import fs from "node:fs";
import { assertRingDefinitionCatalog } from "../dist/src/catalog/ring-definition-catalog.js";
const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/iteminfo-ring-definitions-v1.json", import.meta.url), "utf8"));
const summary = assertRingDefinitionCatalog(fixture.rows);
console.log(JSON.stringify({ result: "passed", shadowChecks: 6, ...summary, sourceHash: fixture.sourceHash, sourceFileHash: fixture.sourceFileHash }));
