import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { PendantMarketInfoService, isPendantMarketInfoCommandCandidate } from "../src/market/pendant-market-info-service.js";
import { PendantInfoService, isPendantInfoCommandCandidate } from "../src/pet/pendant-info-service.js";
import { PendantProbabilityService, isPendantProbabilityCommand } from "../src/pet/pendant-probability-service.js";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n?/g, "\n");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const normalize = (sql: string) => sql.replace(/\s+/g, " ").trim();
const safe = (value: any): any => typeof value === "bigint" ? { $bigint: value.toString() }
  : Array.isArray(value) ? value.map(safe)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, safe(child)])) : value;
const manifest = JSON.parse(read("개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json"));
const output = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave10-pendant-read-v1.json";
const receiptScenarios = ["READ_POSITIVE", "NEGATIVE_GUARD", "EXACT_OUTPUT", "SOURCE_DOMAIN_DML_ZERO", "RESTART_CONSISTENCY"];
const riskScenarios = ["ROLLBACK", "SAME_EVENT_REPLAY", "APP_INBOX_DUPLICATE", "MISSING_IDENTITY", "WRONG_OPERATIONAL_CHANNEL", "PAYLOAD_DESTINATION_DRIFT"];
const definitions = [
  { consumerId: "runtime-dispatch-36d6721ade0707a6", caseId: "case:pendant-market-info", message: "/펜던트거래정보 3", invalid: "/펜던트거래정보3", commandCode: "PENDANT_MARKET_INFO", handlerKey: "pendant_market_info", serviceFile: "개발환경_고도화/runtime/src/market/pendant-market-info-service.ts", service: PendantMarketInfoService, guard: isPendantMarketInfoCommandCandidate },
  { consumerId: "runtime-dispatch-8c6c3c3d598fe078", caseId: "case:pendant-info", message: "/펜던트정보 1", invalid: "/펜던트정보1", commandCode: "PENDANT_INFO_READ", handlerKey: "pendant_info_read", serviceFile: "개발환경_고도화/runtime/src/pet/pendant-info-service.ts", service: PendantInfoService, guard: isPendantInfoCommandCandidate },
  { consumerId: "runtime-dispatch-19076db78c2eefb9", caseId: "case:pendant-probability", message: "/펜던트확률", invalid: "/펜던트확률 안내", commandCode: "PENDANT_PROBABILITY_READ", handlerKey: "pendant_probability_read", serviceFile: "개발환경_고도화/runtime/src/pet/pendant-probability-service.ts", service: PendantProbabilityService, guard: isPendantProbabilityCommand },
] as const;
type Definition = typeof definitions[number];
const evidenceZero = () => ({ operations: 0, outbox_messages: 0, command_executions: 0, command_audit: 0 });
function locate(file: string, needle: string) { const source = read(file); if (!source.includes(needle)) throw new Error(`${file} missing ${needle}`); return { file, start: 0, end: source.length, sha256: sha(source), needle }; }
function locateAppBranch(handlerKey: string) { const file = "개발환경_고도화/runtime/src/app.ts", source = read(file), anchor = `partialDispatchDecision.handlerKey === "${handlerKey}"`, compact = `partialDispatchDecision.handlerKey==="${handlerKey}"`, index = Math.max(source.indexOf(anchor), source.indexOf(compact)); if (index < 0) throw new Error(`app missing ${handlerKey}`); const start = Math.max(source.lastIndexOf("      if (isOperationalChannel", index), source.lastIndexOf("      if(isOperationalChannel", index)); const endMarker = source.indexOf("\n      }", index); const end = endMarker < 0 ? source.indexOf("\n\n", index) : endMarker + 8; if (start < 0 || end <= start) throw new Error(`app span missing ${handlerKey}`); const span = source.slice(start, end); return { file, start, end, sha256: sha(span), needle: handlerKey }; }
function replayResult(def: Definition) { if (def.handlerKey === "pendant_probability_read") return { status: "replied", data: "저장된 펜던트 확률", outboxId: "601", rowCount: 13, rateTotal: 100 }; return { status: "found", data: "저장된 펜던트 정보", outboxId: "601", ...(def.handlerKey === "pendant_market_info" ? { listingId: "9223372036854775806", instanceId: "9223372036854775805" } : { instanceId: "9223372036854775805" }) }; }
const probabilityRows = [["조약돌", "🪨", "최하급", "31", 1], ["동빛", "🔸", "하급", "20", 2], ["은빛", "⚪", "하급+", "15", 3], ["금빛", "🟡", "중급", "10", 4], ["청옥", "🔹", "중급+", "7", 5], ["홍옥", "🔴", "상급", "5", 6], ["별빛", "⭐", "상급+", "4", 7], ["달빛", "🌙", "최상급", "3", 8], ["햇빛", "☀️", "최상급+", "2", 9], ["신화", "🌀", "신화", "1.5", 10], ["초월", "🌌", "초월", "1", 11], ["창세", "🌠", "창세", "0.4", 12], ["창조", "✨", "창조", "0.1", 13]].map(([name, icon, grade, rate, drawOrder]) => ({ name, icon, grade, rate, drawOrder }));
function rowsFor(def: Definition, scenario: string, sql: string) {
  if (sql.includes("FROM command_aliases")) return [{ command_code: def.commandCode, handler_key: def.handlerKey, auth_scope: "VERIFIED_USER", rollout_state: "ACTIVE" }];
  if (sql === "SELECT id FROM channels WHERE provider_code = ? AND external_channel_id = ?") return [{ id: 11n }];
  if (sql === "SELECT id FROM external_identities WHERE provider_code = 'kakao' AND external_user_id = ?") return [{ id: 42n }];
  if (sql.startsWith("SELECT attempt_count + 1 AS next_attempt FROM outbox_messages")) return [{ next_attempt: 1n }];
  if (sql.includes("FROM external_identities identity") && scenario === "MISSING_IDENTITY") return [];
  if (def.handlerKey === "pendant_market_info" && sql.includes("SELECT identity.id identity_id,identity.player_id")) return [{ identity_id: 42n, player_id: 1n }];
  if (def.handlerKey === "pendant_info_read" && sql.includes("SELECT identity.id identity_id,profile.player_id")) return [{ identity_id: 42n, player_id: 1n, pet_id: 2n, rank_display: "🥇호이" }];
  if (def.handlerKey === "pendant_probability_read" && sql.includes("SELECT identity.id identity_id")) return [{ identity_id: 42n }];
  if (sql.startsWith("SELECT result_json FROM operations")) return ["SAME_EVENT_REPLAY", "PAYLOAD_DESTINATION_DRIFT"].includes(scenario) ? [{ result_json: replayResult(def) }] : [];
  if (sql.includes("FROM market_listings listing")) return [{ listing_id: 9223372036854775806n, asset_type_code: "ITEM", inventory_instance_id: 9223372036854775805n, object_type: "pendant", item_name: "별빛 펜던트⭐", name_value: "별빛 펜던트", icon_value: "⭐", grade_value: "창조", durability_value: "4", max_durability_value: "5", upgrade_value: "30" }];
  if (sql.includes("FROM inventory_instances instance")) return [{ instance_id: 9223372036854775805n, item_name: "별빛 펜던트⭐", name_value: "별빛 펜던트", icon_value: "⭐", grade_value: "창조", durability_value: "4", max_durability_value: "5", upgrade_value: "30" }, { instance_id: 11n, item_name: "조약돌 펜던트🪨", name_value: "조약돌 펜던트", icon_value: "🪨", grade_value: "최하급", durability_value: "5", max_durability_value: "5", upgrade_value: "0" }];
  if (sql.includes("FROM item_definitions WHERE code LIKE 'ITEM-PENDANT-DRAW-%'")) return probabilityRows;
  throw new Error(`${def.consumerId}/${scenario} unhandled query: ${sql}`);
}
function insertId(sql: string) { if (sql.startsWith("INSERT INTO operations")) return 501n; if (sql.startsWith("INSERT INTO outbox_messages")) return 601n; if (sql.startsWith("INSERT INTO command_executions")) return 701n; if (sql.startsWith("INSERT INTO command_audit")) return 801n; if (sql.startsWith("INSERT INTO delivery_attempts")) return 901n; return 0n; }

