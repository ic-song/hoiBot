import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AccountPlatformService,
  readAccountSwitchSelector,
  type AccountPlatformRepository,
  type ActivePlayerSnapshot,
  type SwitchActiveGameAccountInput,
  type SwitchActiveGameAccountResult,
  type VerifyGameAccountInput,
  type VerifyGameAccountResult
} from "../src/account-platform/account-platform-service.js";

type ScopedVerify = VerifyGameAccountInput & { identityScopeKey: string };
type ScopedSwitch = SwitchActiveGameAccountInput & { identityScopeKey: string };
type ScopedContext = Pick<ScopedSwitch, "platformCode" | "contextType" | "externalContextKey" | "externalUserKey" | "identityScopeKey">;

// AMGP 합성 fixture에서 포털·identity·context 불변식을 재현합니다.
class MemoryAccountPlatformRepository implements AccountPlatformRepository {
  private nextPlayer = 1000;
  private nextPortal = 1;
  private nextMembership = 1;
  readonly portals = new Map<string, { portalId: string; links: Array<{ playerId: string; name: string; role: "REPRESENTATIVE" | "SUB" }> }>();
  readonly playerOwners = new Map<string, string>();
  readonly identityOwners = new Map<string, string>();
  readonly memberships = new Map<string, { membershipId: string; portalId: string }>();
  readonly selections = new Map<string, { playerId: string; version: number }>();
  readonly nicknames: string[] = [];
  readonly receipts = new Map<string, VerifyGameAccountResult | SwitchActiveGameAccountResult>();

  // 검증된 게임계정을 대표/부계정 규칙으로 연결하고 현재 context를 선택합니다.
  async linkVerifiedGameAccount(input: ScopedVerify): Promise<VerifyGameAccountResult> {
    const receiptKey = `verify:${input.requestKey}`;
    const replay = this.receipts.get(receiptKey) as VerifyGameAccountResult | undefined;
    if (replay !== undefined) return { ...replay, replayed: true };
    const portal = this.portals.get(input.legacyUserAccountId) ?? { portalId: `portal${this.nextPortal++}`, links: [] };
    const playerId = input.purpose === "NEW_GAME_ACCOUNT" ? String(this.nextPlayer++) : input.targetPlayerId!;
    const owner = this.playerOwners.get(playerId);
    if (owner !== undefined && owner !== portal.portalId) throw new Error("GAME_ACCOUNT_OWNED_BY_OTHER_PORTAL");
    const identityKey = this.identityKey(input);
    const identityOwner = this.identityOwners.get(identityKey);
    if (identityOwner !== undefined && identityOwner !== portal.portalId) throw new Error("PLATFORM_IDENTITY_OWNED_BY_OTHER_PORTAL");
    this.portals.set(input.legacyUserAccountId, portal);
    let link = portal.links.find((candidate) => candidate.playerId === playerId);
    if (link === undefined) {
      link = { playerId, name: input.expectedDisplayName, role: portal.links.length === 0 ? "REPRESENTATIVE" : "SUB" };
      portal.links.push(link);
      this.playerOwners.set(playerId, portal.portalId);
    }
    this.identityOwners.set(identityKey, portal.portalId);
    const membership = this.ensureMembership(input, portal.portalId);
    this.selections.set(membership.membershipId, { playerId, version: (this.selections.get(membership.membershipId)?.version ?? 0) + 1 });
    this.nicknames.push(input.observedDisplayName);
    const result: VerifyGameAccountResult = {
      portalAccountId: portal.portalId, playerId, playerRole: link.role,
      platformIdentityId: identityKey, platformContextMembershipId: membership.membershipId,
      createdPlayer: input.purpose === "NEW_GAME_ACCOUNT", replayed: false
    };
    this.receipts.set(receiptKey, result);
    return result;
  }

  // 현재 context selection만 같은 portal의 대상 게임계정으로 변경합니다.
  async switchActiveGameAccount(input: ScopedSwitch): Promise<SwitchActiveGameAccountResult> {
    const receiptKey = `switch:${input.requestKey}`;
    const replay = this.receipts.get(receiptKey) as SwitchActiveGameAccountResult | undefined;
    if (replay !== undefined) return { ...replay, replayed: true };
    const membership = this.memberships.get(this.membershipKey(input));
    if (membership === undefined) throw new Error("PLATFORM_CONTEXT_AUTH_REQUIRED");
    const portal = [...this.portals.values()].find((candidate) => candidate.portalId === membership.portalId)!;
    const target = portal.links.find((candidate) => candidate.playerId === input.gameAccountSelector || candidate.name === input.gameAccountSelector);
    if (target === undefined) throw new Error("GAME_ACCOUNT_NOT_AVAILABLE");
    const current = this.selections.get(membership.membershipId);
    if (input.expectedSelectionVersion !== undefined && (current?.version ?? 0) !== input.expectedSelectionVersion) throw new Error("ACTIVE_PLAYER_SELECTION_CONFLICT");
    const selectionVersion = (current?.version ?? 0) + 1;
    this.selections.set(membership.membershipId, { playerId: target.playerId, version: selectionVersion });
    const result: SwitchActiveGameAccountResult = { portalAccountId: portal.portalId, playerId: target.playerId, platformContextMembershipId: membership.membershipId, selectionVersion, replayed: false };
    this.receipts.set(receiptKey, result);
    return result;
  }

