import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  auditObjectDbRuntimeAdoption,
  auditObjectDbRuntimeAdoptionSources as runObjectDbRuntimeAdoptionSourceAudit,
  type ObjectDbRuntimeAdoptionExpectedHashes,
  type ObjectDbRuntimeAdoptionSources,
} from "../src/data-migration/object-db-runtime-adoption-audit.js";

const validApp = `
async function dispatchPetExploreSettlementCommand(ingress: any, isOperationalChannel: boolean, duplicate: boolean, event: any) {
  if (ingress === undefined || !isOperationalChannel || duplicate !== false
    || event.direction !== "incoming" || !isPetExploreSettlementCommand(event.message)
    || event.userId === undefined || event.channelId === undefined) return;
  await ingress.handle(event);
}
async function dispatchPetExploreEventControlCommand(ingress: any, isOperationalChannel: boolean, duplicate: boolean, event: any) {
  if (ingress === undefined || !isOperationalChannel || duplicate !== false
    || event.direction !== "incoming" || !isPetExploreEventControlCommand(event.message)
    || event.userId === undefined || event.channelId === undefined) return;
  await ingress.handle(event);
}
async function dispatchPetExploreCommandConsumers(ingress: any, isOperationalChannel: boolean, duplicate: boolean, event: any) {
  await dispatchPetExploreSettlementCommand(ingress, isOperationalChannel, duplicate, event);
  await dispatchPetExploreEventControlCommand(ingress, isOperationalChannel, duplicate, event);
}
async function dispatchPetDataCompareCommand(ingress: any, isOperationalChannel: boolean, duplicate: boolean, event: any) {
  if (ingress === undefined || !isOperationalChannel || duplicate !== false
    || event.direction !== "incoming" || !isPetDataCompareCommand(event.message)
    || event.userId === undefined || event.channelId === undefined) return "not_applicable";
  const result = await ingress.handle(event);
  if (result.status === "ignored") return "not_applicable";
  if (result.status === "legacy_fallback") return "legacy_fallback";
  return "claimed";
}
export function buildApp() {
  const appWiringOperationProvider = new MariaAppWiringOperationProvider(database, dependencies.environmentContext);
  const petExploreAppWiringIngress = new PetExploreAppWiringIngress(appWiringOperationProvider, new CommandDispatcher(new MariaCommandRouteReader(database)));
  const petDataCompareAppWiringIngress = new PetDataCompareAppWiringIngress(appWiringOperationProvider, new CommandDispatcher(new MariaCommandRouteReader(database)));
  const irisAdminCommandService = new IrisAdminCommandService(database);
  app.post<{ Body: IrisPayload }>("/api/v1/integrations/iris/events", {}, async (request, reply) => {
    const normalizedEvent = normalizeIrisEvent(request.body);
    const processing = eventProcessor === undefined ? undefined : await eventProcessor.execute(normalizedEvent);
    await dispatchPetExploreCommandConsumers(petExploreAppWiringIngress, isOperationalChannel, processing?.duplicate, normalizedEvent);
    const petDataCompareDisposition = await dispatchPetDataCompareCommand(petDataCompareAppWiringIngress, isOperationalChannel, processing?.duplicate, normalizedEvent);
    if (isOperationalChannel && processing !== undefined && !processing.duplicate
      && petDataCompareDisposition !== "claimed" && isPointEditCommandCandidate(normalizedEvent.message)) {
      await irisAdminCommandService.changePlayerPoint(normalizedEvent);
    }
  });
}
`;

const validIngress = `
import { executeAppWiringEntrypoint } from "../dispatch/app-wiring-entrypoint-runner.js";
function forbiddenMutation() { throw new Error("closed"); }
export class PetExploreAppWiringIngress {
  async handle(event: any) {
    const family = familyOf(event.message);
    const decision = await this.dispatcher.resolveReadOnly(event);
    if (decision.route === "LEGACY_FALLBACK") return { status: "legacy_fallback" };
    if (decision.route === "MODERN" && family !== "EVENT_CONTROL") throw new Error("closed");
    const route = { ...decision, effectMode: decision.route === "MODERN" ? "MUTATION" as const : "READ_ONLY" as const };
    return executeAppWiringEntrypoint(this.provider, {
      claim: { entrypointKind: "IRIS", actor: "pet_explore_app_wiring" },
      resolveRoute: () => route,
      handlers: {
        MODERN: { READ_ONLY: forbiddenMutation, MUTATION: async (database, claim) => {
          if (family !== "EVENT_CONTROL") return forbiddenMutation();
          const result = await this.eventControlProvider.execute(database, event, claim);
          return { typedReceipt: { receiptKind: "PET_EXPLORE_EVENT_CONTROL", petExploreEventControlOperationId: result.operationId } };
        } },
        LEGACY_FALLBACK: { READ_ONLY: forbiddenMutation, MUTATION: forbiddenMutation },
        SHADOW: async () => ({ status: "shadow" }),
        REJECT: async () => ({ status: "rejected" }),
      },
    });
  }
}
`;

const validPetExploreEventControlProvider = `export class PetExploreEventControlAppWiringProvider { async execute(database, event, claim) { await database.execute("INSERT"); return { operationId: "event001" }; } }`;
const validAppWiringOperationProvider = `const RECEIPT = { PET_EXPLORE_EVENT_CONTROL: ["pet_explore_event_control_operation_id","canonical_pet_explore_event_control_operations","operation_status",7] };`;
const validPetExploreEventControlMigration = `CREATE TABLE canonical_pet_explore_event_control_operations; ALTER TABLE canonical_app_wiring_receipt_links ADD COLUMN pet_explore_event_control_operation_id CHAR(8);`;
const validPetExploreEventControlRollback = `ALTER TABLE canonical_app_wiring_receipt_links DROP COLUMN pet_explore_event_control_operation_id; DROP TABLE canonical_pet_explore_event_control_operations;`;

