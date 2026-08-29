import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
};

const phase = process.env.ACCOUNT_SUSPENSION_PROBE_PHASE ?? "run";
const databaseName = required("DATABASE_NAME");
const tag = databaseName.replace(/[^a-zA-Z0-9]/g, "_").slice(-40);
const token = "admin-account-suspension-probe-token";
const roomId = "990000000000346";
const operatorExternalId = `account-suspension-operator-${tag}`;
const unauthorizedExternalId = `account-suspension-unauthorized-${tag}`;
const operatorName = `정지 관리자 ${tag}`;
const targetName = `정지 대상 ${tag}`;
const concurrentTargetName = `동시 정지 대상 ${tag}`;
const rollbackTargetName = `롤백 정지 대상 ${tag}`;
const suspendEvent = `account-suspension-activate-${tag}`;
const releaseEvent = `account-suspension-release-${tag}`;

const database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
  user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: databaseName, connectionLimit: 8, connectTimeoutMs: 5_000 });

const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "account-suspension-probe-pepper",
  DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
  DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: databaseName });
const replies: Array<{ room: string; data: string }> = [];
const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
  evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });

const send = async (eventId: string, externalUserId: string, message: string) => app.inject({ method: "POST",
  url: `/api/v1/integrations/iris/events?token=${token}`,
  payload: { msg: message, room: "고도화계정정지테스트방", sender: "합성 운영자", json: { _id: eventId, chat_id: roomId, user_id: externalUserId } } });

// 합성 player, 계정, 운영자 identity와 account.restrict 역할을 생성합니다.
async function seedFixtures(): Promise<void> {
  await database.execute(
    `INSERT INTO admin_operators(login_id,display_name,password_hash,status)
     VALUES (?,?, 'synthetic','active')`, [`acct-suspend-${tag}`.slice(0, 64), operatorName]
  );
  await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES (?,?,1)", [`acct_suspend_${tag}`.slice(0, 64), "계정 정지 합성 역할"]);
  const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE display_name=?", [operatorName]))[0]!;
  const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE display_name='계정 정지 합성 역할' ORDER BY id DESC LIMIT 1"))[0]!;
  await database.execute("INSERT INTO admin_role_permissions(role_id,permission_code) VALUES (?,'account.restrict')", [role.id]);
  await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);

  const createPlayer = async (displayName: string, externalUserId?: string): Promise<string> => {
    const created = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [created.insertId, displayName]);
    await database.execute(
      `INSERT INTO user_accounts(player_id,login_id,password_hash,system_account_name,gender_code,account_type,status,activated_at)
       VALUES (?,?, 'synthetic',?,'unknown','test','active',UTC_TIMESTAMP(3))`,
      [created.insertId, `u${created.insertId.toString()}`.slice(0, 20), displayName]
    );
    if (externalUserId !== undefined) {
      await database.execute(
        "INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')",
        [created.insertId, externalUserId, displayName]
      );
    }
    return created.insertId.toString();
  };

  const operatorPlayerId = await createPlayer(operatorName, operatorExternalId);
  const identity = (await database.query<Array<{ id: bigint }>>(
    "SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]
  ))[0]!;
  await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
  await createPlayer("권한 없는 합성 사용자", unauthorizedExternalId);
  await createPlayer(targetName);
  await createPlayer(concurrentTargetName);
  await createPlayer(rollbackTargetName);
  assert.ok(BigInt(operatorPlayerId) > 0n);
}

// 표시명으로 합성 player 상태와 활성 제한 수를 조회합니다.
async function readTargetState(displayName: string): Promise<{ playerId: string; playerStatus: string; accountStatus: string; activeRestrictions: number }> {
  const row = (await database.query<Array<{ player_id: bigint; player_status: string; account_status: string; active_restrictions: bigint }>>(
    `SELECT profile.player_id,player.status AS player_status,account_row.status AS account_status,
       (SELECT COUNT(*) FROM player_restrictions restriction WHERE restriction.player_id=profile.player_id
         AND restriction.status='active' AND (restriction.ends_at IS NULL OR restriction.ends_at>UTC_TIMESTAMP(3))) AS active_restrictions
     FROM player_profiles profile JOIN players player ON player.id=profile.player_id
     JOIN user_accounts account_row ON account_row.player_id=profile.player_id
     WHERE profile.current_display_name=?`, [displayName]
  ))[0]!;
  return { playerId: row.player_id.toString(), playerStatus: row.player_status, accountStatus: row.account_status,
    activeRestrictions: Number(row.active_restrictions) };
}

