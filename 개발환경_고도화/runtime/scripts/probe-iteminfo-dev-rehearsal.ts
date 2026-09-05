import { readFile } from "node:fs/promises";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { assertItemInfoRehearsalCredentialPath } from "../src/data-migration/iteminfo-dev-rehearsal-environment.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseEnvironment(text: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("ITEMINFO_REHEARSAL_ENV_INVALID");
    result[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return result;
}

const environmentPath = argument("--env");
const afterRollback = process.argv.includes("--after-rollback");
if (environmentPath === undefined) {
  throw new Error("USAGE: --env <absolute-private-env-path>");
}
const exactEnvironmentPath = assertItemInfoRehearsalCredentialPath(environmentPath);
const env = parseEnvironment(await readFile(exactEnvironmentPath, "utf8"));
if (env.DATABASE_HOST !== "127.0.0.1" || env.DATABASE_PORT !== "3308"
  || env.DATABASE_NAME !== "hoibot_rehearsal_iteminfo_20260905a"
  || env.DATABASE_USER !== "iteminfo_r2549") {
  throw new Error("ITEMINFO_REHEARSAL_DB_TARGET_REFUSED");
}

const config = loadConfig({
  ...env,
  NODE_ENV: "test",
  PARTIAL_COMMAND_DISPATCH_ENABLED: "true",
  RAW_PAYLOAD_LOGGING: "false",
  RECENT_EVENTS_ENABLED: "false"
});
const database = createDatabaseClient(config.database);
try {
  const raw = (await database.query<Array<{ files: bigint; bytes: string; content_sha256: string }>>(
    "SELECT COUNT(*) files,CAST(SUM(size_bytes) AS CHAR) bytes,MIN(source_content_sha256) content_sha256 FROM data_migration_raw_files"
  ))[0]!;
  const staging = (await database.query<Array<{ records: bigint; project: string; quarantine: string; ignored: string }>>(
    "SELECT COUNT(*) records,CAST(SUM(projection_status='PROJECT') AS CHAR) project,CAST(SUM(projection_status='QUARANTINE') AS CHAR) quarantine,CAST(SUM(projection_status='IGNORE') AS CHAR) ignored FROM data_migration_common_staging_records"
  ))[0]!;
  const catalog = (await database.query<Array<{ decisions: bigint; project: string; quarantine: string; ignored: string; records: string; projection_sha256: string }>>(
    "SELECT COUNT(*) decisions,CAST(SUM(decision.decision_status='PROJECT') AS CHAR) project,CAST(SUM(decision.decision_status='QUARANTINE') AS CHAR) quarantine,CAST(SUM(decision.decision_status='IGNORE') AS CHAR) ignored,CAST(SUM(decision.projected_row_count) AS CHAR) records,MIN(run.projection_sha256) projection_sha256 FROM data_migration_catalog_source_decisions decision JOIN data_migration_catalog_projection_runs run ON run.catalog_projection_run_id=decision.catalog_projection_run_id"
  ))[0]!;
  const domain = (await database.query<Array<{ decisions: bigint; records: string; canonical_items: string; import_sha256: string }>>(
    "SELECT COUNT(DISTINCT decision.object_domain_import_decision_id) decisions,CAST(COUNT(DISTINCT record.object_domain_import_record_id) AS CHAR) records,CAST((SELECT COUNT(*) FROM canonical_item_definitions) AS CHAR) canonical_items,MIN(run.import_sha256) import_sha256 FROM data_migration_object_domain_import_runs run LEFT JOIN data_migration_object_domain_import_decisions decision ON decision.object_domain_import_run_id=run.object_domain_import_run_id LEFT JOIN data_migration_object_domain_import_records record ON record.object_domain_import_run_id=run.object_domain_import_run_id"
  ))[0]!;

  if (Number(raw.files) !== 1 || raw.bytes !== "31289" || raw.content_sha256 !== "49ef9f7b39ffa5fab57c0d3759f8a682c7be759e4708f76744ae095fc673ffdc") throw new Error("ITEMINFO_REHEARSAL_RAW_PARITY_FAILED");
  if (Number(staging.records) !== 131 || staging.project !== "131" || staging.quarantine !== "0" || staging.ignored !== "0") throw new Error("ITEMINFO_REHEARSAL_STAGING_PARITY_FAILED");
  if (Number(catalog.decisions) !== 131 || catalog.project !== "25" || catalog.quarantine !== "106" || catalog.ignored !== "0" || catalog.records !== "25") throw new Error("ITEMINFO_REHEARSAL_CATALOG_PARITY_FAILED");
  if (!afterRollback && (Number(domain.decisions) !== 131 || domain.records !== "25" || domain.canonical_items !== "25")) throw new Error("ITEMINFO_REHEARSAL_DOMAIN_PARITY_FAILED");
  if (afterRollback && (Number(domain.decisions) !== 0 || domain.records !== "0" || domain.canonical_items !== "0")) throw new Error("ITEMINFO_REHEARSAL_DOMAIN_ROLLBACK_FAILED");

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    raw: { files: Number(raw.files), bytes: Number(raw.bytes), contentSha256: raw.content_sha256 },
    staging: { records: Number(staging.records), project: Number(staging.project), quarantine: Number(staging.quarantine), ignore: Number(staging.ignored) },
    catalog: { decisions: Number(catalog.decisions), project: Number(catalog.project), quarantine: Number(catalog.quarantine), ignore: Number(catalog.ignored), records: Number(catalog.records), projectionSha256: catalog.projection_sha256 },
    domain: { decisions: Number(domain.decisions), records: Number(domain.records), canonicalItems: Number(domain.canonical_items), importSha256: domain.import_sha256 },
    rollback: afterRollback ? { targetRows: 0, decisionReceipts: 0, importRecords: 0, upstreamPreserved: true } : undefined,
    commandCheckpoint: { status: "NOT_ACHIEVED", reason: "APP_DISPATCH_AND_CANONICAL_CONSUMER_GAP", realNetworkCalls: 0 }
  })}\n`);
} finally {
  await database.close();
}
