import { readFileSync } from "node:fs";

const statuses = new Set(["investigating", "rehearsal", "ported", "verified", "cutover_ready"]);
const results = new Set(["pending", "passed", "failed"]);

function requireObject(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value;
}

function requireString(value, path) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${path} must be a non-empty string`);
  return value;
}

function requireStringArray(value, path, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${path} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  value.forEach((item, index) => requireString(item, `${path}[${index}]`));
  return value;
}

export function validateEvidence(input) {
  const root = requireObject(input, "evidence");
  if (root.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  requireString(root.sliceId, "sliceId");
  if (!statuses.has(root.status)) throw new Error("status is invalid");

  const commands = requireObject(root.commands, "commands");
  requireStringArray(commands.names, "commands.names");
  requireStringArray(commands.sourceFiles, "commands.sourceFiles");
  requireStringArray(commands.guards, "commands.guards");
  requireStringArray(commands.helpers, "commands.helpers", true);
  requireStringArray(commands.automaticFlows, "commands.automaticFlows", true);

  const legacy = requireObject(root.legacyData, "legacyData");
  requireStringArray(legacy.files, "legacyData.files");
  requireStringArray(legacy.readPaths, "legacyData.readPaths", true);
  requireStringArray(legacy.writePaths, "legacyData.writePaths", true);
  if (typeof legacy.devProdRoutingVerified !== "boolean") throw new Error("legacyData.devProdRoutingVerified must be boolean");

  const database = requireObject(root.database, "database");
  requireStringArray(database.migrations, "database.migrations");
  requireStringArray(database.tables, "database.tables");
  requireStringArray(database.constraints, "database.constraints");
  requireString(database.transactionBoundary, "database.transactionBoundary");

  const trial = requireObject(root.trialMigration, "trialMigration");
  requireString(trial.sourceSnapshot, "trialMigration.sourceSnapshot");
  requireString(trial.targetDatabase, "trialMigration.targetDatabase");
  if (trial.sourceReadOnly !== true) throw new Error("trialMigration.sourceReadOnly must be true");
  requireString(trial.replayPolicy, "trialMigration.replayPolicy");
  requireStringArray(trial.checks, "trialMigration.checks");
  if (!results.has(trial.result)) throw new Error("trialMigration.result is invalid");

  const logic = requireObject(root.logicPort, "logicPort");
  requireStringArray(logic.services, "logicPort.services");
  requireStringArray(logic.repositories, "logicPort.repositories");
  requireStringArray(logic.tests, "logicPort.tests");

  const parity = requireObject(root.parity, "parity");
  requireStringArray(parity.fixtures, "parity.fixtures");
  requireString(parity.comparisonMode, "parity.comparisonMode");
  if (!results.has(parity.result)) throw new Error("parity.result is invalid");

  const cutover = requireObject(root.cutover, "cutover");
  ["freezePlan", "finalImportPlan", "smokePlan", "rollbackPlan"].forEach((key) => requireString(cutover[key], `cutover.${key}`));
  requireStringArray(root.risks, "risks", true);

  if ((root.status === "verified" || root.status === "cutover_ready") && (trial.result !== "passed" || parity.result !== "passed")) {
    throw new Error(`${root.status} requires passed trial migration and parity`);
  }
  if (root.status === "cutover_ready") {
    for (const key of ["freezePlan", "finalImportPlan", "smokePlan", "rollbackPlan"]) {
      if (/^(pending|todo)$/i.test(cutover[key].trim())) throw new Error(`cutover_ready requires a completed ${key}`);
    }
  }
  return root;
}

const selfTestEvidence = {
  schemaVersion: 1,
  sliceId: "self-test",
  status: "investigating",
  commands: { names: ["/test"], sourceFiles: ["main.js"], guards: ["exact"], helpers: [], automaticFlows: [] },
  legacyData: { files: ["data/member.json"], readPaths: [], writePaths: [], devProdRoutingVerified: true },
  database: { migrations: ["001.sql"], tables: ["players"], constraints: ["PK players.id"], transactionBoundary: "read only" },
  trialMigration: { sourceSnapshot: "sha256:test", targetDatabase: "disposable", sourceReadOnly: true, replayPolicy: "idempotent", checks: ["counts derived from source"], result: "pending" },
  logicPort: { services: ["src/service.ts"], repositories: ["src/repository.ts"], tests: ["test/service.test.ts"] },
  parity: { fixtures: ["fixture-1"], comparisonMode: "exact text", result: "pending" },
  cutover: { freezePlan: "pending", finalImportPlan: "pending", smokePlan: "pending", rollbackPlan: "pending" },
  risks: []
};

const argument = process.argv[2];
if (argument === "--self-test") {
  validateEvidence(selfTestEvidence);
  process.stdout.write("self-test passed\n");
} else if (argument) {
  const evidence = JSON.parse(readFileSync(argument, "utf8"));
  validateEvidence(evidence);
  process.stdout.write(`valid slice evidence: ${evidence.sliceId}\n`);
} else {
  process.stderr.write("Usage: node validate-slice-evidence.mjs <evidence.json> | --self-test\n");
  process.exitCode = 2;
}
