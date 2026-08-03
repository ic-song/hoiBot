import mariadb, { type Pool, type PoolConnection } from "mariadb";
import type { DatabaseConfig } from "./config.js";

export interface DatabaseClient {
  ping(): Promise<void>;
  verifyRollback(): Promise<boolean>;
  close(): Promise<void>;
}

// MariaDB 연결 풀을 통해 서버 데이터베이스 접근을 관리합니다.
class MariaDatabaseClient implements DatabaseClient {
  readonly #pool: Pool;

  constructor(config: DatabaseConfig) {
    this.#pool = mariadb.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.name,
      connectionLimit: config.connectionLimit,
      connectTimeout: config.connectTimeoutMs,
      acquireTimeout: config.connectTimeoutMs,
      charset: "utf8mb4",
      timezone: "Z",
      bigIntAsNumber: false,
      insertIdAsNumber: false,
      decimalAsNumber: false
    });
  }

  async ping(): Promise<void> {
    const rows = await this.#pool.query<Array<{ connection_ok: number }>>(
      "SELECT 1 AS connection_ok"
    );
    if (Number(rows[0]?.connection_ok) !== 1) {
      throw new Error("MariaDB connection probe returned an unexpected value.");
    }
  }

  async verifyRollback(): Promise<boolean> {
    const connection = await this.#pool.getConnection();
    const probeId = crypto.randomUUID();
    try {
      await connection.beginTransaction();
      await connection.query(
        "INSERT INTO db_connection_probes (probe_id, created_at) VALUES (?, UTC_TIMESTAMP(3))",
        [probeId]
      );
      await connection.rollback();

      const rows = await connection.query<Array<{ probe_count: bigint }>>(
        "SELECT COUNT(*) AS probe_count FROM db_connection_probes WHERE probe_id = ?",
        [probeId]
      );
      return Number(rows[0]?.probe_count ?? 1) === 0;
    } catch (error) {
      await rollbackQuietly(connection);
      throw error;
    } finally {
      connection.release();
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

// 실패 경로에서 열린 트랜잭션을 남기지 않도록 롤백합니다.
async function rollbackQuietly(connection: PoolConnection): Promise<void> {
  try {
    await connection.rollback();
  } catch {
    // 원래 오류를 유지하기 위해 정리 중 롤백 오류는 무시합니다.
  }
}

// 검증된 설정으로 MariaDB 클라이언트를 생성합니다.
export function createDatabaseClient(config: DatabaseConfig): DatabaseClient {
  if (!config.enabled) {
    throw new Error("Cannot create a database client while DATABASE_ENABLED is false.");
  }
  return new MariaDatabaseClient(config);
}