  // 닉네임만 이력에 추가하고 identity/selection은 유지합니다.
  async observeNickname(input: ScopedContext & { observedDisplayName: string }): Promise<void> {
    if (!this.memberships.has(this.membershipKey(input))) throw new Error("PLATFORM_CONTEXT_AUTH_REQUIRED");
    this.nicknames.push(input.observedDisplayName);
  }

  // 현재 context의 활성 player snapshot을 반환합니다.
  async resolveActivePlayer(input: ScopedContext): Promise<ActivePlayerSnapshot | null> {
    const membership = this.memberships.get(this.membershipKey(input));
    if (membership === undefined) return null;
    const selection = this.selections.get(membership.membershipId);
    return selection === undefined ? null : { portalAccountId: membership.portalId, playerId: selection.playerId, platformContextMembershipId: membership.membershipId, selectionVersion: selection.version };
  }

  // 플랫폼·식별범위·외부 사용자키의 안정 identity key를 만듭니다.
  private identityKey(input: ScopedContext): string {
    return `${input.platformCode}:${input.identityScopeKey}:${input.externalUserKey}`;
  }

  // identity와 방·서버 조합의 membership key를 만듭니다.
  private membershipKey(input: ScopedContext): string {
    return `${this.identityKey(input)}:${input.contextType}:${input.externalContextKey}`;
  }

  // identity와 context의 단일 membership을 반환하거나 생성합니다.
  private ensureMembership(input: ScopedContext, portalId: string) {
    const key = this.membershipKey(input);
    const existing = this.memberships.get(key);
    if (existing !== undefined) return existing;
    const created = { membershipId: `member${this.nextMembership++}`, portalId };
    this.memberships.set(key, created);
    return created;
  }
}

// Kakao 방 범위 fixture를 생성합니다.
const kakao = (room: string, user: string) => ({ platformCode: "KAKAO" as const, contextType: "ROOM" as const, externalContextKey: room, externalUserKey: user });
// Discord 서버 범위 fixture를 생성합니다.
const discord = (server: string, user: string) => ({ platformCode: "DISCORD" as const, contextType: "SERVER" as const, externalContextKey: server, externalUserKey: user });
// 기본 신규 인증 fixture에 시나리오별 값을 덮어씁니다.
const verify = (overrides: Partial<VerifyGameAccountInput> = {}): VerifyGameAccountInput => ({
  ...kakao("room-a", "user-a"), requestKey: "event-1", legacyUserAccountId: "1", purpose: "NEW_GAME_ACCOUNT",
  expectedDisplayName: "대표 남", observedDisplayName: "대표 남", actor: "개발자", ...overrides
});

