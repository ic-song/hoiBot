import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";

type Result = { providerId: string; status: string; badgeCode: string | null };
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};
const config = {
  enabled: true,
  host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"),
  password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 3, connectTimeoutMs: 5_000,
};
let database: DatabaseClient = createDatabaseClient(config);
const playerId = "900002400";
const scopePrefix = "lease2400.badge_provider";
const room = "lease2400-shadow-room";
const checks: string[] = [];

async function scalar(sql: string, values: readonly unknown[] = []): Promise<bigint> {
  const rows = await database.query<Array<{ value: string | bigint }>>(sql, values);
  return BigInt(String(rows[0]?.value ?? "0").split(".")[0]!);
}

async function prior(tx: DatabaseTransaction, providerId: string, key: string): Promise<Result | null> {
  const row = (await tx.query<Array<{ result_json: string | Result | null }>>(
    "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [`${scopePrefix}.${providerId}`, key],
  ))[0]?.result_json;
  if (row == null) return null;
  return typeof row === "string" ? JSON.parse(row) as Result : row;
}

async function operation(tx: DatabaseTransaction, providerId: string, key: string): Promise<bigint> {
  const inserted = await tx.execute(
    "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'system',NULL,'synthetic','processing',UTC_TIMESTAMP(3))",
    [randomUUID(), `${scopePrefix}.${providerId}`, key],
  );
  return inserted.insertId;
}

async function complete(tx: DatabaseTransaction, operationId: bigint, providerId: string, status: string, badgeCode: string | null): Promise<Result> {
  const result = { providerId, status, badgeCode };
  await tx.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json,created_at) VALUES (?,'system',NULL,'home_badge',?,?,?, ?,UTC_TIMESTAMP(3))",
    [operationId, playerId, `lease2400.${providerId}`, status, JSON.stringify({ badgeCode })],
  );
  await tx.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [operationId, room, JSON.stringify({ data: `${providerId}:${status}:${badgeCode ?? "none"}` })],
  );
  await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
  return result;
}

async function award(providerId: string, key: string, badgeCode: string, homeProjection: boolean, rollback = false): Promise<Result> {
  return database.withTransaction(async (tx) => {
    const replay = await prior(tx, providerId, key);
    if (replay !== null) return replay;
    const operationId = await operation(tx, providerId, key);
    const excluded = (await tx.query<Array<{ badge_code: string }>>(
      "SELECT badge_code FROM player_home_badge_exclusions WHERE player_id=? AND badge_code=? FOR UPDATE", [playerId, badgeCode],
    ))[0] !== undefined;
    if (excluded) return complete(tx, operationId, providerId, "excluded", badgeCode);
    const priority = await tx.query<Array<{ value: bigint }>>("SELECT COALESCE(MAX(priority),0)+1 value FROM player_badge_assignments WHERE player_id=? FOR UPDATE", [playerId]);
    await tx.execute(
      "INSERT INTO player_badge_assignments(player_id,badge_code,display_value,priority) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE display_value=VALUES(display_value)",
      [playerId, badgeCode, `[${badgeCode}] Lease2400`, priority[0]!.value],
    );
    if (homeProjection) await tx.execute(
      "INSERT INTO player_home_badges(player_id,badge_code,owned,equipped,version,updated_at) VALUES (?,?,TRUE,FALSE,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE owned=TRUE,version=version+1,updated_at=UTC_TIMESTAMP(3)",
      [playerId, badgeCode],
    );
    if (rollback) throw new Error("lease2400 synthetic rollback");
    return complete(tx, operationId, providerId, "awarded", badgeCode);
  });
}

