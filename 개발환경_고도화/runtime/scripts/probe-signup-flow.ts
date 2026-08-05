import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { ProcessIrisEventService } from "../src/integration/event-processing-service.js";
import { normalizeIrisEvent } from "../src/integration/iris-normalizer.js";
import { SignupService } from "../src/signup/signup-service.js";
import { UserAuthService } from "../src/user-auth/user-auth-service.js";
import { ProviderVerificationService } from "../src/user-auth/provider-verification-service.js";

const config = loadConfig();
if (!config.database.enabled || !config.database.name.startsWith("hoibot_import_verify_")) {
  throw new Error("Signup probe is allowed only in a disposable hoibot_import_verify_* database.");
}

const database = createDatabaseClient(config.database);
const eventProcessor = new ProcessIrisEventService(database);
const signupService = new SignupService(database);
const suffix = Date.now().toString().slice(-8);
const channelId = `signup-probe-room-${suffix}`;

// 실제 Iris inbox·identity 관측을 거친 가입 명령 입력을 생성합니다.
async function prepareCommand(message: string, userId: string, displayName: string) {
  const event = normalizeIrisEvent({
    msg: message,
    sender: displayName,
    json: {
      id: randomUUID(),
      chat_id: channelId,
      user_id: userId,
      type: 1,
      origin: "MSG",
      v: JSON.stringify({ isMine: false })
    }
  });
  const processing = await eventProcessor.execute(event);
  assert.equal(processing.duplicate, false);
  return {
    event,
    input: {
      externalUserId: userId,
      displayName,
      channelId,
      message,
      eventId: event.eventId
    }
  };
}

