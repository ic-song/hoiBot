import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  MINIPET_PACKAGE_GRANTS,
  buildMinipetPackageGrantReply,
  isMinipetPackageGrantCandidate,
  parseMinipetPackageGrant
} from "../src/admin/minipet-package-grant-policy.js";
import type {
  MinipetPackageGrantCommand,
  MinipetPackageGrantRepository,
  MinipetPackageGrantStoredResult,
  MinipetPackageGrantTransaction
} from "../src/admin/minipet-package-grant-repository.js";
import { MinipetPackageGrantService } from "../src/admin/minipet-package-grant-service.js";

describe("admin minipet package raw parity", () => {
  it("preserves trim candidate and raw anchored parser boundaries", () => {
    for (const prefix of ["/창세패키지", "/창조패키지"]) {
      assert.deepEqual(parseMinipetPackageGrant(`${prefix}, 대상`), {
        status: "parsed", value: { definition: MINIPET_PACKAGE_GRANTS.find(({ command }) => command === prefix), amount: 1n, targetName: "대상" }
      });
      assert.equal(parseMinipetPackageGrant(`${prefix}12, 대상`).status, "parsed");
      assert.equal(parseMinipetPackageGrant(`${prefix}0, 대상`).status, "invalid_amount");
      assert.equal(parseMinipetPackageGrant(` ${prefix}, 대상`).status, "invalid_format");
      assert.deepEqual(parseMinipetPackageGrant(`${prefix}, 대상 `).status, "parsed");
      assert.equal(parseMinipetPackageGrant(`${prefix}, `).status, "parsed");
      for (const raw of [`${prefix}-1, 대상`, `${prefix} 2, 대상`, `${prefix}2 , 대상`, `${prefix}abc, 대상`]) {
        assert.equal(isMinipetPackageGrantCandidate(raw), false);
      }
    }
  });

  it("keeps the legacy format, amount, target, and success replies exact", () => {
    assert.deepEqual(parseMinipetPackageGrant(" /창세패키지, 대상"), {
      status: "invalid_format", data: "올바른 형식으로 입력해 주세요. 예: /시련10, 유저아이디"
    });
    assert.deepEqual(parseMinipetPackageGrant("/창조패키지0, 대상"), {
      status: "invalid_amount", data: "지급 개수는 1개 이상이어야 합니다."
    });
    assert.equal(buildMinipetPackageGrantReply("테스트베타", "컬렉션창세패키지🐹(/컬렉션창세오픈)", 2n),
      "테스트베타님에게 컬렉션창세패키지🐹(/컬렉션창세오픈) 2개를 지급했습니다.");
  });

  it("keeps one app dispatch and command literals inside the policy", async () => {
    const app = await readFile(resolve("src/app.ts"), "utf8");
    assert.equal(app.match(/new MinipetPackageGrantService\(/g)?.length, 1);
    assert.equal(app.match(/isMinipetPackageGrantCandidate\(normalizedEvent\.message\)/g)?.length, 1);
    assert.equal(app.includes("/창세패키지"), false);
    assert.equal(app.includes("/창조패키지"), false);
  });
});

class MemoryRepository implements MinipetPackageGrantRepository {
  authorized = true;
  targetExists = true;
  quantities = new Map<string, bigint>();
  stored = new Map<string, MinipetPackageGrantStoredResult>();
  calls: string[] = [];
  fail = false;

  async withTransaction<T>(work: (transaction: MinipetPackageGrantTransaction) => Promise<T>): Promise<T> {
    const snapshot = { quantities: new Map(this.quantities), stored: new Map(this.stored) };
    try { return await work(this.transaction()); }
    catch (error) { this.quantities = snapshot.quantities; this.stored = snapshot.stored; throw error; }
  }

  private transaction(): MinipetPackageGrantTransaction {
    return {
      findAuthorizedOperator: async () => { this.calls.push("permission"); return this.authorized ? "71" : null; },
      findStoredResult: async (scope, key) => { this.calls.push("stored"); return this.stored.get(`${scope}:${key}`) ?? null; },
      grant: async (operatorId, scope, key, command, parsed) => {
        this.calls.push("target-item-stack-grant");
        if (!this.targetExists || parsed.targetName === "") return null;
        const before = this.quantities.get(parsed.definition.itemCode) ?? 0n;
        const after = before + parsed.amount;
        this.quantities.set(parsed.definition.itemCode, after);
        if (this.fail) throw new Error("synthetic grant failure");
        const result: MinipetPackageGrantStoredResult = {
          status: "granted", operatorId, playerId: "22", commandCode: parsed.definition.commandCode,
          itemCode: parsed.definition.itemCode, itemName: parsed.definition.itemName, targetName: parsed.targetName,
          quantityDelta: parsed.amount.toString(), quantityBefore: before.toString(), quantityAfter: after.toString(),
          data: buildMinipetPackageGrantReply(parsed.targetName, parsed.definition.itemName, parsed.amount),
          outboxId: "81", auditId: "91"
        };
        this.stored.set(`${scope}:${key}`, result);
        return result;
      }
    };
  }
}

const command = (message: string, eventId = "grant-event", roomAllowed = true): MinipetPackageGrantCommand & { roomAllowed: boolean } => ({
  externalUserId: "synthetic-admin-alpha", channelId: "synthetic-room-001", message, eventId, roomAllowed
});

describe("admin minipet package permission, transaction, and replay", () => {
  it("checks operator permission before room and parser, keeping forbidden/outside-room silent", async () => {
    const repository = new MemoryRepository();
    repository.authorized = false;
    assert.equal((await new MinipetPackageGrantService(repository).handle(command(" /창세패키지, 대상"))).status, "ignored_forbidden");
    assert.deepEqual(repository.calls, ["permission"]);
    repository.authorized = true;
    repository.calls = [];
    assert.equal((await new MinipetPackageGrantService(repository).handle(command(" /창세패키지, 대상", "outside", false))).status, "ignored_outside_room");
    assert.deepEqual(repository.calls, ["permission"]);
  });

  it("returns exact errors and grants default/multiple quantities to missing/existing stacks", async () => {
    const repository = new MemoryRepository();
    const service = new MinipetPackageGrantService(repository);
    assert.equal((await service.handle(command(" /창세패키지, 대상", "format"))).status, "invalid_format");
    assert.equal((await service.handle(command("/창세패키지0, 대상", "zero"))).status, "invalid_amount");
    assert.equal((await service.handle(command("/창세패키지, ", "empty"))).status, "target_not_found");
    assert.equal((await service.handle(command("/창세패키지, 테스트베타", "one"))).status, "granted");
    assert.equal((await service.handle(command("/창세패키지2, 테스트베타", "two"))).status, "granted");
    assert.equal(repository.quantities.get("bag_b2fd551a03f6fe6e"), 3n);
    assert.equal((await service.handle(command("/창조패키지3, 테스트베타", "creation"))).status, "granted");
    assert.equal(repository.quantities.get("bag_11319869697c3c00"), 3n);
  });

  it("replays one event without a second grant and rolls failed state back", async () => {
    const repository = new MemoryRepository();
    const service = new MinipetPackageGrantService(repository);
    const value = command("/창조패키지2, 테스트베타");
    const first = await service.handle(value);
    const duplicate = await service.handle(value);
    assert.equal(first.status, "granted");
    assert.equal("duplicate" in duplicate && duplicate.duplicate, true);
    assert.equal(repository.quantities.get("bag_11319869697c3c00"), 2n);
    repository.fail = true;
    await assert.rejects(() => service.handle(command("/창조패키지2, 테스트베타", "rollback")), /synthetic grant failure/);
    assert.equal(repository.quantities.get("bag_11319869697c3c00"), 2n);
  });
});
