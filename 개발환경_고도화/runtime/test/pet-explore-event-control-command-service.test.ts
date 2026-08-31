import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseWriteResult } from "../src/database.js";
import {
  formatPetExploreEventControlReply,
  isPetExploreEventControlCommand,
  parsePetExploreEventControlCommand,
  PetExploreEventControlCommandService,
} from "../src/pet/pet-explore-event-control-command-service.js";
import type { PetExploreEventControlResult } from "../src/pet/pet-explore-event-control-provider.js";

function result(overrides: Partial<PetExploreEventControlResult> = {}): PetExploreEventControlResult {
  return {
    status: "changed",
    eventCode: "diamond_mine",
    previousActive: true,
    active: false,
    previousVersion: "7",
    version: "8",
    relocatedParticipantCount: "2",
    operationId: "101",
    auditId: "102",
    outboxId: "103",
    replayed: false,
    ...overrides,
  };
}

function database(queryResults: unknown[]) {
  const pending = [...queryResults];
  const executions: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const client: DatabaseClient = {
    ping: async () => undefined,
    query: async <T>(): Promise<T> => pending.shift() as T,
    execute: async (sql: string, values?: readonly unknown[]): Promise<DatabaseWriteResult> => {
      executions.push({ sql, values });
      return { affectedRows: 1n, insertId: 1n };
    },
    withTransaction: async () => { throw new Error("unexpected transaction"); },
    verifyRollback: async () => true,
    close: async () => undefined,
  };
  return { client, executions };
}

describe("pet explore event control command consumer", () => {
  it("accepts only the four exact legacy guards", () => {
    const commands = ["/펫탐험이벤트활성화", "/펫탐험이벤트비활성화", "/레이드이벤트활성화", "/레이드이벤트비활성화"];
    assert.equal(commands.every((command) => isPetExploreEventControlCommand(command)), true);
    assert.equal(parsePetExploreEventControlCommand("/레이드이벤트활성화 안내"), null);
    assert.equal(parsePetExploreEventControlCommand("/펫탐험이벤트활성화 "), null);
  });

  it("preserves the event-specific legacy reply and relocation count", () => {
    const diamond = parsePetExploreEventControlCommand("/펫탐험이벤트비활성화")!;
    const raid = parsePetExploreEventControlCommand("/레이드이벤트비활성화")!;
    assert.match(formatPetExploreEventControlReply(diamond, result()), /다이아 광산 참가자 2명/);
    assert.match(formatPetExploreEventControlReply(raid, result({ relocatedParticipantCount: "3" })), /길드레이드던전 참가자 3명/);
  });

  it("authorizes the operator, reads the current CAS version and records command execution", async () => {
    const scripted = database([[{ id: 7n }], [], [{ version: 7n }]]);
    let providerInput: Record<string, unknown> | undefined;
    const service = new PetExploreEventControlCommandService(scripted.client, {
      setActive: async (input) => {
        providerInput = input;
        return result();
      },
    });
    const command = await service.execute({ eventId: "evt-1", externalUserId: "kakao-1", channelId: "room-1", message: "/펫탐험이벤트비활성화" });
    assert.deepEqual([command?.status, command?.operationId, command?.replayed], ["changed", "101", false]);
    assert.deepEqual([providerInput?.eventCode, providerInput?.active, providerInput?.expectedVersion, providerInput?.operatorId], ["diamond_mine", false, "7", "7"]);
    assert.equal(scripted.executions.some(({ sql }) => sql.includes("INSERT INTO command_executions")), true);
  });

  it("returns no reply for an unlinked or unauthorized operator", async () => {
    const scripted = database([[]]);
    const service = new PetExploreEventControlCommandService(scripted.client, { setActive: async () => result() });
    assert.equal(await service.execute({ eventId: "evt-2", externalUserId: "unknown", channelId: "room-1", message: "/레이드이벤트활성화" }), null);
    assert.equal(scripted.executions.length, 0);
  });
});
