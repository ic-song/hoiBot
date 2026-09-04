import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { AccountPlatformChallengeService } from "../src/account-platform/account-platform-challenge-service.js";
import { AccountPlatformActorContextResolver } from "../src/account-platform/account-platform-actor-context-resolver.js";
import { AccountPlatformCommandContextProvider } from "../src/account-platform/account-platform-command-context-provider.js";
import { AccountPlatformIrisContextProvider } from "../src/account-platform/account-platform-iris-context-provider.js";
import { AccountSwitchCommandService } from "../src/account-platform/account-switch-command-service.js";
import { AccountPlatformService } from "../src/account-platform/account-platform-service.js";
import { MariaAccountPlatformRepository } from "../src/account-platform/maria-account-platform-repository.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, createScopedDatabaseClient, type DatabaseClient } from "../src/database.js";
import { normalizeIrisEvent } from "../src/integration/iris-normalizer.js";
import { ProviderVerificationService } from "../src/user-auth/provider-verification-service.js";
import { UserAuthService } from "../src/user-auth/user-auth-service.js";

const enabled = process.env.ACCOUNT_PLATFORM_MARIADB_TEST === "true";
const database = enabled ? createDatabaseClient(loadConfig().database) : null;

after(async () => { if (database !== null) await database.close(); });

