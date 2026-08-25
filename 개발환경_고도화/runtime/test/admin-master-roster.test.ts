import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import {
  AdminMasterRosterService,
  isAdminMasterRosterCommand,
  isAdminMasterRosterListCommand,
  isAdminMasterRosterRemoveCommand
} from "../src/admin/master-roster-service.js";

function scripted(queries: unknown[]) {
  const left = [...queries];
  const sql: string[] = [];
  let id = 1700n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      if (left.length === 0) throw new Error(`Unexpected query: ${statement}`);
      return left.shift() as T;
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement);
      id++;
      return { affectedRows: 1n, insertId: id };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected root query"); },
    execute: async () => { throw new Error("Unexpected root execute"); },
    withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
  return { database, sql };
}

const command = (message: string, eventId = "event-1") => ({
  externalUserId: "master-user", channelId: "room", eventId, message
});

describe("admin master roster command guards", () => {
  it("accepts only the exact list and complete comma remove forms", () => {
    assert.equal(isAdminMasterRosterListCommand("/마스터명단"), true);
    assert.equal(isAdminMasterRosterRemoveCommand("/마스터제거, 대상"), true);
    assert.equal(isAdminMasterRosterRemoveCommand("/마스터제거,대상"), true);
    assert.equal(isAdminMasterRosterCommand("/마스터명단"), true);
    for (const message of ["/마스터명단 1", "/마스터제거", "/마스터제거 대상", "/마스터제거, 대상 "]) {
      assert.equal(isAdminMasterRosterCommand(message), false);
    }
  });
});

describe("admin master roster service", () => {
  it("lists active masters in stable operator order", async () => {
    const fixture = scripted([[{ operator_id: 7n }], [], [
      { operator_id: 7n, display_name: "총괄" }, { operator_id: 9n, display_name: "부총괄" }
    ]]);
    const result = await new AdminMasterRosterService(fixture.database).execute(command("/마스터명단"));
    assert.equal(result.masterCount, 2);
    assert.equal(result.data, "📋 마스터 명단\n\n1. 총괄\n2. 부총괄");
    assert.ok(fixture.sql.some(sql => sql.includes("ORDER BY operator.id")));
  });

  it("removes super_admin and disables an operator with no remaining role", async () => {
    const fixture = scripted([[{ operator_id: 7n }], [], [{ player_id: 2n, external_identity_id: 92n }],
      [{ id: 4n }], [{ operator_id: 8n }], [{ operator_id: 8n }], [{ role_count: 0n }]]);
    const result = await new AdminMasterRosterService(fixture.database).execute(command("/마스터제거, 대상"));
    assert.equal(result.operatorDisabled, true);
    assert.equal(result.roleCode, "super_admin");
    for (const fragment of ["DELETE FROM admin_operator_roles", "UPDATE admin_sessions", "admin_role_assignment_history", "command_audit"]) {
      assert.ok(fixture.sql.some(sql => sql.includes(fragment)), fragment);
    }
  });

  it("allows removing the acting or last master for legacy parity", async () => {
    const fixture = scripted([[{ operator_id: 7n }], [], [{ player_id: 1n, external_identity_id: 91n }],
      [{ id: 4n }], [{ operator_id: 7n }], [{ operator_id: 7n }], [{ role_count: 0n }]]);
    const result = await new AdminMasterRosterService(fixture.database).execute(command("/마스터제거, 총괄"));
    assert.equal(result.targetOperatorId, "7");
    assert.equal(result.operatorDisabled, true);
  });

  it("rejects an unauthorized actor before reading the roster", async () => {
    const fixture = scripted([[]]);
    await assert.rejects(
      () => new AdminMasterRosterService(fixture.database).execute(command("/마스터명단")),
      (error: unknown) => error instanceof ApplicationError && error.statusCode === 403
    );
  });

  it("replays the same removal and rejects changed target content", async () => {
    const stored = { status: "revoked", commandKind: "remove", targetName: "대상", roleCode: "super_admin",
      outboxId: "9", auditId: "10", data: "완료" } as const;
    let fixture = scripted([[{ operator_id: 7n }], [{ result_json: JSON.stringify(stored) }]]);
    const replay = await new AdminMasterRosterService(fixture.database).execute(command("/마스터제거, 대상"));
    assert.equal(replay.replayed, true);
    fixture = scripted([[{ operator_id: 7n }], [{ result_json: JSON.stringify(stored) }]]);
    await assert.rejects(
      () => new AdminMasterRosterService(fixture.database).execute(command("/마스터제거, 다른대상")),
      (error: unknown) => error instanceof ApplicationError && error.code === "ADMIN_MASTER_ROSTER_REPLAY_MISMATCH"
    );
  });
});
