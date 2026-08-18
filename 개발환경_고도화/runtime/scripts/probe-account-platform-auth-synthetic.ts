import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { AdminManagementService } from "../src/admin/management-service.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { ExternalPlatformAccessService } from "../src/user-auth/external-platform-access-service.js";
import { ProviderVerificationService } from "../src/user-auth/provider-verification-service.js";
import { hashVerificationCode, UserAuthService } from "../src/user-auth/user-auth-service.js";

const ACCOUNT_ID = 910000001n;
const INITIAL_LINK_ID = 910000001n;
const SESSION_ID = 910000001n;
const PLAYER_ID = 900000001n;
const INITIAL_IDENTITY_ID = 900000004n;
const OPERATOR_ID = "900000001";
const SESSION_TOKEN = "synthetic-account-auth-session";
const CSRF_TOKEN = "synthetic-account-auth-csrf";
const LINK_CODE = "AUTH2345";
const RELINK_CODE = "RELK2345";
const LIMIT_CODE = "LIMT2345";
const SECONDARY_EXTERNAL_ID = "synthetic-account-auth-secondary";
const LIMIT_EXTERNAL_ID = "synthetic-account-auth-over-limit";

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function insertChallenge(database: DatabaseClient, accountId: bigint, code: string, pepper: string): Promise<void> {
  await database.execute(
    `INSERT INTO user_verification_challenges
      (public_id, user_account_id, provider_code, purpose_code, code_hint, code_hash, status,
       failed_attempt_count, expires_at, created_at, updated_at)
     VALUES (?, ?, 'kakao', 'account_link', ?, ?, 'pending', 0,
       DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [`synthetic-${code.toLowerCase()}-0000-0000-000000000000`.slice(0, 36), accountId, code.slice(0, 4), hashVerificationCode(code, pepper)]
  );
}

async function readFinalState(database: DatabaseClient): Promise<{
  activeLinks: number;
  targetStatus: string;
  identityStatus: string;
  targetHistory: string[];
  auditCount: number;
  verifiedChallenges: number;
  pendingChallenges: number;
  limitIdentityCount: number;
  maxActiveLinks: number;
}> {
  const rows = await database.query<Array<{
    active_links: bigint;
    target_status: string;
    identity_status: string;
    audit_count: bigint;
    verified_challenges: bigint;
    pending_challenges: bigint;
    limit_identity_count: bigint;
    max_active_links: bigint;
  }>>(
    `SELECT
      (SELECT COUNT(*) FROM user_account_external_identities WHERE user_account_id = ? AND status = 'active') AS active_links,
      (SELECT link.status FROM user_account_external_identities link
        JOIN external_identities identity ON identity.id = link.external_identity_id
        WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?) AS target_status,
      (SELECT status FROM external_identities WHERE provider_code = 'kakao' AND external_user_id = ?) AS identity_status,
      (SELECT COUNT(*) FROM command_audit WHERE actor_type IN ('external_identity', 'user_account', 'admin_operator')
        AND target_type = 'user_account_external_identity') AS audit_count,
      (SELECT COUNT(*) FROM user_verification_challenges WHERE user_account_id = ? AND purpose_code = 'account_link' AND status = 'verified') AS verified_challenges,
      (SELECT COUNT(*) FROM user_verification_challenges WHERE user_account_id = ? AND purpose_code = 'account_link' AND status = 'pending') AS pending_challenges,
      (SELECT COUNT(*) FROM external_identities WHERE provider_code = 'kakao' AND external_user_id = ?) AS limit_identity_count,
      (SELECT value_row.integer_value FROM configuration_sets config
        JOIN configuration_values value_row ON value_row.configuration_set_id = config.id
        WHERE config.set_code = 'site.external_platform' AND config.status = 'active'
          AND value_row.config_key = 'max_active_links' ORDER BY config.version DESC LIMIT 1) AS max_active_links`,
    [ACCOUNT_ID, SECONDARY_EXTERNAL_ID, SECONDARY_EXTERNAL_ID, ACCOUNT_ID, ACCOUNT_ID, LIMIT_EXTERNAL_ID]
  );
  const history = await database.query<Array<{ action_code: string }>>(
    `SELECT history.action_code FROM user_account_external_identity_history history
     JOIN user_account_external_identities link ON link.id = history.link_id
     JOIN external_identities identity ON identity.id = link.external_identity_id
     WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? ORDER BY history.id`,
    [SECONDARY_EXTERNAL_ID]
  );
  const row = rows[0]!;
  return {
    activeLinks: Number(row.active_links),
    targetStatus: row.target_status,
    identityStatus: row.identity_status,
    targetHistory: history.map((entry) => entry.action_code),
    auditCount: Number(row.audit_count),
    verifiedChallenges: Number(row.verified_challenges),
    pendingChallenges: Number(row.pending_challenges),
    limitIdentityCount: Number(row.limit_identity_count),
    maxActiveLinks: Number(row.max_active_links)
  };
}

function assertFinalState(state: Awaited<ReturnType<typeof readFinalState>>): void {
  assert.equal(state.activeLinks, 1);
  assert.equal(state.targetStatus, "blocked");
  assert.equal(state.identityStatus, "blocked");
  assert.deepEqual(state.targetHistory, ["linked", "unlinked", "linked", "blocked"]);
  assert.equal(state.auditCount, 4);
  assert.equal(state.verifiedChallenges, 2);
  assert.equal(state.pendingChallenges, 1);
  assert.equal(state.limitIdentityCount, 0);
  assert.equal(state.maxActiveLinks, 1);
}

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic account platform probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
try {
  if (process.argv.includes("--verify-restart")) {
    const state = await readFinalState(database);
    assertFinalState(state);
    process.stdout.write(`${JSON.stringify({ sliceId: "account-platform-auth", mode: "verify-restart", restartVerification: true, ...state })}\n`);
  } else {
    await database.execute(
      `INSERT INTO user_accounts
        (id, player_id, login_id, password_hash, system_account_name, gender_code, account_type, status, activated_at, created_at, updated_at)
       VALUES (?, ?, 'syntheticauth01', 'synthetic-disabled-password-hash', '합성인증 남', 'male', 'test', 'active',
         UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [ACCOUNT_ID, PLAYER_ID]
    );
    await database.execute(
      `INSERT INTO user_account_external_identities
        (id, user_account_id, external_identity_id, link_purpose_code, status, linked_at, created_at, updated_at)
       VALUES (?, ?, ?, 'signup_link', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [INITIAL_LINK_ID, ACCOUNT_ID, INITIAL_IDENTITY_ID]
    );
    await database.execute(
      `INSERT INTO user_account_external_identity_history
        (link_id, user_account_id, external_identity_id, action_code, actor_type, actor_id, reason, created_at)
       VALUES (?, ?, ?, 'linked', 'system', NULL, '합성 초기 연결', UTC_TIMESTAMP(3))`,
      [INITIAL_LINK_ID, ACCOUNT_ID, INITIAL_IDENTITY_ID]
    );
    await database.execute(
      `INSERT INTO user_sessions
        (id, user_account_id, token_hash, csrf_secret_hash, last_seen_at, idle_expires_at, absolute_expires_at, created_at)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR),
         DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 DAY), UTC_TIMESTAMP(3))`,
      [SESSION_ID, ACCOUNT_ID, hashSecret(SESSION_TOKEN), hashSecret(CSRF_TOKEN)]
    );

    const verifier = new ProviderVerificationService(database, config.userVerificationPepper);
    await insertChallenge(database, ACCOUNT_ID, LINK_CODE, config.userVerificationPepper);
    const linked = await verifier.verifyKakao({
      purpose: "account_link", code: LINK_CODE, externalUserId: SECONDARY_EXTERNAL_ID,
      displayName: "합성추가계정", channelId: "synthetic-account-auth-room"
    });
    assert.equal(linked.playerId, PLAYER_ID.toString());
    assert.equal(await new ExternalPlatformAccessService(database).hasActiveSiteAccount("kakao", SECONDARY_EXTERNAL_ID), true);

    const targetRows = await database.query<Array<{ id: bigint }>>(
      `SELECT link.id FROM user_account_external_identities link JOIN external_identities identity
       ON identity.id = link.external_identity_id WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?`,
      [SECONDARY_EXTERNAL_ID]
    );
    const targetLinkId = targetRows[0]!.id.toString();
    const historyBeforeDuplicate = await database.query<Array<{ total: bigint }>>(
      "SELECT COUNT(*) AS total FROM user_account_external_identity_history WHERE link_id = ?", [targetLinkId]
    );
    await assert.rejects(
      verifier.verifyKakao({ purpose: "account_link", code: LINK_CODE, externalUserId: SECONDARY_EXTERNAL_ID, channelId: "synthetic-account-auth-room" }),
      (error: unknown) => error instanceof ApplicationError && error.code === "VERIFICATION_CODE_INVALID"
    );
    const historyAfterDuplicate = await database.query<Array<{ total: bigint }>>(
      "SELECT COUNT(*) AS total FROM user_account_external_identity_history WHERE link_id = ?", [targetLinkId]
    );
    assert.equal(historyAfterDuplicate[0]!.total, historyBeforeDuplicate[0]!.total);

    const userAuth = new UserAuthService(database, config.userVerificationPepper);
    const unlinked = await userAuth.unlinkExternalLink({
      sessionToken: SESSION_TOKEN, csrfToken: CSRF_TOKEN, linkId: targetLinkId, idempotencyKey: "synthetic-user-unlink-once"
    });
    const replayedUnlink = await userAuth.unlinkExternalLink({
      sessionToken: SESSION_TOKEN, csrfToken: CSRF_TOKEN, linkId: targetLinkId, idempotencyKey: "synthetic-user-unlink-once"
    });
    assert.deepEqual(replayedUnlink, unlinked);

    await insertChallenge(database, ACCOUNT_ID, RELINK_CODE, config.userVerificationPepper);
    await verifier.verifyKakao({
      purpose: "account_link", code: RELINK_CODE, externalUserId: SECONDARY_EXTERNAL_ID,
      displayName: "합성재연결계정", channelId: "synthetic-account-auth-room"
    });

    await database.execute(
      `UPDATE configuration_values value_row JOIN configuration_sets config ON config.id = value_row.configuration_set_id
       SET value_row.integer_value = 1 WHERE config.set_code = 'site.external_platform'
         AND config.status = 'active' AND value_row.config_key = 'max_active_links'`
    );
    await insertChallenge(database, ACCOUNT_ID, LIMIT_CODE, config.userVerificationPepper);
    await assert.rejects(
      verifier.verifyKakao({ purpose: "account_link", code: LIMIT_CODE, externalUserId: LIMIT_EXTERNAL_ID, channelId: "synthetic-account-auth-room" }),
      (error: unknown) => error instanceof ApplicationError && error.code === "EXTERNAL_LINK_LIMIT_REACHED"
    );

    const admin = new AdminManagementService(database);
    const blocked = await admin.changeExternalPlatformLinkStatus({
      operatorId: OPERATOR_ID, idempotencyKey: "synthetic-admin-block-once", reason: "합성 차단 검증",
      linkId: targetLinkId, action: "block"
    });
    const replayedBlock = await admin.changeExternalPlatformLinkStatus({
      operatorId: OPERATOR_ID, idempotencyKey: "synthetic-admin-block-once", reason: "합성 차단 검증",
      linkId: targetLinkId, action: "block"
    });
    assert.deepEqual(replayedBlock, blocked);

    const state = await readFinalState(database);
    assertFinalState(state);
    process.stdout.write(`${JSON.stringify({ sliceId: "account-platform-auth", mode: "prepare", restartVerification: false, ...state })}\n`);
  }
} finally {
  await database.close();
}