const validPetDataCompareIngress = `
import { executeAppWiringEntrypoint } from "../dispatch/app-wiring-entrypoint-runner.js";
function forbiddenMutation() { throw new Error("closed"); }
export class PetDataCompareAppWiringIngress {
  async handle(event: any) {
    if (!isPetDataCompareCommand(event.message)
      || event.direction !== "incoming"
      || event.userId === undefined
      || event.channelId === undefined) return { status: "ignored" };
    const dispatchInput = {
      eventId: event.eventId,
      message: event.message,
      userId: event.userId,
      hasTrustedDisplayName: event.displayNameTrust === "trusted",
    } as const;
    const decision = await this.dispatcher.resolveReadOnly(dispatchInput);
    if (decision.route === "LEGACY_FALLBACK") return { status: "legacy_fallback" };
    if (decision.route === "MODERN") throw new Error("closed");
    const route = { ...decision, effectMode: "READ_ONLY" as const };
    return executeAppWiringEntrypoint(this.provider, {
      claim: {
        entrypointKind: "IRIS",
        normalizedPayload: { trustedDisplayName: event.displayNameTrust === "trusted" },
        actor: "pet_data_compare_app_wiring",
      },
      resolveRoute: () => route,
      handlers: {
        MODERN: { READ_ONLY: forbiddenMutation, MUTATION: forbiddenMutation },
        LEGACY_FALLBACK: { READ_ONLY: forbiddenMutation, MUTATION: forbiddenMutation },
        SHADOW: async () => ({ status: "shadow" }),
        REJECT: async () => ({ status: "rejected" }),
      },
    });
  }
}
`;

const validPetDataCompareShadowEvaluator = `
export class MariaPetDataCompareShadowEvaluator {
  async preview(database: unknown, event: unknown) { return { authorized: true }; }
}
`;

const canonicalHash = (value: string): string => createHash("sha256").update(value.replace(/\r\n?/g, "\n"), "utf8").digest("hex");

function actualRepositoryHashes(): ObjectDbRuntimeAdoptionExpectedHashes {
  const read = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8");
  return {
    appSourceSha256: canonicalHash(read("../src/app.ts")),
    petExploreIngressSourceSha256: canonicalHash(read("../src/pet/pet-explore-app-wiring-ingress.ts")),
    petExploreEventControlProviderSourceSha256: canonicalHash(read("../src/pet/pet-explore-event-control-app-wiring-provider.ts")),
    appWiringOperationProviderSourceSha256: canonicalHash(read("../src/dispatch/app-wiring-operation-provider.ts")),
    petExploreEventControlMigrationSourceSha256: canonicalHash(read("../migrations/470_pet_explore_event_control_app_wiring.sql")),
    petExploreEventControlRollbackSourceSha256: canonicalHash(read("../migrations/rollback/470_pet_explore_event_control_app_wiring.rollback.sql")),
    petDataCompareIngressSourceSha256: canonicalHash(read("../src/admin/pet-data-compare-app-wiring-ingress.ts")),
    petDataCompareShadowEvaluatorSourceSha256: canonicalHash(read("../src/admin/pet-data-compare-shadow-snapshot-provider.ts")),
  };
}

const REVIEWED_FIXTURE_HASHES: ObjectDbRuntimeAdoptionExpectedHashes = Object.freeze({
  appSourceSha256: canonicalHash(validApp),
  petExploreIngressSourceSha256: canonicalHash(validIngress),
  petExploreEventControlProviderSourceSha256: canonicalHash(validPetExploreEventControlProvider),
  appWiringOperationProviderSourceSha256: canonicalHash(validAppWiringOperationProvider),
  petExploreEventControlMigrationSourceSha256: canonicalHash(validPetExploreEventControlMigration),
  petExploreEventControlRollbackSourceSha256: canonicalHash(validPetExploreEventControlRollback),
  petDataCompareIngressSourceSha256: canonicalHash(validPetDataCompareIngress),
  petDataCompareShadowEvaluatorSourceSha256: canonicalHash(validPetDataCompareShadowEvaluator),
});

function sources(overrides: Partial<ObjectDbRuntimeAdoptionSources> = {}): ObjectDbRuntimeAdoptionSources {
  return {
    appSource: validApp,
    petExploreIngressSource: validIngress,
    petExploreEventControlProviderSource: validPetExploreEventControlProvider,
    appWiringOperationProviderSource: validAppWiringOperationProvider,
    petExploreEventControlMigrationSource: validPetExploreEventControlMigration,
    petExploreEventControlRollbackSource: validPetExploreEventControlRollback,
    petDataCompareIngressSource: validPetDataCompareIngress,
    petDataCompareShadowEvaluatorSource: validPetDataCompareShadowEvaluator,
    ...overrides,
  };
}

function auditObjectDbRuntimeAdoptionSources(input: ObjectDbRuntimeAdoptionSources) {
  return runObjectDbRuntimeAdoptionSourceAudit(input, REVIEWED_FIXTURE_HASHES);
}

