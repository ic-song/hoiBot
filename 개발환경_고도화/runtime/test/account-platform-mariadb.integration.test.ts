import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { AccountPlatformChallengeService } from "../src/account-platform/account-platform-challenge-service.js";
import { AccountPlatformService } from "../src/account-platform/account-platform-service.js";
import { MariaAccountPlatformRepository } from "../src/account-platform/maria-account-platform-repository.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, createScopedDatabaseClient } from "../src/database.js";

const enabled = process.env.ACCOUNT_PLATFORM_MARIADB_TEST === "true";
const database = enabled ? createDatabaseClient(loadConfig().database) : null;

after(async () => { if (database !== null) await database.close(); });

describe("WBS746 account platform MariaDB", { skip: !enabled }, () => {
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
      const service = new AccountPlatformService(new MariaAccountPlatformRepository(createScopedDatabaseClient(transaction)));
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
});
