import { readFile } from "node:fs/promises";
import path from "node:path";

const argumentsList = process.argv.slice(2);
const sourceIndex = argumentsList.indexOf("--source-main");
const sourcePath = sourceIndex >= 0 ? argumentsList[sourceIndex + 1] : undefined;
if (sourcePath === undefined) throw new Error("Usage: inventory-hardcoded-config --source-main <main.js>");

const manifest = JSON.parse(await readFile(path.resolve("config/hardcoded-classification.json"), "utf8")) as {
  entries: Array<{ symbol: string; classification: string }>;
};
const source = await readFile(path.resolve(sourcePath), "utf8");
const results = manifest.entries.map((entry) => ({
  ...entry,
  observed: source.includes(entry.symbol.includes(".") ? entry.symbol.split(".")[1]! : entry.symbol)
}));
const missing = results.filter((entry) => !entry.observed);
process.stdout.write(JSON.stringify({ checked: results.length, observed: results.length - missing.length, missing }, null, 2) + "\n");
if (missing.length > 0) process.exitCode = 2;
