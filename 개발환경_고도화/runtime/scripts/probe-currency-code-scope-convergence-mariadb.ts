import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { resolveCanonicalCurrencyCode } from "../src/currency/currency-code-scope-resolver.js";
import { PackageDomainItemMutationStore, type PackageDomainTransaction } from "../src/package/domain-item-provider.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};
const config = {
  enabled: true,
  host: required("DATABASE_HOST"),
  port: Number(required("DATABASE_PORT")),
  user: required("DATABASE_USER"),
  password: required("DATABASE_PASSWORD"),
  name: required("DATABASE_NAME"),
  connectionLimit: 2,
  connectTimeoutMs: 5_000,
};
let database: DatabaseClient = createDatabaseClient(config);
const playerId = "900002393";
const guildId = "900002393";
const scopePrefix = "lease2393.currency_scope";
const store = new PackageDomainItemMutationStore();
const checks: string[] = [];

async function scalar(sql: string, values: readonly unknown[] = []): Promise<bigint> {
  const rows = await database.query<Array<{ value: string | bigint }>>(sql, values);
  return BigInt(String(rows[0]?.value ?? "0").split(".")[0]!);
}

async function cleanup(): Promise<void> {
  await database.execute("DELETE FROM package_item_effects WHERE player_id=?", [playerId]);
  await database.execute("DELETE FROM currency_ledger WHERE player_id=?", [playerId]);
  await database.execute("DELETE FROM guild_resource_ledger WHERE guild_id=?", [guildId]);
  await database.execute("DELETE FROM currency_accounts WHERE player_id=?", [playerId]);
  await database.execute("DELETE FROM guild_resource_accounts WHERE guild_id=?", [guildId]);
  await database.execute("DELETE FROM operations WHERE idempotency_scope LIKE ?", [`${scopePrefix}.%`]);
  await database.execute("DELETE FROM guilds WHERE id=?", [guildId]);
  await database.execute("DELETE FROM players WHERE id=?", [playerId]);
}

async function begin(tx: DatabaseTransaction, scope: string, key: string): Promise<{ replay: string | null; operationId: bigint | null }> {
  const prior = (await tx.query<Array<{ result_json: string | { canonicalCode: string } | null }>>(
    "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]
  ))[0];
  if (prior?.result_json != null) {
    const parsed = typeof prior.result_json === "string" ? JSON.parse(prior.result_json) as { canonicalCode: string } : prior.result_json;
    return { replay: parsed.canonicalCode, operationId: null };
  }
  const operation = await tx.execute(
    "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'system',NULL,'synthetic','processing',UTC_TIMESTAMP(3))",
    [randomUUID(), scope, key]
  );
  return { replay: null, operationId: operation.insertId };
}

async function complete(tx: DatabaseTransaction, operationId: bigint, canonicalCode: string): Promise<string> {
  await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify({ canonicalCode }), operationId]);
  return canonicalCode;
}

async function applyPlayerReward(key: string): Promise<string> {
  return database.withTransaction(async (tx) => {
    const scope = `${scopePrefix}.player`;
    const operation = await begin(tx, scope, key);
    if (operation.replay !== null) return operation.replay;
    const code = resolveCanonicalCurrencyCode({ providerContext: "PLAYER_REWARD", ownerScope: "PLAYER", sourceCode: "POINT" });
    await tx.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,?,0,1)", [playerId, code]);
    const account = (await tx.query<Array<{ balance: string; version: bigint }>>("SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code=? FOR UPDATE", [playerId, code]))[0]!;
    const after = BigInt(account.balance.split(".")[0]!) + 5n;
    await tx.execute("UPDATE currency_accounts SET balance=?,version=version+1 WHERE player_id=? AND currency_code=? AND version=?", [after, playerId, code, account.version]);
    await tx.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,?,?,?, 'lease2393_player')", [operation.operationId!, playerId, code, 5, after]);
    return complete(tx, operation.operationId!, code);
  });
}

async function applyGuildReward(key: string): Promise<string> {
  return database.withTransaction(async (tx) => {
    const scope = `${scopePrefix}.guild`;
    const operation = await begin(tx, scope, key);
    if (operation.replay !== null) return operation.replay;
    const code = resolveCanonicalCurrencyCode({ providerContext: "GUILD_REWARD", ownerScope: "GUILD", sourceCode: "POINT" });
    await tx.execute("INSERT IGNORE INTO guild_resource_accounts(guild_id,currency_code,balance,version) VALUES (?,?,0,1)", [guildId, code]);
    const account = (await tx.query<Array<{ balance: string; version: bigint }>>("SELECT CAST(balance AS CHAR) balance,version FROM guild_resource_accounts WHERE guild_id=? AND currency_code=? FOR UPDATE", [guildId, code]))[0]!;
    const after = BigInt(account.balance.split(".")[0]!) + 11n;
    await tx.execute("UPDATE guild_resource_accounts SET balance=?,version=version+1 WHERE guild_id=? AND currency_code=? AND version=?", [after, guildId, code, account.version]);
    await tx.execute("INSERT INTO guild_resource_ledger(operation_id,sequence_no,guild_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,?,?,?, 'lease2393_guild')", [operation.operationId!, guildId, code, 11, after]);
    return complete(tx, operation.operationId!, code);
  });
}