async function capture(def: Definition, scenario: string) {
  const providerEventId = `wave10-${def.consumerId}-${scenario.toLowerCase()}`;
  const input: any = { providerEventId, eventId: `iris:${providerEventId}`, externalUserId: scenario === "MISSING_IDENTITY" ? "missing-pendant-user" : "pendant-user", destinationId: scenario === "PAYLOAD_DESTINATION_DRIFT" ? "changed-room" : "pendant-room", message: scenario === "NEGATIVE_GUARD" ? def.invalid : def.message };
  const queries: any[] = [], mutations: any[] = [], transactionEvents: string[] = [];
  const evidenceRows: Record<string, number> = ["SAME_EVENT_REPLAY", "PAYLOAD_DESTINATION_DRIFT", "APP_INBOX_DUPLICATE"].includes(scenario)
    ? { operations: 1, outbox_messages: 1, command_executions: 1, command_audit: 1 } : evidenceZero();
  const before = { ...evidenceRows };
  const evidenceTables = new Set(Object.keys(evidenceRows));
  const db: any = {
    ping: async () => undefined, close: async () => undefined, verifyRollback: async () => true,
    withTransaction: async (work: any) => { transactionEvents.push("BEGIN"); const state = { ...evidenceRows }; try { const value = await work(db); transactionEvents.push("COMMIT"); return value; } catch (error) { Object.assign(evidenceRows, state); transactionEvents.push("ROLLBACK"); throw error; } },
    query: async (sql: string, values: any[] = []) => { const normalized = normalize(sql), rows = rowsFor(def, scenario, normalized); queries.push({ expectedNormalizedSql: normalized, expectedValues: safe(values), rows: safe(rows) }); return rows; },
    execute: async (sql: string, values: any[] = []) => {
      const normalized = normalize(sql), id = insertId(normalized);
      const step: any = { expectedNormalizedSql: normalized, expectedValues: safe(values).map((value: any, index: number) => index === 0 && normalized.startsWith("INSERT INTO operations") ? { matcher: "UUID_V4" } : value), affectedRows: 1, insertId: id.toString() };
      if (scenario === "APP_INBOX_DUPLICATE" && normalized.startsWith("INSERT INTO event_inbox")) step.error = { message: "wave10 duplicate inbox", code: "ER_DUP_ENTRY", errno: 1062 };
      if (scenario === "ROLLBACK" && normalized.startsWith("INSERT INTO command_executions") && normalized.includes(`'${def.commandCode}'`)) step.error = { message: "wave10 forced middle-DML rollback", code: "ER_SIGNAL_EXCEPTION", errno: 1644 };
      mutations.push(step);
      if (step.error) { const error: any = new Error(step.error.message); Object.assign(error, step.error); throw error; }
      const table = /^INSERT INTO\s+([A-Za-z0-9_]+)/i.exec(normalized)?.[1];
      if (table !== undefined && evidenceTables.has(table)) evidenceRows[table] += 1;
      return { affectedRows: 1n, insertId: id };
    },
  };
  const sentReplies: Array<{ room: string; data: string }> = [];
  let serviceInvocationCount = 0;
  const originalHandle = def.service.prototype.handle;
  def.service.prototype.handle = async function (...args: any[]) { serviceInvocationCount += 1; return originalHandle.apply(this, args as never); };
  const token = "wave10-in-memory-token";
  const rejectedByChannel = scenario === "NEGATIVE_GUARD" || scenario === "WRONG_OPERATIONAL_CHANNEL";
  const app = buildApp(loadConfig({ NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "wave10-in-memory-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: "127.0.0.1", DATABASE_PORT: "3306", DATABASE_USER: "unused", DATABASE_PASSWORD: "unused", DATABASE_NAME: "unused" }), {
    database: db,
    inspectIrisChannel: async () => rejectedByChannel ? { mode: "denied", channelClass: "open_group", reason: "not_designated", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } } : { mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } },
    sendIrisTextReply: async (reply) => { sentReplies.push(reply); }, sendIrisImageReply: async () => { throw new Error("Wave10 unexpected image reply"); },
  });
  let response;
  try { response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: input.message, room: "Wave10 펜던트방", json: { _id: input.providerEventId, chat_id: input.destinationId, user_id: input.externalUserId } } }); }
  finally { def.service.prototype.handle = originalHandle; await app.close(); }
  const body = JSON.parse(response.body);
  const noReplyCode = scenario === "NEGATIVE_GUARD" ? "INVALID_COMMAND_NO_CALL" : scenario === "APP_INBOX_DUPLICATE" ? "APP_INBOX_DUPLICATE_NO_CALL" : scenario === "MISSING_IDENTITY" ? "MISSING_IDENTITY_NO_REPLY" : scenario === "WRONG_OPERATIONAL_CHANNEL" ? "WRONG_OPERATIONAL_CHANNEL_NO_CALL" : scenario === "ROLLBACK" ? "SERVICE_ROLLBACK_NO_REPLY" : "NO_REPLY";
  const httpOracle = { statusCode: response.statusCode, accepted: body.accepted ?? false, ignored: body.ignored ?? false, channelMode: body.channelMode ?? null, duplicate: body.duplicate ?? false, serviceInvocationCount, evidenceRowsBefore: before, evidenceRowsAfter: { ...evidenceRows }, sentReplies, noReplyCode };
  const reply = sentReplies[0]?.data ?? noReplyCode;
  const result = JSON.stringify({ statusCode: response.statusCode, accepted: body.accepted, ignored: body.ignored, channelMode: body.channelMode ?? null, duplicate: body.duplicate ?? false, serviceInvocationCount, evidenceRowsBefore: before, evidenceRowsAfter: { ...evidenceRows }, sentReplies });
  return { input, queries, mutations, transactionEvents, httpOracle, reply, result };
}