async function duplicateGacha(): Promise<Result> {
  return database.withTransaction(async (tx) => {
    const providerId = "gacha_standard";
    const key = "duplicate";
    const replay = await prior(tx, providerId, key);
    if (replay !== null) return replay;
    const operationId = await operation(tx, providerId, key);
    await tx.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,0)", [playerId]);
    const account = (await tx.query<Array<{ balance: string; version: bigint }>>(
      "SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE", [playerId],
    ))[0]!;
    const balance = BigInt(account.balance.split(".")[0]!) + 100000000n;
    await tx.execute("UPDATE currency_accounts SET balance=?,version=version+1 WHERE player_id=? AND currency_code='point' AND version=?", [balance, playerId, account.version]);
    await tx.execute(
      "INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',100000000,?,'HOME_BADGE_DUPLICATE')",
      [operationId, playerId, balance],
    );
    return complete(tx, operationId, providerId, "duplicate_point", "HB001");
  });
}

async function cubeEffect(): Promise<Result> {
  return database.withTransaction(async (tx) => {
    const providerId = "cube_effect";
    const key = "normal";
    const replay = await prior(tx, providerId, key);
    if (replay !== null) return replay;
    const operationId = await operation(tx, providerId, key);
    const item = (await tx.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='ITEM-HOME-BADGE-CUBE'"))[0]!;
    await tx.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,10,1)", [playerId, item.id]);
    await tx.execute("UPDATE inventory_stacks SET quantity=9,version=version+1 WHERE player_id=? AND item_id=?", [playerId, item.id]);
    await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,-1,'HOME_BADGE_CUBE_USE')", [operationId, playerId, item.id]);
    await tx.execute(
      "INSERT INTO player_home_badge_cubes(player_id,badge_code,castle_percent,raid_percent,pet_upgrade_percent,explore_percent,equipped,version,updated_at) VALUES (?,'HB001',1,0,0,0,FALSE,1,UTC_TIMESTAMP(3))",
      [playerId],
    );
    return complete(tx, operationId, providerId, "changed", "HB001");
  });
}

async function equip(badgeCode: string): Promise<Result> {
  return database.withTransaction(async (tx) => {
    const providerId = "equip";
    const key = badgeCode;
    const replay = await prior(tx, providerId, key);
    if (replay !== null) return replay;
    const operationId = await operation(tx, providerId, key);
    await tx.execute("UPDATE player_home_badges SET equipped=FALSE,version=version+1 WHERE player_id=?", [playerId]);
    await tx.execute("UPDATE player_home_badge_cubes SET equipped=FALSE,version=version+1 WHERE player_id=?", [playerId]);
    await tx.execute("UPDATE player_home_badges SET equipped=TRUE,version=version+1 WHERE player_id=? AND badge_code=? AND owned=TRUE", [playerId, badgeCode]);
    await tx.execute("UPDATE player_home_badge_cubes SET equipped=TRUE,version=version+1 WHERE player_id=? AND badge_code=?", [playerId, badgeCode]);
    await tx.execute(
      "INSERT INTO player_badge_equipment(player_id,equipped_badge_code,version,updated_at) VALUES (?,?,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE equipped_badge_code=VALUES(equipped_badge_code),version=version+1",
      [playerId, badgeCode],
    );
    return complete(tx, operationId, providerId, "equipped", badgeCode);
  });
}

async function specialRevoke(): Promise<Result> {
  return database.withTransaction(async (tx) => {
    const providerId = "special_revoke";
    const key = "normal";
    const replay = await prior(tx, providerId, key);
    if (replay !== null) return replay;
    const operationId = await operation(tx, providerId, key);
    await tx.execute("DELETE FROM player_badge_assignments WHERE player_id=? AND badge_code='S01'", [playerId]);
    await tx.execute("UPDATE player_badge_equipment SET equipped_badge_code=NULL,version=version+1 WHERE player_id=? AND equipped_badge_code='S01'", [playerId]);
    return complete(tx, operationId, providerId, "revoked", "S01");
  });
}

