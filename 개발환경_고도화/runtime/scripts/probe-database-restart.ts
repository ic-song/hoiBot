import mariadb from "mariadb";
import { loadConfig } from "../src/config.js";

const PROBE_ID = "hoibot-restart-persistence-probe";
const mode = process.argv[2];
if (mode !== "setup" && mode !== "verify-clean") {
  throw new Error("Usage: probe-database-restart.ts <setup|verify-clean>");
}

const config = loadConfig();
if (!config.database.enabled) {
  throw new Error("DATABASE_ENABLED must be true to probe MariaDB restart persistence.");
}

const connection = await mariadb.createConnection({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
  connectTimeout: config.database.connectTimeoutMs,
  charset: "utf8mb4",
  timezone: "Z"
});

try {
  if (mode === "setup") {
    await connection.query("DELETE FROM db_connection_probes WHERE probe_id = ?", [PROBE_ID]);
    await connection.query(
      "INSERT INTO db_connection_probes (probe_id, created_at) VALUES (?, UTC_TIMESTAMP(3))",
      [PROBE_ID]
    );
    process.stdout.write(JSON.stringify({ probeCreated: true }));
  } else {
    const rows = await connection.query<Array<{ probe_count: bigint }>>(
      "SELECT COUNT(*) AS probe_count FROM db_connection_probes WHERE probe_id = ?",
      [PROBE_ID]
    );
    const persisted = Number(rows[0]?.probe_count ?? 0) === 1;
    await connection.query("DELETE FROM db_connection_probes WHERE probe_id = ?", [PROBE_ID]);
    const afterDelete = await connection.query<Array<{ probe_count: bigint }>>(
      "SELECT COUNT(*) AS probe_count FROM db_connection_probes WHERE probe_id = ?",
      [PROBE_ID]
    );
    process.stdout.write(JSON.stringify({
      persisted,
      cleaned: Number(afterDelete[0]?.probe_count ?? 1) === 0
    }));
  }
} finally {
  await connection.end();
}