describe("object DB runtime production adoption audit", () => {
  it("derives EVENT_CONTROL MODERN and both reachable IRIS read-only callsites as one adoption unit", () => {
    const result = auditObjectDbRuntimeAdoptionSources(sources());
    assert.deepEqual(result.failures, []);
    assert.equal(result.compliant, true);
    assert.equal(result.productionSourceCallCount, 2);
    assert.deepEqual(result.connectedIngressFamilies, ["EVENT_CONTROL", "SETTLEMENT", "ADMIN_PET_DATA_COMPARE"]);
    assert.deepEqual(result.callSites, [
      {
        sourceFile: "src/pet/pet-explore-app-wiring-ingress.ts",
        functionName: "PetExploreAppWiringIngress.handle",
        entrypointKind: "IRIS",
        domain: "PET_EXPLORE",
        effectModes: ["MODERN_MUTATION", "SHADOW", "REJECT"],
      },
      {
        sourceFile: "src/admin/pet-data-compare-app-wiring-ingress.ts",
        functionName: "PetDataCompareAppWiringIngress.handle",
        entrypointKind: "IRIS",
        domain: "ADMIN_PET_DATA_COMPARE",
        effectModes: ["SHADOW", "REJECT"],
      },
    ]);
  });

  it("normalizes CRLF input before deriving the same evidence", () => {
    const result = auditObjectDbRuntimeAdoptionSources({
      appSource: validApp.replaceAll("\n", "\r\n"),
      petExploreIngressSource: validIngress.replaceAll("\n", "\r\n"),
      petExploreEventControlProviderSource: validPetExploreEventControlProvider.replaceAll("\n", "\r\n"),
      appWiringOperationProviderSource: validAppWiringOperationProvider.replaceAll("\n", "\r\n"),
      petExploreEventControlMigrationSource: validPetExploreEventControlMigration.replaceAll("\n", "\r\n"),
      petExploreEventControlRollbackSource: validPetExploreEventControlRollback.replaceAll("\n", "\r\n"),
      petDataCompareIngressSource: validPetDataCompareIngress.replaceAll("\n", "\r\n"),
      petDataCompareShadowEvaluatorSource: validPetDataCompareShadowEvaluator.replaceAll("\n", "\r\n"),
    });
    assert.equal(result.compliant, true);
    assert.equal(result.productionSourceCallCount, 2);
  });

  it("does not count dead string-only fixtures as a reachable call graph", () => {
    const result = auditObjectDbRuntimeAdoptionSources(sources({
      appSource: `const dead = ${JSON.stringify(validApp)};`,
      petExploreIngressSource: `const dead = ${JSON.stringify(validIngress)};`,
      petDataCompareIngressSource: `const dead = ${JSON.stringify(validPetDataCompareIngress)};`,
      petDataCompareShadowEvaluatorSource: `const dead = ${JSON.stringify(validPetDataCompareShadowEvaluator)};`,
    }));
    assert.equal(result.compliant, false);
    assert.equal(result.productionSourceCallCount, 0);
    assert.deepEqual(result.callSites, []);
  });

  it("fails closed when the runner import or call is missing", () => {
    const withoutImport = auditObjectDbRuntimeAdoptionSources(sources({
      petExploreIngressSource: validIngress.replace('import { executeAppWiringEntrypoint } from "../dispatch/app-wiring-entrypoint-runner.js";', ""),
    }));
    assert.equal(withoutImport.productionSourceCallCount, 0);
    assert.ok(withoutImport.failures.includes("RUNNER_IMPORT_MISSING"));

    const withoutCall = auditObjectDbRuntimeAdoptionSources(sources({
      petExploreIngressSource: validIngress.replace("return executeAppWiringEntrypoint(this.provider, {", "return passthrough(this.provider, {"),
    }));
    assert.equal(withoutCall.productionSourceCallCount, 0);
    assert.ok(withoutCall.failures.includes("RUNNER_CALLSITE_NOT_EXACTLY_ONCE"));
  });

  it("fails closed for a duplicate runner callsite", () => {
    const duplicateCall = validIngress.replace(
      "const decision = await this.dispatcher.resolveReadOnly(event);",
      "const decision = await this.dispatcher.resolveReadOnly(event); executeAppWiringEntrypoint(this.provider, {});",
    );
    const result = auditObjectDbRuntimeAdoptionSources(sources({ petExploreIngressSource: duplicateCall }));
    assert.equal(result.productionSourceCallCount, 0);
    assert.ok(result.failures.includes("RUNNER_CALLSITE_NOT_EXACTLY_ONCE"));
  });

  it("fails closed when MODERN or LEGACY execution is opened", () => {
    const opened = validIngress
      .replace('if (decision.route === "LEGACY_FALLBACK") return { status: "legacy_fallback" };', "")
      .replace('if (decision.route === "MODERN" && family !== "EVENT_CONTROL") throw new Error("closed");', "")
      .replace("this.eventControlProvider.execute", "runModern");
    const result = auditObjectDbRuntimeAdoptionSources(sources({ petExploreIngressSource: opened }));
    assert.equal(result.productionSourceCallCount, 0);
    assert.ok(result.failures.includes("LEGACY_EXECUTION_NOT_CLOSED"));
    assert.ok(result.failures.includes("SETTLEMENT_MODERN_EXECUTION_NOT_CLOSED"));
    assert.ok(result.failures.includes("EVENT_CONTROL_MODERN_HANDLER_NOT_ADOPTED"));
  });

  it("allows MODERN mutation only for EVENT_CONTROL with the exact typed receipt", () => {
    for (const [source, failure] of [
      [validIngress.replace('family !== "EVENT_CONTROL"', 'family !== "SETTLEMENT"'), "SETTLEMENT_MODERN_EXECUTION_NOT_CLOSED"],
      [validIngress.replace('effectMode: decision.route === "MODERN" ? "MUTATION" as const : "READ_ONLY" as const', 'effectMode: "READ_ONLY" as const'), "PET_EXPLORE_EFFECT_MODE_NOT_FAMILY_BOUND"],
      [validIngress.replace('receiptKind: "PET_EXPLORE_EVENT_CONTROL"', 'receiptKind: "PET_EXPLORE"'), "EVENT_CONTROL_MODERN_HANDLER_NOT_ADOPTED"],
      [validIngress.replace("this.eventControlProvider.execute(database, event, claim)", "this.settlementProvider.execute(database, event, claim)"), "EVENT_CONTROL_MODERN_HANDLER_NOT_ADOPTED"],
    ] as const) {
      const result = auditObjectDbRuntimeAdoptionSources(sources({ petExploreIngressSource: source }));
      assert.equal(result.productionSourceCallCount, 0);
      assert.ok(result.failures.includes(failure), failure);
    }
  });

  it("fails closed when provider or read-only route-reader composition is absent", () => {
    const missingComposition = validApp
      .replace("new MariaAppWiringOperationProvider(database, dependencies.environmentContext)", "providerDependency")
      .replace("new MariaCommandRouteReader(database)", "routeReaderDependency");
    const result = auditObjectDbRuntimeAdoptionSources(sources({ appSource: missingComposition }));
    assert.equal(result.productionSourceCallCount, 0);
    assert.ok(result.failures.includes("APP_WIRING_PROVIDER_COMPOSITION_MISSING"));
    assert.ok(result.failures.includes("READ_ONLY_ROUTE_READER_COMPOSITION_MISSING"));
  });

  it("rejects imports, guards, handlers, and claims spoofed by comments or templates", () => {
    const spoofed = validIngress
      .replace('import { executeAppWiringEntrypoint } from "../dispatch/app-wiring-entrypoint-runner.js";', '/* import { executeAppWiringEntrypoint } from "../dispatch/app-wiring-entrypoint-runner.js"; */')
      .replace('if (decision.route === "LEGACY_FALLBACK") return { status: "legacy_fallback" };', 'const legacySpoof = `if (decision.route === "LEGACY_FALLBACK") return fake`;')
      .replace("this.eventControlProvider.execute", 'runModern /* this.eventControlProvider.execute */')
      .replace('entrypointKind: "IRIS", actor: "pet_explore_app_wiring"', 'entrypointKind: "WEB", actor: "other", note: `entrypointKind: "IRIS", actor: "pet_explore_app_wiring"`');
    const result = auditObjectDbRuntimeAdoptionSources(sources({ petExploreIngressSource: spoofed }));
    assert.equal(result.productionSourceCallCount, 0);
    assert.ok(result.failures.includes("RUNNER_IMPORT_MISSING"));
    assert.ok(result.failures.includes("LEGACY_EXECUTION_NOT_CLOSED"));
    assert.ok(result.failures.includes("EVENT_CONTROL_MODERN_HANDLER_NOT_ADOPTED"));
    assert.ok(result.failures.includes("IRIS_ENTRYPOINT_CLAIM_MISSING"));
    assert.ok(result.failures.includes("PET_EXPLORE_DOMAIN_CLAIM_MISSING"));
  });

  it("does not count a runner name inside a regular-expression literal", () => {
    const spoofed = validIngress
      .replace("const decision = await this.dispatcher.resolveReadOnly(event);", "const decision = await this.dispatcher.resolveReadOnly(event); const spoof = () => /executeAppWiringEntrypoint()/;")
      .replace("return executeAppWiringEntrypoint(this.provider, {", "return passthrough(this.provider, {");
    const result = auditObjectDbRuntimeAdoptionSources(sources({ petExploreIngressSource: spoofed }));
    assert.equal(result.productionSourceCallCount, 0);
    assert.ok(result.failures.includes("RUNNER_CALLSITE_NOT_EXACTLY_ONCE"));
  });

  it("does not accept route guards nested only under if(false)", () => {
    const deadGuards = validIngress
      .replace('if (decision.route === "LEGACY_FALLBACK") return { status: "legacy_fallback" };', "")
      .replace('if (decision.route === "MODERN" && family !== "EVENT_CONTROL") throw new Error("closed");', `if (false) {
        if (decision.route === "LEGACY_FALLBACK") return { status: "legacy_fallback" };
        if (decision.route === "MODERN" && family !== "EVENT_CONTROL") throw new Error("closed");
      }`);
    const result = auditObjectDbRuntimeAdoptionSources(sources({ petExploreIngressSource: deadGuards }));
    assert.equal(result.productionSourceCallCount, 0);
    assert.ok(result.failures.includes("LEGACY_EXECUTION_NOT_CLOSED"));
    assert.ok(result.failures.includes("SETTLEMENT_MODERN_EXECUTION_NOT_CLOSED"));
  });

  it("binds claim and closed handlers to the exact runner options object", () => {
    const openOptions = validIngress
      .replace('claim: { entrypointKind: "IRIS", actor: "pet_explore_app_wiring" },', 'claim: { entrypointKind: "WEB", actor: "other" },')
      .replace("this.eventControlProvider.execute", "runModern")
      .replace("LEGACY_FALLBACK: { READ_ONLY: forbiddenMutation, MUTATION: forbiddenMutation },", "LEGACY_FALLBACK: { READ_ONLY: runLegacy, MUTATION: runLegacy },")
      .replace("return executeAppWiringEntrypoint(this.provider, {", `const unrelated = {
      claim: { entrypointKind: "IRIS", actor: "pet_explore_app_wiring" },
      handlers: {
        MODERN: { READ_ONLY: forbiddenMutation, MUTATION: forbiddenMutation },
        LEGACY_FALLBACK: { READ_ONLY: forbiddenMutation, MUTATION: forbiddenMutation },
        SHADOW: async () => ({}), REJECT: async () => ({}),
      },
    };
    return executeAppWiringEntrypoint(this.provider, {`);
    const result = auditObjectDbRuntimeAdoptionSources(sources({ petExploreIngressSource: openOptions }));
    assert.equal(result.productionSourceCallCount, 0);
    assert.ok(result.failures.includes("EVENT_CONTROL_MODERN_HANDLER_NOT_ADOPTED"));
    assert.ok(result.failures.includes("LEGACY_HANDLER_NOT_CLOSED"));
    assert.ok(result.failures.includes("IRIS_ENTRYPOINT_CLAIM_MISSING"));
    assert.ok(result.failures.includes("PET_EXPLORE_DOMAIN_CLAIM_MISSING"));
  });

  it("requires this.provider and callable SHADOW and REJECT handlers on the actual runner call", () => {
    const bypass = validIngress
      .replace("executeAppWiringEntrypoint(this.provider, {", "executeAppWiringEntrypoint(OTHER_PROVIDER, {")
      .replace('SHADOW: async () => ({ status: "shadow" }),', "SHADOW: undefined,")
      .replace('REJECT: async () => ({ status: "rejected" }),', "REJECT: undefined,");
    const result = auditObjectDbRuntimeAdoptionSources(sources({ petExploreIngressSource: bypass }));
    assert.equal(result.productionSourceCallCount, 0);
    assert.ok(result.failures.includes("RUNNER_PROVIDER_ARGUMENT_INVALID"));
    assert.ok(result.failures.includes("SHADOW_REJECT_HANDLERS_MISSING"));
  });

  it("rejects spreads, computed keys, and duplicate properties at every runner object level", () => {
    const cases = [
      validIngress.replace("executeAppWiringEntrypoint(this.provider, {", "executeAppWiringEntrypoint(this.provider, { ...override,"),
      validIngress.replace('claim: { entrypointKind: "IRIS", actor: "pet_explore_app_wiring" }', 'claim: { ...override, entrypointKind: "IRIS", actor: "pet_explore_app_wiring" }'),
      validIngress.replace("handlers: {", "handlers: { ...override,"),
      validIngress.replace("MODERN: { READ_ONLY:", "MODERN: { ...override, READ_ONLY:"),
      validIngress.replace("executeAppWiringEntrypoint(this.provider, {", "executeAppWiringEntrypoint(this.provider, { [dynamicKey]: override,"),
      validIngress.replace('claim: { entrypointKind: "IRIS", actor: "pet_explore_app_wiring" }', 'claim: { [dynamicKey]: override, entrypointKind: "IRIS", actor: "pet_explore_app_wiring" }'),
      validIngress.replace("handlers: {", "handlers: { [dynamicKey]: override,"),
      validIngress.replace("MODERN: { READ_ONLY:", "MODERN: { [dynamicKey]: override, READ_ONLY:"),
      validIngress.replace('claim: { entrypointKind: "IRIS", actor: "pet_explore_app_wiring" },', 'claim: { entrypointKind: "IRIS", actor: "pet_explore_app_wiring" }, claim: { entrypointKind: "IRIS", actor: "pet_explore_app_wiring" },'),
      validIngress.replace('claim: { entrypointKind: "IRIS", actor: "pet_explore_app_wiring" }', 'claim: { entrypointKind: "IRIS", entrypointKind: "IRIS", actor: "pet_explore_app_wiring" }'),
      validIngress.replace("handlers: {", "handlers: { SHADOW: async () => ({}),"),
      validIngress.replace("MODERN: { READ_ONLY:", "MODERN: { READ_ONLY: forbiddenMutation, READ_ONLY:"),
    ];
    for (const petExploreIngressSource of cases) {
      const result = auditObjectDbRuntimeAdoptionSources(sources({ petExploreIngressSource }));
      assert.equal(result.productionSourceCallCount, 0, petExploreIngressSource);
    }
  });

  it("does not count calls reachable only inside a nested declaration or if(false)", () => {
    const deadApp = validApp.replace(
      "await dispatchPetExploreCommandConsumers(petExploreAppWiringIngress, isOperationalChannel, processing?.duplicate, normalizedEvent);",
      "function dead() { dispatchPetExploreCommandConsumers(petExploreAppWiringIngress, isOperationalChannel, processing?.duplicate, normalizedEvent); } if (false) { dispatchPetExploreCommandConsumers(petExploreAppWiringIngress, isOperationalChannel, processing?.duplicate, normalizedEvent); }",
    );
    const result = auditObjectDbRuntimeAdoptionSources(sources({ appSource: deadApp }));
    assert.equal(result.productionSourceCallCount, 0);
    assert.ok(result.failures.includes("BUILD_APP_DISPATCH_PATH_MISSING_OR_DUPLICATE"));
  });

  it("does not count a call inside an uninvoked variable-assigned arrow", () => {
    const deadApp = validApp.replace(
      "await dispatchPetExploreCommandConsumers(petExploreAppWiringIngress, isOperationalChannel, processing?.duplicate, normalizedEvent);",
      "const dead = async () => { await dispatchPetExploreCommandConsumers(petExploreAppWiringIngress, isOperationalChannel, processing?.duplicate, normalizedEvent); };",
    );
    const result = auditObjectDbRuntimeAdoptionSources(sources({ appSource: deadApp }));
    assert.equal(result.productionSourceCallCount, 0);
    assert.ok(result.failures.includes("BUILD_APP_DISPATCH_PATH_MISSING_OR_DUPLICATE"));
  });

  it("requires the Iris route dispatch to remain a direct top-level awaited statement", () => {
    const direct = "await dispatchPetExploreCommandConsumers(petExploreAppWiringIngress, isOperationalChannel, processing?.duplicate, normalizedEvent);";
    const bypasses = [
      `if (0) ${direct}`,
      `if (null) ${direct}`,
      `function hiddenDispatch() { ${direct} }`,
      `await (async () => { ${direct} })();`,
    ];
    for (const replacement of bypasses) {
      const result = auditObjectDbRuntimeAdoptionSources(sources({ appSource: validApp.replace(direct, replacement) }));
      assert.equal(result.productionSourceCallCount, 0, replacement);
      assert.ok(result.failures.includes("BUILD_APP_DISPATCH_PATH_MISSING_OR_DUPLICATE"));
    }
  });

  it("rejects an unconditional return before an otherwise direct dispatch through source binding", () => {
    const bypass = validApp.replace(
      "await dispatchPetExploreCommandConsumers(petExploreAppWiringIngress, isOperationalChannel, processing?.duplicate, normalizedEvent);",
      "return; await dispatchPetExploreCommandConsumers(petExploreAppWiringIngress, isOperationalChannel, processing?.duplicate, normalizedEvent);",
    );
    const result = auditObjectDbRuntimeAdoptionSources(sources({ appSource: bypass }));
    assert.equal(result.productionSourceCallCount, 0);
    assert.ok(result.failures.includes("APP_SOURCE_HASH_MISMATCH"));
  });

  it("requires every independently supplied canonical-LF source hash", () => {
    const appMismatch = runObjectDbRuntimeAdoptionSourceAudit(sources(), { ...REVIEWED_FIXTURE_HASHES, appSourceSha256: "0".repeat(64) });
    assert.equal(appMismatch.productionSourceCallCount, 0);
    assert.ok(appMismatch.failures.includes("APP_SOURCE_HASH_MISMATCH"));

    const ingressMismatch = runObjectDbRuntimeAdoptionSourceAudit(sources(), { ...REVIEWED_FIXTURE_HASHES, petExploreIngressSourceSha256: "f".repeat(64) });
    assert.equal(ingressMismatch.productionSourceCallCount, 0);
    assert.ok(ingressMismatch.failures.includes("PET_EXPLORE_INGRESS_SOURCE_HASH_MISMATCH"));

    const adminIngressMismatch = runObjectDbRuntimeAdoptionSourceAudit(sources(), { ...REVIEWED_FIXTURE_HASHES, petDataCompareIngressSourceSha256: "a".repeat(64) });
    assert.equal(adminIngressMismatch.productionSourceCallCount, 0);
    assert.ok(adminIngressMismatch.failures.includes("PET_DATA_COMPARE_INGRESS_SOURCE_HASH_MISMATCH"));

    const evaluatorMismatch = runObjectDbRuntimeAdoptionSourceAudit(sources(), { ...REVIEWED_FIXTURE_HASHES, petDataCompareShadowEvaluatorSourceSha256: "b".repeat(64) });
    assert.equal(evaluatorMismatch.productionSourceCallCount, 0);
    assert.ok(evaluatorMismatch.failures.includes("PET_DATA_COMPARE_SHADOW_EVALUATOR_SOURCE_HASH_MISMATCH"));

    for (const [field, failure] of [
      ["petExploreEventControlProviderSourceSha256", "PET_EXPLORE_EVENT_CONTROL_PROVIDER_SOURCE_HASH_MISMATCH"],
      ["appWiringOperationProviderSourceSha256", "APP_WIRING_OPERATION_PROVIDER_SOURCE_HASH_MISMATCH"],
      ["petExploreEventControlMigrationSourceSha256", "PET_EXPLORE_EVENT_CONTROL_MIGRATION_SOURCE_HASH_MISMATCH"],
      ["petExploreEventControlRollbackSourceSha256", "PET_EXPLORE_EVENT_CONTROL_ROLLBACK_SOURCE_HASH_MISMATCH"],
    ] as const) {
      const result = runObjectDbRuntimeAdoptionSourceAudit(sources(), { ...REVIEWED_FIXTURE_HASHES, [field]: "c".repeat(64) });
      assert.equal(result.productionSourceCallCount, 0);
      assert.ok(result.failures.includes(failure), failure);
    }

    const missingAdminHashes = runObjectDbRuntimeAdoptionSourceAudit(sources(), {
      appSourceSha256: REVIEWED_FIXTURE_HASHES.appSourceSha256,
      petExploreIngressSourceSha256: REVIEWED_FIXTURE_HASHES.petExploreIngressSourceSha256,
    });
    assert.equal(missingAdminHashes.productionSourceCallCount, 0);
    assert.ok(missingAdminHashes.failures.includes("PET_DATA_COMPARE_INGRESS_SOURCE_HASH_MISMATCH"));
    assert.ok(missingAdminHashes.failures.includes("PET_DATA_COMPARE_SHADOW_EVALUATOR_SOURCE_HASH_MISMATCH"));
  });

  it("requires each wrapper's actual family guard and the wired ingress argument at buildApp", () => {
    const wrongFamily = validApp.replace("isPetExploreSettlementCommand(event.message)", "isUnrelatedCommand(event.message)");
    const familyResult = auditObjectDbRuntimeAdoptionSources(sources({ appSource: wrongFamily }));
    assert.equal(familyResult.productionSourceCallCount, 0);
    assert.ok(familyResult.failures.includes("INGRESS_FAMILY_GUARD_MISSING:dispatchPetExploreSettlementCommand"));

    const wrongIngressArgument = validApp.replace(
      "dispatchPetExploreCommandConsumers(petExploreAppWiringIngress, isOperationalChannel, processing?.duplicate, normalizedEvent)",
      "dispatchPetExploreCommandConsumers(otherIngress, isOperationalChannel, processing?.duplicate, normalizedEvent)",
    );
    const argumentResult = auditObjectDbRuntimeAdoptionSources(sources({ appSource: wrongIngressArgument }));
    assert.equal(argumentResult.productionSourceCallCount, 0);
    assert.ok(argumentResult.failures.includes("BUILD_APP_DISPATCH_PATH_MISSING_OR_DUPLICATE"));
  });

  it("requires dispatcher and wrappers to forward their own ingress and event parameters", () => {
    for (const wrapper of ["dispatchPetExploreSettlementCommand", "dispatchPetExploreEventControlCommand"]) {
      const disconnectedDispatcher = validApp.replace(
        `${wrapper}(ingress, isOperationalChannel, duplicate, event)`,
        `${wrapper}(undefined, isOperationalChannel, duplicate, event)`,
      );
      const result = auditObjectDbRuntimeAdoptionSources(sources({ appSource: disconnectedDispatcher }));
      assert.equal(result.productionSourceCallCount, 0);
      assert.ok(result.failures.includes(`DISPATCH_WRAPPER_NOT_EXACTLY_ONCE:${wrapper}`));
    }

    for (const wrapper of ["dispatchPetExploreSettlementCommand", "dispatchPetExploreEventControlCommand"]) {
      const disconnectedWrapper = validApp.replace(
        new RegExp(`(function ${wrapper}[^}]+)ingress\\.handle\\(event\\)`),
        "$1ingress.handle(otherEvent)",
      );
      const result = auditObjectDbRuntimeAdoptionSources(sources({ appSource: disconnectedWrapper }));
      assert.equal(result.productionSourceCallCount, 0);
      assert.ok(result.failures.includes(`INGRESS_HANDLE_NOT_EXACTLY_ONCE:${wrapper}`));
    }
  });

  it("rejects a renamed dispatcher parameter shadowed by a local ingress", () => {
    const bypass = validApp
      .replace("dispatchPetExploreCommandConsumers(ingress: any,", "dispatchPetExploreCommandConsumers(_ingress: any,")
      .replace("dispatchPetExploreCommandConsumers(_ingress: any, isOperationalChannel: boolean, duplicate: boolean, event: any) {", "dispatchPetExploreCommandConsumers(_ingress: any, isOperationalChannel: boolean, duplicate: boolean, event: any) { const ingress = undefined;");
    const result = auditObjectDbRuntimeAdoptionSources(sources({ appSource: bypass }));
    assert.equal(result.productionSourceCallCount, 0);
    assert.ok(result.failures.includes("DISPATCH_PARAMETER_CONTRACT_INVALID"));
    assert.ok(result.failures.includes("DISPATCH_BODY_CONTRACT_INVALID"));
  });

  it("rejects parameter reassignment or shadow declarations in dispatcher and wrappers", () => {
    const dispatcherReassignment = validApp.replace(
      "dispatchPetExploreCommandConsumers(ingress: any, isOperationalChannel: boolean, duplicate: boolean, event: any) {",
      "dispatchPetExploreCommandConsumers(ingress: any, isOperationalChannel: boolean, duplicate: boolean, event: any) { event = otherEvent;",
    );
    const dispatcherResult = auditObjectDbRuntimeAdoptionSources(sources({ appSource: dispatcherReassignment }));
    assert.equal(dispatcherResult.productionSourceCallCount, 0);
    assert.ok(dispatcherResult.failures.includes("DISPATCH_BODY_CONTRACT_INVALID"));

    const wrapperShadow = validApp.replace(
      "dispatchPetExploreSettlementCommand(ingress: any, isOperationalChannel: boolean, duplicate: boolean, event: any) {",
      "dispatchPetExploreSettlementCommand(ingress: any, isOperationalChannel: boolean, duplicate: boolean, event: any) { const duplicate = false;",
    );
    const wrapperResult = auditObjectDbRuntimeAdoptionSources(sources({ appSource: wrapperShadow }));
    assert.equal(wrapperResult.productionSourceCallCount, 0);
    assert.ok(wrapperResult.failures.includes("WRAPPER_BODY_CONTRACT_INVALID:dispatchPetExploreSettlementCommand"));
  });

  it("rejects array and object destructuring assignments through the exact body grammar", () => {
    const arrayBypass = validApp.replace(
      "dispatchPetExploreCommandConsumers(ingress: any, isOperationalChannel: boolean, duplicate: boolean, event: any) {",
      "dispatchPetExploreCommandConsumers(ingress: any, isOperationalChannel: boolean, duplicate: boolean, event: any) { [ingress] = [undefined];",
    );
    const arrayResult = auditObjectDbRuntimeAdoptionSources(sources({ appSource: arrayBypass }));
    assert.equal(arrayResult.productionSourceCallCount, 0);
    assert.ok(arrayResult.failures.includes("DISPATCH_BODY_CONTRACT_INVALID"));

    const objectBypass = validApp.replace(
      "dispatchPetExploreEventControlCommand(ingress: any, isOperationalChannel: boolean, duplicate: boolean, event: any) {",
      "dispatchPetExploreEventControlCommand(ingress: any, isOperationalChannel: boolean, duplicate: boolean, event: any) { ({ event } = replacement);",
    );
    const objectResult = auditObjectDbRuntimeAdoptionSources(sources({ appSource: objectBypass }));
    assert.equal(objectResult.productionSourceCallCount, 0);
    assert.ok(objectResult.failures.includes("WRAPPER_BODY_CONTRACT_INVALID:dispatchPetExploreEventControlCommand"));
  });

  it("preserves exact seam-body string values instead of reducing same-length literals", () => {
    const outgoing = validApp.replace('event.direction !== "incoming"', 'event.direction !== "outgoing"');
    const outgoingResult = auditObjectDbRuntimeAdoptionSources(sources({ appSource: outgoing }));
    assert.equal(outgoingResult.productionSourceCallCount, 0);
    assert.ok(outgoingResult.failures.includes("WRAPPER_BODY_CONTRACT_INVALID:dispatchPetExploreSettlementCommand"));

    const sameLength = validApp.replace('event.direction !== "incoming"', 'event.direction !== "12345678"');
    const sameLengthResult = auditObjectDbRuntimeAdoptionSources(sources({ appSource: sameLength }));
    assert.equal(sameLengthResult.productionSourceCallCount, 0);
    assert.ok(sameLengthResult.failures.includes("WRAPPER_BODY_CONTRACT_INVALID:dispatchPetExploreSettlementCommand"));
  });

  it("requires the provider, route reader, dispatcher, and ingress to be the same argument chain", () => {
    const wrongWiring = validApp.replace(
      "new PetExploreAppWiringIngress(appWiringOperationProvider, new CommandDispatcher(new MariaCommandRouteReader(database)))",
      "new PetExploreAppWiringIngress(otherProvider, new CommandDispatcher(otherRouteReader)); new MariaCommandRouteReader(database); new PetExploreAppWiringIngress(appWiringOperationProvider, otherDispatcher)",
    );
    const result = auditObjectDbRuntimeAdoptionSources(sources({ appSource: wrongWiring }));
    assert.equal(result.productionSourceCallCount, 0);
    assert.ok(result.failures.includes("READ_ONLY_ROUTE_READER_COMPOSITION_MISSING"));
    assert.ok(result.failures.includes("PET_EXPLORE_INGRESS_COMPOSITION_MISSING"));
  });

  it("derives IRIS and PET_EXPLORE only from the actual claim", () => {
    const wrongClaim = validIngress.replace('entrypointKind: "IRIS", actor: "pet_explore_app_wiring"', 'entrypointKind: "WEB", actor: "other"');
    const result = auditObjectDbRuntimeAdoptionSources(sources({ petExploreIngressSource: wrongClaim }));
    assert.equal(result.productionSourceCallCount, 0);
    assert.ok(result.failures.includes("IRIS_ENTRYPOINT_CLAIM_MISSING"));
    assert.ok(result.failures.includes("PET_EXPLORE_DOMAIN_CLAIM_MISSING"));
  });

  it("fails both ingress families closed when either production call graph fails", () => {
    const cases: ObjectDbRuntimeAdoptionSources[] = [
      sources({ petExploreIngressSource: validIngress.replace("executeAppWiringEntrypoint(this.provider, {", "passthrough(this.provider, {") }),
      sources({ petDataCompareIngressSource: validPetDataCompareIngress.replace("executeAppWiringEntrypoint(this.provider, {", "passthrough(this.provider, {") }),
    ];
    for (const input of cases) {
      const result = auditObjectDbRuntimeAdoptionSources(input);
      assert.equal(result.productionSourceCallCount, 0);
      assert.deepEqual(result.callSites, []);
      assert.deepEqual(result.connectedIngressFamilies, []);
    }
  });

  it("requires the exact ADMIN wrapper contract and four forwarded arguments", () => {
    const wrongGuard = auditObjectDbRuntimeAdoptionSources(sources({
      appSource: validApp.replace("!isPetDataCompareCommand(event.message)", "!isPointEditCommandCandidate(event.message)"),
    }));
    assert.ok(wrongGuard.failures.includes("PET_DATA_COMPARE_WRAPPER_BODY_CONTRACT_INVALID"));
    assert.ok(wrongGuard.failures.includes("PET_DATA_COMPARE_EXACT_GUARD_MISSING"));

    const wrongEvent = auditObjectDbRuntimeAdoptionSources(sources({
      appSource: validApp.replace("const result = await ingress.handle(event);", "const result = await ingress.handle(otherEvent);"),
    }));
    assert.ok(wrongEvent.failures.includes("PET_DATA_COMPARE_WRAPPER_BODY_CONTRACT_INVALID"));
    assert.ok(wrongEvent.failures.includes("PET_DATA_COMPARE_INGRESS_HANDLE_NOT_EXACTLY_ONCE"));

    const wrongDependency = auditObjectDbRuntimeAdoptionSources(sources({
      appSource: validApp.replace(
        "dispatchPetDataCompareCommand(petDataCompareAppWiringIngress, isOperationalChannel, processing?.duplicate, normalizedEvent)",
        "dispatchPetDataCompareCommand(otherIngress, isOperationalChannel, processing?.duplicate, normalizedEvent)",
      ),
    }));
    assert.ok(wrongDependency.failures.includes("PET_DATA_COMPARE_BUILD_APP_DISPATCH_PATH_MISSING_OR_DUPLICATE"));
  });

  it("requires a direct ADMIN dispatch before a claimed-only legacy admin block", () => {
    const nested = auditObjectDbRuntimeAdoptionSources(sources({
      appSource: validApp.replace(
        "const petDataCompareDisposition = await dispatchPetDataCompareCommand(petDataCompareAppWiringIngress, isOperationalChannel, processing?.duplicate, normalizedEvent);",
        "if (false) { const petDataCompareDisposition = await dispatchPetDataCompareCommand(petDataCompareAppWiringIngress, isOperationalChannel, processing?.duplicate, normalizedEvent); } const petDataCompareDisposition = 'not_applicable';",
      ),
    }));
    assert.ok(nested.failures.includes("PET_DATA_COMPARE_BUILD_APP_DISPATCH_PATH_MISSING_OR_DUPLICATE"));

    const legacyBlocked = auditObjectDbRuntimeAdoptionSources(sources({
      appSource: validApp.replace('petDataCompareDisposition !== "claimed"', 'petDataCompareDisposition === "legacy_fallback"'),
    }));
    assert.ok(legacyBlocked.failures.includes("PET_DATA_COMPARE_LEGACY_ADMIN_ORDER_INVALID"));

    const detachedHandler = auditObjectDbRuntimeAdoptionSources(sources({
      appSource: validApp.replace("irisAdminCommandService.changePlayerPoint(normalizedEvent)", "otherService.changePlayerPoint(normalizedEvent)"),
    }));
    assert.ok(detachedHandler.failures.includes("PET_DATA_COMPARE_LEGACY_ADMIN_ORDER_INVALID"));
  });

  it("requires ADMIN to share the provider and database route-reader composition", () => {
    const result = auditObjectDbRuntimeAdoptionSources(sources({
      appSource: validApp.replace(
        "new PetDataCompareAppWiringIngress(appWiringOperationProvider, new CommandDispatcher(new MariaCommandRouteReader(database)))",
        "new PetDataCompareAppWiringIngress(otherProvider, new CommandDispatcher(otherRouteReader)); new MariaCommandRouteReader(database)",
      ),
    }));
    assert.ok(result.failures.includes("READ_ONLY_ROUTE_READER_COMPOSITION_MISSING"));
    assert.ok(result.failures.includes("PET_DATA_COMPARE_INGRESS_COMPOSITION_MISSING"));
  });

  it("requires ADMIN exact incoming identity preconditions and resolveReadOnly exactly once", () => {
    const mutations = [
      validPetDataCompareIngress.replace("!isPetDataCompareCommand(event.message)", "!isUnrelatedCommand(event.message)"),
      validPetDataCompareIngress.replace('event.direction !== "incoming"', 'event.direction !== "outgoing"'),
      validPetDataCompareIngress.replace("event.userId === undefined", "false"),
      validPetDataCompareIngress.replace("event.channelId === undefined", "false"),
      validPetDataCompareIngress.replace(
        "const decision = await this.dispatcher.resolveReadOnly(dispatchInput);",
        "await this.dispatcher.resolveReadOnly(dispatchInput); const decision = await this.dispatcher.resolveReadOnly(dispatchInput);",
      ),
    ];
    for (const petDataCompareIngressSource of mutations) {
      const result = auditObjectDbRuntimeAdoptionSources(sources({ petDataCompareIngressSource }));
      assert.equal(result.productionSourceCallCount, 0);
      assert.ok(result.failures.includes("PET_DATA_COMPARE_PRECONDITIONS_OR_RESOLVE_INVALID"));
    }
  });

  it("binds ADMIN IRIS claim, closed routes, READ_ONLY effect, and callable SHADOW/REJECT to its runner", () => {
    const cases: Array<[string, string]> = [
      [validPetDataCompareIngress.replace('entrypointKind: "IRIS"', 'entrypointKind: "WEB"'), "PET_DATA_COMPARE_IRIS_ENTRYPOINT_CLAIM_MISSING"],
      [validPetDataCompareIngress.replace('if (decision.route === "LEGACY_FALLBACK") return { status: "legacy_fallback" };', 'if (decision.route === "LEGACY_FALLBACK") observe(decision);'), "PET_DATA_COMPARE_LEGACY_EXECUTION_NOT_CLOSED"],
      [validPetDataCompareIngress.replace('if (decision.route === "MODERN") throw new Error("closed");', 'if (decision.route === "MODERN") observe(decision);'), "PET_DATA_COMPARE_MODERN_EXECUTION_NOT_CLOSED"],
      [validPetDataCompareIngress.replace('effectMode: "READ_ONLY"', 'effectMode: "MUTATION"'), "PET_DATA_COMPARE_READ_ONLY_EFFECT_NOT_BOUND"],
      [validPetDataCompareIngress.replace("resolveRoute: () => route", "resolveRoute: () => decision"), "PET_DATA_COMPARE_READ_ONLY_EFFECT_NOT_BOUND"],
      [validPetDataCompareIngress.replace('SHADOW: async () => ({ status: "shadow" }),', "SHADOW: undefined,"), "PET_DATA_COMPARE_SHADOW_REJECT_HANDLERS_MISSING"],
      [validPetDataCompareIngress.replace('REJECT: async () => ({ status: "rejected" }),', "REJECT: undefined,"), "PET_DATA_COMPARE_SHADOW_REJECT_HANDLERS_MISSING"],
      [validPetDataCompareIngress.replace("executeAppWiringEntrypoint(this.provider, {", "executeAppWiringEntrypoint(otherProvider, {"), "PET_DATA_COMPARE_RUNNER_PROVIDER_ARGUMENT_INVALID"],
    ];
    for (const [petDataCompareIngressSource, expectedFailure] of cases) {
      const result = auditObjectDbRuntimeAdoptionSources(sources({ petDataCompareIngressSource }));
      assert.equal(result.productionSourceCallCount, 0);
      assert.ok(result.failures.includes(expectedFailure), expectedFailure);
    }
  });

  it("requires the actual display-name trust bit in both ADMIN dispatch and claim payload", () => {
    const dispatchSpoof = auditObjectDbRuntimeAdoptionSources(sources({
      petDataCompareIngressSource: validPetDataCompareIngress.replace(
        'hasTrustedDisplayName: event.displayNameTrust === "trusted"',
        "hasTrustedDisplayName: true",
      ),
    }));
    assert.ok(dispatchSpoof.failures.includes("PET_DATA_COMPARE_TRUST_FORWARDING_INVALID"));

    const payloadSpoof = auditObjectDbRuntimeAdoptionSources(sources({
      petDataCompareIngressSource: validPetDataCompareIngress.replace(
        'normalizedPayload: { trustedDisplayName: event.displayNameTrust === "trusted" }',
        "normalizedPayload: { trustedDisplayName: true }",
      ),
    }));
    assert.ok(payloadSpoof.failures.includes("PET_DATA_COMPARE_TRUST_FORWARDING_INVALID"));
  });

  it("accepts the current repository only when the complete production path remains connected", () => {
    const runtimeRoot = fileURLToPath(new URL("../", import.meta.url));
    const result = auditObjectDbRuntimeAdoption(runtimeRoot, actualRepositoryHashes());
    assert.deepEqual(result.failures, []);
    assert.equal(result.productionSourceCallCount, 2);
    assert.deepEqual(result.connectedIngressFamilies, ["EVENT_CONTROL", "SETTLEMENT", "ADMIN_PET_DATA_COMPARE"]);
  });
});
