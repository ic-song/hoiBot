import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { resolveCanonicalCurrencyCode } from "../src/currency/currency-code-scope-resolver.js";

type OwnerScope = "PLAYER" | "GUILD";
type ProviderProbe = { providerId: string; ownerScope: OwnerScope; sourceCode: string; canonicalCode: string; delta: bigint };
type Result = { providerId: string; canonicalCode: string; balance: string; version: string };
const probes: ProviderProbe[] = [
  { providerId: "admin_generic_adjust", ownerScope: "PLAYER", sourceCode: "point", canonicalCode: "point", delta: 5n },
  { providerId: "admin_diamond_adjust", ownerScope: "PLAYER", sourceCode: "diamond", canonicalCode: "diamond", delta: 7n },
  { providerId: "admin_diamond_reset", ownerScope: "PLAYER", sourceCode: "diamond", canonicalCode: "diamond", delta: -7n },
  { providerId: "package_point", ownerScope: "PLAYER", sourceCode: "ITEM-RWD-011", canonicalCode: "point", delta: 3n },
  { providerId: "wallet_rng_point_reward", ownerScope: "PLAYER", sourceCode: "point", canonicalCode: "point", delta: 4n },
  { providerId: "guild_warehouse_diamond", ownerScope: "GUILD", sourceCode: "diamond", canonicalCode: "diamond", delta: 19n },
  { providerId: "guild_warehouse_fund", ownerScope: "GUILD", sourceCode: "guild_fund", canonicalCode: "guild_fund", delta: 11n },
  { providerId: "guild_territory_attack", ownerScope: "GUILD", sourceCode: "POINT", canonicalCode: "guild_fund", delta: 13n },
  { providerId: "guild_territory_finish", ownerScope: "GUILD", sourceCode: "POINT", canonicalCode: "guild_fund", delta: 17n }
];
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};
const config = {
  enabled: true,
  host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"),
  password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 2, connectTimeoutMs: 5_000,
};
let database: DatabaseClient = createDatabaseClient(config);
const playerId = "900002395";
const guildId = "900002395";
const scopePrefix = "lease2395.currency_provider";
const checks: string[] = [];

async function scalar(sql: string, values: readonly unknown[] = []): Promise<bigint> {
  const rows = await database.query<Array<{ value: string | bigint }>>(sql, values);
  return BigInt(String(rows[0]?.value ?? "0").split(".")[0]!);
}

function canonicalCode(probe: ProviderProbe): string {
  if (probe.providerId === "package_point") {
    return resolveCanonicalCurrencyCode({ providerContext: "PACKAGE_POINT", ownerScope: "PLAYER", sourceCode: probe.sourceCode, definitionCode: "ITEM-RWD-011" });
  }
  return probe.ownerScope === "PLAYER"
    ? resolveCanonicalCurrencyCode({ providerContext: "PLAYER_REWARD", ownerScope: "PLAYER", sourceCode: probe.sourceCode })
    : resolveCanonicalCurrencyCode({ providerContext: "GUILD_REWARD", ownerScope: "GUILD", sourceCode: probe.sourceCode });
}

async function cleanup(): Promise<void> {
  await database.execute("DELETE FROM currency_ledger WHERE player_id=?", [playerId]);
  await database.execute("DELETE FROM guild_resource_ledger WHERE guild_id=?", [guildId]);
  await database.execute("DELETE FROM currency_accounts WHERE player_id=?", [playerId]);
  await database.execute("DELETE FROM guild_resource_accounts WHERE guild_id=?", [guildId]);
  await database.execute("DELETE FROM operations WHERE idempotency_scope LIKE ?", [`${scopePrefix}.%`]);
  await database.execute("DELETE FROM guilds WHERE id=?", [guildId]);
  await database.execute("DELETE FROM players WHERE id=?", [playerId]);
}

