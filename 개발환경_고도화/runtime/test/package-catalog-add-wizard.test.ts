import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPackageCatalogWizardStatus, parsePackageCatalogWizardControl, parseWizardQuantity, type PackageCatalogWizardDraft } from "../src/package/package-catalog-add-wizard.js";
import { PackageCatalogAddWizardService, type PackageCatalogWizardRepository, type PackageCatalogWizardResult, type PackageCatalogWizardSession } from "../src/package/package-catalog-add-wizard-service.js";
import { PACKAGE_CATALOG_WIZARD_FIXTURES } from "./fixtures/package-catalog-add-wizard.js";

class MemoryRepository implements PackageCatalogWizardRepository {
  public session?: PackageCatalogWizardSession;
  public readonly replays = new Map<string, PackageCatalogWizardResult>();
  public finalized = 0;
  public async findReplay(key: string) { return this.replays.get(key); }
  public async readActive(operatorId: string, now: Date) { return this.session?.operatorId === operatorId && this.session.expiresAt > now ? this.session : undefined; }
  public async start(input: { operatorId: string; requestKey: string; now: Date; expiresAt: Date }) {
    this.session = { sessionId: "S1", operatorId: input.operatorId, version: (this.session?.version ?? 0n) + 1n, baseCatalogVersion: 7n, expiresAt: input.expiresAt,
      draft: { step: "NAME", name: "", description: "", rewards: [] } };
    const result = { message: PackageCatalogAddWizardService.startMessage(), replayed: false, session: this.session }; this.replays.set(input.requestKey, result); return result;
  }
  public async cancel(input: { requestKey: string; message: string }) { this.session = undefined; const result = { message: input.message, replayed: false }; this.replays.set(input.requestKey, result); return result; }
  public async transition(input: { requestKey: string; expectedVersion: bigint; draft: PackageCatalogWizardDraft; message: string }) {
    assert.equal(this.session?.version, input.expectedVersion); this.session = { ...this.session!, version: input.expectedVersion + 1n, draft: input.draft };
    const result = { message: input.message, replayed: false, session: this.session }; this.replays.set(input.requestKey, result); return result;
  }
  public async finalize(input: { requestKey: string; expectedVersion: bigint; message: string }) { assert.equal(this.session?.version, input.expectedVersion); this.finalized += 1; this.session = undefined;
    const result = { message: input.message, replayed: false, packageId: "PKG-CUSTOM-000008", outboxId: "1" }; this.replays.set(input.requestKey, result); return result; }
}

describe("package catalog add wizard", () => {
  it("keeps four exact control commands and rejects suffix text", () => {
    assert.equal(parsePackageCatalogWizardControl("/패키지추가시작")?.kind, "START");
    assert.equal(parsePackageCatalogWizardControl("/패키지추가취소")?.kind, "CANCEL");
    assert.equal(parsePackageCatalogWizardControl("/패키지추가상태")?.kind, "STATUS");
    assert.equal(parsePackageCatalogWizardControl("/패키지추가방법")?.kind, "GUIDE");
    assert.equal(parsePackageCatalogWizardControl("/패키지추가시작 안내"), undefined);
  });

  it("uses strict positive bigint quantities", () => {
    assert.equal(parseWizardQuantity("4000"), 4000n);
    assert.equal(parseWizardQuantity("4,000"), undefined);
    assert.equal(parseWizardQuantity("10개"), undefined);
    assert.equal(parseWizardQuantity("0"), undefined);
  });

  it("starts, overwrites and cancels a persistent operator session", async () => {
    const repository = new MemoryRepository(); const service = new PackageCatalogAddWizardService(repository);
    await service.execute({ operatorId: "1", requestKey: "start-1", command: { kind: "START" }, now: new Date(0) });
    const firstVersion = repository.session!.version;
    await service.execute({ operatorId: "1", requestKey: "start-2", command: { kind: "START" }, now: new Date(1) });
    assert.ok(repository.session!.version > firstVersion);
    assert.match((await service.execute({ operatorId: "1", requestKey: "cancel", command: { kind: "CANCEL" }, now: new Date(2) })).message, /취소/);
    assert.equal(repository.session, undefined);
  });

  it("advances name, description, point and item rewards in order", async () => {
    const repository = new MemoryRepository(); const service = new PackageCatalogAddWizardService(repository);
    await service.execute({ operatorId: "1", requestKey: "s", command: { kind: "START" }, now: new Date(0) });
    const messages = ["합성패키지", "합성 설명", "1", "100", "2", "합성아이템", "3"];
    for (let index = 0; index < messages.length; index += 1) await service.execute({ operatorId: "1", requestKey: `e${index}`, command: { kind: "FLOW", text: messages[index]! }, now: new Date(index + 1) });
    assert.deepEqual(repository.session!.draft.rewards, [
      { rewardType: "POINT", assetCode: "POINT", quantity: 100n },
      { rewardType: "ITEM", assetCode: "합성아이템", quantity: 3n },
    ]);
    assert.equal(repository.session!.draft.step, "REWARD_CHOICE");
  });

  it("finalizes once and replays the same event without another catalog mutation", async () => {
    const repository = new MemoryRepository(); const service = new PackageCatalogAddWizardService(repository);
    await service.execute({ operatorId: "1", requestKey: "s", command: { kind: "START" }, now: new Date(0) });
    repository.session = { ...repository.session!, draft: { step: "CONFIRM", name: "합성", description: "설명", rewards: [{ rewardType: "POINT", assetCode: "POINT", quantity: 1n }] } };
    const first = await service.execute({ operatorId: "1", requestKey: "final", command: { kind: "FLOW", text: "등록" }, now: new Date(1) });
    const replay = await service.execute({ operatorId: "1", requestKey: "final", command: { kind: "FLOW", text: "등록" }, now: new Date(2) });
    assert.equal(first.packageId, "PKG-CUSTOM-000008"); assert.equal(replay.replayed, true); assert.equal(repository.finalized, 1);
  });

  it("formats active status and covers all sixteen synthetic scenarios", () => {
    const draft: PackageCatalogWizardDraft = { step: "REWARD_CHOICE", name: "합성", description: "설명", rewards: [{ rewardType: "POINT", assetCode: "POINT", quantity: 1000n }] };
    assert.match(formatPackageCatalogWizardStatus(draft), /포인트 🅟1,000/);
    assert.equal(PACKAGE_CATALOG_WIZARD_FIXTURES.length, 16);
    assert.equal(new Set(PACKAGE_CATALOG_WIZARD_FIXTURES.map((fixture) => fixture.id)).size, 16);
  });
});
