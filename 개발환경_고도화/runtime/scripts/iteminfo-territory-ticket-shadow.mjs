import fs from "node:fs";
import { assertTerritoryTicketCatalog } from "../dist/src/catalog/territory-ticket-catalog.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/iteminfo-territory-tickets-v1.json", import.meta.url), "utf8"));
console.log(JSON.stringify({ result: "passed", shadowChecks: 6, ...assertTerritoryTicketCatalog(fixture.rows), sourceHash: fixture.sourceHash, sourceFileHash: fixture.sourceFileHash }));
