import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdminBalanceMutationProvider } from "../src/admin/admin-balance-mutation-provider.js";
import { createFakeBalanceDatabase, createFakeBalanceRepository } from "./fixtures/admin-balance-mutation-provider.js";

const badgePreview = { mode: "apply" as const, domain: "home_badge" as const, operatorId: "7", expectedVersion: "1", reason: "홈뱃지 기준 조정", changes: [{ key: "home_badge.F01.criteria.followers", value: "2" }] };

describe("admin balance mutation provider", () => {
  it("previews typed changes and rejects range, precision, noneditable and sum violations", async () => {
    const repository = createFakeBalanceRepository();
    const { database } = createFakeBalanceDatabase(repository);
    const provider = new AdminBalanceMutationProvider(database, repository);
    const preview = await provider.preview(badgePreview);
    assert.equal(preview.confirmationToken.startsWith("sha256:"), true);
    assert.deepEqual(preview.changes, [{ key: "home_badge.F01.criteria.followers", label: "첫인연 팔로워", before: "1", after: "2", unit: "명" }]);
    await assert.rejects(() => provider.preview({ ...badgePreview, changes: [{ ...badgePreview.changes[0]!, value: "1.5" }] }), /1 단위/);
    await assert.rejects(() => provider.preview({ ...badgePreview, domain: "home_furniture", changes: [{ key: "home_furniture.grade.1.entry_count", value: "11" }] }), /변경할 수 없는 키/);
    await assert.rejects(() => provider.preview({ ...badgePreview, domain: "home_furniture", changes: [{ key: "home_furniture.grade.1.probability", value: "59" }] }), /합계는 정확히 100%/);
    await assert.rejects(() => provider.preview({ ...badgePreview, domain: "pendant", changes: [{ key: "pendant.level.1.success_rate", value: "99.99999" }] }), /0.0001 단위/);
  });

  it("applies all three typed domains with change-log, audit and outbox", async () => {
    const repository = createFakeBalanceRepository();
    const { database, state } = createFakeBalanceDatabase(repository);
    const provider = new AdminBalanceMutationProvider(database, repository);
    const requests = [
      badgePreview,
      { ...badgePreview, domain: "home_furniture" as const, reason: "가구 확률 조정", changes: [{ key: "home_furniture.grade.1.probability", value: "55" }, { key: "home_furniture.grade.2.probability", value: "45" }] },
      { ...badgePreview, domain: "pendant" as const, reason: "펜던트 확률 조정", changes: [{ key: "pendant.level.1.success_rate", value: "99.9999" }] },
    ];
    for (const [index, request] of requests.entries()) {
      const preview = await provider.preview(request);
      const result = await provider.apply({ ...request, idempotencyKey: `apply-${index}`, confirmationToken: preview.confirmationToken, confirmed: true });
      assert.equal(result.version, "2");
      assert.equal(result.replayed, false);
    }
    assert.equal(state.sql.filter((sql) => sql.startsWith("INSERT INTO configuration_change_log")).length, 3);
    assert.equal(state.sql.filter((sql) => sql.startsWith("INSERT INTO command_audit")).length, 3);
    assert.equal(state.sql.filter((sql) => sql.startsWith("INSERT INTO outbox_messages")).length, 3);
  });

  it("replays the same key and rejects a different payload on that key", async () => {
    const repository = createFakeBalanceRepository();
    const { database } = createFakeBalanceDatabase(repository);
    const provider = new AdminBalanceMutationProvider(database, repository);
    const preview = await provider.preview(badgePreview);
    const input = { ...badgePreview, idempotencyKey: "same", confirmationToken: preview.confirmationToken, confirmed: true as const };
    const first = await provider.apply(input);
    const replay = await provider.apply(input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.operationId, first.operationId);
    await assert.rejects(() => provider.apply({ ...input, reason: "다른 변경 사유입니다" }), /다른 요청/);
  });

  it("creates a new version when rolling back to a prior version", async () => {
    const repository = createFakeBalanceRepository();
    const { database } = createFakeBalanceDatabase(repository);
    const provider = new AdminBalanceMutationProvider(database, repository);
    const preview = await provider.preview(badgePreview);
    await provider.apply({ ...badgePreview, idempotencyKey: "apply", confirmationToken: preview.confirmationToken, confirmed: true });
    const rollbackPreview = await provider.preview({ mode: "rollback", domain: "home_badge", operatorId: "7", expectedVersion: "2", targetVersion: "1", reason: "이전 홈뱃지 복구" });
    const rollback = await provider.rollback({ domain: "home_badge", operatorId: "7", expectedVersion: "2", targetVersion: "1", reason: "이전 홈뱃지 복구", idempotencyKey: "rollback", confirmationToken: rollbackPreview.confirmationToken, confirmed: true });
    assert.equal(rollback.version, "3");
    assert.equal(rollback.targetVersion, "1");
    assert.equal((await repository.readCurrent("home_badge")).values[0]!.value, "1");
  });

  it("rejects stale versions and stale confirmation tokens before activation", async () => {
    const repository = createFakeBalanceRepository();
    const { database } = createFakeBalanceDatabase(repository);
    const provider = new AdminBalanceMutationProvider(database, repository);
    await assert.rejects(() => provider.preview({ ...badgePreview, expectedVersion: "99" }), /먼저 변경/);
    const preview = await provider.preview(badgePreview);
    await assert.rejects(() => provider.apply({ ...badgePreview, idempotencyKey: "stale", confirmationToken: `${preview.confirmationToken}0`, confirmed: true }), /오래되었거나/);
    assert.equal((await repository.readCurrent("home_badge")).version, "1");
  });

  it("rolls back domain, operation, change-log and outbox work on audit failure and reconnects cleanly", async () => {
    const repository = createFakeBalanceRepository();
    const { database, state } = createFakeBalanceDatabase(repository);
    const provider = new AdminBalanceMutationProvider(database, repository);
    const preview = await provider.preview(badgePreview);
    state.auditFailure = true;
    await assert.rejects(() => provider.apply({ ...badgePreview, idempotencyKey: "rollback-all", confirmationToken: preview.confirmationToken, confirmed: true }), /synthetic audit failure/);
    assert.equal((await repository.readCurrent("home_badge")).version, "1");
    assert.equal(state.operations.size, 0);
    state.auditFailure = false;
    const reconnected = new AdminBalanceMutationProvider(database, repository);
    const nextPreview = await reconnected.preview(badgePreview);
    const result = await reconnected.apply({ ...badgePreview, idempotencyKey: "after-reconnect", confirmationToken: nextPreview.confirmationToken, confirmed: true });
    assert.equal(result.version, "2");
  });
});