const cases: any[] = [], bindings: any[] = [], riskBindings: any[] = [];
for (const def of definitions) {
  const source = manifest.consumers.find((entry: any) => entry.consumerId === def.consumerId); if (!source) throw new Error(`missing ${def.consumerId}`);
  const captured: Record<string, any> = {}; for (const scenario of [...receiptScenarios, ...riskScenarios]) captured[scenario] = await capture(def, scenario);
  const consumer = {
    consumerId: def.consumerId, sourceLocator: { ...locateAppBranch(def.handlerKey), symbol: source.symbol, triggerOrPredicate: source.triggerOrPredicate, interfaceId: source.interfaceId, catalogSourceSpanSha256: source.sourceSpan.sha256, catalogSourceSpanStatus: "STALE_RELOCATED_AT_WAVE10" }, frozenSourceCommit: "15abb95203e7eb375c9f0bd4294a0ec7100aa1a6",
    chainLocators: [locate("개발환경_고도화/runtime/src/app.ts", "/api/v1/integrations/iris/events"), locate("개발환경_고도화/runtime/src/integration/event-processing-service.ts", "export class ProcessIrisEventService"), locate("개발환경_고도화/runtime/src/dispatch/command-dispatcher.ts", "async resolveReadOnly("), locate(def.serviceFile, "withTransaction")],
    errorScenarios: ["ROLLBACK"], scenarioInputsByScenario: Object.fromEntries([...receiptScenarios, ...riskScenarios].map((scenario) => [scenario, captured[scenario].input])), queryPlanByScenario: Object.fromEntries([...receiptScenarios, ...riskScenarios].map((scenario) => [scenario, captured[scenario].queries])), mutationPlanByScenario: Object.fromEntries([...receiptScenarios, ...riskScenarios].map((scenario) => [scenario, captured[scenario].mutations])), expectedResultsByScenario: Object.fromEntries([...receiptScenarios, ...riskScenarios].map((scenario) => [scenario, captured[scenario].result])), expectedReplyByScenario: Object.fromEntries([...receiptScenarios, ...riskScenarios].map((scenario) => [scenario, captured[scenario].reply])), httpOracleByScenario: Object.fromEntries([...receiptScenarios, ...riskScenarios].map((scenario) => [scenario, captured[scenario].httpOracle])), transactionEventsByScenario: Object.fromEntries([...receiptScenarios, ...riskScenarios].map((scenario) => [scenario, captured[scenario].transactionEvents])),
  };
  cases.push({ caseId: def.caseId, executablePath: "buildApp().inject Iris HTTP event→token→normalize→operational channel→ProcessIrisEventService inbox→partial dispatch→production pendant read service→outbox delivery callback", transactionPath: "actual ProcessIrisEventService, pendant read service and recordOutboxDelivery transactions; callback stub only; external sender/network excluded", requiredScenarios: receiptScenarios, riskScenarios, consumers: [consumer] });
  for (const scenario of receiptScenarios) bindings.push({ consumerId: def.consumerId, harnessId: "harness:object-db-executable-parity:wave10", harnessCaseId: def.caseId, fixtureId: "fixture:object-db-executable-parity:wave10:pendant-read:v1", scenarioId: `scenario:${scenario.toLowerCase().replaceAll("_", "-")}`, scenarioKind: scenario });
  for (const scenario of riskScenarios) riskBindings.push({ consumerId: def.consumerId, harnessId: "harness:object-db-executable-parity:wave10", harnessCaseId: def.caseId, fixtureId: "fixture:object-db-executable-parity:wave10:pendant-read:v1", scenarioId: `scenario:${scenario.toLowerCase().replaceAll("_", "-")}`, scenarioKind: scenario });
}
const actual = { format: "hoibot-object-db-consumer-parity-case-fixture-v1", fixtureId: "fixture:object-db-executable-parity:wave10:pendant-read:v1", bindings, payload: { cases, riskBindings, riskNotes: ["펜던트 상세 계산의 등급·강화 수치가 서비스에 하드코딩되어 정의 DB 변경과 불일치할 위험이 있습니다.", "펜던트 확률 조회는 기존 item_definitions.code에 의존합니다. 이미 적용된 migration/provider는 Wave10에서 수정하지 않습니다.", "세 서비스 모두 재시도 정책 없이 FOR UPDATE를 사용하며 lock 순서를 변경하지 않습니다.", "eventId만 멱등성 키이므로 payload·destination 변경은 기존 결과를 재사용합니다.", "오픈톡 identity 누락과 비운영 채널은 실제 HTTP/app/service 계측과 business evidence table before/after snapshot으로 검증합니다."] } };
const canonical = JSON.parse(read(output));
if (JSON.stringify(actual) !== JSON.stringify(canonical)) throw new Error("Wave10 independent canonical HTTP/SQL/row/output vector drift");
console.log(JSON.stringify({ status: "PASS", cases: cases.length, receipts: bindings.length, risks: riskBindings.length }));
