import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ITEMINFO_REHEARSAL_TEMP_DIRECTORY = "hoibot-iteminfo-rehearsal-lease2549-20260905a";
export const ITEMINFO_REHEARSAL_CREDENTIAL_FILENAME = "rehearsal.env.private";
export const ITEMINFO_REHEARSAL_DATABASE = "hoibot_rehearsal_iteminfo_20260905a";
export const ITEMINFO_REHEARSAL_USER = "iteminfo_r2549";
export const ITEMINFO_REHEARSAL_USER_HOST = "%";
export const ITEMINFO_REHEARSAL_CONTAINER = "hoibot-modernization-mariadb-1";

export function expectedItemInfoRehearsalTempRoot(tempBase = tmpdir()): string {
  return resolve(tempBase, ITEMINFO_REHEARSAL_TEMP_DIRECTORY);
}

export function assertItemInfoRehearsalTempRoot(value: string, tempBase = tmpdir()): string {
  if (!isAbsolute(value)) throw new Error("ITEMINFO_REHEARSAL_ASSET_TARGET_REFUSED");
  const requested = resolve(value);
  if (requested !== expectedItemInfoRehearsalTempRoot(tempBase)) throw new Error("ITEMINFO_REHEARSAL_ASSET_TARGET_REFUSED");
  return requested;
}

export function assertItemInfoRehearsalCredentialPath(value: string, tempBase = tmpdir()): string {
  if (!isAbsolute(value)) throw new Error("ITEMINFO_REHEARSAL_CREDENTIAL_PATH_REFUSED");
  const requested = resolve(value);
  const expected = resolve(expectedItemInfoRehearsalTempRoot(tempBase), ITEMINFO_REHEARSAL_CREDENTIAL_FILENAME);
  if (requested !== expected) throw new Error("ITEMINFO_REHEARSAL_CREDENTIAL_PATH_REFUSED");
  return requested;
}

export function itemInfoProjectionContractPath(): string {
  return fileURLToPath(new URL("../../../migration-control/contracts/object-domain-import-target-schema.v1.json", import.meta.url));
}

export interface MariaAdminResult { status: number | null; stdout: string; }
export interface ItemInfoDatabaseDependencies {
  runMariaAdmin(sql: string): MariaAdminResult;
  writeCredential(path: string, data: string): Promise<void>;
  password(): string;
}

const cleanupSql = `DROP DATABASE IF EXISTS \`${ITEMINFO_REHEARSAL_DATABASE}\`;\nDROP USER IF EXISTS '${ITEMINFO_REHEARSAL_USER}'@'${ITEMINFO_REHEARSAL_USER_HOST}';\nFLUSH PRIVILEGES;\n`;
const verifyCleanupSql = `SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${ITEMINFO_REHEARSAL_DATABASE}';\nSELECT COUNT(*) FROM mysql.user WHERE user='${ITEMINFO_REHEARSAL_USER}' AND host='${ITEMINFO_REHEARSAL_USER_HOST}';\n`;

function assertAdminSuccess(result: MariaAdminResult, code: string): void {
  if (result.status !== 0) throw new Error(code);
}

function verifyAbsent(dependencies: ItemInfoDatabaseDependencies): void {
  const result = dependencies.runMariaAdmin(verifyCleanupSql);
  assertAdminSuccess(result, "ITEMINFO_REHEARSAL_DB_CLEANUP_VERIFY_FAILED");
  if (result.stdout.trim().split(/\s+/).join(",") !== "0,0") throw new Error("ITEMINFO_REHEARSAL_DB_CLEANUP_INCOMPLETE");
}

export async function manageItemInfoRehearsalDatabase(input: { action: "create" | "cleanup"; credentialsPath?: string }, dependencies: ItemInfoDatabaseDependencies): Promise<void> {
  if (input.action === "cleanup") {
    assertAdminSuccess(dependencies.runMariaAdmin(cleanupSql), "ITEMINFO_REHEARSAL_DB_CLEANUP_FAILED");
    verifyAbsent(dependencies);
    return;
  }
  if (input.credentialsPath === undefined) throw new Error("ITEMINFO_REHEARSAL_CREDENTIAL_PATH_REQUIRED");
  const credentialsPath = assertItemInfoRehearsalCredentialPath(input.credentialsPath);
  const password = dependencies.password();
  const createSql = `CREATE DATABASE \`${ITEMINFO_REHEARSAL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\nCREATE USER '${ITEMINFO_REHEARSAL_USER}'@'${ITEMINFO_REHEARSAL_USER_HOST}' IDENTIFIED BY '${password}';\nGRANT ALL PRIVILEGES ON \`${ITEMINFO_REHEARSAL_DATABASE}\`.* TO '${ITEMINFO_REHEARSAL_USER}'@'${ITEMINFO_REHEARSAL_USER_HOST}';\nFLUSH PRIVILEGES;\n`;
  try {
    assertAdminSuccess(dependencies.runMariaAdmin(createSql), "ITEMINFO_REHEARSAL_DB_CREATE_FAILED_COMPENSATED");
    try {
      await dependencies.writeCredential(credentialsPath, [
        "NODE_ENV=test", "DATABASE_ENABLED=true", "DATABASE_HOST=127.0.0.1", "DATABASE_PORT=3308",
        `DATABASE_USER=${ITEMINFO_REHEARSAL_USER}`, `DATABASE_PASSWORD=${password}`, `DATABASE_NAME=${ITEMINFO_REHEARSAL_DATABASE}`,
        "DATABASE_CONNECTION_LIMIT=2", "DATABASE_CONNECT_TIMEOUT_MS=5000", "RAW_PAYLOAD_LOGGING=false",
        "RECENT_EVENTS_ENABLED=false", "IRIS_SHARED_TOKEN=rehearsal-disabled-2549", ""
      ].join("\n"));
    } catch {
      throw new Error("ITEMINFO_REHEARSAL_CREDENTIAL_WRITE_FAILED_COMPENSATED");
    }
  } catch (error) {
    assertAdminSuccess(dependencies.runMariaAdmin(cleanupSql), "ITEMINFO_REHEARSAL_DB_COMPENSATION_FAILED");
    verifyAbsent(dependencies);
    throw error;
  }
}

export const defaultItemInfoDatabaseDependencies = (runMariaAdmin: (sql: string) => MariaAdminResult): ItemInfoDatabaseDependencies => ({
  runMariaAdmin,
  writeCredential: (path, data) => writeFile(path, data, { encoding: "utf8", flag: "wx", mode: 0o600 }),
  password: () => randomBytes(24).toString("hex")
});