describe("WBS746 account multi-game platform context", () => {
  it("AMGP-001 creates a new representative player and selects it in the verified context", async () => {
    const repository = new MemoryAccountPlatformRepository();
    const result = await new AccountPlatformService(repository).verifyGameAccount(verify());
    assert.equal(result.createdPlayer, true); assert.equal(result.playerRole, "REPRESENTATIVE");
    assert.equal((await new AccountPlatformService(repository).resolveActivePlayer(kakao("room-a", "user-a")))?.playerId, result.playerId);
  });

  it("AMGP-002 preserves the legacy player_id instead of creating a player", async () => {
    const repository = new MemoryAccountPlatformRepository();
    const result = await new AccountPlatformService(repository).verifyGameAccount(verify({ purpose: "LEGACY_GAME_ACCOUNT_LINK", targetPlayerId: "42" }));
    assert.equal(result.playerId, "42"); assert.equal(result.createdPlayer, false); assert.equal(result.playerRole, "REPRESENTATIVE");
  });

  it("AMGP-003 assigns REPRESENTATIVE once and later links as SUB", async () => {
    const repository = new MemoryAccountPlatformRepository(); const service = new AccountPlatformService(repository);
    const first = await service.verifyGameAccount(verify());
    const second = await service.verifyGameAccount(verify({ requestKey: "event-2", externalUserKey: "user-b", expectedDisplayName: "부계 여", observedDisplayName: "부계 여" }));
    assert.equal(first.playerRole, "REPRESENTATIVE"); assert.equal(second.playerRole, "SUB");
    assert.equal(repository.portals.get("1")?.links.filter((link) => link.role === "REPRESENTATIVE").length, 1);
  });

  it("AMGP-004 keeps Kakao identities and active selections independent by room", async () => {
    const repository = new MemoryAccountPlatformRepository(); const service = new AccountPlatformService(repository);
    const first = await service.verifyGameAccount(verify());
    const second = await service.verifyGameAccount(verify({ ...kakao("room-b", "room-b-user"), requestKey: "event-2", purpose: "LEGACY_GAME_ACCOUNT_LINK", targetPlayerId: first.playerId }));
    assert.notEqual(first.platformIdentityId, second.platformIdentityId); assert.notEqual(first.platformContextMembershipId, second.platformContextMembershipId);
  });

  it("AMGP-005 reuses one Discord identity while selecting independently per server", async () => {
    const repository = new MemoryAccountPlatformRepository(); const service = new AccountPlatformService(repository);
    const first = await service.verifyGameAccount(verify({ ...discord("server-a", "discord-1") }));
    const second = await service.verifyGameAccount(verify({ ...discord("server-b", "discord-1"), requestKey: "event-2", purpose: "LEGACY_GAME_ACCOUNT_LINK", targetPlayerId: first.playerId }));
    assert.equal(first.platformIdentityId, second.platformIdentityId); assert.notEqual(first.platformContextMembershipId, second.platformContextMembershipId);
  });

  it("AMGP-006 /계정변경 changes only the invoking context with an exact guard", async () => {
    const repository = new MemoryAccountPlatformRepository(); const service = new AccountPlatformService(repository);
    const representative = await service.verifyGameAccount(verify());
    const sub = await service.verifyGameAccount(verify({ requestKey: "event-2", externalUserKey: "user-b", expectedDisplayName: "부계 여", observedDisplayName: "부계 여" }));
    await service.verifyGameAccount(verify({ ...kakao("room-b", "room-b-user"), requestKey: "event-3", purpose: "LEGACY_GAME_ACCOUNT_LINK", targetPlayerId: representative.playerId }));
    await service.switchActiveGameAccount({ ...kakao("room-a", "user-a"), requestKey: "switch-1", message: "/계정변경 부계 여", actor: "개발자", expectedSelectionVersion: 1 });
    assert.equal((await service.resolveActivePlayer(kakao("room-a", "user-a")))?.playerId, sub.playerId);
    assert.equal((await service.resolveActivePlayer(kakao("room-b", "room-b-user")))?.playerId, representative.playerId);
    assert.notEqual(representative.playerId, sub.playerId);
    assert.equal(readAccountSwitchSelector("/계정변경 부계 여 해줘"), "부계 여 해줘");
    assert.equal(readAccountSwitchSelector(" /계정변경 부계 여"), null);
  });

  it("AMGP-007 records nickname changes without changing stable identity or active player", async () => {
    const repository = new MemoryAccountPlatformRepository(); const service = new AccountPlatformService(repository);
    const linked = await service.verifyGameAccount(verify());
    await service.observeNickname({ ...kakao("room-a", "user-a"), observedDisplayName: "새 닉네임", actor: "개발자" });
    const snapshot = await service.resolveActivePlayer(kakao("room-a", "user-a"));
    assert.equal(snapshot?.playerId, linked.playerId); assert.deepEqual(repository.nicknames, ["대표 남", "새 닉네임"]);
  });

  it("AMGP-008 rejects duplicate ownership and stale races while replaying the same request once", async () => {
    const repository = new MemoryAccountPlatformRepository(); const service = new AccountPlatformService(repository);
    const first = await service.verifyGameAccount(verify());
    const replay = await service.verifyGameAccount(verify());
    assert.equal(replay.replayed, true); assert.equal(repository.portals.get("1")?.links.length, 1);
    await assert.rejects(() => service.verifyGameAccount(verify({ requestKey: "event-x", legacyUserAccountId: "2", purpose: "LEGACY_GAME_ACCOUNT_LINK", targetPlayerId: first.playerId })), /GAME_ACCOUNT_OWNED_BY_OTHER_PORTAL/);
    await assert.rejects(() => service.verifyGameAccount(verify({ requestKey: "event-y", observedDisplayName: "불일치" })), /플랫폼 닉네임/);
    await assert.rejects(() => service.switchActiveGameAccount({ ...kakao("room-a", "user-a"), requestKey: "switch-x", message: "/계정변경 대표 남", actor: "개발자", expectedSelectionVersion: 0 }), /ACTIVE_PLAYER_SELECTION_CONFLICT/);
  });
});