// 서버 재시작 뒤 같은 event 결과가 재사용되고 추가 mutation이 없는지 확인합니다.
async function verifyRestartReplay(): Promise<void> {
  await database.execute(
    "UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code IN ('ADMIN_ACCOUNT_SUSPENSION_ACTIVATE','ADMIN_ACCOUNT_SUSPENSION_RELEASE','ADMIN_ACCOUNT_SUSPENSION_LIST')"
  );
  const before = (await database.query<Array<{ changes: bigint; operations: bigint }>>(
    `SELECT
       (SELECT COUNT(*) FROM admin_account_suspension_changes) AS changes,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'admin.account_suspension.%') AS operations`
  ))[0]!;
  const response = await send(releaseEvent, operatorExternalId, `/계정정지해제 ${targetName}`);
  assert.equal(response.statusCode, 202);
  const after = (await database.query<Array<{ changes: bigint; operations: bigint }>>(
    `SELECT
       (SELECT COUNT(*) FROM admin_account_suspension_changes) AS changes,
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'admin.account_suspension.%') AS operations`
  ))[0]!;
  assert.deepEqual({ changes: after.changes.toString(), operations: after.operations.toString() },
    { changes: before.changes.toString(), operations: before.operations.toString() });
  const state = await readTargetState(targetName);
  assert.deepEqual({ player: state.playerStatus, account: state.accountStatus, active: state.activeRestrictions },
    { player: "active", account: "active", active: 0 });
  process.stdout.write(`${JSON.stringify({ phase, restartReplay: true, changes: after.changes.toString(), operations: after.operations.toString() })}\n`);
}

