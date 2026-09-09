import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { classifyPrivateAssetReferenceGaps } from "../src/data-migration/asset-reference-gap-classification.js";
import type { PrivateAssetReferenceGapCrosswalk } from "../src/data-migration/asset-reference-validation.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const input = argument("--input");
const output = argument("--output");
if (!input || !output) throw new Error("USAGE: --input <private-crosswalk> --output <public-summary>");
const privateInput = resolve(input);
const relativeInput = relative(resolve(tmpdir()), privateInput);
if (relativeInput.startsWith("..") || isAbsolute(relativeInput)) throw new Error("PRIVATE_CROSSWALK_INPUT_MUST_BE_TEMP");
const crosswalk = JSON.parse(await readFile(privateInput, "utf8")) as PrivateAssetReferenceGapCrosswalk;
const classification = classifyPrivateAssetReferenceGaps(crosswalk);
const target = resolve(output);
const temporary = `${target}.tmp`;
await mkdir(dirname(target), { recursive: true });
await writeFile(temporary, `${JSON.stringify(classification, null, 2)}\n`, "utf8");
await rename(temporary, target);
process.stdout.write(`${JSON.stringify({ status: "PASS", ...classification })}\n`);
