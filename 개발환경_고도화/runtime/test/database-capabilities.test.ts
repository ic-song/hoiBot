import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createConnectionBoundDatabaseCapabilities,
  createScopedDatabaseClient,
  hasDatabaseTransactionCapabilities,
  MariaDatabaseClient,
  type DatabaseClient,
  type DatabaseTransactionCapabilities
} from "../src/database.js";
import type { Pool } from "mariadb";

class SyntheticConnection {
  readonly events: string[] = [];
  failAt: string | undefined;
  alsoFailAt: string | undefined;
  releaseGate: Promise<void> | undefined;

  private failsAt(value: string): boolean {
    return this.failAt === value || this.alsoFailAt === value;
  }

  async query<T>(sql: string, values: readonly unknown[] = []): Promise<T> {
    this.events.push(`query:${sql}:${JSON.stringify(values)}`);
    if (this.failsAt(sql)) throw new Error(`synthetic failure: ${sql}`);
    if (/^(?:INSERT|UPDATE|DELETE)\b/.test(sql)) {
      return { affectedRows: 1, insertId: 2 } as T;
    }
    return [{ value: 1 }] as T;
  }

  async beginTransaction(): Promise<void> {
    this.events.push("begin");
    if (this.failsAt("begin")) throw new Error("synthetic failure: begin");
  }

  async commit(): Promise<void> {
    this.events.push("commit");
    if (this.failsAt("commit")) throw new Error("synthetic failure: commit");
  }

  async rollback(): Promise<void> {
    this.events.push("rollback");
    if (this.failsAt("rollback")) throw new Error("synthetic failure: rollback");
  }

  async release(): Promise<void> {
    this.events.push("release");
    await this.releaseGate;
    if (this.failsAt("release")) throw new Error("synthetic failure: release");
  }
}

function capabilities(connection: SyntheticConnection): DatabaseTransactionCapabilities {
  return createConnectionBoundDatabaseCapabilities(async () => connection);
}