async function apply(probe: ProviderProbe, key: string, options: { expectedVersion?: bigint; rollback?: boolean } = {}): Promise<Result> {
  const code = canonicalCode(probe);
  assert.equal(code, probe.canonicalCode);
  return database.withTransaction(async (tx) => {
    const scope = `${scopePrefix}.${probe.providerId}`;
    const prior = (await tx.query<Array<{ result_json: string | Result | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]
    ))[0]?.result_json;
    if (prior != null) return typeof prior === "string" ? JSON.parse(prior) as Result : prior;
    const definition = (await tx.query<Array<{ code: string }>>("SELECT code FROM currency_definitions WHERE code=? AND active=TRUE", [code]))[0];
    if (definition === undefined) throw new Error(`CURRENCY_NOT_FOUND:${code}`);
    const accountTable = probe.ownerScope === "PLAYER" ? "currency_accounts" : "guild_resource_accounts";
    const ownerColumn = probe.ownerScope === "PLAYER" ? "player_id" : "guild_id";
    const ownerId = probe.ownerScope === "PLAYER" ? playerId : guildId;
    await tx.execute(`INSERT IGNORE INTO ${accountTable}(${ownerColumn},currency_code,balance,version) VALUES (?,?,0,0)`, [ownerId, code]);
    const account = (await tx.query<Array<{ balance: string; version: bigint }>>(
      `SELECT CAST(balance AS CHAR) balance,version FROM ${accountTable} WHERE ${ownerColumn}=? AND currency_code=? FOR UPDATE`, [ownerId, code]
    ))[0]!;
    if (options.expectedVersion !== undefined && account.version !== options.expectedVersion) throw new Error("CURRENCY_VERSION_CONFLICT");
    const operation = await tx.execute(
      "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'system',NULL,'synthetic','processing',UTC_TIMESTAMP(3))",
      [randomUUID(), scope, key]
    );
    const balance = BigInt(account.balance.split(".")[0]!) + probe.delta;
    const changed = await tx.execute(
      `UPDATE ${accountTable} SET balance=?,version=version+1 WHERE ${ownerColumn}=? AND currency_code=? AND version=?`,
      [balance, ownerId, code, account.version]
    );
    if (changed.affectedRows !== 1n) throw new Error("CURRENCY_VERSION_CONFLICT");
    if (options.rollback) throw new Error("lease2395 synthetic rollback");
    const ledgerTable = probe.ownerScope === "PLAYER" ? "currency_ledger" : "guild_resource_ledger";
    await tx.execute(
      `INSERT INTO ${ledgerTable}(operation_id,sequence_no,${ownerColumn},currency_code,delta,balance_after,reason_code) VALUES (?,1,?,?,?,?,?)`,
      [operation.insertId, ownerId, code, probe.delta, balance, `LEASE2395_${probe.providerId}`]
    );
    const result: Result = { providerId: probe.providerId, canonicalCode: code, balance: balance.toString(), version: (account.version + 1n).toString() };
    await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
    return result;
  });
}

