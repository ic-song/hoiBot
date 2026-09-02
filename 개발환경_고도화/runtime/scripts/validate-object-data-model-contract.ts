import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateObjectDataModelContract, type ObjectDataModelContract } from "../src/catalog/object-data-model-contract.js";

const manifestPath = process.argv[2] ?? path.resolve("../migration-control/contracts/object-data-model-standard.v1.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ObjectDataModelContract;
validateObjectDataModelContract(manifest);
const evidence = manifest.tables.length === 0 ? "등록 대상 없음; 신규 schema compliance 증거 아님" : `등록 대상 ${manifest.tables.length}개`;
process.stdout.write(`valid object data model contract: ${manifestPath} (${evidence})\n`);
