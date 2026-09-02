import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateObjectDataModelContract, type ObjectDataModelContract } from "../src/catalog/object-data-model-contract.js";

const manifestPath = process.argv[2] ?? path.resolve("../migration-control/contracts/object-data-model-standard.v1.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ObjectDataModelContract;
validateObjectDataModelContract(manifest);
process.stdout.write(`valid object data model contract: ${manifestPath} (${manifest.tables.length} tables)\n`);