try {
  await cleanup();
  await database.execute("INSERT INTO players(id,status,version,created_at,updated_at) VALUES (?,'active',1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [playerId]);
  await database.execute("INSERT INTO guilds(id,code,display_name,status,version) VALUES (?,'lease2395-guild','Lease2395 Guild','active',1)", [guildId]);
  for (const probe of probes) await apply(probe, "normal");
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM operations WHERE idempotency_scope LIKE ?", [`${scopePrefix}.%`]), 9n);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM currency_ledger WHERE player_id=?", [playerId]), 5n);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM guild_resource_ledger WHERE guild_id=?", [guildId]), 4n);
  checks.push("normal nine-provider canonical account and append-only ledger writes");

  const replayBefore = await scalar("SELECT (SELECT COUNT(*) FROM currency_ledger WHERE player_id=?)+(SELECT COUNT(*) FROM guild_resource_ledger WHERE guild_id=?) AS value", [playerId, guildId]);
  assert.deepEqual(await apply(probes[0]!, "normal"), { providerId: "admin_generic_adjust", canonicalCode: "point", balance: "5", version: "1" });
  assert.equal(await scalar("SELECT (SELECT COUNT(*) FROM currency_ledger WHERE player_id=?)+(SELECT COUNT(*) FROM guild_resource_ledger WHERE guild_id=?) AS value", [playerId, guildId]), replayBefore);
  checks.push("exact replay and namespaced idempotency");

  const missing = { ...probes[0]!, providerId: "not_found", sourceCode: "missing_currency", canonicalCode: "missing_currency" };
  await assert.rejects(apply(missing, "not-found"), /CURRENCY_NOT_FOUND/);
  await assert.rejects(apply(probes[0]!, "version-conflict", { expectedVersion: 999n }), /CURRENCY_VERSION_CONFLICT/);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM operations WHERE idempotency_key IN ('not-found','version-conflict')"), 0n);
  checks.push("not-found and optimistic version conflict rollback");

  const pointBeforeRollback = await scalar("SELECT balance AS value FROM currency_accounts WHERE player_id=? AND currency_code='point'", [playerId]);
  await assert.rejects(apply(probes[3]!, "rollback", { rollback: true }), /lease2395 synthetic rollback/);
  assert.equal(await scalar("SELECT balance AS value FROM currency_accounts WHERE player_id=? AND currency_code='point'", [playerId]), pointBeforeRollback);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM operations WHERE idempotency_key='rollback'"), 0n);
  checks.push("transaction rollback after versioned account update");

  assert.equal(await scalar("SELECT version AS value FROM currency_accounts WHERE player_id=? AND currency_code='point'", [playerId]), 3n);
  assert.equal(await scalar("SELECT version AS value FROM currency_accounts WHERE player_id=? AND currency_code='diamond'", [playerId]), 2n);
  assert.equal(await scalar("SELECT version AS value FROM guild_resource_accounts WHERE guild_id=? AND currency_code='diamond'", [guildId]), 1n);
  assert.equal(await scalar("SELECT version AS value FROM guild_resource_accounts WHERE guild_id=? AND currency_code='guild_fund'", [guildId]), 3n);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM currency_ledger WHERE player_id=? AND sequence_no<>1", [playerId]), 0n);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM guild_resource_ledger WHERE guild_id=? AND sequence_no<>1", [guildId]), 0n);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM currency_accounts WHERE player_id=? AND balance<>TRUNCATE(balance,0)", [playerId]), 0n);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM guild_resource_accounts WHERE guild_id=? AND balance<>TRUNCATE(balance,0)", [guildId]), 0n);
  checks.push("account versions, operation sequence and effective integer unit");

  assert.equal(await scalar("SELECT COUNT(*) AS value FROM currency_accounts WHERE player_id=? AND currency_code IN ('POINT','guild_fund','ITEM-RWD-011')", [playerId]), 0n);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM guild_resource_accounts WHERE guild_id=? AND currency_code='POINT'", [guildId]), 0n);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM currency_definitions WHERE code IN ('point','diamond','guild_fund') AND active=TRUE"), 3n);
  checks.push("raw uppercase, global alias and wrong owner writes zero");

  await database.close();
  database = createDatabaseClient(config);
  await apply(probes[0]!, "normal");
  assert.equal(await scalar("SELECT (SELECT COUNT(*) FROM currency_ledger WHERE player_id=?)+(SELECT COUNT(*) FROM guild_resource_ledger WHERE guild_id=?) AS value", [playerId, guildId]), replayBefore);
  checks.push("reconnect exact replay");

  console.log(JSON.stringify({ result: "passed", providers: 9, canonicalDefinitions: 3, checks, total: checks.length, rawUppercaseWrites: 0, wrongAccountWrites: 0, providerChanges: 0 }));
} finally {
  await cleanup().catch(() => undefined);
  await database.close().catch(() => undefined);
}
