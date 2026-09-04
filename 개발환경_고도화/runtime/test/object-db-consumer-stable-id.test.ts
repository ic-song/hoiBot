import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  createConsumerIdResolver,
  deriveConsumerLogicalKey,
  OBJECT_DB_CONSUMER_ID_REGISTRY_SEED_SHA256,
  parseConsumerIdRegistry,
  type ConsumerIdRegistry,
  type StableConsumerIdentity
} from "../src/data-migration/object-db-consumer-id-registry.js";

const registryUrl = new URL("../../migration-control/contracts/object-db-consumer-id-registry.v1.json", import.meta.url);
const manifestUrl = new URL("../../migration-control/contracts/object-db-consumer-manifest.v1.json", import.meta.url);
const registry = parseConsumerIdRegistry(JSON.parse(readFileSync(registryUrl, "utf8")));
const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as {
  baseCommit: string;
  consumerSetSha256: string;
  consumers: Array<StableConsumerIdentity & { consumerId: string }>;
};

function makeRegistry(entries: ConsumerIdRegistry["entries"]): ConsumerIdRegistry {
  return {
    format: "hoibot-object-db-consumer-id-registry-v1",
    logicalKeyVersion: "consumer-logical-key-v1",
    newConsumerIdVersion: "consumer-logical-id-v2",
    baseCommit: "f97be62292c3f7e8ea79b2d6f302dd25517584d4",
    sourceManifestConsumerSetSha256: OBJECT_DB_CONSUMER_ID_REGISTRY_SEED_SHA256,
    entries
  };
}