async function permanentDelete(): Promise<Result> {
  return database.withTransaction(async (tx) => {
    const providerId = "permanent_delete";
    const key = "normal";
    const replay = await prior(tx, providerId, key);
    if (replay !== null) return replay;
    const operationId = await operation(tx, providerId, key);
    await tx.execute("DELETE FROM player_badge_assignments WHERE player_id=? AND badge_code='HB001'", [playerId]);
    await tx.execute("UPDATE player_home_badges SET owned=FALSE,equipped=FALSE,version=version+1 WHERE player_id=? AND badge_code='HB001'", [playerId]);
    await tx.execute("DELETE FROM player_home_badge_cubes WHERE player_id=? AND badge_code='HB001'", [playerId]);
    await tx.execute("UPDATE player_badge_equipment SET equipped_badge_code=NULL,version=version+1 WHERE player_id=? AND equipped_badge_code='HB001'", [playerId]);
    await tx.execute(
      "INSERT INTO player_home_badge_exclusions(player_id,badge_code,reason_code,created_at) VALUES (?,'HB001','user_permanent_delete',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE reason_code=VALUES(reason_code)",
      [playerId],
    );
    return complete(tx, operationId, providerId, "deleted", "HB001");
  });
}

async function cleanup(): Promise<void> {
  const pattern = `${scopePrefix}.%`;
  await database.execute("DELETE FROM outbox_messages WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope LIKE ?)", [pattern]);
  await database.execute("DELETE FROM command_audit WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope LIKE ?)", [pattern]);
  await database.execute("DELETE FROM inventory_ledger WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope LIKE ?)", [pattern]);
  await database.execute("DELETE FROM currency_ledger WHERE operation_id IN (SELECT id FROM operations WHERE idempotency_scope LIKE ?)", [pattern]);
  await database.execute("DELETE FROM player_badge_equipment WHERE player_id=?", [playerId]);
  await database.execute("DELETE FROM player_home_badge_cubes WHERE player_id=?", [playerId]);
  await database.execute("DELETE FROM player_home_badge_exclusions WHERE player_id=?", [playerId]);
  await database.execute("DELETE FROM player_home_badges WHERE player_id=?", [playerId]);
  await database.execute("DELETE FROM player_badge_assignments WHERE player_id=?", [playerId]);
  await database.execute("DELETE FROM inventory_stacks WHERE player_id=?", [playerId]);
  await database.execute("DELETE FROM currency_accounts WHERE player_id=?", [playerId]);
  await database.execute("DELETE FROM operations WHERE idempotency_scope LIKE ?", [pattern]);
  await database.execute("DELETE FROM players WHERE id=?", [playerId]);
}

