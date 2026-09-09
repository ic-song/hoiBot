import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePackageCatalogAdminCommand, parsePackageCatalogRewards } from "../src/package/package-catalog-admin-command.js";
import {
  PackageCatalogAdminService,
  type PackageCatalogAdminRepository,
  type PackageCatalogMutationRequest,
} from "../src/package/package-catalog-admin-service.js";
import { SYNTHETIC_PACKAGE_CATALOG } from "./fixtures/package-catalog-admin.js";

class RecordingRepository implements PackageCatalogAdminRepository {
  public readonly mutations: PackageCatalogMutationRequest[] = [];

  public async readSnapshot() {
    return { catalogVersion: 7n, entries: SYNTHETIC_PACKAGE_CATALOG };
  }

  public async mutate(request: PackageCatalogMutationRequest) {
    this.mutations.push(request);
    const packageId = request.mutation.action === "ADD" ? "PKG-SYNTH-004" : request.mutation.packageId;
    return { replayed: false, catalogVersion: 8n, packageId, message: "처리되었습니다." };
  }
}

describe("package catalog admin command parser", () => {
  it("parses standard and natural rewards without losing order or comma quantities", () => {
    assert.deepEqual(parsePackageCatalogRewards("point:10, item:합성아이템:2"), [
      { rewardType: "POINT", assetCode: "POINT", quantity: 10n },
      { rewardType: "ITEM", assetCode: "합성아이템", quantity: 2n },
    ]);
    assert.deepEqual(parsePackageCatalogRewards("합성아이템 x4,000, 합성아이템 x2"), [
      { rewardType: "ITEM", assetCode: "합성아이템", quantity: 4000n },
      { rewardType: "ITEM", assetCode: "합성아이템", quantity: 2n },
    ]);
  });

  it("accepts exact mutation guards and the remove alias", () => {
    assert.equal(parsePackageCatalogAdminCommand("/패키지추가 이름 | 설명 | point:1")?.kind, "ADD");
    assert.equal(parsePackageCatalogAdminCommand("/패키지수정 2 | item:A:3")?.kind, "EDIT");
    assert.equal(parsePackageCatalogAdminCommand("/패키지리스트제거 2")?.kind, "REMOVE");
    assert.equal(parsePackageCatalogAdminCommand("/패키지활성 2")?.kind, "ENABLE");
  });

  it("rejects suffix and malformed numeric forms before mutation", () => {
    assert.equal(parsePackageCatalogAdminCommand("/패키지제거 2 안내"), undefined);
    assert.equal(parsePackageCatalogAdminCommand("/패키지수정 1.5 | point:1"), undefined);
    assert.equal(parsePackageCatalogAdminCommand("/패키지활성 -1"), undefined);
    assert.equal(parsePackageCatalogAdminCommand("/패키지추가 이름 | 설명 | point:1 | extra"), undefined);
  });
});

describe("package catalog admin service", () => {
  it("resolves a compact list number to the stable package id and current version", async () => {
    const repository = new RecordingRepository();
    const service = new PackageCatalogAdminService(repository);
    const command = parsePackageCatalogAdminCommand("/패키지수정 2 | item:합성아이템:3");
    assert.ok(command);
    await service.execute({ command, requestKey: "fixture-edit", actorOperatorId: "operator-1" });
    assert.equal(repository.mutations[0]?.expectedCatalogVersion, 7n);
    assert.deepEqual(repository.mutations[0]?.mutation, {
      action: "EDIT",
      packageId: "PKG-SYNTH-002",
      rewards: [{ rewardType: "ITEM", assetCode: "합성아이템", quantity: 3n }],
    });
  });

  it("assigns append order and rejects duplicate names without repository mutation", async () => {
    const repository = new RecordingRepository();
    const service = new PackageCatalogAdminService(repository);
    const add = parsePackageCatalogAdminCommand("/패키지추가 신규 | 설명 | point:1");
    assert.ok(add);
    await service.execute({ command: add, requestKey: "fixture-add", actorOperatorId: "operator-1" });
    assert.equal(repository.mutations[0]?.mutation.action, "ADD");
    assert.equal(repository.mutations[0]?.mutation.action === "ADD" ? repository.mutations[0].mutation.displayOrder : 0, 4);
    const duplicate = parsePackageCatalogAdminCommand("/패키지추가 합성 패키지 하나 | 설명 | point:1");
    assert.ok(duplicate);
    await assert.rejects(() => service.execute({ command: duplicate, requestKey: "fixture-duplicate", actorOperatorId: "operator-1" }), /같은 이름/);
    assert.equal(repository.mutations.length, 1);
  });

  it("passes an explicit stale expected version to the atomic repository boundary", async () => {
    const repository = new RecordingRepository();
    const service = new PackageCatalogAdminService(repository);
    const command = parsePackageCatalogAdminCommand("/패키지활성 2");
    assert.ok(command);
    await service.execute({ command, requestKey: "fixture-stale", actorOperatorId: "operator-1", expectedCatalogVersion: 6n });
    assert.equal(repository.mutations[0]?.expectedCatalogVersion, 6n);
  });
});
