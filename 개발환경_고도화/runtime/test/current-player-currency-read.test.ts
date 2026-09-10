import assert from "node:assert/strict";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { describe, it } from "node:test";
import type { DatabaseClient } from "../src/database.js";
import { MariaProfileRepository } from "../src/player/maria-profile-repository.js";
import type { ProfileRepository, ProfileView } from "../src/player/profile.js";
import { registerUserAuthRoutes } from "../src/user-auth/routes.js";
import type { RequestRateLimiter } from "../src/user-auth/request-rate-limiter.js";
import { UserAuthService } from "../src/user-auth/user-auth-service.js";

function profileRow(): Record<string, unknown> {
  return {
    player_id: 9223372036854775807n, display_name: "정밀도용사", profile_version: 18446744073709551615n,
    server_code: "hoi-1", server_name: "호이월드 1", joined_at: null,
    level: 9007199254740993n, accumulated_level: 9007199254740994n, experience: 9007199254740995n,
    rebirth_count: 9007199254740996n, terms_agreed: 1, first_sponsor: 0,
    active_title: null, title_count: 0n, pet_title_count: 0n,
    guild_id: null, guild_name: null, guild_mark: null, guild_role_code: null,
    pet_name: null, pet_type_code: null, pet_image_value: null, pet_experience: null, pet_enhancement_level: null,
    mini_pet_name: null, mini_pet_grade: null, mini_pet_grade_display: null, mini_pet_emoji: null,
    mini_pet_progress: null, mini_pet_battle_experience: null,
    home_name: null, home_likes: null, home_charm: null, home_floor_area: null
  };
}

describe("current player currency read contract", () => {
  it("returns only active currency definitions while preserving DECIMAL and BIGINT strings", async () => {
    const statements: string[] = [];
    const database = {
      async query<T>(sql: string): Promise<T> {
        statements.push(sql);
        if (sql.includes("FROM players p")) return [profileRow()] as T;
        if (sql.includes("FROM currency_accounts account")) {
          assert.match(sql, /JOIN currency_definitions definition/);
          assert.match(sql, /definition\.active = TRUE/);
          assert.match(sql, /account\.player_id = \?/);
          return [
            { code: "diamond", balance: "999999999999999999999999999.999", version: 18446744073709551615n },
            { code: "point", balance: "9007199254740993.125", version: 9007199254740993n }
          ] as T;
        }
        return [] as T;
      }
    };

    const profile = await new MariaProfileRepository(database).findByPlayerId("9223372036854775807");

    assert.match(statements[0] ?? "", /p\.status = 'active' AND p\.deleted_at IS NULL/);
    assert.equal(profile?.playerId, "9223372036854775807");
    assert.equal(profile?.profileVersion, "18446744073709551615");
    assert.deepEqual(profile?.currencies, {
      diamond: "999999999999999999999999999.999",
      point: "9007199254740993.125"
    });
    assert.deepEqual(profile?.currencyAccounts, [
      { code: "diamond", balance: "999999999999999999999999999.999", version: "18446744073709551615" },
      { code: "point", balance: "9007199254740993.125", version: "9007199254740993" }
    ]);
  });

  it("rejects a session whose active account has been soft deleted", async () => {
    const statements: string[] = [];
    const database = {
      async query<T>(sql: string): Promise<T> {
        statements.push(sql);
        return [] as T;
      },
      async execute() { return { affectedRows: 0n, insertId: 0n }; }
    } as unknown as DatabaseClient;

    await assert.rejects(
      new UserAuthService(database, "test-pepper").authenticate("deleted-account-session"),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error
        && error.code === "USER_SESSION_INVALID"
    );
    assert.match(statements[0] ?? "", /account_row\.status = 'active'[\s\S]*account_row\.deleted_at IS NULL/);
  });

  it("uses only the authenticated session player for the current profile route", async () => {
    const requestedPlayerIds: string[] = [];
    const preciseProfile = {
      playerId: "9223372036854775807",
      displayName: "정밀도용사",
      profileVersion: "18446744073709551615",
      server: null, joinedAt: null, level: "9007199254740993", accumulatedLevel: "9007199254740994",
      experience: { current: "9007199254740995", next: null }, rebirthCount: "9007199254740996",
      termsAgreed: true, firstSponsor: false, passes: [],
      currencies: { point: "9007199254740993.125" },
      currencyAccounts: [{ code: "point", balance: "9007199254740993.125", version: "18446744073709551615" }],
      counters: {}, activeTitle: null, titleCount: "0", petTitleCount: "0", guild: null, pet: null,
      equippedMiniPet: null, home: null, ranks: {}, badges: []
    } satisfies ProfileView;
    const profiles = {
      async findByPlayerId(playerId: string) { requestedPlayerIds.push(playerId); return preciseProfile; },
      async findByExternalIdentity() { return null; }, async list() { return []; }, async count() { return 0; }
    } satisfies ProfileRepository;
    const auth = {
      async refreshSession() {
        return {
          session: { sessionId: "1", accountId: "2", playerId: "9223372036854775807", loginId: "precision", systemAccountName: "호이월드" },
          csrfToken: "csrf"
        };
      }
    } as unknown as UserAuthService;
    const app = Fastify();
    await app.register(cookie);
    await registerUserAuthRoutes(app, {
      auth, profiles,
      rateLimiter: { consume() {} } as unknown as RequestRateLimiter,
      secureCookies: false
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/player-profiles/current?playerId=9007199254740992",
      headers: { cookie: "hoibot_user_session=session-token" }
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(requestedPlayerIds, ["9223372036854775807"]);
    assert.equal(response.json().profile.currencyAccounts[0].balance, "9007199254740993.125");
    assert.equal(response.json().profile.currencyAccounts[0].version, "18446744073709551615");
    await app.close();
  });
});
