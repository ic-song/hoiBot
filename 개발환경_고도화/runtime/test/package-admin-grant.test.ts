import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  buildPackageAdminGrantReply,
  isPackageAdminGrantCommand,
  parsePackageAdminGrantCommand
} from "../src/package/package-admin-grant-policy.js";
import type {
  PackageAdminGrantCommand,
  PackageAdminGrantDomainResult,
  PackageAdminGrantRepository,
  PackageAdminGrantStoredResult,
  PackageAdminGrantTransaction
} from "../src/package/package-admin-grant-repository.js";
import { PackageAdminGrantService } from "../src/package/package-admin-grant-service.js";

describe("/패키지지급 raw guard and parser parity", () => {
  it("accepts only the anchored digits form and normalizes internal whitespace", () => {
    assert.equal(isPackageAdminGrantCommand("/패키지지급 테스트 대상 1 3"), true);
    assert.equal(isPackageAdminGrantCommand("/패키지지급\t테스트   대상\t1 3"), true);
    assert.deepEqual(parsePackageAdminGrantCommand("/패키지지급\t테스트   대상\t1 3"), {
      status: "parsed", value: { targetName: "테스트 대상", listNumber: 1n, count: 3n }
    });
    for (const message of [
      "/패키지지급", " /패키지지급 테스트 1 3", "/패키지지급 테스트 1 3 ",
      "/패키지지급 테스트 -1 3", "/패키지지급 테스트 1 -3",
      "/패키지지급 테스트 1 3.0", "/패키지지급 테스트 1 3x"
    ]) assert.equal(isPackageAdminGrantCommand(message), false, message);
  });

  it("keeps count boundaries exact without Number coercion", () => {
    assert.deepEqual(parsePackageAdminGrantCommand("/패키지지급 대상 1 0"), {
      status: "invalid_count", data: "❌ 지급 수량은 1 이상 10000 이하만 가능합니다."
    });
    assert.equal(parsePackageAdminGrantCommand("/패키지지급 대상 1 1").status, "parsed");
    assert.equal(parsePackageAdminGrantCommand("/패키지지급 대상 1 10000").status, "parsed");
    assert.equal(parsePackageAdminGrantCommand("/패키지지급 대상 1 10001").status, "invalid_count");
    assert.deepEqual(parsePackageAdminGrantCommand("/패키지지급 대상 9007199254740993 1"), {
      status: "parsed", value: { targetName: "대상", listNumber: 9007199254740993n, count: 1n }
    });
  });

  it("keeps the seven-line success reply exact", () => {
    assert.equal(buildPackageAdminGrantReply({
      targetName: "테스트 대상", packageName: "합성 패키지", count: 3000n,
      quantityBefore: 2n, quantityAfter: 3002n, operatorName: "합성 운영자"
    }), [
      "✅ 패키지 지급 완료", "", "대상: 테스트 대상", "패키지: 합성 패키지",
      "지급 수량: 3,000개", "보유 수량: 2개 → 3,002개", "지급자: 합성 운영자"
    ].join("\n"));
  });

  it("keeps exactly one app dispatch", async () => {
    const app = await readFile(resolve("src/app.ts"), "utf8");
    assert.equal(app.match(/new PackageAdminGrantService\(/g)?.length, 1);
    assert.equal(app.match(/isPackageAdminGrantCommand\(normalizedEvent\.message\)/g)?.length, 1);
  });
});

class MemoryRepository implements PackageAdminGrantRepository {
  authorized = true;
  targetExists = true;
  packageEnabled = true;
  quantity = 0n;
  stored = new Map<string, PackageAdminGrantStoredResult>();
  calls: string[] = [];
  fail = false;

  async withTransaction<T>(work: (transaction: PackageAdminGrantTransaction) => Promise<T>): Promise<T> {
    const snapshot = { quantity: this.quantity, stored: new Map(this.stored) };
    try { return await work(this.transaction()); }
    catch (error) { this.quantity = snapshot.quantity; this.stored = snapshot.stored; throw error; }
  }

  private transaction(): PackageAdminGrantTransaction {
    return {
      findAuthorizedOperator: async () => {
        this.calls.push("permission");
        return this.authorized ? { id: "71", name: "합성 운영자" } : null;
      },
      findStoredResult: async (scope, key) => {
        this.calls.push("stored");
        return this.stored.get(`${scope}:${key}`) ?? null;
      },
      grant: async (operator, scope, key, command, parsed): Promise<PackageAdminGrantDomainResult> => {
        this.calls.push("catalog-target-stack");
        if (parsed.listNumber !== 1n) return { status: "package_not_found", data: "❌ 패키지 번호가 올바르지 않습니다." };
        if (!this.packageEnabled) return { status: "package_disabled", data: "❌ 비활성화된 패키지는 지급할 수 없습니다." };
        if (!this.targetExists) return { status: "target_not_found", data: `❌ 대상 유저가 존재하지 않습니다: ${parsed.targetName}` };
        const before = this.quantity;
        this.quantity += parsed.count;
        if (this.fail) throw new Error("synthetic rollback");
        const data = buildPackageAdminGrantReply({
          targetName: parsed.targetName, packageName: "합성 스타터 패키지", count: parsed.count,
          quantityBefore: before, quantityAfter: this.quantity, operatorName: operator.name
        });
        const result: PackageAdminGrantStoredResult = {
          status: "granted", operatorId: operator.id, operatorName: operator.name, playerId: "22",
          targetName: parsed.targetName, packageCode: "synthetic-starter-package",
          packageName: "합성 스타터 패키지", bagItemCode: "synthetic_package_token",
          catalogVersion: "1", listNumber: parsed.listNumber.toString(), count: parsed.count.toString(),
          quantityBefore: before.toString(), quantityAfter: this.quantity.toString(),
          data, outboxId: "81", auditId: "91"
        };
        this.stored.set(`${scope}:${key}`, result);
        return result;
      }
    };
  }
}

const command = (message: string, eventId = "package-grant-event"): PackageAdminGrantCommand => ({
  externalUserId: "synthetic-admin-alpha", channelId: "synthetic-room-001", message, eventId
});

describe("/패키지지급 permission, transaction, and idempotency", () => {
  it("checks permission before parsing and keeps non-admin silent", async () => {
    const repository = new MemoryRepository();
    repository.authorized = false;
    assert.equal((await new PackageAdminGrantService(repository).handle(command("/패키지지급 대상 1 1"))).status, "ignored_forbidden");
    assert.deepEqual(repository.calls, ["permission"]);
  });

  it("handles normal, catalog, target, and disabled cases", async () => {
    const repository = new MemoryRepository();
    const service = new PackageAdminGrantService(repository);
    assert.equal((await service.handle(command("/패키지지급 대상 1 1", "one"))).status, "granted");
    assert.equal((await service.handle(command("/패키지지급 대상 1 10000", "max"))).status, "granted");
    assert.equal(repository.quantity, 10001n);
    assert.equal((await service.handle(command("/패키지지급 대상 0 1", "list-zero"))).status, "package_not_found");
    repository.targetExists = false;
    assert.equal((await service.handle(command("/패키지지급 없는 대상 1 1", "missing"))).status, "target_not_found");
    repository.targetExists = true;
    repository.packageEnabled = false;
    assert.equal((await service.handle(command("/패키지지급 대상 1 1", "disabled"))).status, "package_disabled");
  });

  it("replays a duplicate without a second delta and rolls failed work back", async () => {
    const repository = new MemoryRepository();
    const service = new PackageAdminGrantService(repository);
    const value = command("/패키지지급 대상 1 3");
    assert.equal((await service.handle(value)).status, "granted");
    const duplicate = await service.handle(value);
    assert.equal("duplicate" in duplicate && duplicate.duplicate, true);
    assert.equal(repository.quantity, 3n);
    repository.fail = true;
    await assert.rejects(() => service.handle(command("/패키지지급 대상 1 2", "rollback")), /synthetic rollback/);
    assert.equal(repository.quantity, 3n);
  });
});