describe("WBS746 account platform MariaDB", { skip: !enabled }, () => {
  it("completes new and legacy web signup in the first Kakao room while preserving the legacy player_id", async () => {
    assert.ok(database !== null);
    const rollback = new Error("ACCOUNT_PLATFORM_SIGNUP_INTEGRATION_ROLLBACK");
    await assert.rejects(database.withTransaction(async (transaction) => {
      const suffix = Date.now().toString();
      const scoped = createScopedDatabaseClient(transaction);
      const pepper = "account-platform-signup-pepper";
      const auth = new UserAuthService(scoped, pepper);
      const provider = new ProviderVerificationService(scoped, pepper);

      const newSignup = await auth.signup({
        loginId: `amgn${suffix.slice(-12)}`, password: "password1", systemAccountName: "갸뇨 남", acceptTerms: true
      });
      const newVerified = await provider.verifyInitialKakao({
        code: newSignup.verificationCode, externalUserId: `new-user-${suffix}`, displayName: "갸뇨 남",
        channelId: `new-room-${suffix}`, requestKey: `new-signup-${suffix}`
      });
      assert.equal(newSignup.gameAccountPurpose, "NEW_GAME_ACCOUNT");
      assert.match(newVerified.playerId, /^\d+$/);

      const legacyPlayer = await transaction.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      await transaction.execute(
        "INSERT INTO player_profiles(player_id,current_display_name,terms_agreed,version) VALUES (?,'댜료 여',TRUE,1)",
        [legacyPlayer.insertId]
      );
      const legacySignup = await auth.signup({
        loginId: `amgl${suffix.slice(-12)}`, password: "password2", systemAccountName: "댜료 여", acceptTerms: true,
        gameAccountPurpose: "LEGACY_GAME_ACCOUNT_LINK", legacyPlayerId: legacyPlayer.insertId.toString()
      });
      const legacyVerified = await provider.verifyInitialKakao({
        code: legacySignup.verificationCode, externalUserId: `legacy-user-${suffix}`, displayName: "댜료 여",
        channelId: `legacy-room-${suffix}`, requestKey: `legacy-signup-${suffix}`
      });
      assert.equal(legacyVerified.playerId, legacyPlayer.insertId.toString());
      const bound = (await transaction.query<Array<{ context_type: string; external_context_key: string }>>(
        "SELECT context_type,external_context_key FROM user_verification_challenges WHERE public_id=?",
        [legacySignup.challengeId]
      ))[0];
      assert.deepEqual(bound, { context_type: "ROOM", external_context_key: `legacy-room-${suffix}` });
      throw rollback;
    }), (error: unknown) => error === rollback);
  });

  it("applies portal ownership and context-scoped selection invariants in one rollback-only fixture", async () => {
    assert.ok(database !== null);
    const rollback = new Error("ACCOUNT_PLATFORM_INTEGRATION_ROLLBACK");
    await assert.rejects(database.withTransaction(async (transaction) => {
      const suffix = Date.now().toString();
      const legacyPlayer = await transaction.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      await transaction.execute(
        "INSERT INTO player_profiles(player_id,current_display_name,terms_agreed,version) VALUES (?,'레거시 대표',TRUE,1)",
        [legacyPlayer.insertId]
      );
      const account = await transaction.execute(
        "INSERT INTO user_accounts(login_id,password_hash,system_account_name,gender_code,status) VALUES (?,?,?,'unspecified','active')",
        [`amgp${suffix.slice(-12)}`, "synthetic", `AMGP 포털 ${suffix}`]
      );
      const scoped = createScopedDatabaseClient(transaction);
      const service = new AccountPlatformService(new MariaAccountPlatformRepository(scoped));
      const representative = await service.verifyGameAccount({
        platformCode: "KAKAO", contextType: "ROOM", externalContextKey: `room-a-${suffix}`, externalUserKey: `user-a-${suffix}`,
        requestKey: `verify-representative-${suffix}`, legacyUserAccountId: account.insertId.toString(), purpose: "LEGACY_GAME_ACCOUNT_LINK",
        targetPlayerId: legacyPlayer.insertId.toString(), expectedDisplayName: "레거시 대표", observedDisplayName: "레거시 대표", actor: "개발자"
      });
      const sub = await service.verifyGameAccount({
        platformCode: "KAKAO", contextType: "ROOM", externalContextKey: `room-a-${suffix}`, externalUserKey: `user-a-${suffix}`,
        requestKey: `verify-sub-${suffix}`, legacyUserAccountId: account.insertId.toString(), purpose: "NEW_GAME_ACCOUNT",
        expectedDisplayName: `신규 부계정 ${suffix}`, observedDisplayName: `신규 부계정 ${suffix}`, actor: "개발자"
      });
      assert.equal(representative.playerId, legacyPlayer.insertId.toString());
      assert.equal(representative.playerRole, "REPRESENTATIVE");
      assert.equal(sub.playerRole, "SUB");
      assert.equal((await service.resolveActivePlayer({ platformCode: "KAKAO", contextType: "ROOM", externalContextKey: `room-a-${suffix}`, externalUserKey: `user-a-${suffix}` }))?.playerId, sub.playerId);

      const otherRoom = await service.verifyGameAccount({
        platformCode: "KAKAO", contextType: "ROOM", externalContextKey: `room-b-${suffix}`, externalUserKey: `user-b-${suffix}`,
        requestKey: `verify-room-b-${suffix}`, legacyUserAccountId: account.insertId.toString(), purpose: "LEGACY_GAME_ACCOUNT_LINK",
        targetPlayerId: representative.playerId, expectedDisplayName: "레거시 대표", observedDisplayName: "레거시 대표", actor: "개발자"
      });
      const switched = await service.switchActiveGameAccount({
        platformCode: "KAKAO", contextType: "ROOM", externalContextKey: `room-a-${suffix}`, externalUserKey: `user-a-${suffix}`,
        requestKey: `switch-${suffix}`, message: "/계정변경 레거시 대표", expectedSelectionVersion: 2, actor: "개발자"
      });
      const replay = await service.switchActiveGameAccount({
        platformCode: "KAKAO", contextType: "ROOM", externalContextKey: `room-a-${suffix}`, externalUserKey: `user-a-${suffix}`,
        requestKey: `switch-${suffix}`, message: "/계정변경 레거시 대표", expectedSelectionVersion: 2, actor: "개발자"
      });
      assert.equal(switched.playerId, representative.playerId);
      assert.equal(replay.replayed, true);
      assert.equal((await service.resolveActivePlayer({ platformCode: "KAKAO", contextType: "ROOM", externalContextKey: `room-b-${suffix}`, externalUserKey: `user-b-${suffix}` }))?.playerId, representative.playerId);
      assert.deepEqual(
        await new AccountPlatformActorContextResolver(scoped).resolve({
          platformCode: "KAKAO", contextType: "ROOM", externalContextKey: `room-a-${suffix}`, externalUserKey: `user-a-${suffix}`
        }),
        {
          playerId: representative.playerId,
          source: "ACCOUNT_PLATFORM_CONTEXT",
          portalAccountId: representative.portalAccountId,
          platformContextMembershipId: representative.platformContextMembershipId,
          selectionVersion: 3
        }
      );
      const switchedByCommand = await new AccountSwitchCommandService(scoped).handleKakao({
        eventId: `switch-command-${suffix}`,
        externalUserId: `user-a-${suffix}`,
        channelId: `room-a-${suffix}`,
        message: `/계정변경 ${sub.playerId}`
      });
      assert.deepEqual(
        { playerId: switchedByCommand.playerId, selectionVersion: switchedByCommand.selectionVersion, replayed: switchedByCommand.replayed },
        { playerId: sub.playerId, selectionVersion: 4, replayed: false }
      );
      assert.equal((await service.resolveActivePlayer({ platformCode: "KAKAO", contextType: "ROOM", externalContextKey: `room-b-${suffix}`, externalUserKey: `user-b-${suffix}` }))?.playerId, representative.playerId);

      const roomAContext = { platformCode: "KAKAO" as const, contextType: "ROOM" as const, externalContextKey: `room-a-${suffix}`, externalUserKey: `user-a-${suffix}` };
      const beforeNicknameObservation = await service.resolveActivePlayer(roomAContext);
      await service.observeNickname({ ...roomAContext, observedDisplayName: `카카오 새 닉네임 ${suffix}`, actor: "개발자" });
      const afterNicknameObservation = await service.resolveActivePlayer(roomAContext);
      const nicknameRows = await transaction.query<Array<{ observed_nickname: string; observation_source: string }>>(
        `SELECT observation.observed_nickname,observation.observation_source FROM account_platform_nickname_observations observation
         WHERE observation.platform_context_membership_id=? AND observation.observed_nickname=?`,
        [representative.platformContextMembershipId, `카카오 새 닉네임 ${suffix}`]
      );
      const subProfile = (await transaction.query<Array<{ current_display_name: string }>>(
        "SELECT current_display_name FROM player_profiles WHERE player_id=?", [sub.playerId]
      ))[0];
      assert.deepEqual(afterNicknameObservation, beforeNicknameObservation);
      assert.deepEqual(nicknameRows, [{ observed_nickname: `카카오 새 닉네임 ${suffix}`, observation_source: "EVENT_OBSERVATION" }]);
      assert.equal(subProfile?.current_display_name, `신규 부계정 ${suffix}`);

      const discordA = await service.verifyGameAccount({
        platformCode: "DISCORD", contextType: "SERVER", externalContextKey: `server-a-${suffix}`, externalUserKey: `discord-${suffix}`,
        requestKey: `verify-discord-a-${suffix}`, legacyUserAccountId: account.insertId.toString(), purpose: "LEGACY_GAME_ACCOUNT_LINK",
        targetPlayerId: representative.playerId, expectedDisplayName: "레거시 대표", observedDisplayName: "레거시 대표", actor: "개발자"
      });
      const discordB = await service.verifyGameAccount({
        platformCode: "DISCORD", contextType: "SERVER", externalContextKey: `server-b-${suffix}`, externalUserKey: `discord-${suffix}`,
        requestKey: `verify-discord-b-${suffix}`, legacyUserAccountId: account.insertId.toString(), purpose: "LEGACY_GAME_ACCOUNT_LINK",
        targetPlayerId: representative.playerId, expectedDisplayName: "레거시 대표", observedDisplayName: "레거시 대표", actor: "개발자"
      });
      assert.equal(discordA.platformIdentityId, discordB.platformIdentityId);
      assert.notEqual(discordA.platformContextMembershipId, discordB.platformContextMembershipId);
      await service.switchActiveGameAccount({
        platformCode: "DISCORD", contextType: "SERVER", externalContextKey: `server-b-${suffix}`, externalUserKey: `discord-${suffix}`,
        requestKey: `switch-discord-b-${suffix}`, message: `/계정변경 ${sub.playerId}`, expectedSelectionVersion: 1, actor: "개발자"
      });
      const platformContextProvider = new AccountPlatformCommandContextProvider(scoped);
      const discordAContext = await platformContextProvider.prepare({
        eventId: `discord-event-a-${suffix}`, platformCode: "DISCORD", contextType: "SERVER",
        externalContextKey: `server-a-${suffix}`, externalUserKey: `discord-${suffix}`, message: "/가방"
      });
      const discordBContext = await platformContextProvider.prepare({
        eventId: `discord-event-b-${suffix}`, platformCode: "DISCORD", contextType: "SERVER",
        externalContextKey: `server-b-${suffix}`, externalUserKey: `discord-${suffix}`, message: "/가방"
      });
      assert.deepEqual(
        [discordAContext.actor?.playerId, discordAContext.actor?.selectionVersion,
          discordBContext.actor?.playerId, discordBContext.actor?.selectionVersion],
        [representative.playerId, 1, sub.playerId, 2]
      );
      assert.notEqual(representative.platformIdentityId, otherRoom.platformIdentityId);

      const extraPlayer = await transaction.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      await assert.rejects(
        transaction.execute(
          "INSERT INTO portal_game_account_links(portal_game_account_link_id,portal_account_id,player_id,player_role,registration_sequence,link_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('z1234567',?,?, 'REPRESENTATIVE',3,'ACTIVE','개발자','2026-09-04 17:00:00','개발자','2026-09-04 17:00:00')",
          [representative.portalAccountId, extraPlayer.insertId]
        ),
        (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY"
      );
      throw rollback;
    }), (error: unknown) => error === rollback);
  });

  it("consumes a room-bound legacy challenge and replays the same request without duplicate writes", async () => {
    assert.ok(database !== null);
    const suffix = Date.now().toString();
    const requestKey = `challenge-verify-${suffix}`;
    const contextKey = `challenge-room-${suffix}`;
    const player = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    await database.execute(
      "INSERT INTO player_profiles(player_id,current_display_name,terms_agreed,version) VALUES (?,'챌린지 레거시',TRUE,1)",
      [player.insertId]
    );
    const account = await database.execute(
      "INSERT INTO user_accounts(login_id,password_hash,system_account_name,gender_code,status) VALUES (?,?,?,'unspecified','active')",
      [`amgc${suffix.slice(-12)}`, "synthetic", `AMGP 챌린지 ${suffix}`]
    );
    let portalAccountId: string | undefined;
    let membershipId: string | undefined;
    try {
      const service = new AccountPlatformChallengeService(database, "account-platform-mariadb-pepper");
      const challenge = await service.issue({
        legacyUserAccountId: account.insertId.toString(), purpose: "LEGACY_GAME_ACCOUNT_LINK", targetPlayerId: player.insertId.toString(),
        expectedDisplayName: "챌린지 레거시", platformCode: "KAKAO", contextType: "ROOM", externalContextKey: contextKey
      });
      const verified = await service.verify({
        requestKey, code: challenge.verificationCode, platformCode: "KAKAO", contextType: "ROOM", externalContextKey: contextKey,
        externalUserKey: `challenge-user-${suffix}`, observedDisplayName: "챌린지 레거시", actor: "개발자"
      });
      const replay = await service.verify({
        requestKey, code: challenge.verificationCode, platformCode: "KAKAO", contextType: "ROOM", externalContextKey: contextKey,
        externalUserKey: `challenge-user-${suffix}`, observedDisplayName: "챌린지 레거시", actor: "개발자"
      });
      portalAccountId = verified.portalAccountId;
      membershipId = verified.platformContextMembershipId;
      assert.equal(verified.playerId, player.insertId.toString());
      assert.equal(replay.replayed, true);
      const receiptCount = (await database.query<Array<{ value: bigint }>>(
        "SELECT COUNT(*) AS value FROM account_platform_operation_receipts WHERE operation_kind='VERIFY_GAME_ACCOUNT' AND request_key=?",
        [requestKey]
      ))[0]?.value;
      assert.equal(receiptCount, 1n);
    } finally {
      const operations = await database.query<Array<{ id: bigint }>>("SELECT id FROM operations WHERE idempotency_key=?", [requestKey]);
      for (const operation of operations) {
        await database.execute("DELETE FROM outbox_messages WHERE operation_id=?", [operation.id]);
        await database.execute("DELETE FROM command_audit WHERE operation_id=?", [operation.id]);
        await database.execute("DELETE FROM operations WHERE id=?", [operation.id]);
      }
      await database.execute("DELETE FROM user_verification_challenges WHERE user_account_id=?", [account.insertId]);
      if (membershipId !== undefined) {
        await database.execute("DELETE FROM account_platform_active_player_selections WHERE platform_context_membership_id=?", [membershipId]);
        await database.execute("DELETE FROM account_platform_nickname_observations WHERE platform_context_membership_id=?", [membershipId]);
        await database.execute("DELETE FROM account_platform_operation_receipts WHERE platform_context_membership_id=?", [membershipId]);
        await database.execute("DELETE FROM account_platform_context_memberships WHERE platform_context_membership_id=?", [membershipId]);
      }
      await database.execute("DELETE FROM account_platform_identities WHERE external_user_key=?", [`challenge-user-${suffix}`]);
      await database.execute("DELETE FROM account_platform_contexts WHERE external_context_key=?", [contextKey]);
      if (portalAccountId !== undefined) {
        await database.execute("DELETE FROM portal_game_account_links WHERE portal_account_id=?", [portalAccountId]);
        await database.execute("DELETE FROM account_platform_operation_receipts WHERE portal_account_id=?", [portalAccountId]);
        await database.execute("DELETE FROM canonical_portal_accounts WHERE portal_account_id=?", [portalAccountId]);
      }
      await database.execute("DELETE FROM user_accounts WHERE id=?", [account.insertId]);
      await database.execute("DELETE FROM player_profiles WHERE player_id=?", [player.insertId]);
      await database.execute("DELETE FROM players WHERE id=?", [player.insertId]);
    }
  });

  it("restores the active account and replays the same switch after a database client restart", async () => {
    assert.ok(database !== null);
    const suffix = Date.now().toString();
    const externalUserKey = `restart-user-${suffix}`;
    const externalContextKey = `restart-room-${suffix}`;
    const requestKeys = [
      `restart-verify-representative-${suffix}`,
      `restart-verify-sub-${suffix}`,
      `restart-switch-${suffix}`
    ];
    const representativePlayer = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const subPlayer = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    await database.execute(
      "INSERT INTO player_profiles(player_id,current_display_name,terms_agreed,version) VALUES (?,'재시작 대표',TRUE,1),(?,'재시작 부계정',TRUE,1)",
      [representativePlayer.insertId, subPlayer.insertId]
    );
    const account = await database.execute(
      "INSERT INTO user_accounts(login_id,password_hash,system_account_name,gender_code,status) VALUES (?,?,?,'unspecified','active')",
      [`amgr${suffix.slice(-12)}`, "synthetic", `AMGP 재시작 ${suffix}`]
    );
    let firstClient: DatabaseClient | null = createDatabaseClient(loadConfig().database);
    let restartedClient: DatabaseClient | null = null;
    let portalAccountId: string | undefined;
    let membershipId: string | undefined;
    try {
      const service = new AccountPlatformService(new MariaAccountPlatformRepository(firstClient));
      const representative = await service.verifyGameAccount({
        platformCode: "KAKAO", contextType: "ROOM", externalContextKey, externalUserKey,
        requestKey: requestKeys[0]!, legacyUserAccountId: account.insertId.toString(), purpose: "LEGACY_GAME_ACCOUNT_LINK",
        targetPlayerId: representativePlayer.insertId.toString(), expectedDisplayName: "재시작 대표", observedDisplayName: "재시작 대표", actor: "개발자"
      });
      const sub = await service.verifyGameAccount({
        platformCode: "KAKAO", contextType: "ROOM", externalContextKey, externalUserKey,
        requestKey: requestKeys[1]!, legacyUserAccountId: account.insertId.toString(), purpose: "LEGACY_GAME_ACCOUNT_LINK",
        targetPlayerId: subPlayer.insertId.toString(), expectedDisplayName: "재시작 부계정", observedDisplayName: "재시작 부계정", actor: "개발자"
      });
      portalAccountId = representative.portalAccountId;
      membershipId = representative.platformContextMembershipId;
      assert.equal(sub.playerRole, "SUB");

      const switchEvent = normalizeIrisEvent({
        msg: `/계정변경 ${representative.playerId}`, sender: "재시작 대표",
        json: { _id: requestKeys[2]!, user_id: externalUserKey, chat_id: externalContextKey }
      });
      requestKeys[2] = switchEvent.eventId;
      const firstProvider = new AccountPlatformIrisContextProvider(firstClient);
      const firstContext = await firstProvider.prepareKakao(switchEvent);
      assert.ok(firstContext !== null);
      const switched = await firstProvider.dispatchAccountSwitch(firstContext);
      assert.deepEqual(
        { playerId: switched?.playerId, selectionVersion: switched?.selectionVersion, replayed: switched?.replayed },
        { playerId: representative.playerId, selectionVersion: 3, replayed: false }
      );

      await firstClient.close();
      firstClient = null;
      restartedClient = createDatabaseClient(loadConfig().database);
      assert.deepEqual(
        await new AccountPlatformActorContextResolver(restartedClient).resolve({
          platformCode: "KAKAO", contextType: "ROOM", externalContextKey, externalUserKey
        }),
        {
          playerId: representative.playerId,
          source: "ACCOUNT_PLATFORM_CONTEXT",
          portalAccountId: representative.portalAccountId,
          platformContextMembershipId: representative.platformContextMembershipId,
          selectionVersion: 3
        }
      );
      const restartedProvider = new AccountPlatformIrisContextProvider(restartedClient);
      const restartedContext = await restartedProvider.prepareKakao(switchEvent);
      assert.ok(restartedContext !== null);
      const replay = await restartedProvider.dispatchAccountSwitch(restartedContext);
      assert.deepEqual(
        { playerId: replay?.playerId, selectionVersion: replay?.selectionVersion, replayed: replay?.replayed },
        { playerId: representative.playerId, selectionVersion: 3, replayed: true }
      );
    } finally {
      if (firstClient !== null) await firstClient.close();
      if (restartedClient !== null) await restartedClient.close();
      const operations = await database.query<Array<{ id: bigint }>>(
        `SELECT id FROM operations WHERE idempotency_key IN (${requestKeys.map(() => "?").join(",")})`, requestKeys
      );
      for (const operation of operations) {
        await database.execute("DELETE FROM outbox_messages WHERE operation_id=?", [operation.id]);
        await database.execute("DELETE FROM command_audit WHERE operation_id=?", [operation.id]);
        await database.execute("DELETE FROM operations WHERE id=?", [operation.id]);
      }
      await database.execute(
        `DELETE FROM account_platform_operation_receipts WHERE request_key IN (${requestKeys.map(() => "?").join(",")})`, requestKeys
      );
      if (membershipId !== undefined) {
        await database.execute("DELETE FROM account_platform_active_player_selections WHERE platform_context_membership_id=?", [membershipId]);
        await database.execute("DELETE FROM account_platform_nickname_observations WHERE platform_context_membership_id=?", [membershipId]);
        await database.execute("DELETE FROM account_platform_context_memberships WHERE platform_context_membership_id=?", [membershipId]);
      }
      await database.execute("DELETE FROM account_platform_identities WHERE external_user_key=?", [externalUserKey]);
      await database.execute("DELETE FROM account_platform_contexts WHERE external_context_key=?", [externalContextKey]);
      if (portalAccountId !== undefined) {
        await database.execute("DELETE FROM portal_game_account_links WHERE portal_account_id=?", [portalAccountId]);
        await database.execute("DELETE FROM canonical_portal_accounts WHERE portal_account_id=?", [portalAccountId]);
      }
      await database.execute("DELETE FROM user_accounts WHERE id=?", [account.insertId]);
      await database.execute("DELETE FROM player_profiles WHERE player_id IN (?,?)", [representativePlayer.insertId, subPlayer.insertId]);
      await database.execute("DELETE FROM players WHERE id IN (?,?)", [representativePlayer.insertId, subPlayer.insertId]);
    }
  });
});
