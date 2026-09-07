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

// SHADOW 조회에는 DML 진입점이 없는 transaction capability만 제공합니다.
export interface ReadOnlySnapshotTransaction {
  query<T>(sql: string, values?: readonly unknown[]): Promise<T>;
}

// 공통 claim transaction이 기존 provider의 중첩 transaction을 savepoint로 수용합니다.
export interface ControlledDatabaseTransaction extends DatabaseTransaction {
  withSavepoint<T>(work: (transaction: ControlledDatabaseTransaction) => Promise<T>): Promise<T>;
}

// 기존 DatabaseClient fake를 깨지 않도록 원자 실행 capability를 별도 확장 계약으로 둡니다.
export interface DatabaseTransactionCapabilities {
  withReadOnlySnapshot<T>(work: (transaction: ReadOnlySnapshotTransaction) => Promise<T>): Promise<T>;
  withControlledTransaction<T>(work: (transaction: ControlledDatabaseTransaction) => Promise<T>): Promise<T>;
}

// savepoint 기반 scoped client와 구분되는 새 root transaction 시작 capability입니다.
export interface RootTransactionDatabaseClient extends DatabaseClient {
  withRootTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T>;
}

// 기존 root 의미를 바꾸지 않고 B1 recovery만 repeatable-read consistent snapshot을 요구합니다.
export interface ConsistentRootTransactionDatabaseClient extends DatabaseClient {
  withConsistentRootTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T>;
}

// 이미 열린 transaction을 savepoint 없이 한 번 사용하는 scoped-client capability입니다.
export interface CurrentTransactionDatabaseClient extends DatabaseClient {
  withCurrentTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T>;
}

export function hasRootTransactionCapability(database: DatabaseClient): database is RootTransactionDatabaseClient {
  return typeof (database as Partial<RootTransactionDatabaseClient>).withRootTransaction === "function";
}

export function hasConsistentRootTransactionCapability(database: DatabaseClient): database is ConsistentRootTransactionDatabaseClient {
  return typeof (database as Partial<ConsistentRootTransactionDatabaseClient>).withConsistentRootTransaction === "function";
}

export function hasCurrentTransactionCapability(database: DatabaseClient): database is CurrentTransactionDatabaseClient {
  return typeof (database as Partial<CurrentTransactionDatabaseClient>).withCurrentTransaction === "function";
}

export type CapableDatabaseClient = DatabaseClient & DatabaseTransactionCapabilities;

export function hasDatabaseTransactionCapabilities(database: DatabaseClient): database is CapableDatabaseClient {
  const candidate = database as Partial<DatabaseTransactionCapabilities>;
  return typeof candidate.withReadOnlySnapshot === "function"
    && typeof candidate.withControlledTransaction === "function";
}

interface CapabilityConnection {
  query<T>(sql: string, values?: readonly unknown[]): Promise<T>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void | Promise<void>;
}

// 실제 pool과 합성 connection 테스트가 동일한 transaction 수명주기를 사용합니다.
export function createConnectionBoundDatabaseCapabilities(
  acquireConnection: () => Promise<CapabilityConnection>
): DatabaseTransactionCapabilities {
  return {
    withReadOnlySnapshot: async <T>(work: (transaction: ReadOnlySnapshotTransaction) => Promise<T>): Promise<T> => {
      const connection = await acquireConnection();
      const failures: unknown[] = [];
      let result!: T;
      try {
        await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
        const transaction: ReadOnlySnapshotTransaction = {
          query: <R>(sql: string, values: readonly unknown[] = []) => connection.query<R>(sql, values)
        };
        result = await work(transaction);
        await connection.commit();
      } catch (error) {
        failures.push(error);
        try { await connection.rollback(); } catch (rollbackError) { failures.push(rollbackError); }
      }
      try {
        await connection.release();
      } catch (releaseError) {
        failures.push(releaseError);
      }
      throwCapabilityFailures(failures);
      return result;
    },
    withControlledTransaction: async <T>(work: (transaction: ControlledDatabaseTransaction) => Promise<T>): Promise<T> => {
      const connection = await acquireConnection();
      const failures: unknown[] = [];
      let result!: T;
      try {
        await connection.beginTransaction();
        const controlled = createControlledQueryExecutor(connection);
        result = await work(controlled.transaction);
        controlled.assertUsable();
        await connection.commit();
      } catch (error) {
        failures.push(error);
        try { await connection.rollback(); } catch (rollbackError) { failures.push(rollbackError); }
      }
      try {
        await connection.release();
      } catch (releaseError) {
        failures.push(releaseError);
      }
      throwCapabilityFailures(failures);
      return result;
    }
  };
}