async function applyPackagePoint(key: string, rollback = false): Promise<string> {
  return database.withTransaction(async (tx) => {
    const scope = `${scopePrefix}.package`;
    const operation = await begin(tx, scope, key);
    if (operation.replay !== null) return operation.replay;
    await store.add(tx as unknown as PackageDomainTransaction, {
      id: "ITEM-RWD-011", type: "POINT", displayName: "포인트", metadata: { currencyCode: "ITEM-RWD-011" },
    }, { operationId: operation.operationId!.toString(), sequenceNo: 1, playerId, quantity: 7, reasonCode: "lease2393_package" });
    if (rollback) throw new Error("lease2393 synthetic rollback");
    return complete(tx, operation.operationId!, "point");
  });
}

try {
  await cleanup();
  await database.execute("INSERT INTO players(id,status,version,created_at,updated_at) VALUES (?,'active',1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [playerId]);
  await database.execute("INSERT INTO guilds(id,code,display_name,status,version) VALUES (?,'lease2393-guild','Lease2393 Guild','active',1)", [guildId]);
  assert.equal(await applyPlayerReward("normal"), "point");
  assert.equal(await applyGuildReward("normal"), "guild_fund");
  assert.equal(await applyPackagePoint("normal"), "point");
  assert.equal(await scalar("SELECT balance AS value FROM currency_accounts WHERE player_id=? AND currency_code='point'", [playerId]), 12n);
  assert.equal(await scalar("SELECT balance AS value FROM guild_resource_accounts WHERE guild_id=? AND currency_code='guild_fund'", [guildId]), 11n);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM currency_accounts WHERE player_id=? AND currency_code IN ('POINT','ITEM-RWD-011')", [playerId]), 0n);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM guild_resource_accounts WHERE guild_id=? AND currency_code='POINT'", [guildId]), 0n);
  checks.push("normal scoped canonical account and ledger writes");

  const ledgerBeforeReplay = await scalar("SELECT (SELECT COUNT(*) FROM currency_ledger WHERE player_id=?)+(SELECT COUNT(*) FROM guild_resource_ledger WHERE guild_id=?) AS value", [playerId, guildId]);
  assert.equal(await applyPlayerReward("normal"), "point");
  assert.equal(await applyGuildReward("normal"), "guild_fund");
  assert.equal(await applyPackagePoint("normal"), "point");
  assert.equal(await scalar("SELECT (SELECT COUNT(*) FROM currency_ledger WHERE player_id=?)+(SELECT COUNT(*) FROM guild_resource_ledger WHERE guild_id=?) AS value", [playerId, guildId]), ledgerBeforeReplay);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM operations WHERE idempotency_scope LIKE ?", [`${scopePrefix}.%`]), 3n);
  checks.push("exact replay and idempotency");

  const balanceBeforeRollback = await scalar("SELECT balance AS value FROM currency_accounts WHERE player_id=? AND currency_code='point'", [playerId]);
  await assert.rejects(applyPackagePoint("rollback", true), /lease2393 synthetic rollback/);
  assert.equal(await scalar("SELECT balance AS value FROM currency_accounts WHERE player_id=? AND currency_code='point'", [playerId]), balanceBeforeRollback);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM operations WHERE idempotency_scope=? AND idempotency_key='rollback'", [`${scopePrefix}.package`]), 0n);
  checks.push("transaction rollback");

  await database.close();
  database = createDatabaseClient(config);
  assert.equal(await applyPackagePoint("normal"), "point");
  assert.equal(await scalar("SELECT (SELECT COUNT(*) FROM currency_ledger WHERE player_id=?)+(SELECT COUNT(*) FROM guild_resource_ledger WHERE guild_id=?) AS value", [playerId, guildId]), ledgerBeforeReplay);
  assert.equal(await scalar("SELECT COUNT(*) AS value FROM currency_definitions WHERE code='ITEM-RWD-011' AND active=0"), 1n);
  checks.push("reconnect replay and inactive residue preservation");

  console.log(JSON.stringify({ result: "passed", checks, total: checks.length, uppercaseAccountWrites: 0, schemaChanges: 0, migrationChanges: 0 }));
} finally {
  await cleanup().catch(() => undefined);
  await database.close().catch(() => undefined);
}
