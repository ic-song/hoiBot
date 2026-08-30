import fs from "node:fs";
import { assertCastleUnitCatalog } from "../dist/src/catalog/castle-unit-catalog.js";

const fixture=JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/iteminfo-castle-units-v1.json",import.meta.url),"utf8"));
console.log(JSON.stringify({result:"passed",shadowChecks:10,...assertCastleUnitCatalog(fixture.rows),sourceHash:fixture.sourceHash,sourceFileHash:fixture.sourceFileHash}));