// SHADOW, 권한, 정지·목록·해제, replay, 동시성, rollback을 한 합성 시나리오로 검증합니다.
async function run(): Promise<void> {
  if (phase === "verify-restart") {
    await verifyRestartReplay();
    return;
  }
  await seedFixtures();
  await database.execute(
    "UPDATE command_registry SET rollout_state='SHADOW',enabled=1 WHERE command_code IN ('ADMIN_ACCOUNT_SUSPENSION_ACTIVATE','ADMIN_ACCOUNT_SUSPENSION_RELEASE','ADMIN_ACCOUNT_SUSPENSION_LIST')"
  );
  const shadowEvent = `account-suspension-shadow-${tag}`;
  assert.equal((await send(shadowEvent, operatorExternalId, `/계정정지 ${targetName}`)).statusCode, 202);
  let state = await readTargetState(targetName);
  assert.deepEqual({ player: state.playerStatus, account: state.accountStatus, active: state.activeRestrictions },
    { player: "active", account: "active", active: 0 });
  const shadowRoute = (await database.query<Array<{ route: string }>>(
    "SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowEvent}`]
  ))[0]!;
  assert.equal(shadowRoute.route, "SHADOW");

  await database.execute(
    "UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code IN ('ADMIN_ACCOUNT_SUSPENSION_ACTIVATE','ADMIN_ACCOUNT_SUSPENSION_RELEASE','ADMIN_ACCOUNT_SUSPENSION_LIST')"
  );
  assert.equal((await send(suspendEvent, operatorExternalId, `/계정정지 ${targetName}`)).statusCode, 202);
  assert.equal(replies.at(-1)?.data, `⛔ 계정 정지 완료\n[${targetName}] 님의 계정을 정지했습니다.`);
  await send(suspendEvent, operatorExternalId, `/계정정지 ${targetName}`);
  state = await readTargetState(targetName);
  assert.deepEqual({ player: state.playerStatus, account: state.accountStatus, active: state.activeRestrictions },
    { player: "suspended", account: "suspended", active: 1 });
  const replayCount = (await database.query<Array<{ count: bigint }>>(
    "SELECT COUNT(*) AS count FROM admin_account_suspension_changes WHERE player_id=? AND action_code='activate'", [state.playerId]
  ))[0]!;
  assert.equal(Number(replayCount.count), 1);

  const concurrentEvent = `account-suspension-concurrent-${tag}`;
  const concurrentResponses = await Promise.all([
    send(concurrentEvent, operatorExternalId, `/계정정지 ${concurrentTargetName}`),
    send(concurrentEvent, operatorExternalId, `/계정정지 ${concurrentTargetName}`)
  ]);
  assert.ok(concurrentResponses.every((response) => response.statusCode === 202));
  const concurrentState = await readTargetState(concurrentTargetName);
  assert.equal(concurrentState.activeRestrictions, 1);

  const changesBeforeList = (await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM admin_account_suspension_changes"))[0]!.count;
  assert.equal((await send(`account-suspension-list-${tag}`, operatorExternalId, "/계정정지리스트")).statusCode, 202);
  assert.ok(replies.at(-1)?.data.includes(`[${targetName}]`));
  assert.ok(replies.at(-1)?.data.includes(`[${concurrentTargetName}]`));
  const changesAfterList = (await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM admin_account_suspension_changes"))[0]!.count;
  assert.equal(changesAfterList.toString(), changesBeforeList.toString());

  await send(`account-suspension-self-${tag}`, operatorExternalId, `/계정정지 ${operatorName}`);
  assert.equal((await readTargetState(operatorName)).activeRestrictions, 0);
  await send(`account-suspension-forbidden-${tag}`, unauthorizedExternalId, `/계정정지 ${rollbackTargetName}`);
  assert.equal((await readTargetState(rollbackTargetName)).activeRestrictions, 0);

  await database.execute(
    "CREATE TRIGGER synthetic_account_suspension_audit_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'"
  );
  const failed = await send(`account-suspension-rollback-${tag}`, operatorExternalId, `/계정정지 ${rollbackTargetName}`);
  assert.equal(failed.statusCode, 500);
  await database.execute("DROP TRIGGER synthetic_account_suspension_audit_failure");
  const rollbackState = await readTargetState(rollbackTargetName);
  assert.deepEqual({ player: rollbackState.playerStatus, account: rollbackState.accountStatus, active: rollbackState.activeRestrictions },
    { player: "active", account: "active", active: 0 });

  assert.equal((await send(releaseEvent, operatorExternalId, `/계정정지해제 ${targetName}`)).statusCode, 202);
  assert.equal(replies.at(-1)?.data, `✅ 계정 정지 해제 완료\n[${targetName}] 님의 계정 정지를 해제했습니다.`);
  await send(releaseEvent, operatorExternalId, `/계정정지해제 ${targetName}`);
  state = await readTargetState(targetName);
  assert.deepEqual({ player: state.playerStatus, account: state.accountStatus, active: state.activeRestrictions },
    { player: "active", account: "active", active: 0 });
  assert.equal((await send(`account-suspension-release-noop-${tag}`, operatorExternalId, `/계정정지해제 ${targetName}`)).statusCode, 202);
  assert.equal(replies.at(-1)?.data, `ℹ️ [${targetName}] 님은 정지 상태가 아닙니다.`);

  const effects = (await database.query<Array<{ operations: bigint; outboxes: bigint; audits: bigint; executions: bigint; changes: bigint }>>(
    `SELECT
       (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'admin.account_suspension.%') AS operations,
       (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope LIKE 'admin.account_suspension.%') AS outboxes,
       (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id=audit.operation_id WHERE operation.idempotency_scope LIKE 'admin.account_suspension.%') AS audits,
       (SELECT COUNT(*) FROM command_executions WHERE command_code LIKE 'ADMIN_ACCOUNT_SUSPENSION_%') AS executions,
       (SELECT COUNT(*) FROM admin_account_suspension_changes) AS changes`
  ))[0]!;
  assert.equal(effects.operations.toString(), effects.outboxes.toString());
  assert.equal(effects.operations.toString(), effects.audits.toString());
  assert.equal(effects.operations.toString(), effects.executions.toString());
  process.stdout.write(`${JSON.stringify({ phase, shadow: true, suspendReplay: true, concurrentReplay: true, listMutationFree: true,
    unauthorized: true, rollback: true, releaseReplay: true, effects: Object.fromEntries(Object.entries(effects).map(([key, value]) => [key, value.toString()])) })}\n`);
}

try {
  await run();
} finally {
  await app.close();
}