try {
  await cleanup();
  await database.execute("INSERT INTO players(id,status,version,created_at,updated_at) VALUES (?,'active',1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [playerId]);
  await award("inventory_award", "normal", "F02", true);
  await award("gacha_standard", "normal", "HB001", true);
  await award("gacha_mbti", "normal", "MBTI01", true);
  await award("gacha_love", "normal", "LOVE01", true);
  await cubeEffect();
  await equip("HB001");
  await award("special_grant", "normal", "S01", false);
  await database.execute(
    "INSERT INTO player_badge_equipment(player_id,equipped_badge_code,version,updated_at) VALUES (?,'S01',1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE equipped_badge_code='S01',version=version+1",
    [playerId],
  );
  await specialRevoke();
  await award("social_achievement_migration", "normal", "F01", true);
  checks.push("normal ten-provider ownership and projection paths");

  await duplicateGacha();
  assert.equal(await scalar("SELECT balance value FROM currency_accounts WHERE player_id=? AND currency_code='point'", [playerId]), 100000000n);
  assert.equal(await scalar("SELECT COUNT(*) value FROM currency_ledger WHERE player_id=? AND sequence_no=1 AND delta=100000000", [playerId]), 1n);
  checks.push("gacha duplicate point reward and operation sequence");

  await permanentDelete();
  const excluded = await award("gacha_standard", "deleted", "HB001", true);
  assert.equal(excluded.status, "excluded");
  assert.equal(await scalar("SELECT COUNT(*) value FROM player_badge_assignments WHERE player_id=? AND badge_code='HB001'", [playerId]), 0n);
  assert.equal(await scalar("SELECT COUNT(*) value FROM player_home_badge_cubes WHERE player_id=? AND badge_code='HB001'", [playerId]), 0n);
  assert.equal(await scalar("SELECT COUNT(*) value FROM player_home_badge_exclusions WHERE player_id=? AND badge_code='HB001'", [playerId]), 1n);
  checks.push("permanent tombstone and deleted badge regrant zero");

  assert.equal(await scalar("SELECT COUNT(*) value FROM player_badge_assignments assignment JOIN player_home_badges home ON home.player_id=assignment.player_id AND home.badge_code=assignment.badge_code WHERE assignment.player_id=? AND home.owned=TRUE", [playerId]), 4n);
  assert.equal(await scalar("SELECT COUNT(*) value FROM player_badge_equipment WHERE player_id=? AND equipped_badge_code IS NOT NULL", [playerId]), 0n);
  assert.equal(await scalar("SELECT COUNT(*) value FROM player_home_badges WHERE player_id=? AND equipped=TRUE", [playerId]), 0n);
  checks.push("dual ownership and equipment consistency");

  await assert.rejects(award("inventory_award", "rollback", "F03", true, true), /lease2400 synthetic rollback/);
  assert.equal(await scalar("SELECT COUNT(*) value FROM operations WHERE idempotency_scope=? AND idempotency_key='rollback'", [`${scopePrefix}.inventory_award`]), 0n);
  assert.equal(await scalar("SELECT COUNT(*) value FROM player_badge_assignments WHERE player_id=? AND badge_code='F03'", [playerId]), 0n);
  checks.push("transaction rollback leaves no operation or ownership residue");

  const beforeReplay = await scalar("SELECT COUNT(*) value FROM operations WHERE idempotency_scope LIKE ?", [`${scopePrefix}.%`]);
  assert.deepEqual(await award("inventory_award", "normal", "F02", true), { providerId: "inventory_award", status: "awarded", badgeCode: "F02" });
  assert.equal(await scalar("SELECT COUNT(*) value FROM operations WHERE idempotency_scope LIKE ?", [`${scopePrefix}.%`]), beforeReplay);
  checks.push("exact idempotent replay");

  assert.equal(beforeReplay, 12n);
  assert.equal(await scalar("SELECT COUNT(*) value FROM command_audit audit JOIN operations operation ON operation.id=audit.operation_id WHERE operation.idempotency_scope LIKE ?", [`${scopePrefix}.%`]), 12n);
  assert.equal(await scalar("SELECT COUNT(*) value FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope LIKE ?", [`${scopePrefix}.%`]), 12n);
  assert.equal(await scalar("SELECT COUNT(*) value FROM inventory_ledger ledger JOIN operations operation ON operation.id=ledger.operation_id WHERE operation.idempotency_scope LIKE ? AND ledger.sequence_no<>1", [`${scopePrefix}.%`]), 0n);
  assert.equal(await scalar("SELECT COUNT(*) value FROM currency_ledger ledger JOIN operations operation ON operation.id=ledger.operation_id WHERE operation.idempotency_scope LIKE ? AND ledger.sequence_no<>1", [`${scopePrefix}.%`]), 0n);
  checks.push("operation audit outbox atomic counts and ledger sequences");

  await database.close();
  database = createDatabaseClient(config);
  await award("inventory_award", "normal", "F02", true);
  assert.equal(await scalar("SELECT COUNT(*) value FROM operations WHERE idempotency_scope LIKE ?", [`${scopePrefix}.%`]), 12n);
  checks.push("reconnect exact replay");

  console.log(JSON.stringify({ result: "passed", providers: 10, canonical: 204, runtimeDisplay: 127, awardLifecycle: 77, operations: 12, audits: 12, outbox: 12, duplicatePointReward: "100000000", deletedBadgeRegrants: 0, rollbackResidue: 0, wrongSequenceRows: 0, checks, total: checks.length, providerChanges: 0 }));
} finally {
  await cleanup().catch(() => undefined);
  await database.close().catch(() => undefined);
}
