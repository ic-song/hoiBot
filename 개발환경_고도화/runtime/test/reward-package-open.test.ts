import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import {
  buildRewardPackageOpenReply,
  isRewardPackageOpenCommand,
  RewardPackageOpenService,
  type RewardPackageOpenResult
} from "../src/package/reward-package-open-service.js";

function scriptedDatabase(queryResults: unknown[], failAtExecute?: number) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 100n;
  let executeCount = 0;
  let rolledBack = false;
  const tx: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      if (remaining.length === 0) throw new Error("Unexpected query: " + statement);
      return remaining.shift() as T;
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement);
      executeCount += 1;
      if (executeCount === failAtExecute) throw new Error("synthetic write failure");
      insertId += 1n;
      return { affectedRows: 1n, insertId };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected non-transaction query"); },
    execute: async () => { throw new Error("Unexpected non-transaction write"); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => {
      try { return await work(tx); } catch (error) { rolledBack = true; throw error; }
    },
    close: async () => undefined
  };
  return { database, sql, didRollback: () => rolledBack };
}

const actor = { identity_id: 11n, player_id: 21n, current_display_name: "합성회원" };
const itemRows = [
  { item_id: 1n, code: "deputy_reward_package_3", display_name: "부방상여패키지3(/고생하셨습니다)", active: true, stackable: true, quantity: 1n, version: 2n },
  { item_id: 2n, code: "pet_sweet_home_interior_shop", display_name: "펫스윗홈인테리어샵🖼️(/샵오픈)", active: true, stackable: true, quantity: 3n, version: 1n },
  { item_id: 3n, code: "exploration_probability_up_20", display_name: "탐험확률UP🗻(20%)", active: true, stackable: true, quantity: null, version: null },
  { item_id: 4n, code: "guild_contribution_medal", display_name: "길드공헌훈장🌟(/길드공헌 숫자)", active: true, stackable: true, quantity: 7n, version: 4n },
  { item_id: 5n, code: "guild_warehouse_package", display_name: "길드창고패키지🧳(/길드창고패키지오픈", active: true, stackable: true, quantity: null, version: null },
  { item_id: 6n, code: "loudspeaker_notice", display_name: "확성기📢(/알림 내용 30자)", active: true, stackable: true, quantity: 1n, version: 3n }
];
const command = { externalUserId: "kakao-11", channelId: "room-1", message: "/고생하셨습니다", eventId: "event-reward-1" };

describe("reward package open policy", () => {
  it("accepts the exact command only", () => {
    assert.equal(isRewardPackageOpenCommand("/고생하셨습니다"), true);
    for (const value of ["/고생하셨습니다 ", "/고생하셨습니다 1", "/고생하셨습니다 안내", undefined]) {
      assert.equal(isRewardPackageOpenCommand(value), false);
    }
  });

  it("preserves the legacy success reply", () => {
    assert.equal(buildRewardPackageOpenReply("합성회원"),
      "합성회원 님의 부방상여패키지🤫이 성공적으로 오픈되었습니다.\n방을 위한 노고와 기여에 감사드립니다.\n\n획득한 아이템 목록:\n"
      + "펫스윗홈인테리어샵🖼️(/샵오픈) x 20000\n탐험확률UP🗻(20%) x 20\n길드공헌훈장🌟(/길드공헌 숫자) x 30\n"
      + "길드창고패키지🧳(/길드창고패키지오픈 x 1\n확성기📢(/알림 내용 30자) x 5");
  });
});

describe("reward package open transaction", () => {
  it("consumes one package and grants all five rewards in one transaction", async () => {
    const scripted = scriptedDatabase([[actor], [], itemRows]);
    const result = await new RewardPackageOpenService(scripted.database).handle(command);
    assert.equal(result.status, "opened");
    assert.equal(result.packageBefore, "1");
    assert.equal(result.packageAfter, "0");
    assert.deepEqual(result.rewards?.map((value) => value.after), ["20003", "20", "37", "1", "6"]);
    assert.equal(scripted.sql.filter((value) => value.includes("INSERT INTO inventory_ledger")).length, 6);
    for (const fragment of ["DELETE FROM inventory_stacks", "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"]) {
      assert.ok(scripted.sql.some((value) => value.includes(fragment)), fragment);
    }
  });

  it("returns the legacy package-required response without membership mutation", async () => {
    const scripted = scriptedDatabase([[]]);
    const result = await new RewardPackageOpenService(scripted.database).handle(command);
    assert.deepEqual(result, { status: "package_required", data: "부방상여패키지를 소지하고 있지 않습니다." });
    assert.equal(scripted.sql.some((value) => /^(INSERT|UPDATE|DELETE)\b/.test(value.trim())), false);
  });

  it("reuses the completed event result without a second mutation", async () => {
    const prior: RewardPackageOpenResult = { status: "opened", playerId: "21", packageBefore: "1", packageAfter: "0", rewards: [], data: "stored" };
    const scripted = scriptedDatabase([[actor], [{ result_json: JSON.stringify(prior) }]]);
    const result = await new RewardPackageOpenService(scripted.database).handle(command);
    assert.equal(result.duplicate, true);
    assert.equal(result.data, "stored");
    assert.equal(scripted.sql.some((value) => /^(INSERT|UPDATE|DELETE)\b/.test(value.trim())), false);
  });

  it("rolls back when a reward write fails after package consumption", async () => {
    const scripted = scriptedDatabase([[actor], [], itemRows], 5);
    await assert.rejects(() => new RewardPackageOpenService(scripted.database).handle(command), /synthetic write failure/);
    assert.equal(scripted.didRollback(), true);
  });
});
