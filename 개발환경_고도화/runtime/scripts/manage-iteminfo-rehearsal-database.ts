import { spawnSync } from "node:child_process";
import { defaultItemInfoDatabaseDependencies, ITEMINFO_REHEARSAL_CONTAINER, ITEMINFO_REHEARSAL_DATABASE, ITEMINFO_REHEARSAL_USER, manageItemInfoRehearsalDatabase } from "../src/data-migration/iteminfo-dev-rehearsal-environment.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const action = argument("--action");
const container = argument("--container") ?? ITEMINFO_REHEARSAL_CONTAINER;
const database = argument("--database") ?? ITEMINFO_REHEARSAL_DATABASE;
const user = argument("--user") ?? ITEMINFO_REHEARSAL_USER;
const credentialsPathArgument = argument("--credentials-out");
if (action !== "create" && action !== "cleanup") throw new Error("USAGE: --action create|cleanup [--credentials-out <task-temp-path>]");
if (container !== ITEMINFO_REHEARSAL_CONTAINER) throw new Error("ITEMINFO_REHEARSAL_CONTAINER_REFUSED");
if (database !== ITEMINFO_REHEARSAL_DATABASE || user !== ITEMINFO_REHEARSAL_USER) throw new Error("ITEMINFO_REHEARSAL_DB_TARGET_REFUSED");

const runMariaAdmin = (sql: string) => {
  const result = spawnSync("docker", ["exec", "-i", container, "sh", "-lc", 'mariadb -N -uroot -p"$MARIADB_ROOT_PASSWORD"'], { input: sql, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout };
};
await manageItemInfoRehearsalDatabase({ action, credentialsPath: credentialsPathArgument }, defaultItemInfoDatabaseDependencies(runMariaAdmin));
process.stdout.write(`${JSON.stringify({ status: action === "create" ? "CREATED" : "CLEANED", container, database, user, credentialWritten: action === "create" })}\n`);