function throwCapabilityFailures(failures: readonly unknown[]): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "DATABASE_TRANSACTION_LIFECYCLE_FAILED");
}

function createControlledQueryExecutor(connection: CapabilityConnection): {
  transaction: ControlledDatabaseTransaction;
  assertUsable(): void;
} {
  let savepointSequence = 0;
  let cleanupFailure: AggregateError | undefined;
  const assertUsable = (): void => {
    if (cleanupFailure !== undefined) throw cleanupFailure;
  };
  const transaction: ControlledDatabaseTransaction = {
    query: <T>(sql: string, values: readonly unknown[] = []) => {
      assertUsable();
      return connection.query<T>(sql, values);
    },
    execute: async (sql: string, values: readonly unknown[] = []) => {
      assertUsable();
      return toWriteResult(await connection.query<UpsertResult>(sql, values));
    },
    withSavepoint: async <T>(work: (nested: ControlledDatabaseTransaction) => Promise<T>): Promise<T> => {
      assertUsable();
      const savepoint = `controlled_provider_${++savepointSequence}`;
      await connection.query(`SAVEPOINT ${savepoint}`);
      try {
        const result = await work(transaction);
        await connection.query(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        const cleanupErrors: unknown[] = [];
        try {
          await connection.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
        try {
          await connection.query(`RELEASE SAVEPOINT ${savepoint}`);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
        if (cleanupErrors.length > 0) {
          cleanupFailure = new AggregateError(
            [error, ...cleanupErrors],
            "CONTROLLED_SAVEPOINT_CLEANUP_FAILED"
          );
          throw cleanupFailure;
        }
        throw error;
      }
    }
  };
  return { transaction, assertUsable };
}

// 상위 트랜잭션 안에서 기존 provider의 중첩 transaction을 savepoint로 재사용합니다.
export function createScopedDatabaseClient(transaction: DatabaseTransaction): DatabaseClient & CurrentTransactionDatabaseClient {
  let savepointSequence = 0;
  return {
    ping: async () => { await transaction.query("SELECT 1"); },
    verifyRollback: async () => true,
    query: <T>(sql: string, values: readonly unknown[] = []) => transaction.query<T>(sql, values),
    execute: (sql: string, values: readonly unknown[] = []) => transaction.execute(sql, values),
    withTransaction: async <T>(work: (nested: DatabaseTransaction) => Promise<T>): Promise<T> => {
      if ("withSavepoint" in transaction && typeof transaction.withSavepoint === "function") {
        return transaction.withSavepoint(work as (nested: ControlledDatabaseTransaction) => Promise<T>);
      }
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
    withCurrentTransaction: <T>(work: (current: DatabaseTransaction) => Promise<T>) => work(transaction),
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
class MariaDatabaseClient implements CapableDatabaseClient, RootTransactionDatabaseClient {
  readonly #pool: Pool;
  readonly #transactionCapabilities: DatabaseTransactionCapabilities;

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
    this.#transactionCapabilities = createConnectionBoundDatabaseCapabilities(
      async () => this.#pool.getConnection() as Promise<CapabilityConnection>
    );
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
      await connection.release();
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
      await connection.release();
    }
  }

  async withRootTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    return this.withTransaction(work);
  }

  async withConsistentRootTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    const connection = await this.#pool.getConnection();
    try {
      await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
      const result = await work(createQueryExecutor(connection));
      await connection.commit();
      return result;
    } catch (error) {
      await rollbackQuietly(connection);
      throw error;
    } finally {
      await connection.release();
    }
  }

  async withReadOnlySnapshot<T>(work: (transaction: ReadOnlySnapshotTransaction) => Promise<T>): Promise<T> {
    return this.#transactionCapabilities.withReadOnlySnapshot(work);
  }

  async withControlledTransaction<T>(work: (transaction: ControlledDatabaseTransaction) => Promise<T>): Promise<T> {
    return this.#transactionCapabilities.withControlledTransaction(work);
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
export function createDatabaseClient(config: DatabaseConfig): CapableDatabaseClient {
  if (!config.enabled) {
    throw new Error("Cannot create a database client while DATABASE_ENABLED is false.");
  }
  return new MariaDatabaseClient(config);
}
