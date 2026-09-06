import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const MODULE_EXECUTION_ID = randomUUID();
const SCENARIOS = ["READ_POSITIVE", "NEGATIVE_GUARD", "EXACT_OUTPUT", "SOURCE_DOMAIN_DML_ZERO", "RESTART_CONSISTENCY"];
const TARGETS = {
  "runtime-dispatch-f53934feccdd6d39": { file: "개발환경_고도화/runtime/src/shop/point-shop-catalog-iris-handler.ts", exportName: "PointShopCatalogIrisHandler", handlerKey:"POINT_SHOP_CATALOG_READ",outboxAware: true },
  "runtime-dispatch-f024a0ae45b58a2a": { file: "개발환경_고도화/runtime/src/package/package-iris-command-handler.ts", exportName: "PackageIrisCommandHandler", handlerKey:"PACKAGE_BAG",outboxAware: false },
  "runtime-dispatch-e45c1c15e08c165a": { file: "개발환경_고도화/runtime/src/package/package-catalog-add-wizard-iris-handler.ts", exportName: "PackageCatalogAddWizardIrisHandler", handlerKey:"PACKAGE_CATALOG_WIZARD_GUIDE",outboxAware: true },
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
  const dispatch=args.scenarioKind==="NEGATIVE_GUARD"?state.consumer.negativeDispatch:state.consumer.dispatch;
  const dispatchAllowed=dispatch?.database===true&&dispatch?.eventProcessor===true&&dispatch?.processing===true&&dispatch?.duplicate===false&&dispatch?.route==="MODERN"&&dispatch?.handlerKey===state.target.handlerKey&&(state.target.handlerKey!=="PACKAGE_CATALOG_WIZARD_GUIDE"||dispatch.wizardHandler===true);
  if (args.scenarioKind === "NEGATIVE_GUARD") {
    state.check(dispatchAllowed===false&&dispatch?.duplicate === true, "Wave7 negative dispatch guard drift");
    return { executedConsumerId: args.consumerId, executedCaseId: args.harnessCaseId, moduleExecutionId: MODULE_EXECUTION_ID, assertionCount: state.assertionCount, reply: state.consumer.expectedGuardError, result: JSON.stringify({ error: state.consumer.expectedGuardError, queryCount: 0, mutationCount: 0 }) };
  }
  state.check(dispatchAllowed,"Wave7 positive dispatch guard drift");
  const module = await tsImport(pathToFileURL(resolve(state.root, state.target.file)).href, import.meta.url);
  const Handler = module[state.target.exportName];
  state.check(typeof Handler === "function", "Wave7 handler export drift");
  const handler = new Handler(args.database);
  const handlerResult = await handler.execute(state.consumer.input);
  const expected = state.consumer.expectedResultsByScenario[args.scenarioKind];
  state.check(JSON.stringify(handlerResult) === JSON.stringify(expected), "Wave7 handler result drift");
  let result;
  if (state.target.outboxAware && handlerResult.outboxId) result = { outboxId: handlerResult.outboxId, room: state.consumer.input.channelId, data: handlerResult.message };
  else {
    const eventModule = await tsImport(pathToFileURL(resolve(state.root, "개발환경_고도화/runtime/src/integration/event-processing-service.ts")).href, import.meta.url);
    const processor = new eventModule.ProcessIrisEventService(args.database);
    result = await processor.queueCommandReply(state.consumer.input, handlerResult.commandCode, handlerResult.message);
  }
  const expectedDispatch=handlerResult.outboxId?{outboxId:handlerResult.outboxId,room:state.consumer.input.channelId,data:handlerResult.message}:{outboxId:state.consumer.queueReplyContract.outboxInsertId,room:state.consumer.input.channelId,data:handlerResult.message};
  state.check(JSON.stringify(result) === JSON.stringify(expectedDispatch), "Wave7 dispatch result drift");
  const raw = JSON.stringify(result);
  return { executedConsumerId: args.consumerId, executedCaseId: args.harnessCaseId, moduleExecutionId: MODULE_EXECUTION_ID, assertionCount: state.assertionCount, reply: raw, result: raw };
}
