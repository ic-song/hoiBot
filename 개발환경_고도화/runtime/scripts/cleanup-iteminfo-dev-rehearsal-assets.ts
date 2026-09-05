import { rm } from "node:fs/promises";
import { assertItemInfoRehearsalTempRoot } from "../src/data-migration/iteminfo-dev-rehearsal-environment.js";

const requested = assertItemInfoRehearsalTempRoot(process.argv[2] ?? "");
await rm(requested, { recursive: true, force: false });
process.stdout.write(`${JSON.stringify({ status: "CLEANED", target: "lease2549-private-assets" })}\n`);
