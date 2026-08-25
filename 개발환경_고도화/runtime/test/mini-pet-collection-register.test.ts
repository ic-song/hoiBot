import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMiniPetCollectionRegisterCommand,
  MiniPetCollectionRegisterService,
  parseMiniPetCollectionRegisterCommand,
  type MiniPetCollectionRegisterInput,
  type MiniPetCollectionRegisterRepository,
  type MiniPetCollectionRegisterResult
} from "../src/mini-pet/collection-register-service.js";

const token = "123e4567-e89b-42d3-a456-426614174000";

class FakeRepository implements MiniPetCollectionRegisterRepository {
  calls: Array<{ action: string; value: number[] | string }> = [];
  async preview(_input: MiniPetCollectionRegisterInput, bagNumbers: number[]): Promise<MiniPetCollectionRegisterResult> {
    this.calls.push({ action: "preview", value: bagNumbers });
    return { status: "previewed", confirmationToken: token };
  }
  async confirm(_input: MiniPetCollectionRegisterInput, confirmationToken: string): Promise<MiniPetCollectionRegisterResult> {
    this.calls.push({ action: "confirm", value: confirmationToken });
    return { status: "registered" };
  }
  async cancel(_input: MiniPetCollectionRegisterInput, confirmationToken: string): Promise<MiniPetCollectionRegisterResult> {
    this.calls.push({ action: "cancel", value: confirmationToken });
    return { status: "cancelled" };
  }
}

const base = { externalUserId: "user", channelId: "room", eventId: "event" };

describe("mini-pet collection register", () => {
  it("accepts only exact usage, numeric preview, confirm, and cancel forms", () => {
    assert.equal(isMiniPetCollectionRegisterCommand("/컬렉션등록"), true);
    assert.equal(isMiniPetCollectionRegisterCommand("/컬렉션등록 1 8"), true);
    assert.equal(isMiniPetCollectionRegisterCommand(`/컬렉션등록 확인 ${token}`), true);
    assert.equal(isMiniPetCollectionRegisterCommand(`/컬렉션등록 취소 ${token}`), true);
    assert.equal(isMiniPetCollectionRegisterCommand("/컬렉션등록 1 해봐"), false);
    assert.equal(isMiniPetCollectionRegisterCommand("/컬렉션등록확인"), false);
  });

  it("keeps no-argument usage free of repository mutations", async () => {
    const repository = new FakeRepository();
    const result = await new MiniPetCollectionRegisterService(repository).handle({ ...base, message: "/컬렉션등록" });
    assert.equal(result.status, "usage");
    assert.match(result.data ?? "", /사용법/);
    assert.equal(repository.calls.length, 0);
  });

  it("parses one to eight distinct bag numbers and rejects duplicates", () => {
    assert.deepEqual(parseMiniPetCollectionRegisterCommand("/컬렉션등록 8 2 1"), { kind: "preview", bagNumbers: [8, 2, 1] });
    assert.throws(() => parseMiniPetCollectionRegisterCommand("/컬렉션등록 1 1"), /같은 가방번호/);
    assert.equal(parseMiniPetCollectionRegisterCommand("/컬렉션등록 1 2 3 4 5 6 7 8 9"), null);
    assert.equal(parseMiniPetCollectionRegisterCommand("/컬렉션등록 1abc"), null);
  });

  it("delegates preview and token-bound confirm or cancel", async () => {
    const repository = new FakeRepository();
    const service = new MiniPetCollectionRegisterService(repository);
    assert.equal((await service.handle({ ...base, message: "/컬렉션등록 1 2" })).status, "previewed");
    assert.equal((await service.handle({ ...base, message: `/컬렉션등록 확인 ${token}` })).status, "registered");
    assert.equal((await service.handle({ ...base, message: `/컬렉션등록 취소 ${token}` })).status, "cancelled");
    assert.deepEqual(repository.calls, [
      { action: "preview", value: [1, 2] },
      { action: "confirm", value: token },
      { action: "cancel", value: token }
    ]);
  });
});
