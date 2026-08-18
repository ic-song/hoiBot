import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { ProviderVerificationService } from "../src/user-auth/provider-verification-service.js";
import { UserAuthService } from "../src/user-auth/user-auth-service.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Account platform auth probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const auth = new UserAuthService(database, config.userVerificationPepper);
const verifier = new ProviderVerificationService(database, config.userVerificationPepper);
const stage = process.env.ACCOUNT_AUTH_PROBE_STAGE?.trim() || "prepare";
const loginId = "authprobe01";
const password = "authProbePassword1";
const channelId = "synthetic-room-001";

// 인증 코드의 1회성 실패가 기대한 오류인지 확인합니다.
function isInvalidVerificationCode(error: unknown): boolean {
  return error instanceof ApplicationError
    && error.code === "VERIFICATION_CODE_INVALID"
    && error.statusCode === 422;
}

// 인증 실패가 기대한 애플리케이션 오류 코드인지 확인합니다.
function hasApplicationErrorCode(error: unknown, code: string): boolean {
  return error instanceof ApplicationError && error.code === code;
}

try {
  if (stage === "prepare") {
    const signup = await auth.signup({
      loginId,
      password,
      systemAccountName: "인증 남",
      acceptTerms: true
    });
    assert.equal(signup.verificationCommand, `/가입인증 ${signup.verificationCode}`);
    assert.equal(signup.verificationPurpose, "initial_link");

    const initial = await verifier.verifyKakao({
      purpose: "signup_link",
      code: signup.verificationCode,
      externalUserId: "account-auth-initial",
      displayName: "인증 남",
      channelId
    });
    assert.equal(initial.status, "verified");
    assert.equal(initial.purpose, "signup_link");

    const session = await auth.login(loginId, password);
    const expiredChallenge = await auth.issueExternalLinkCode(session.sessionToken, session.csrfToken);
    await database.execute(
      "UPDATE user_verification_challenges SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE public_id = ?",
      [expiredChallenge.challengeId]
    );
    await assert.rejects(() => verifier.verifyKakao({
      purpose: "account_link",
      code: expiredChallenge.verificationCode,
      externalUserId: "account-auth-expired",
      channelId
    }), (error: unknown) => hasApplicationErrorCode(error, "VERIFICATION_CODE_EXPIRED"));

    const challenge = await auth.issueExternalLinkCode(session.sessionToken, session.csrfToken);
    assert.equal(challenge.purpose, "account_link");
    assert.equal(challenge.verificationCommand, `/계정인증 ${challenge.verificationCode}`);
    assert.equal(challenge.verificationPurpose, "existing_link");
    await assert.rejects(() => verifier.verifyKakao({
      purpose: "signup_link",
      code: challenge.verificationCode,
      externalUserId: "account-auth-purpose-mismatch",
      channelId
    }), isInvalidVerificationCode);

    process.stdout.write(`${JSON.stringify({
      sliceId: "account-platform-auth",
      stage,
      accountId: signup.accountId,
      playerId: initial.playerId,
      challengeId: challenge.challengeId,
      verificationCode: challenge.verificationCode,
      signupCommandContractVerified: true,
      existingLinkCommandContractVerified: true,
      expiredCodeRejected: true,
      purposeMismatchRejected: true
    })}\n`);
  } else if (stage === "verify-after-restart") {
    const verificationCode = process.env.ACCOUNT_AUTH_PROBE_CODE?.trim() ?? "";
    assert.match(verificationCode, /^[A-HJ-NP-Z2-9]{8}$/);

    const linked = await verifier.verifyKakao({
      purpose: "account_link",
      code: verificationCode,
      externalUserId: "account-auth-existing-link",
      displayName: "인증검증 추가",
      channelId
    });
    assert.equal(linked.status, "verified");
    assert.equal(linked.purpose, "account_link");

    const beforeReplay = await database.query<Array<{
      active_links: bigint;
      history_rows: bigint;
      audit_rows: bigint;
      pending_challenges: bigint;
    }>>(
      `SELECT
        (SELECT COUNT(*) FROM user_account_external_identities link
          JOIN user_accounts account_row ON account_row.id = link.user_account_id
          WHERE account_row.login_id = ? AND link.status = 'active') AS active_links,
        (SELECT COUNT(*) FROM user_account_external_identity_history history
          JOIN user_accounts account_row ON account_row.id = history.user_account_id
          WHERE account_row.login_id = ? AND history.action_code = 'linked') AS history_rows,
        (SELECT COUNT(*) FROM command_audit audit_row
          WHERE audit_row.action_code = 'user.external_identity.kakao.link') AS audit_rows,
        (SELECT COUNT(*) FROM user_verification_challenges challenge
          JOIN user_accounts account_row ON account_row.id = challenge.user_account_id
          WHERE account_row.login_id = ? AND challenge.purpose_code = 'account_link'
            AND challenge.status = 'pending') AS pending_challenges`,
      [loginId, loginId, loginId]
    );
    assert.equal(beforeReplay[0]?.active_links, 2n);
    assert.equal(beforeReplay[0]?.history_rows, 2n);
    assert.equal(beforeReplay[0]?.audit_rows, 1n);
    assert.equal(beforeReplay[0]?.pending_challenges, 0n);

    await assert.rejects(() => verifier.verifyKakao({
      purpose: "account_link",
      code: verificationCode,
      externalUserId: "account-auth-existing-link",
      displayName: "인증검증 추가",
      channelId
    }), isInvalidVerificationCode);

    const afterReplay = await database.query<Array<{ active_links: bigint; history_rows: bigint; audit_rows: bigint }>>(
      `SELECT
        (SELECT COUNT(*) FROM user_account_external_identities link
          JOIN user_accounts account_row ON account_row.id = link.user_account_id
          WHERE account_row.login_id = ? AND link.status = 'active') AS active_links,
        (SELECT COUNT(*) FROM user_account_external_identity_history history
          JOIN user_accounts account_row ON account_row.id = history.user_account_id
          WHERE account_row.login_id = ? AND history.action_code = 'linked') AS history_rows,
        (SELECT COUNT(*) FROM command_audit audit_row
          WHERE audit_row.action_code = 'user.external_identity.kakao.link') AS audit_rows`,
      [loginId, loginId]
    );
    assert.deepEqual(afterReplay, beforeReplay.map(({ active_links, history_rows, audit_rows }) => ({
      active_links, history_rows, audit_rows
    })));

    process.stdout.write(`${JSON.stringify({
      sliceId: "account-platform-auth",
      stage,
      playerId: linked.playerId,
      activeLinkCount: beforeReplay[0]?.active_links.toString(),
      linkHistoryCount: beforeReplay[0]?.history_rows.toString(),
      existingLinkAuditCount: beforeReplay[0]?.audit_rows.toString(),
      restartPersistenceVerified: true,
      oneTimeReplayRejectedWithoutMutation: true
    })}\n`);
  } else {
    throw new Error(`Unsupported ACCOUNT_AUTH_PROBE_STAGE: ${stage}`);
  }
} finally {
  await database.close();
}
