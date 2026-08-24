import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/shared/application-error.js";
import {
  handleGuildTerritoryRememberCommand,
  isGuildTerritoryRememberCommand
} from "../src/guild/guild-territory-remember-command-adapter.js";

describe("guild territory remember command adapter", () => {
  it("accepts only exact ON and OFF commands", () => {
    assert.equal(isGuildTerritoryRememberCommand("/날기억해줘온"), true);
    assert.equal(isGuildTerritoryRememberCommand("/날기억해줘오프"), true);
    for (const message of ["/날기억해줘온 ", "/날기억해줘오프 1", "/날기억해줘", undefined]) {
      assert.equal(isGuildTerritoryRememberCommand(message), false);
    }
  });

  it("returns the legacy forbidden reply before identity or mutation", async () => {
    let resolved = false;
    const result = await handleGuildTerritoryRememberCommand(
      { message: "/날기억해줘온", sender: "일반사용자" },
      {
        isMaster: () => false,
        isAdmin: () => false,
        resolveIdentity: async () => { resolved = true; return null; },
        setRememberPreference: async () => { throw new Error("must not mutate"); }
      }
    );
    assert.equal(result.status, "forbidden");
    assert.equal(resolved, false);
  });

  it("maps exact ON/OFF to normalized provider identity and legacy success reply", async () => {
    const commands: boolean[] = [];
    for (const [message, desiredState] of [["/날기억해줘온", true], ["/날기억해줘오프", false]] as const) {
      const result = await handleGuildTerritoryRememberCommand(
        { message, sender: "관리자" },
        {
          isMaster: () => false,
          isAdmin: () => true,
          resolveIdentity: async () => ({ territoryScope: " world-active ", operatorPlayerId: " 1 ", playerId: " 1 " }),
          setRememberPreference: async (command) => {
            commands.push(command.desiredState);
            assert.equal(command.territoryScope, "world-active");
            return { ...command, version: BigInt(commands.length) };
          }
        }
      );
      assert.equal(result.status, "updated");
      if (result.status === "updated") {
        assert.equal(result.desiredState, desiredState);
        assert.match(result.reply, desiredState ? /ON 상태/ : /OFF 상태/);
      }
    }
    assert.deepEqual(commands, [true, false]);
  });

  it("rejects missing identity and provider state mismatch without success reply", async () => {
    await assert.rejects(
      handleGuildTerritoryRememberCommand(
        { message: "/날기억해줘온", sender: "오픈채팅봇" },
        { isMaster: () => false, isAdmin: () => false, resolveIdentity: async () => null,
          setRememberPreference: async () => { throw new Error("must not mutate"); } }
      ),
      (error: unknown) => error instanceof ApplicationError && error.code === "TERRITORY_REMEMBER_IDENTITY_UNAVAILABLE"
    );
    await assert.rejects(
      handleGuildTerritoryRememberCommand(
        { message: "/날기억해줘온", sender: "관리자" },
        { isMaster: () => false, isAdmin: () => true,
          resolveIdentity: async () => ({ territoryScope: "world-active", operatorPlayerId: "1", playerId: "1" }),
          setRememberPreference: async (command) => ({ ...command, desiredState: false, version: 1n }) }
      ),
      (error: unknown) => error instanceof ApplicationError && error.code === "TERRITORY_REMEMBER_STATE_MISMATCH"
    );
  });
});
