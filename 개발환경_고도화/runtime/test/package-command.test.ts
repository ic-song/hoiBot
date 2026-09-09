import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPackageCommandCandidate,
  normalizePackageDispatchMessage,
  parsePackageCommand,
} from "../src/package/package-command.js";
import {
  PackageCommandService,
  type PackageHubApplicationPort,
} from "../src/package/package-command-service.js";

describe("package command boundary", () => {
  it("accepts only the exact package bag command", () => {
    assert.equal(isPackageCommandCandidate("/패키지가방"), true);
    assert.equal(isPackageCommandCandidate("/패키지가방 1"), false);
    assert.deepEqual(parsePackageCommand("/패키지가방"), { kind: "PACKAGE_BAG" });
  });

  it("parses bag number and defaults open count to one", () => {
    assert.deepEqual(parsePackageCommand("/패키지사용 2"), {
      kind: "PACKAGE_USE",
      bagNumber: 2,
      openCount: 1,
    });
    assert.deepEqual(parsePackageCommand("/패키지사용 2 30"), {
      kind: "PACKAGE_USE",
      bagNumber: 2,
      openCount: 30,
    });
    assert.equal(normalizePackageDispatchMessage("/패키지사용 2 30"), "/패키지사용");
  });

  it("rejects suffix text, zero and excessive open count", () => {
    assert.deepEqual(parsePackageCommand("/패키지사용 1 해봐"), { kind: "INVALID", reason: "FORMAT" });
    assert.deepEqual(parsePackageCommand("/패키지사용 0"), { kind: "INVALID", reason: "BAG_NUMBER" });
    assert.deepEqual(parsePackageCommand("/패키지사용 1 1001"), { kind: "INVALID", reason: "OPEN_COUNT" });
  });
});

describe("package command application service", () => {
  it("uses the selected package bag entry with the event request key", async () => {
    const calls: unknown[] = [];
    const hub: PackageHubApplicationPort = {
      listBag: async () => [{
        bagNumber: 1,
        packageId: "PKG-209",
        displayName: "루비 패키지",
        quantity: 3,
        maxOpenCount: 100,
      }],
      use: async (request) => {
        calls.push(request);
        return {
          replayed: false,
          packageId: request.packageId,
          displayName: "루비 패키지",
          openCount: request.openCount,
          rewards: [{ displayName: "루비", quantity: 120 }],
        };
      },
    };
    const response = await new PackageCommandService(hub).execute({
      message: "/패키지사용 1 2",
      playerId: "7",
      requestKey: "iris:event-1:package",
    });
    assert.deepEqual(calls, [{
      requestKey: "iris:event-1:package",
      playerId: "7",
      packageId: "PKG-209",
      openCount: 2,
    }]);
    assert.equal(response.commandCode, "PACKAGE_USE");
    assert.match(response.message, /루비 120개/);
  });

  it("does not call the provider when bag quantity is insufficient", async () => {
    let used = false;
    const hub: PackageHubApplicationPort = {
      listBag: async () => [{
        bagNumber: 1,
        packageId: "PKG-209",
        displayName: "루비 패키지",
        quantity: 1,
        maxOpenCount: 100,
      }],
      use: async () => {
        used = true;
        throw new Error("must not execute");
      },
    };
    const response = await new PackageCommandService(hub).execute({
      message: "/패키지사용 1 2",
      playerId: "7",
      requestKey: "iris:event-2:package",
    });
    assert.equal(used, false);
    assert.match(response.message, /보유 수량이 부족/);
  });
});
