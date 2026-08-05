import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSignupTermsMessage,
  buildSignupWelcomeMessage,
  isSignupCommand,
  validateSystemAccountName,
  validateSignupDisplayName
} from "../src/signup/signup-policy.js";
import { SignupService } from "../src/signup/signup-service.js";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";

// 가입 Service의 SQL 순서와 트랜잭션 경계를 기록하는 테스트 DB를 생성합니다.
function createScriptedDatabase(queryResults: unknown[]) {
  const queries = [...queryResults];
  const sql: string[] = [];
  let insertId = 0n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      if (queries.length === 0) throw new Error(`Unexpected query: ${statement}`);
      return queries.shift() as T;
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement);
      insertId += 1n;
      return { affectedRows: 1n, insertId };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected non-transactional query."); },
    execute: async () => { throw new Error("Unexpected non-transactional execute."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
  return { database, sql };
}

describe("signup policy", () => {
  it("normalizes a valid legacy display name and keeps the gender", () => {
    assert.deepEqual(validateSignupDisplayName("  호이   남  "), {
      displayName: "호이 남",
      normalizedDisplayName: "호이 남",
      genderCode: "male"
    });
    assert.equal(validateSignupDisplayName("테스터 여").genderCode, "female");
  });

  it("rejects invalid and blocked display names", () => {
    assert.throws(() => validateSignupDisplayName("호이"), /INVALID_SIGNUP_NAME_FORMAT/);
    assert.throws(() => validateSignupDisplayName("가 남"), /INVALID_SIGNUP_NAME_FORMAT/);
    assert.throws(() => validateSignupDisplayName("욕설시발 남"), /BLOCKED_SIGNUP_NAME/);
    assert.throws(() => validateSignupDisplayName("정치인 남"), /BLOCKED_SIGNUP_NAME/);
  });

  it("requires the site account name to match exactly two Hangul characters, one space, and gender", () => {
    assert.deepEqual(validateSystemAccountName("호이 남"), {
      displayName: "호이 남",
      normalizedDisplayName: "호이 남",
      genderCode: "male"
    });
    assert.throws(() => validateSystemAccountName(" 호이 남 "), /INVALID_SIGNUP_NAME_FORMAT/);
    assert.throws(() => validateSystemAccountName("호이봇 남"), /INVALID_SIGNUP_NAME_FORMAT/);
    assert.throws(() => validateSystemAccountName("호이남"), /INVALID_SIGNUP_NAME_FORMAT/);
  });

  it("accepts only exact signup and terms response commands", () => {
    for (const command of ["/가입", "시작한다", "/시작한다", "거절한다", "/거절한다"]) {
      assert.equal(isSignupCommand(command), true, command);
    }
    for (const command of ["/가입 해줘", "/시작한다 지금", "/거절한다 1", "가입"]) {
      assert.equal(isSignupCommand(command), false, command);
    }
  });

  it("preserves the legacy terms and welcome guidance", () => {
    assert.match(buildSignupTermsMessage(), /\[시작한다\] \/ \[거절한다\]/);
    assert.match(buildSignupTermsMessage(), /전체이용가/);
    assert.match(buildSignupWelcomeMessage(), /\/펫생성 아이디/);
    assert.match(buildSignupWelcomeMessage(), /\/시련의탑/);
  });

  it("persists a signup request without creating a player", async () => {
    const scripted = createScriptedDatabase([
      [{ id: 11n, player_id: null, status: "candidate" }],
      [],
      [],
      []
    ]);
    const result = await new SignupService(scripted.database).handle({
      externalUserId: "kakao-11",
      displayName: "신규회원 남",
      channelId: "room-1",
      message: "/가입",
      eventId: "iris:event-request"
    });

    assert.equal(result.status, "pending");
    assert.ok(scripted.sql.some((statement) => statement.includes("INSERT INTO player_signup_requests")));
    assert.equal(scripted.sql.some((statement) => statement.includes("INSERT INTO players")), false);
  });

  it("creates all initial member records only when terms are accepted", async () => {
    const scripted = createScriptedDatabase([
      [{ id: 12n, player_id: null, status: "candidate" }],
      [],
      [{ id: 31n, display_name: "가입완료 여", gender_code: "female", expired: 0 }],
      [],
      [{ game_server_id: 7n }]
    ]);
    const result = await new SignupService(scripted.database).handle({
      externalUserId: "kakao-12",
      displayName: "가입완료 여",
      channelId: "room-2",
      message: "/시작한다",
      eventId: "iris:event-accept"
    });

    assert.equal(result.status, "accepted");
    for (const table of ["players", "player_profiles", "player_pets", "currency_accounts", "player_counters"]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(`INSERT INTO ${table}`)), table);
    }
    assert.ok(scripted.sql.some((statement) => statement.includes("status = 'linked'")));
    assert.ok(scripted.sql.some((statement) => statement.includes("status = 'accepted'")));
  });

  it("releases the nickname without creating a player when signup is rejected", async () => {
    const scripted = createScriptedDatabase([
      [{ id: 13n, player_id: null, status: "candidate" }],
      [],
      [{ id: 32n, display_name: "가입거절 남", gender_code: "male", expired: 0 }]
    ]);
    const result = await new SignupService(scripted.database).handle({
      externalUserId: "kakao-13",
      displayName: "가입거절 남",
      channelId: "room-3",
      message: "거절한다",
      eventId: "iris:event-reject"
    });

    assert.equal(result.status, "rejected");
    assert.ok(scripted.sql.some((statement) => statement.includes("normalized_display_name = NULL")));
    assert.equal(scripted.sql.some((statement) => statement.includes("INSERT INTO players")), false);
  });
});
