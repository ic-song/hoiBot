import { randomUUID } from "node:crypto";
import { argon2id, hash } from "argon2";
import { AdminManagementService } from "../src/admin/management-service.js";
import { readAuthorization } from "../src/admin/auth-service.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { createInitialPlayer } from "../src/signup/create-initial-player.js";
import { UserAuthService } from "../src/user-auth/user-auth-service.js";
import { AccountCleanupService } from "../src/user-auth/account-cleanup-service.js";

const config = loadConfig();
const database = createDatabaseClient(config.database);
const suffix = randomUUID().slice(0, 8);
const loginId = `auth${suffix}`;
const password = `Probe-${suffix}-Password!`;
const operationKeys = [`operator-${suffix}`, `allow-${suffix}`, `deny-${suffix}`, `pass-${suffix}`, `restrict-${suffix}`, `revoke-${suffix}`];
let operatorId: string | undefined;
let accountId: bigint | undefined;
let playerId: bigint | undefined;

try {
  const admins = await database.query<Array<{ id: bigint }>>(
    `SELECT operator.id FROM admin_operators operator
     JOIN admin_operator_roles operator_role ON operator_role.operator_id = operator.id
     JOIN admin_roles role ON role.id = operator_role.role_id
     WHERE operator.status = 'active' AND role.code = 'super_admin' ORDER BY operator.id LIMIT 1`
  );
  const actorId = admins[0]?.id.toString();
  if (actorId === undefined) throw new Error("An active super administrator is required.");
  const management = new AdminManagementService(database);
  const manager = await management.createOperator({ operatorId: actorId, idempotencyKey: operationKeys[0]!, reason: "authorization probe", loginId: `mgr${suffix}`, displayName: "검증 매니저", password, roleCode: "manager" });
  operatorId = String(manager.operatorId);
  await management.setPermissionOverride({ operatorId: actorId, targetOperatorId: operatorId, permissionCode: "game.currency.change", effect: "allow", remove: false, idempotencyKey: operationKeys[1]!, reason: "authorization probe" });
  await management.setPermissionOverride({ operatorId: actorId, targetOperatorId: operatorId, permissionCode: "player.read", effect: "deny", remove: false, idempotencyKey: operationKeys[2]!, reason: "authorization probe" });
  const authorization = await readAuthorization(database, operatorId);
  let lastSuperAdminProtected = false;
  try { await management.updateOperator({ operatorId: actorId, targetOperatorId: actorId, status: "suspended", idempotencyKey: `last-${suffix}`, reason: "last super administrator probe" }); }
  catch (error) { lastSuperAdminProtected = error instanceof ApplicationError && error.code === "LAST_SUPER_ADMIN"; }
  let superAdminOverrideBlocked = false;
  try { await management.setPermissionOverride({ operatorId: actorId, targetOperatorId: actorId, permissionCode: "player.read", effect: "deny", remove: false, idempotencyKey: `super-override-${suffix}`, reason: "super administrator override probe" }); }
  catch (error) { superAdminOverrideBlocked = error instanceof ApplicationError && error.code === "SUPER_ADMIN_OVERRIDE_FORBIDDEN"; }

  const created = await database.withTransaction(async (transaction) => {
    const createdPlayerId = await createInitialPlayer(transaction, "검권 남", "test-environment");
    const account = await transaction.execute(
      `INSERT INTO user_accounts
        (player_id, login_id, password_hash, system_account_name, gender_code, account_type, status, activated_at, created_at, updated_at)
       VALUES (?, ?, ?, '검권 남', 'male', 'test', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [createdPlayerId, loginId, await hash(password, { type: argon2id })]
    );
    return { accountId: account.insertId, playerId: createdPlayerId };
  });
  accountId = created.accountId; playerId = created.playerId;
  const userAuth = new UserAuthService(database, config.userVerificationPepper, "test");
  const login = await userAuth.login(loginId, password);
  const deletion = await userAuth.requestDeletion(login.sessionToken, login.csrfToken);
  let deletionGraceBlocked = false;
  try { await userAuth.login(loginId, password); }
  catch (error) { deletionGraceBlocked = error instanceof ApplicationError && error.code === "ACCOUNT_DELETION_GRACE"; }
  await userAuth.recoverDeletion(loginId, password);
  let productionTestBlocked = false;
  try { await new UserAuthService(database, config.userVerificationPepper, "production").login(loginId, password); }
  catch (error) { productionTestBlocked = error instanceof ApplicationError && error.code === "TEST_ACCOUNT_FORBIDDEN"; }

  await management.setPass({ operatorId: actorId, playerId: playerId.toString(), passCode: "probe_pass", permanent: true, revoke: false, idempotencyKey: operationKeys[3]!, reason: "authorization probe" });
  const restriction = await management.createRestriction({ operatorId: actorId, playerId: playerId.toString(), restrictionType: "temporary_suspension", endsAt: new Date(Date.now() + 3_600_000).toISOString(), idempotencyKey: operationKeys[4]!, reason: "authorization probe" });
  let suspensionBlocked = false;
  try { await userAuth.login(loginId, password); }
  catch (error) { suspensionBlocked = error instanceof ApplicationError && error.code === "ACCOUNT_UNAVAILABLE"; }
  await management.updateRestriction({ operatorId: actorId, restrictionId: String(restriction.restrictionId), status: "revoked", idempotencyKey: operationKeys[5]!, reason: "authorization probe" });
  const restored = await userAuth.login(loginId, password);
  await userAuth.requestDeletion(restored.sessionToken, restored.csrfToken);
  await database.execute("UPDATE account_deletion_requests SET scheduled_delete_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE user_account_id = ? AND status = 'grace_period'", [accountId]);
  const cleanup = await new AccountCleanupService(database).runDue();
  const deleted = await database.query<Array<{ account_status: string; player_status: string }>>(
    `SELECT account_row.status AS account_status, player.status AS player_status
     FROM user_accounts account_row JOIN players player ON player.id = ? WHERE account_row.id = ?`, [playerId, accountId]
  );
  const permanentCleanup = cleanup.processed === 1 && deleted[0]?.account_status === "deleted" && deleted[0]?.player_status === "deleted";

  process.stdout.write(JSON.stringify({ managerRole: authorization.roleCodes.includes("manager"), allowApplied: authorization.permissions.includes("game.currency.change"), denyApplied: !authorization.permissions.includes("player.read"), lastSuperAdminProtected, superAdminOverrideBlocked, deletionGraceBlocked, recoveredRequest: deletion.requestId !== "", productionTestBlocked, suspensionBlocked, restrictionRecovered: true, permanentPassStored: true, permanentCleanup }) + "\n");
} finally {
  await database.withTransaction(async (transaction) => {
    if (accountId !== undefined) {
      await transaction.execute("DELETE FROM user_sessions WHERE user_account_id = ?", [accountId]);
      await transaction.execute("DELETE cleanup_run FROM account_cleanup_runs cleanup_run JOIN account_deletion_requests deletion ON deletion.id = cleanup_run.deletion_request_id WHERE deletion.user_account_id = ?", [accountId]);
      await transaction.execute("DELETE FROM account_deletion_requests WHERE user_account_id = ?", [accountId]);
      await transaction.execute("DELETE FROM user_accounts WHERE id = ?", [accountId]);
    }
    if (playerId !== undefined) {
      await transaction.execute("DELETE FROM player_pass_admin_history WHERE player_id = ?", [playerId]);
      await transaction.execute("DELETE FROM player_restrictions WHERE player_id = ?", [playerId]);
      await transaction.execute("DELETE FROM player_passes WHERE player_id = ?", [playerId]);
      await transaction.execute("DELETE FROM player_counters WHERE player_id = ?", [playerId]);
      await transaction.execute("DELETE FROM currency_accounts WHERE player_id = ?", [playerId]);
      await transaction.execute("DELETE FROM player_pets WHERE player_id = ?", [playerId]);
      await transaction.execute("DELETE FROM player_profiles WHERE player_id = ?", [playerId]);
      await transaction.execute("DELETE FROM players WHERE id = ?", [playerId]);
    }
    if (operatorId !== undefined) {
      await transaction.execute("DELETE FROM admin_operator_permission_overrides WHERE operator_id = ?", [operatorId]);
      await transaction.execute("DELETE FROM admin_operator_roles WHERE operator_id = ?", [operatorId]);
      await transaction.execute("DELETE FROM admin_operators WHERE id = ?", [operatorId]);
    }
    const operations = await transaction.query<Array<{ id: bigint }>>(`SELECT id FROM operations WHERE idempotency_key IN (${operationKeys.map(() => "?").join(",")})`, operationKeys);
    for (const operation of operations) {
      await transaction.execute("DELETE FROM outbox_messages WHERE operation_id = ?", [operation.id]);
      await transaction.execute("DELETE FROM command_audit WHERE operation_id = ?", [operation.id]);
      await transaction.execute("DELETE FROM operations WHERE id = ?", [operation.id]);
    }
  });
  await database.close();
}
