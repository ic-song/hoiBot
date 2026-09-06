import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CommandDispatcher, MariaCommandRouteReader } from "../src/dispatch/command-dispatcher.js";
import { PlayerCumulativeLevelRankReadService } from "../src/player/player-cumulative-level-rank-read-service.js";
import { PlayerCumulativeLikeRankReadService } from "../src/player/player-cumulative-like-rank-read-service.js";
import { PlayerOverallRankReadService } from "../src/player/player-overall-rank-read-service.js";
import { HomeRankingReadService } from "../src/home/home-ranking-read-service.js";
import { HomeFurnitureRankReadService } from "../src/home/home-furniture-rank-read-service.js";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n?/g, "\n");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const normalize = (sql: string) => sql.replace(/\s+/g, " ").trim();
const manifest = JSON.parse(read("개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json"));
const output = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave9-rank-chain-v1.json";
const receiptScenarios = ["READ_POSITIVE", "NEGATIVE_GUARD", "EXACT_OUTPUT", "SOURCE_DOMAIN_DML_ZERO", "RESTART_CONSISTENCY"];
const riskScenarios = ["ROLLBACK", "SAME_EVENT_REPLAY"];
const definitions = [
  ["runtime-dispatch-465e4b3a15c003dc", "case:rank-cumulative-level", "/누렙순위", "/누렙순위 안내", "PLAYER_CUMULATIVE_LEVEL_RANK_READ", "player_cumulative_level_rank_read", "개발환경_고도화/runtime/src/player/player-cumulative-level-rank-read-service.ts", PlayerCumulativeLevelRankReadService],
  ["runtime-dispatch-9db5e3e6c256b5fa", "case:rank-cumulative-like", "/누좋순위", "/누좋순위 안내", "PLAYER_CUMULATIVE_LIKE_RANK_READ", "player_cumulative_like_rank_read", "개발환경_고도화/runtime/src/player/player-cumulative-like-rank-read-service.ts", PlayerCumulativeLikeRankReadService],
  ["runtime-dispatch-eaa906ea249408a5", "case:rank-overall", "/종합순위", "/종합순위 안내", "PLAYER_OVERALL_RANK_READ", "player_overall_rank_read", "개발환경_고도화/runtime/src/player/player-overall-rank-read-service.ts", PlayerOverallRankReadService],
  ["runtime-dispatch-e02f58bf27070ab0", "case:rank-home", "/펫홈순위", "/펫홈순위 안내", "HOME_RANKING_READ", "home_ranking_read", "개발환경_고도화/runtime/src/home/home-ranking-read-service.ts", HomeRankingReadService],
  ["runtime-dispatch-e54fc7fbded287c6", "case:rank-furniture", "/가구순위", "/가구순위 안내", "HOME_FURNITURE_RANK_READ", "home_furniture_rank_read", "개발환경_고도화/runtime/src/home/home-furniture-rank-read-service.ts", HomeFurnitureRankReadService],
] as const;
const safe = (value: any): any => typeof value === "bigint" ? { $bigint: value.toString() } : Array.isArray(value) ? value.map(safe) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, safe(child)])) : value;
function locate(file: string, needle: string) {
  const source = read(file);
  if (!source.includes(needle)) throw new Error(`${file} missing ${needle}`);
  return { file, start: 0, end: source.length, sha256: sha(source), needle };
}
function replayResult(def: typeof definitions[number]) {
  const data = `저장된 ${def[5]}`;
  return def[0].includes("eaa906") ? { data, outboxId: "601", rowCount: 1, requesterRank: 1 } : { data, outboxId: "601", rowCount: 1 };
}
function rowsFor(def: typeof definitions[number], scenario: string, sql: string) {
  if (sql.includes("FROM command_aliases")) return [{ command_code: def[4], handler_key: def[5], auth_scope: "VERIFIED_USER", rollout_state: "ACTIVE" }];
  if (sql.includes("SELECT id identity_id,player_id FROM external_identities")) return [{ identity_id: 42n, player_id: 1n }];
  if (sql.startsWith("SELECT result_json FROM operations")) return scenario === "SAME_EVENT_REPLAY" ? [{ result_json: replayResult(def) }] : [];
  if (sql.includes("CAST(CAST(profile.level AS DECIMAL")) return [{ player_id: 1n, current_display_name: "호이", rank_emoji: "🥇", total_level: "123" }];
  if (sql.includes("CAST(COALESCE(counters.lifetime_like")) return [{ player_id: 1n, current_display_name: "호이", rank_emoji: "🥇", total_likes: "456" }];
  if (sql.includes("pet.id pet_id,pet.experience pet_experience")) return [{ player_id: 1n, current_display_name: "호이", rank_emoji: "🥇", source_order: 1n, pet_id: 2n, pet_experience: 100n, pet_enhancement: 3n, mini_grade: null, mini_raid: 0n, mini_castle: 0n, home_charm: 10n, arcana_count: 0n, royal_placed_count: 0n, intimacy_charm: 0n, elemental_raid: 0n, elemental_castle: 0n, pendant_raid: 0n, pendant_castle: 0n, cube_raid: "0", cube_castle: "0", cube_pet_upgrade: "0", guild_raid_units: 0n, guild_castle_units: 0n }];
  if (sql.startsWith("SELECT DISTINCT pet.player_id")) return [];
  if (sql.includes("FROM player_homes home")) return [{ player_id: 1n, owner_name: "호이", rank_emoji: "🥇", house_name: "호이집", base_experience: 7n, floor_area: 30n }];
  if (sql.includes("FROM furniture_inventory_instances instance")) return [{ owner_name: "호이", rank_emoji: "🥇", furniture_name: "별빛침대", charm_value: 9000n, grade_name: "로열 루미에르", stable_id: 11n }];
  throw new Error(`${def[0]}/${scenario} unhandled query: ${sql}`);
}
function insertId(sql: string) { if (sql.startsWith("INSERT INTO operations")) return 501n; if (sql.startsWith("INSERT INTO outbox_messages")) return 601n; if (sql.startsWith("INSERT INTO command_executions")) return 701n; if (sql.startsWith("INSERT INTO command_audit")) return 801n; return 0n; }
async function capture(def: typeof definitions[number], scenario: string) {
  const input = { eventId: `wave9-${def[0]}-${scenario.toLowerCase()}`, externalUserId: "rank-user", destinationId: "rank-room", message: scenario === "NEGATIVE_GUARD" ? def[3] : def[2] };
  if (scenario === "NEGATIVE_GUARD") return { queries: [], mutations: [], result: "INVALID_COMMAND_NO_CALL", input };
  const queries: any[] = [], mutations: any[] = [];
  const db: any = {
    withTransaction: async (work: any) => work(db),
    query: async (sql: string, values: any[] = []) => { const normalized = normalize(sql), rows = rowsFor(def, scenario, normalized); queries.push({ expectedNormalizedSql: normalized, expectedValues: safe(values), rows: safe(rows) }); return rows; },
    execute: async (sql: string, values: any[] = []) => {
      const normalized = normalize(sql), id = insertId(normalized), step: any = { expectedNormalizedSql: normalized, expectedValues: safe(values).map((value: any, index: number) => index === 0 && normalized.startsWith("INSERT INTO operations") ? { matcher: "UUID_V4" } : value), affectedRows: 1, insertId: id.toString() };
      if (scenario === "ROLLBACK" && normalized.startsWith("INSERT INTO command_executions")) step.error = { message: "wave9 forced middle-DML rollback", code: "ER_SIGNAL_EXCEPTION", errno: 1644 };
      mutations.push(step);
      if (step.error) { const error: any = new Error(step.error.message); Object.assign(error, step.error); throw error; }
      return { affectedRows: 1n, insertId: id };
    },
  };
  const dispatcher = new CommandDispatcher(new MariaCommandRouteReader(db), { enabled: true, allowAllCanaries: false, canaryUserIds: new Set() }, undefined);
  const decision = await dispatcher.resolveReadOnly({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true });
  if (decision.route !== "MODERN" || decision.handlerKey !== def[5]) throw new Error(`${def[0]} dispatch drift`);
  try { return { queries, mutations, result: JSON.stringify(await new def[7](db).read(input)), input }; }
  catch (error) { if (scenario !== "ROLLBACK") throw error; const caught = error as any; return { queries, mutations, result: `ERROR:${caught.code ?? caught.message}`, input }; }
}
const cases: any[] = [], bindings: any[] = [], riskBindings: any[] = [];
for (const def of definitions) {
  const source = manifest.consumers.find((entry: any) => entry.consumerId === def[0]);
  if (!source) throw new Error(`missing ${def[0]}`);
  const captured: Record<string, any> = {};
  for (const scenario of [...receiptScenarios, ...riskScenarios]) captured[scenario] = await capture(def, scenario);
  const consumer = {
    consumerId: def[0],
    sourceLocator: { ...locate(source.file, def[5]), symbol: source.symbol, triggerOrPredicate: source.triggerOrPredicate, interfaceId: source.interfaceId, catalogSourceSpanSha256: source.sourceSpan.sha256, catalogSourceSpanStatus: "STALE_RELOCATED_AT_WAVE9" },
    frozenSourceCommit: "15abb95203e7eb375c9f0bd4294a0ec7100aa1a6",
    chainLocators: [locate("개발환경_고도화/runtime/src/app.ts", def[5]), locate("개발환경_고도화/runtime/src/dispatch/command-dispatcher.ts", "async resolveReadOnly("), locate(def[6], "this.db.withTransaction".replace("this.db", def[0].includes("eaa906") ? "this.database" : "this.db"))],
    errorScenarios: ["ROLLBACK"],
    scenarioInputsByScenario: Object.fromEntries([...receiptScenarios, ...riskScenarios].map((scenario) => [scenario, captured[scenario].input])),
    queryPlanByScenario: Object.fromEntries([...receiptScenarios, ...riskScenarios].map((scenario) => [scenario, captured[scenario].queries])),
    mutationPlanByScenario: Object.fromEntries([...receiptScenarios, ...riskScenarios].map((scenario) => [scenario, captured[scenario].mutations])),
    expectedResultsByScenario: Object.fromEntries([...receiptScenarios, ...riskScenarios].map((scenario) => [scenario, captured[scenario].result])),
  };
  cases.push({ caseId: def[1], executablePath: "Iris event callback→partial dispatch→CommandDispatcher→exact guard→production rank service transaction", transactionPath: "actual rank service transaction; external sender/network excluded", requiredScenarios: receiptScenarios, riskScenarios, consumers: [consumer] });
  for (const scenario of receiptScenarios) bindings.push({ consumerId: def[0], harnessId: "harness:object-db-executable-parity:wave9", harnessCaseId: def[1], fixtureId: "fixture:object-db-executable-parity:wave9:rank-chain:v1", scenarioId: `scenario:${scenario.toLowerCase().replaceAll("_", "-")}`, scenarioKind: scenario });
  for (const scenario of riskScenarios) riskBindings.push({ consumerId: def[0], harnessId: "harness:object-db-executable-parity:wave9", harnessCaseId: def[1], fixtureId: "fixture:object-db-executable-parity:wave9:rank-chain:v1", scenarioId: `scenario:${scenario.toLowerCase().replaceAll("_", "-")}`, scenarioKind: scenario });
}
writeFileSync(resolve(root, output), JSON.stringify({ format: "hoibot-object-db-consumer-parity-case-fixture-v1", fixtureId: "fixture:object-db-executable-parity:wave9:rank-chain:v1", bindings, payload: { cases, riskBindings, riskNotes: ["모든 순위 조회가 재시도 없이 광범위 FOR UPDATE를 사용합니다.", "eventId만 멱등성 키이므로 destination 변경은 기존 결과를 재사용합니다.", "가구순위는 charm_snapshot·grade_display_name 레거시 projection을 읽습니다.", "종합순위는 다수 레거시 projection과 스킬 표시명 연결을 읽습니다.", "동시 동일 event는 DB unique/gap-lock 결과에 따라 단일 writer 또는 duplicate conflict가 됩니다."] } }, null, 2) + "\n");
console.log(JSON.stringify({ status: "PASS", consumers: definitions.length, bindings: bindings.length, risks: riskBindings.length }));
