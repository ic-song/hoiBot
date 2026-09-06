import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const MODULE_EXECUTION_ID = randomUUID();
const SCENARIOS = ["READ_POSITIVE", "NEGATIVE_GUARD", "EXACT_OUTPUT", "SOURCE_DOMAIN_DML_ZERO", "RESTART_CONSISTENCY"];
const TARGETS = {
  "runtime-dispatch-f53934feccdd6d39": { file: "개발환경_고도화/runtime/src/shop/point-shop-catalog-iris-handler.ts", exportName: "PointShopCatalogIrisHandler" },
  "runtime-dispatch-f024a0ae45b58a2a": { file: "개발환경_고도화/runtime/src/package/package-iris-command-handler.ts", exportName: "PackageIrisCommandHandler" },
  "runtime-dispatch-e45c1c15e08c165a": { file: "개발환경_고도화/runtime/src/package/package-catalog-add-wizard-iris-handler.ts", exportName: "PackageCatalogAddWizardIrisHandler" },
};

function assert(value, message) { if (!value) throw new Error(message); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function canonical(path) { return readFileSync(path, "utf8").replace(/\r\n?/g, "\n"); }

function context(args) {
  let assertionCount = 0;
  const check = (value, message) => { assertionCount += 1; assert(value, message); };
  const parityCase = args.fixturePayload.cases.find((candidate) => candidate.caseId === args.harnessCaseId);
  const consumer = parityCase?.consumers.find((candidate) => candidate.consumerId === args.consumerId);
  const target = TARGETS[args.consumerId];
  check(target && consumer && JSON.stringify(parityCase.requiredScenarios) === JSON.stringify(SCENARIOS), "Wave7 case drift");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const dispatch = canonical(resolve(root, consumer.currentDispatchLocator.file));
  const dispatchSpan = dispatch.slice(consumer.currentDispatchLocator.start, consumer.currentDispatchLocator.end);
  check(hash(dispatchSpan) === consumer.currentDispatchLocator.sha256 && hash(dispatchSpan) === consumer.sourceLocator.sha256, "Wave7 dispatch span drift");
  for (const locator of consumer.chainLocators) {
    const source = canonical(resolve(root, locator.file));
    const span = source.slice(locator.start, locator.end);
    check(hash(span) === locator.sha256 && span.includes(locator.needle), `Wave7 chain source drift: ${locator.file}`);
  }
  return { consumer, target, root, check, get assertionCount() { return assertionCount; } };
}

export async function executeWave7ServiceChain(args) {
  const state = context(args);
  const module = await tsImport(pathToFileURL(resolve(state.root, state.target.file)).href, import.meta.url);
  const Handler = module[state.target.exportName];
  state.check(typeof Handler === "function", "Wave7 handler export drift");
  const handler = new Handler(args.database);
  if (args.scenarioKind === "NEGATIVE_GUARD") {
    let error = null;
    try { await handler.execute(state.consumer.negativeInput); }
    catch (cause) { error = cause && typeof cause === "object" && "code" in cause ? cause.code : cause instanceof Error ? cause.message : String(cause); }
    state.check(error === state.consumer.expectedGuardError, "Wave7 guard drift");
    return { executedConsumerId: args.consumerId, executedCaseId: args.harnessCaseId, moduleExecutionId: MODULE_EXECUTION_ID, assertionCount: state.assertionCount, reply: error, result: JSON.stringify({ error, queryCount: 0 }) };
  }
  const result = await handler.execute(state.consumer.input);
  const expected = state.consumer.expectedResultsByScenario[args.scenarioKind];
  state.check(JSON.stringify(result) === JSON.stringify(expected), "Wave7 result drift");
  const raw = JSON.stringify(result);
  return { executedConsumerId: args.consumerId, executedCaseId: args.harnessCaseId, moduleExecutionId: MODULE_EXECUTION_ID, assertionCount: state.assertionCount, reply: raw, result: raw };
}
