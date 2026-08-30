import fs from "node:fs";
import { assertRaidItemBonusCatalog } from "../dist/src/catalog/raid-item-bonus-catalog.js";
const fixture=JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/iteminfo-raid-definitions-v1.json",import.meta.url),"utf8"));
console.log(JSON.stringify({result:"passed",shadowChecks:6,...assertRaidItemBonusCatalog(fixture.rows),sourceHash:fixture.sourceHash,sourceFileHash:fixture.sourceFileHash}));