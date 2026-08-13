import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import mariadb from "mariadb";
import { loadConfig } from "../src/config.js";

const config = loadConfig();
if (!config.database.enabled) {
  throw new Error("DATABASE_ENABLED must be true to run migrations.");
}

const connection = await mariadb.createConnection({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
  connectTimeout: config.database.connectTimeoutMs,
  charset: "utf8mb4",
  timezone: "Z",
  multipleStatements: true,
  bigIntAsNumber: false
});

try {
  const lockRows = await connection.query<Array<{ acquired: number }>>(
    "SELECT GET_LOCK('hoibot_schema_migrations', 10) AS acquired"
  );
  if (Number(lockRows[0]?.acquired) !== 1) {
    throw new Error("Could not acquire the MariaDB migration lock.");
  }

  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(128) NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME(3) NOT NULL,
      PRIMARY KEY (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const migrationsDirectory = path.resolve("migrations");
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/i.test(file))
    .sort();

  for (const file of migrationFiles) {
    const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await connection.query<Array<{ checksum: string }>>(
      "SELECT checksum FROM schema_migrations WHERE version = ?",
      [file]
    );

    if (existing.length > 0) {
      if (existing[0]?.checksum !== checksum) {
        throw new Error(`Migration checksum mismatch: ${file}`);
      }
      continue;
    }

    await connection.query(sql);
    await connection.query(
      "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, UTC_TIMESTAMP(3))",
      [file, checksum]
    );
    process.stdout.write(`applied ${file}\n`);
  }

  process.stdout.write(`migration-count ${migrationFiles.length}\n`);
} finally {
  try {
    await connection.query("SELECT RELEASE_LOCK('hoibot_schema_migrations')");
  } finally {
    await connection.end();
  }
}