try {
  const acceptedUserId = `signup-probe-accepted-${suffix}`;
  const acceptedName = `가입검증${suffix} 남`;
  const requested = await prepareCommand("/가입", acceptedUserId, acceptedName);
  const pending = await signupService.handle(requested.input);
  assert.equal(pending.status, "pending");
  assert.match(pending.data, /\[시작한다\]/);

  const acceptedCommand = await prepareCommand("/시작한다", acceptedUserId, acceptedName);
  const accepted = await signupService.handle(acceptedCommand.input);
  assert.equal(accepted.status, "accepted");
  assert.ok(accepted.playerId);

  const acceptedRows = await database.query<Array<{
    player_count: bigint;
    profile_count: bigint;
    pet_count: bigint;
    currency_count: bigint;
    counter_count: bigint;
    linked_count: bigint;
    accepted_count: bigint;
  }>>(
    `SELECT
      (SELECT COUNT(*) FROM players WHERE id = ?) AS player_count,
      (SELECT COUNT(*) FROM player_profiles WHERE player_id = ? AND terms_agreed = TRUE AND level = 1 AND rebirth_count = 1) AS profile_count,
      (SELECT COUNT(*) FROM player_pets WHERE player_id = ?) AS pet_count,
      (SELECT COUNT(*) FROM currency_accounts WHERE player_id = ?) AS currency_count,
      (SELECT COUNT(*) FROM player_counters WHERE player_id = ?) AS counter_count,
      (SELECT COUNT(*) FROM external_identities WHERE provider_code = 'kakao' AND external_user_id = ? AND player_id = ? AND status = 'linked') AS linked_count,
      (SELECT COUNT(*) FROM player_signup_requests WHERE player_id = ? AND status = 'accepted') AS accepted_count`,
    [accepted.playerId, accepted.playerId, accepted.playerId, accepted.playerId, accepted.playerId,
      acceptedUserId, accepted.playerId, accepted.playerId]
  );
  assert.equal(acceptedRows[0]?.player_count, 1n);
  assert.equal(acceptedRows[0]?.profile_count, 1n);
  assert.equal(acceptedRows[0]?.pet_count, 1n);
  assert.equal(acceptedRows[0]?.currency_count, 2n);
  assert.equal(acceptedRows[0]?.counter_count, 11n);
  assert.equal(acceptedRows[0]?.linked_count, 1n);
  assert.equal(acceptedRows[0]?.accepted_count, 1n);

  const duplicateAccept = await prepareCommand("시작한다", acceptedUserId, acceptedName);
  await assert.rejects(() => signupService.handle(duplicateAccept.input), (error: unknown) => {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ALREADY_REGISTERED";
  });
  const playerCountAfterRetry = await database.query<Array<{ count: bigint }>>(
    "SELECT COUNT(*) AS count FROM external_identities WHERE provider_code = 'kakao' AND external_user_id = ? AND player_id IS NOT NULL",
    [acceptedUserId]
  );
  assert.equal(playerCountAfterRetry[0]?.count, 1n);

  const rejectedUserId = `signup-probe-rejected-${suffix}`;
  const rejectedName = `가입거절${suffix} 여`;
  const rejectRequest = await prepareCommand("/가입", rejectedUserId, rejectedName);
  await signupService.handle(rejectRequest.input);
  const rejectCommand = await prepareCommand("/거절한다", rejectedUserId, rejectedName);
  const rejected = await signupService.handle(rejectCommand.input);
  assert.equal(rejected.status, "rejected");
  const rejectedRows = await database.query<Array<{ player_count: bigint; rejected_count: bigint }>>(
    `SELECT
      (SELECT COUNT(*) FROM external_identities WHERE provider_code = 'kakao' AND external_user_id = ? AND player_id IS NOT NULL) AS player_count,
      (SELECT COUNT(*) FROM player_signup_requests request_row
        JOIN external_identities identity ON identity.id = request_row.external_identity_id
        WHERE identity.external_user_id = ? AND request_row.status = 'rejected' AND request_row.normalized_display_name IS NULL) AS rejected_count`,
    [rejectedUserId, rejectedUserId]
  );
  assert.equal(rejectedRows[0]?.player_count, 0n);
  assert.equal(rejectedRows[0]?.rejected_count, 1n);

  const siteAuth = new UserAuthService(database, config.userVerificationPepper);
  const siteSignup = await siteAuth.signup({
    loginId: `probe${suffix}`.slice(0, 20),
    password: `probePassword${suffix}`,
    systemAccountName: "솜별 남",
    acceptTerms: true
  });
  assert.equal(siteSignup.status, "pending_kakao_link");
  const siteVerification = await new ProviderVerificationService(database, config.userVerificationPepper)
    .verifyInitialKakao({
      code: siteSignup.verificationCode,
      externalUserId: `site-signup-probe-${suffix}`,
      displayName: "솜별 남",
      channelId
    });
  assert.equal(siteVerification.status, "verified");
  const siteRows = await database.query<Array<{
    account_count: bigint; consent_count: bigint; verified_count: bigint; linked_count: bigint;
  }>>(
    `SELECT
      (SELECT COUNT(*) FROM user_accounts WHERE id = ? AND player_id = ? AND status = 'active') AS account_count,
      (SELECT COUNT(*) FROM user_terms_acceptances WHERE user_account_id = ?) AS consent_count,
      (SELECT COUNT(*) FROM user_verification_challenges WHERE user_account_id = ? AND status = 'verified') AS verified_count,
      (SELECT COUNT(*) FROM external_identities WHERE provider_code = 'kakao' AND external_user_id = ? AND player_id = ?) AS linked_count`,
    [siteSignup.accountId, siteVerification.playerId, siteSignup.accountId, siteSignup.accountId,
      `site-signup-probe-${suffix}`, siteVerification.playerId]
  );
  assert.equal(siteRows[0]?.account_count, 1n);
  assert.equal(siteRows[0]?.consent_count, 1n);
  assert.equal(siteRows[0]?.verified_count, 1n);
  assert.equal(siteRows[0]?.linked_count, 1n);

  process.stdout.write(JSON.stringify({
    ok: true,
    acceptedPlayerId: accepted.playerId,
    rejectedWithoutPlayer: true,
    siteSignupPlayerId: siteVerification.playerId
  }) + "\n");
} finally {
  await database.close();
}