describe("object DB consumer stable ID registry", () => {
  it("keeps immutable seed provenance separate from the current manifest evidence hash", () => {
    assert.equal(registry.baseCommit, manifest.baseCommit);
    assert.equal(registry.sourceManifestConsumerSetSha256, OBJECT_DB_CONSUMER_ID_REGISTRY_SEED_SHA256);
    assert.equal(createHash("sha256").update(JSON.stringify(manifest.consumers)).digest("hex"), manifest.consumerSetSha256);
    assert.notEqual(manifest.consumerSetSha256, OBJECT_DB_CONSUMER_ID_REGISTRY_SEED_SHA256);
    assert.equal(registry.entries.length, 1_102);
    assert.equal(registry.entries.every(({ state }) => state === "ACTIVE"), true);
    const registered = new Map(registry.entries.map(({ logicalKey, consumerId }) => [logicalKey, consumerId]));
    const current = new Map(manifest.consumers.map((consumer) => [deriveConsumerLogicalKey(consumer), consumer.consumerId]));
    assert.equal(current.size, 1_102);
    assert.equal(new Set(manifest.consumers.map(({ consumerId }) => consumerId)).size, 1_102);
    assert.deepEqual(current, registered);
    const resolveId = createConsumerIdResolver(registry);
    for (const consumer of manifest.consumers) assert.equal(resolveId(consumer), consumer.consumerId, deriveConsumerLogicalKey(consumer));
  });

  it("keeps the accepted timer and raw runtime guard IDs when source offsets move", () => {
    const resolveId = createConsumerIdResolver(registry);
    assert.equal(resolveId({
      kind: "AUTOMATIC_CALLBACK",
      file: "개발환경_고도화/runtime/src/app.ts",
      symbol: "accountCleanupTimer",
      triggerOrPredicate: "TIMER:setInterval@1"
    }), "automatic-callback-9d5ecb80cb2eb5a4");
    assert.equal(resolveId({
      kind: "AUTOMATIC_CALLBACK",
      file: "개발환경_고도화/runtime/src/app.ts",
      symbol: "accountCleanupTimer",
      triggerOrPredicate: "TIMER:setInterval@999999"
    }), "automatic-callback-9d5ecb80cb2eb5a4");
    const rawGuard = (offset: number): StableConsumerIdentity => ({
      kind: "RUNTIME_DISPATCH",
      file: "개발환경_고도화/runtime/src/app.ts",
      symbol: `predicate=message-guard@${offset};service=IrisAdminCommandService|IrisAdminCommandService.changePlayerServer`,
      triggerOrPredicate: `predicate=message-guard@${offset};service=IrisAdminCommandService|IrisAdminCommandService.changePlayerServer`
    });
    assert.equal(resolveId(rawGuard(12)), "runtime-dispatch-3470c2d79f013a8c");
    assert.equal(resolveId(rawGuard(987654)), "runtime-dispatch-3470c2d79f013a8c");
  });

  it("does not use discovery order, HTTP index, or legacy source position for identity", () => {
    const resolveId = createConsumerIdResolver(registry);
    const http: StableConsumerIdentity = {
      kind: "HTTP_WEB_ROUTE",
      file: "개발환경_고도화/runtime/src/admin/routes.ts",
      symbol: "registerAdminRoutes",
      triggerOrPredicate: "GET|/api/v1/admin/overview"
    };
    const legacy: StableConsumerIdentity = {
      kind: "LEGACY_COMMAND",
      file: "main.js",
      symbol: "response",
      triggerOrPredicate: 'msg === "/가방" || msg === "ㄴㄴㄴ"'
    };
    const forward = [resolveId(http), resolveId(legacy)];
    const reverseResolver = createConsumerIdResolver(registry);
    const reverse = [reverseResolver(legacy), reverseResolver(http)].reverse();
    assert.deepEqual(forward, reverse);
    assert.equal(forward[0], "http-web-route-ec81112b73cf8381");
    assert.equal(forward[1], manifest.consumers.find((consumer) => deriveConsumerLogicalKey(consumer) === deriveConsumerLogicalKey(legacy))?.consumerId);
  });

  it("assigns deterministic v2 IDs to new logical keys independent of discovery order", () => {
    const left: StableConsumerIdentity = { kind: "APP_WIRING", file: "runtime/src/example.ts", symbol: "dispatchAlpha", triggerOrPredicate: "dispatchAlpha" };
    const right: StableConsumerIdentity = { kind: "HTTP_WEB_ROUTE", file: "runtime/src/routes.ts", symbol: "registerRoutes", triggerOrPredicate: "GET|/v2/example" };
    const first = createConsumerIdResolver(registry);
    const firstIds = [first(left), first(right)];
    const second = createConsumerIdResolver(registry);
    const secondIds = [second(right), second(left)].reverse();
    assert.deepEqual(firstIds, secondIds);
    assert.match(firstIds[0]!, /^app-wiring-[a-f0-9]{16}$/);
    assert.match(firstIds[1]!, /^http-web-route-[a-f0-9]{16}$/);
  });

  it("fails closed on duplicate or conflicting registry mappings and tombstone reuse", () => {
    const keyA = deriveConsumerLogicalKey({ kind: "LEGACY_COMMAND", file: "main.js", symbol: "response", triggerOrPredicate: "A" });
    const keyB = deriveConsumerLogicalKey({ kind: "LEGACY_COMMAND", file: "main.js", symbol: "response", triggerOrPredicate: "B" });
    assert.throws(() => parseConsumerIdRegistry(makeRegistry([
      { logicalKey: keyA, consumerId: "legacy-1111111111111111", state: "ACTIVE" },
      { logicalKey: keyA, consumerId: "legacy-2222222222222222", state: "ACTIVE" }
    ])), /duplicate.*logicalKey/);
    assert.throws(() => parseConsumerIdRegistry(makeRegistry([
      { logicalKey: keyA, consumerId: "legacy-1111111111111111", state: "ACTIVE" },
      { logicalKey: keyB, consumerId: "legacy-1111111111111111", state: "ACTIVE" }
    ])), /duplicate.*consumerId/);
    const tombstoned = makeRegistry([{ logicalKey: keyA, consumerId: "legacy-1111111111111111", state: "TOMBSTONE" }]);
    assert.throws(() => createConsumerIdResolver(tombstoned)({ kind: "LEGACY_COMMAND", file: "main.js", symbol: "response", triggerOrPredicate: "A" }), /tombstoned/);
  });
});
