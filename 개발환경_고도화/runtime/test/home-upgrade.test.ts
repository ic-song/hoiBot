import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { HomeUpgradeService, isHomeUpgradeCommandCandidate, parseHomeUpgradeCommand } from "../src/home/home-upgrade-service.js";

// 실행된 SQL을 기록하는 최소 합성 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 100n;
  const tx: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => { sql.push(statement); return remaining.shift() as T; },
    execute: async (statement: string): Promise<DatabaseWriteResult> => { sql.push(statement); insertId += 1n; return { affectedRows: 1n, insertId }; }
  };
  const database: DatabaseClient = {
    ping: async () => undefined, verifyRollback: async () => true,
    query: async () => { throw new Error("unexpected query"); }, execute: async () => { throw new Error("unexpected execute"); },
    withTransaction: async <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => work(tx), close: async () => undefined
  };
  return { database, sql };
}

describe("home upgrade parser", () => {
  it("accepts only exact slash and approved bare aliases", () => {
    assert.equal(parseHomeUpgradeCommand("/집짓기"), "home_upgrade_preview");
    assert.equal(parseHomeUpgradeCommand("/집뚝딱"), "home_upgrade_execute");
    assert.equal(parseHomeUpgradeCommand("집뚝딱"), "home_upgrade_execute");
    assert.equal(parseHomeUpgradeCommand("/생각해본다"), "home_upgrade_cancel");
    assert.equal(parseHomeUpgradeCommand("생각해본다"), "home_upgrade_cancel");
    for (const value of ["/집짓기 1", "/집뚝딱 해줘", "생각해본다 ", "/집"])
      assert.equal(isHomeUpgradeCommandCandidate(value), false);
  });
});

describe("home upgrade service", () => {
  it("ignores an unlinked identity without mutation", async () => {
    const scripted = scriptedDatabase([[]]);
    assert.deepEqual(await new HomeUpgradeService(scripted.database).handle({ externalUserId: "none", channelId: "room", message: "/집짓기", eventId: "e1" }), { status: "ignored" });
    assert.equal(scripted.sql.length, 1);
  });

  it("records a rejected preview when the player has no pet", async () => {
    const scripted = scriptedDatabase([
      [{ identity_id: 1n, player_id: 2n }], [], [{ pet_id: null, pet_version: null, current_floor: 0n, home_version: null }]
    ]);
    const result = await new HomeUpgradeService(scripted.database).handle({ externalUserId: "kakao-2", channelId: "room", message: "/집짓기", eventId: "e2" });
    assert.equal(result.status, "rejected");
    assert.equal(result.data, "펫을 먼저 생성해주세요.");
    assert.equal(scripted.sql.some((statement) => statement.includes("home_upgrade_confirmations")), false);
    for (const fragment of ["INSERT INTO operations", "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"])
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
  });
});
