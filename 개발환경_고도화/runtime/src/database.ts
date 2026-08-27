import mariadb, { type Pool, type PoolConnection, type UpsertResult } from "mariadb";
import type { DatabaseConfig } from "./config.js";

export interface DatabaseClient {
  ping(): Promise<void>;
  verifyRollback(): Promise<boolean>;
  query<T>(sql: string, values?: readonly unknown[]): Promise<T>;
  execute(sql: string, values?: readonly unknown[]): Promise<DatabaseWriteResult>;
  withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface DatabaseWriteResult {
  affectedRows: bigint;
  insertId: bigint;
}

export interface DatabaseTransaction {
  query<T>(sql: string, values?: readonly unknown[]): Promise<T>;
  execute(sql: string, values?: readonly unknown[]): Promise<DatabaseWriteResult>;
}

// 상위 트랜잭션 안에서 기존 provider의 중첩 transaction을 savepoint로 재사용합니다.
export function createScopedDatabaseClient(transaction: DatabaseTransaction): DatabaseClient {
  let savepointSequence = 0;
  return {
    ping: async () => { await transaction.query("SELECT 1"); },
    verifyRollback: async () => true,
    query: <T>(sql: string, values: readonly unknown[] = []) => transaction.query<T>(sql, values),
    execute: (sql: string, values: readonly unknown[] = []) => transaction.execute(sql, values),
    withTransaction: async <T>(work: (nested: DatabaseTransaction) => Promise<T>): Promise<T> => {
      const savepoint = `scoped_provider_${++savepointSequence}`;
      await transaction.execute(`SAVEPOINT ${savepoint}`);
      try {
        const result = await work(transaction);
        await transaction.execute(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        await transaction.execute(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await transaction.execute(`RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      }
    },
    close: async () => undefined
  };
}

// Connector 결과를 서버 내부의 안정적인 쓰기 결과로 변환합니다.
function toWriteResult(result: UpsertResult): DatabaseWriteResult {
  return {
    affectedRows: BigInt(result.affectedRows),
    insertId: BigInt(result.insertId ?? 0)
  };
}

// 풀 또는 트랜잭션 연결에 파라미터 SQL 계약을 제공합니다.
function createQueryExecutor(connection: Pick<PoolConnection, "query">): DatabaseTransaction {
  return {
    query: async <T>(sql: string, values: readonly unknown[] = []) =>
      connection.query(sql, [...values]) as Promise<T>,
    execute: async (sql: string, values: readonly unknown[] = []) =>
      toWriteResult(await connection.query<UpsertResult>(sql, [...values]))
  };
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

  async query<T>(sql: string, values: readonly unknown[] = []): Promise<T> {
    return this.#pool.query(sql, [...values]) as Promise<T>;
  }

  async execute(sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> {
    return toWriteResult(await this.#pool.query<UpsertResult>(sql, [...values]));
  }

  async withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    const connection = await this.#pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(createQueryExecutor(connection));
      await connection.commit();
      return result;
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