describe("database transaction capabilities", () => {
  function productionAdapter(connection:SyntheticConnection):MariaDatabaseClient{
    const pool={getConnection:async()=>connection} as unknown as Pool;
    return new MariaDatabaseClient({enabled:true,host:"synthetic",port:3306,user:"test",password:"test",name:"test",connectionLimit:1,connectTimeoutMs:1_000},pool);
  }

  it("runs the production consistent root adapter in exact setup, work, commit and release order",async()=>{
    const connection=new SyntheticConnection();
    const result=await productionAdapter(connection).withConsistentRootTransaction(async transaction=>{
      await transaction.query("SELECT value FROM aggregate WHERE id=?",[7]);
      return"ok";
    });
    assert.equal(result,"ok");
    assert.deepEqual(connection.events,[
      "query:SET TRANSACTION ISOLATION LEVEL REPEATABLE READ:[]",
      "query:START TRANSACTION WITH CONSISTENT SNAPSHOT:[]",
      "query:SELECT value FROM aggregate WHERE id=?:[7]",
      "commit",
      "release"
    ]);
  });

  for(const failure of ["SET TRANSACTION ISOLATION LEVEL REPEATABLE READ","START TRANSACTION WITH CONSISTENT SNAPSHOT","work","commit"] as const){
    it(`rolls back and releases the production consistent root adapter after ${failure} failure`,async()=>{
      const connection=new SyntheticConnection();
      if(failure!=="work")connection.failAt=failure;
      await assert.rejects(()=>productionAdapter(connection).withConsistentRootTransaction(async()=>{
        if(failure==="work")throw new Error("synthetic failure: work");
      }),/synthetic failure/);
      assert.deepEqual(connection.events.slice(-2),["rollback","release"]);
      if(failure!=="commit")assert.equal(connection.events.includes("commit"),false);
    });
  }

  it("keeps legacy DatabaseClient fakes valid and detects only the opt-in capability", () => {
    const legacy = {
      ping: async () => undefined,
      verifyRollback: async () => true,
      query: async <T>(): Promise<T> => [] as T,
      execute: async () => ({ affectedRows: 0n, insertId: 0n }),
      withTransaction: async <T>(): Promise<T> => undefined as T,
      close: async () => undefined
    } satisfies DatabaseClient;
    assert.equal(hasDatabaseTransactionCapabilities(legacy), false);
    const extended = Object.assign(legacy, capabilities(new SyntheticConnection()));
    assert.equal(hasDatabaseTransactionCapabilities(extended), true);
  });

  it("opens a repeatable-read consistent read-only snapshot and exposes query only", async () => {
    const connection = new SyntheticConnection();
    const result = await capabilities(connection).withReadOnlySnapshot(async (transaction) => {
      assert.equal("execute" in transaction, false);
      return (await transaction.query<Array<{ value: number }>>("SELECT value FROM catalog WHERE id=?", [7]))[0]!.value;
    });
    assert.equal(result, 1);
    assert.deepEqual(connection.events, [
      "query:SET TRANSACTION ISOLATION LEVEL REPEATABLE READ:[]",
      "query:START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY:[]",
      "query:SELECT value FROM catalog WHERE id=?:[7]",
      "commit",
      "release"
    ]);
  });

  for (const setupFailure of [
    "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
    "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"
  ]) {
    it(`rolls back and releases when read-only setup fails at ${setupFailure}`, async () => {
      const connection = new SyntheticConnection();
      connection.failAt = setupFailure;
      let called = false;
      await assert.rejects(
        () => capabilities(connection).withReadOnlySnapshot(async () => { called = true; }),
        /synthetic failure/
      );
      assert.equal(called, false);
      assert.equal(connection.events.at(-2), "rollback");
      assert.equal(connection.events.at(-1), "release");
      assert.equal(connection.events.includes("commit"), false);
    });
  }

  it("rolls back then releases after read-only work or commit failure", async () => {
    for (const failAt of ["work", "commit"] as const) {
      const connection = new SyntheticConnection();
      if (failAt === "commit") connection.failAt = "commit";
      await assert.rejects(() => capabilities(connection).withReadOnlySnapshot(async () => {
        if (failAt === "work") throw new Error("synthetic failure: work");
        return "ok";
      }), /synthetic failure/);
      assert.deepEqual(connection.events.slice(-3), [failAt === "commit" ? "commit" : "query:START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY:[]", "rollback", "release"]);
    }
  });

  it("uses one controlled connection and keeps savepoint control outside domain execute", async () => {
    const connection = new SyntheticConnection();
    const result = await capabilities(connection).withControlledTransaction(async (transaction) => {
      await transaction.query("SELECT value FROM aggregate FOR UPDATE");
      const scoped = createScopedDatabaseClient(transaction);
      return scoped.withTransaction(async (nested) => {
        const write = await nested.execute("UPDATE aggregate SET value=?", [2]);
        return write.affectedRows;
      });
    });
    assert.equal(result, 1n);
    assert.deepEqual(connection.events, [
      "begin",
      "query:SELECT value FROM aggregate FOR UPDATE:[]",
      "query:SAVEPOINT controlled_provider_1:[]",
      "query:UPDATE aggregate SET value=?:[2]",
      "query:RELEASE SAVEPOINT controlled_provider_1:[]",
      "commit",
      "release"
    ]);
  });

  it("rolls back only the failed savepoint and can commit subsequent controlled work", async () => {
    const connection = new SyntheticConnection();
    await capabilities(connection).withControlledTransaction(async (transaction) => {
      await assert.rejects(() => transaction.withSavepoint(async (nested) => {
        await nested.execute("INSERT INTO child VALUES (?)", [1]);
        throw new Error("child failed");
      }), /child failed/);
      await transaction.execute("UPDATE parent SET value=?", [2]);
    });
    assert.deepEqual(connection.events, [
      "begin",
      "query:SAVEPOINT controlled_provider_1:[]",
      "query:INSERT INTO child VALUES (?):[1]",
      "query:ROLLBACK TO SAVEPOINT controlled_provider_1:[]",
      "query:RELEASE SAVEPOINT controlled_provider_1:[]",
      "query:UPDATE parent SET value=?:[2]",
      "commit",
      "release"
    ]);
  });

  it("rolls back and releases on controlled setup, work, and commit failures", async () => {
    for (const failAt of ["begin", "work", "commit"] as const) {
      const connection = new SyntheticConnection();
      if (failAt !== "work") connection.failAt = failAt;
      await assert.rejects(() => capabilities(connection).withControlledTransaction(async () => {
        if (failAt === "work") throw new Error("synthetic failure: work");
      }), /synthetic failure/);
      assert.deepEqual(connection.events.slice(-2), ["rollback", "release"]);
      if (failAt !== "commit") assert.equal(connection.events.includes("commit"), false);
    }
  });

  it("preserves the original transaction error before a rollback cleanup error", async () => {
    const connection = new SyntheticConnection();
    connection.failAt = "rollback";
    let observed: AggregateError | undefined;
    await assert.rejects(() => capabilities(connection).withControlledTransaction(async () => {
      throw new Error("original work failure");
    }), (error) => { assert.ok(error instanceof AggregateError); observed = error; return true; });
    assert.ok(observed instanceof AggregateError);
    assert.match(String(observed.errors[0]), /original work failure/);
    assert.match(String(observed.errors[1]), /synthetic failure: rollback/);
    assert.deepEqual(connection.events.slice(-2), ["rollback", "release"]);
  });

  it("preserves work then release failures in deterministic AggregateError order", async () => {
    const connection = new SyntheticConnection();
    connection.failAt = "release";
    let observed: AggregateError | undefined;
    await assert.rejects(() => capabilities(connection).withControlledTransaction(async () => {
      throw new Error("original work failure");
    }), (error) => { assert.ok(error instanceof AggregateError); observed = error; return true; });
    assert.ok(observed instanceof AggregateError);
    assert.match(String(observed.errors[0]), /original work failure/);
    assert.match(String(observed.errors[1]), /synthetic failure: release/);
    assert.deepEqual(connection.events.slice(-2), ["rollback", "release"]);
  });

  it("preserves work, rollback, and release failures in lifecycle order", async () => {
    const connection = new SyntheticConnection();
    connection.failAt = "rollback";
    connection.alsoFailAt = "release";
    let observed: AggregateError | undefined;
    await assert.rejects(() => capabilities(connection).withControlledTransaction(async () => {
      throw new Error("original work failure");
    }), (error) => { assert.ok(error instanceof AggregateError); observed = error; return true; });
    assert.ok(observed instanceof AggregateError);
    assert.match(String(observed.errors[0]), /original work failure/);
    assert.match(String(observed.errors[1]), /synthetic failure: rollback/);
    assert.match(String(observed.errors[2]), /synthetic failure: release/);
  });

  it("throws a release failure after otherwise successful work", async () => {
    const connection = new SyntheticConnection();
    connection.failAt = "release";
    await assert.rejects(
      () => capabilities(connection).withControlledTransaction(async () => "ok"),
      /synthetic failure: release/
    );
    assert.deepEqual(connection.events.slice(-3), ["begin", "commit", "release"]);
  });

  it("throws a read-only release failure after otherwise successful work", async () => {
    const connection = new SyntheticConnection();
    connection.failAt = "release";
    await assert.rejects(
      () => capabilities(connection).withReadOnlySnapshot(async () => "ok"),
      /synthetic failure: release/
    );
    assert.deepEqual(connection.events.slice(-2), ["commit", "release"]);
  });

  it("awaits asynchronous connection release before resolving", async () => {
    const connection = new SyntheticConnection();
    let releaseConnection!: () => void;
    connection.releaseGate = new Promise<void>((resolve) => { releaseConnection = resolve; });
    let settled = false;
    const pending = capabilities(connection).withControlledTransaction(async () => "ok")
      .finally(() => { settled = true; });
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    assert.equal(connection.events.at(-1), "release");
    assert.equal(settled, false);
    releaseConnection();
    assert.equal(await pending, "ok");
    assert.equal(settled, true);
  });

  for (const cleanupStatement of [
    "ROLLBACK TO SAVEPOINT controlled_provider_1",
    "RELEASE SAVEPOINT controlled_provider_1"
  ]) {
    it(`preserves domain and savepoint cleanup errors and poisons the outer transaction at ${cleanupStatement}`, async () => {
      const connection = new SyntheticConnection();
      connection.failAt = cleanupStatement;
      let observed: AggregateError | undefined;
      await assert.rejects(
        () => capabilities(connection).withControlledTransaction(async (transaction) => {
          try {
            await transaction.withSavepoint(async () => { throw new Error("domain failure"); });
          } catch (error) {
            assert.ok(error instanceof AggregateError);
            observed = error;
          }
        }),
        /CONTROLLED_SAVEPOINT_CLEANUP_FAILED/
      );
      assert.ok(observed instanceof AggregateError);
      assert.match(String(observed.errors[0]), /domain failure/);
      assert.match(String(observed.errors[1]), /synthetic failure/);
      assert.equal(connection.events.includes("commit"), false);
      assert.deepEqual(connection.events.slice(-2), ["rollback", "release"]);
    });
  }
});
