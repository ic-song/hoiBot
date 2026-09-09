import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MariaProfileRepository } from "../src/player/maria-profile-repository.js";

describe("admin web reward currency version read", () => {
  it("keeps the legacy balance map and exposes ordered account versions", async () => {
    const database = {
      async query<T>(sql: string): Promise<T> {
        if (sql.includes("FROM players p")) return [{
          player_id: 40001n, display_name: "합성회원", profile_version: 12n,
          server_code: "hoi-1", server_name: "호이 1서버", joined_at: new Date("2026-08-28T03:20:00.000Z"),
          level: 125n, accumulated_level: 1250n, experience: 7200n, rebirth_count: 4n,
          terms_agreed: 1, first_sponsor: 0, active_title: null, title_count: 0n, pet_title_count: 0n,
          guild_id: null, guild_name: null, guild_mark: null, guild_role_code: null,
          pet_name: null, pet_type_code: null, pet_image_value: null, pet_experience: null, pet_enhancement_level: null,
          mini_pet_name: null, mini_pet_grade: null, mini_pet_grade_display: null, mini_pet_emoji: null,
          mini_pet_progress: null, mini_pet_battle_experience: null,
          home_name: null, home_likes: null, home_charm: null, home_floor_area: null
        }] as T;
        if (sql.includes("FROM currency_accounts")) {
          assert.match(sql, /version/);
          assert.match(sql, /ORDER BY currency_code/);
          return [{ code: "diamond", balance: "350", version: 4n }, { code: "point", balance: "1200000", version: 9n }] as T;
        }
        return [] as T;
      }
    };
    const profile = await new MariaProfileRepository(database).findByPlayerId("40001");
    assert.deepEqual(profile?.currencies, { diamond: "350", point: "1200000" });
    assert.deepEqual(profile?.currencyAccounts, [
      { code: "diamond", balance: "350", version: "4" },
      { code: "point", balance: "1200000", version: "9" }
    ]);
  });
});
