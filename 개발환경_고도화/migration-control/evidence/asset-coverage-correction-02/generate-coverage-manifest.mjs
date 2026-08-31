// main.js, Info.js, data/*.json의 정적 자산·설정 coverage manifest 생성기
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const OUTPUT = process.env.HOIBOT_CATALOG_OUTPUT || resolve(HERE, "coverage-manifest.json");
const FREEZE_DECISION = resolve(HERE, "freeze-decision.md");
const PROD_REF = process.env.HOIBOT_CATALOG_PROD_REF || "origin/feature/prod";
const CLASSIFICATION_BASELINE = "23ca3409764fbb2ac82f20f562a817926d496dc5";

// 문자열의 SHA-256 해시를 반환한다.
function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

// Git 객체의 UTF-8 파일 내용을 읽는다.
function gitShow(ref, path) {
  return execFileSync("git", ["show", `${ref}:${path}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
}

// 지정 Git ref의 커밋 해시를 반환한다.
function gitRevParse(ref) {
  return execFileSync("git", ["rev-parse", ref], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

// Git ref의 commit 시각을 재생성 가능한 ISO 문자열로 반환한다.
function gitCommitTimestamp(ref) {
  return execFileSync("git", ["show", "-s", "--format=%cI", ref], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

// Git ref에서 추적 중인 data/*.json 경로를 반환한다.
function listDataJsonPaths(ref) {
  return execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "data"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .split(/\r?\n/)
    .filter((path) => /^data\/.*\.json$/i.test(path));
}

// 위치를 1-based 행 번호로 변환한다.
function buildLineLookup(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return (position) => {
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (starts[mid] <= position) low = mid + 1;
      else high = mid;
    }
    return low;
  };
}

// JavaScript 문자열·숫자 literal을 주석과 구분해 추출한다.
function scanLiterals(source) {
  const lineOf = buildLineLookup(source);
  const literals = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 2;
      continue;
    }
    if (char === "/") {
      let previousIndex = index - 1;
      while (previousIndex >= 0 && /\s/.test(source[previousIndex])) previousIndex -= 1;
      const previous = source[previousIndex] || "";
      const previousWordMatch = source.slice(0, previousIndex + 1).match(/([A-Za-z_$][A-Za-z0-9_$]*)$/);
      const previousWord = previousWordMatch ? previousWordMatch[1] : "";
      const regexAllowed = previousIndex < 0 || /[([{,:;=!?&|+*%^~<>-]/.test(previous) || /^(?:return|case|throw|typeof|delete|void|new)$/.test(previousWord);
      if (regexAllowed) {
        index += 1;
        let escaped = false;
        let inClass = false;
        while (index < source.length) {
          const current = source[index];
          if (escaped) escaped = false;
          else if (current === "\\") escaped = true;
          else if (current === "[") inClass = true;
          else if (current === "]") inClass = false;
          else if (current === "/" && !inClass) {
            index += 1;
            while (index < source.length && /[A-Za-z]/.test(source[index])) index += 1;
            break;
          }
          index += 1;
        }
        continue;
      }
    }
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      const start = index;
      let escaped = false;
      index += 1;
      while (index < source.length) {
        const current = source[index];
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      const raw = source.slice(start, index);
      literals.push({ kind: quote === "`" ? "template" : "string", line: lineOf(start), raw });
      continue;
    }
    if ((char >= "0" && char <= "9") && !/[\p{L}\p{N}_$]/u.test(source[index - 1] || "")) {
      const start = index;
      const numericMatch = source.slice(index).match(/^(?:0[xX][0-9A-Fa-f_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*)(?:[eE][+-]?[\d_]+)?)/);
      index += numericMatch ? numericMatch[0].length : 1;
      literals.push({ kind: "number", line: lineOf(start), raw: source.slice(start, index) });
      continue;
    }
    index += 1;
  }
  return literals;
}

// literal이 있는 원본 행의 주변 소비 문맥을 반환한다.
function literalContext(lines, line) {
  return (lines[line - 1] || "").trim().slice(0, 180);
}

// literal이 속한 가장 가까운 함수·명령·선언 소비자를 찾는다.
function inferLiteralConsumer(lines, line, file) {
  const current = (lines[line - 1] || "").trim();
  for (let offset = 0; offset <= 160 && line - 1 - offset >= 0; offset += 1) {
    const candidate = (lines[line - 1 - offset] || "").trim();
    const functionMatch = candidate.match(/function\s+([A-Za-z_$가-힣][A-Za-z0-9_$가-힣]*)\s*\(/);
    if (functionMatch) return { identity: `function:${functionMatch[1]}`, context: `${current} ${candidate}` };
    if (/\b(?:msg|command)\b/.test(candidate)) {
      const commandMatch = candidate.match(/["'](\/[^"][^"']*)["']/);
      if (commandMatch) return { identity: `command:${commandMatch[1].slice(0, 80)}`, context: `${current} ${candidate}` };
    }
    const declarationMatch = candidate.match(/^(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/);
    if (declarationMatch && offset <= 80) return { identity: `declaration:${declarationMatch[1]}`, context: `${current} ${candidate}` };
  }
  return { identity: `line:${line}`, context: current };
}

// literal을 관리 카탈로그 분류로 보수적으로 분류한다.
function classifyLiteral(literal, context) {
  const text = literal.raw;
  if (/\/sdcard\/|DATA_ROOT_PATH|Path\s*=|File\(/.test(context)) return "SYSTEM_ENVIRONMENT_SETTING";
  if (/replier\.reply|\.reply\(|lines?\.push|Msg\s*[+]?=|message|Message|ment|Ment|allsee/.test(context)) return "MESSAGE_TEMPLATE";
  if (/Math\.random|rate|Rate|prob|Prob|chance|Chance|확률/.test(context)) return "RATE_POLICY";
  if (/setTimeout|setInterval|Timeout|timeout|Delay|delay|Deadline|deadline|Ms\b|schedule|Schedule/.test(context)) return "SCHEDULE_DURATION_POLICY";
  if (/addItem|removeItem|reward|Reward|point|Point|exp|Exp|charm|Charm|cost|Cost|price|Price|ticket|Ticket|보상/.test(context)) return "REWARD_COST_POLICY";
  if (/max|min|Max|Min|limit|Limit|count|Count|slot|Slot|횟수|한도/.test(context)) return "LIMIT_POLICY";
  if (/msg\s*(?:={2,3}|!==|===)|startsWith\(|indexOf\(|\/[^/\s]+/.test(text)) return "COMMAND_OR_TRIGGER_TOKEN";
  if (/for\s*\(|\.length|\.slice\(|\.substring\(|parseInt\(|Math\.(?:floor|ceil|max|min)\(/.test(context)) return "IMPLEMENTATION_LITERAL_REVIEW";
  return "INCLUDED_UNTYPED_LEGACY_CONSTANT";
}

// literal 소비 문맥을 도메인 단위로 분류한다.
function classifyLiteralDomain(context) {
  const rules = [
    [/(?:펫무쌍|petMusou|musou)/i, "pet_musou"],
    [/(?:영지|territoryWar|guildTerritory)/i, "guild_territory"],
    [/(?:펫스킬|petSkill)/i, "pet_skill"],
    [/(?:미니펫|miniPet)/i, "mini_pet"],
    [/(?:펫홈|스윗홈|petHome|petSweetHome|furniture)/i, "pet_home"],
    [/(?:펫탐험|petExplore)/i, "pet_explore"],
    [/(?:펫뱃|펫대전|petBattle|playerPet|petData|petTypes|pet_)/i, "pet"],
    [/(?:뱃지|badge|cube)/i, "badge_cube"],
    [/(?:호이패스|호패|초보패스|supportPass|premium|subscription|pass)/i, "support_pass"],
    [/(?:일퀘|주간퀘|퀘스트|dailyQuest|weeklyQuest|quest)/i, "quest"],
    [/(?:티어|rank|Rank|requiredTier|tier)/i, "rank_tier"],
    [/(?:가방|인벤|inventory|bag|Item|item)/i, "inventory_item"],
    [/(?:포인트|currency|Currency|point|Point|다이아)/i, "currency_point"],
    [/(?:경매|auction|bid)/i, "auction"],
    [/(?:당근|carrot|온도|thermo)/i, "carrot_trade"],
    [/(?:이체|transfer|행복재단|happyFoundation)/i, "transfer_foundation"],
    [/(?:피드|댓글|방문|feed|comment|visit|reaction)/i, "social_content"],
    [/(?:강화|upgrade|enhance)/i, "upgrade"],
    [/(?:정령|elemental|반지|ring)/i, "elemental_ring"],
    [/(?:결투|대전|battle|combat|펀치|punch)/i, "battle"],
    [/(?:알림|notice|notification|alert)/i, "notification"],
    [/(?:데이터|admin|Admin|master|Master|운영자)/i, "admin_operation"],
    [/(?:길드|guild)/i, "guild"],
    [/(?:패키지|package)/i, "package"],
    [/(?:타이틀|title)/i, "title"],
    [/(?:펜던트|pendant)/i, "pendant"],
    [/(?:레이드|raid)/i, "raid"],
    [/(?:캐슬|castle)/i, "castle"],
    [/(?:시련|trialTower|tower)/i, "tower"],
    [/(?:출석|attendance)/i, "attendance"],
    [/(?:자유시장|freeMarket|market)/i, "market"],
    [/(?:상점|shop)/i, "shop"],
    [/(?:request|monitor|과부하)/i, "request_monitor"],
  ];
  for (const rule of rules) {
    if (rule[0].test(context)) return rule[1];
  }
  return "common_runtime_configuration";
}

// literal 분류별 canonical 관리 계층을 반환한다.
function literalCanonicalTarget(classification) {
  const targets = {
    SYSTEM_ENVIRONMENT_SETTING: "configuration_sets/values",
    MESSAGE_TEMPLATE: "content_template_definitions/versions",
    RATE_POLICY: "typed_domain_policy_versions",
    SCHEDULE_DURATION_POLICY: "typed_domain_policy_versions",
    REWARD_COST_POLICY: "typed_domain_reward_cost_policy_versions",
    LIMIT_POLICY: "typed_domain_policy_versions",
    COMMAND_OR_TRIGGER_TOKEN: "command_trigger_policy_definitions",
    IMPLEMENTATION_LITERAL_REVIEW: "source_implementation_non_catalog_review",
    INCLUDED_UNTYPED_LEGACY_CONSTANT: "typed_domain_policy_tables + configuration_sets/values",
  };
  return targets[classification];
}

// literal 분류를 카탈로그 포함 또는 source-only 제외로 확정한다.
function literalDisposition(classification) {
  if (classification === "IMPLEMENTATION_LITERAL_REVIEW") {
    return {
      disposition: "EXCLUDED",
      reason: "loop/index/parser arithmetic implementation detail; keep in source and verify through consumer tests",
      canonicalTarget: null,
    };
  }
  return {
    disposition: "INCLUDED",
    reason: "static definition, policy, trigger, message, environment setting, or legacy constant with a named consumer",
    canonicalTarget: literalCanonicalTarget(classification),
  };
}

// 같은 literal 값을 한 행으로 묶고 모든 발생 행을 보존한다.
function aggregateLiterals(source, file) {
  const groups = new Map();
  const lines = source.split(/\r?\n/);
  for (const literal of scanLiterals(source)) {
    const context = literalContext(lines, literal.line);
    const consumerEvidence = inferLiteralConsumer(lines, literal.line, file);
    const key = `${literal.kind}:${sha256(literal.raw)}`;
    let row = groups.get(key);
    if (!row) {
      row = {
        kind: literal.kind,
        valueHash: sha256(literal.raw),
        preview: literal.raw.slice(0, 120),
        occurrenceCount: 0,
        occurrences: [],
        classifications: {},
      };
      groups.set(key, row);
    }
    const classification = classifyLiteral(literal, context);
    const domain = classifyLiteralDomain(consumerEvidence.context);
    const disposition = literalDisposition(classification);
    row.occurrenceCount += 1;
    row.occurrences.push({
      line: literal.line,
      context,
      classification,
      disposition: disposition.disposition,
      reason: disposition.reason,
      domain,
      consumer: `${file}:${consumerEvidence.identity}`,
      canonicalTarget: disposition.canonicalTarget,
    });
    row.classifications[classification] = (row.classifications[classification] || 0) + 1;
  }
  return [...groups.values()];
}

// 선언 대입문의 괄호 literal을 문자열·주석을 무시하며 추출한다.
function extractAssignedLiteral(source, marker) {
  let index = source.indexOf(marker);
  if (index < 0) throw new Error(`marker not found: ${marker}`);
  index += marker.length;
  while (index < source.length && source[index] !== "{" && source[index] !== "[") index += 1;
  const start = index;
  const stack = [];
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") {
      stack.pop();
      if (stack.length === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated literal: ${marker}`);
}

// 순수 정적 선언을 값으로 평가한다.
function evaluateAssignedLiteral(source, marker) {
  const literal = extractAssignedLiteral(source, marker);
  return Function(`"use strict"; return (${literal});`)();
}

// 객체·배열을 field/leaf 경로 목록으로 평탄화한다.
function flattenLeaves(value, prefix = "$", output = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => flattenLeaves(entry, `${prefix}[${index}]`, output));
    if (value.length === 0) output.push({ path: prefix, type: "array", value: [] });
    return output;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    keys.forEach((key) => flattenLeaves(value[key], `${prefix}.${key}`, output));
    if (keys.length === 0) output.push({ path: prefix, type: "object", value: {} });
    return output;
  }
  output.push({ path: prefix, type: value === null ? "null" : typeof value, value });
  return output;
}

// 선언 심볼의 행과 직접 참조 행을 찾는다.
function symbolEvidence(source, symbol) {
  const lines = source.split(/\r?\n/);
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`);
  const references = [];
  lines.forEach((line, index) => {
    if (pattern.test(line)) references.push(index + 1);
  });
  return { declarationLine: references[0] || null, referenceLines: references };
}

// 관리 대상 정적 심볼의 field/leaf 근거를 생성한다.
function buildNamedCatalog(file, source, symbol, marker, domain, target) {
  const value = evaluateAssignedLiteral(source, marker);
  const leaves = flattenLeaves(value);
  return {
    file,
    symbol,
    domain,
    inclusion: "INCLUDED",
    canonicalTarget: target,
    ...symbolEvidence(source, symbol),
    rootType: Array.isArray(value) ? "array" : "object",
    rootEntryCount: Array.isArray(value) ? value.length : Object.keys(value).length,
    leafCount: leaves.length,
    valueHash: sha256(JSON.stringify(value)),
    leaves,
  };
}

const JSON_PATH_CLASSIFICATION = {
  "data/attendanceLight.json": { status: "EXCLUDED", include: [], partial: [], exclude: ["$"], domain: "attendance_runtime_state" },
  "data/board.json": { status: "EXCLUDED", include: [], partial: [], exclude: ["$"], domain: "user_generated_board_state" },
  "data/carrotBoard.json": { status: "EXCLUDED", include: [], partial: [], exclude: ["$"], domain: "user_generated_board_state" },
  "data/castleBattle.json": { status: "EXCLUDED", include: [], partial: [], exclude: ["$"], domain: "castle_battle_runtime_state" },
  "data/castleBattle2.json": { status: "EXCLUDED", include: [], partial: [], exclude: ["$"], domain: "castle_battle_runtime_state" },
  "data/currencyLog.json": { status: "EXCLUDED", include: [], partial: [], exclude: ["$"], domain: "currency_ledger" },
  "data/errorLog.json": { status: "EXCLUDED", include: [], partial: [], exclude: ["$"], domain: "runtime_error_log" },
  "data/eventTowerBoss.json": { status: "INCLUDED", include: ["$"], partial: [], exclude: [], domain: "tower_boss_definition_reward" },
  "data/freeMarket.json": { status: "EXCLUDED", include: [], partial: [], exclude: ["$"], domain: "market_runtime_listing_ledger" },
  "data/guildData.json": { status: "PARTIAL", include: ["$.shop"], partial: ["$.guilds.*.warehouse:item-definition-crosswalk"], exclude: ["$.guilds", "$.nameToId", "$.territoryWar", "$.castleSiegeFlag"], domain: "guild_shop_and_ownership" },
  "data/hoiBotChangeLog.json": { status: "INCLUDED", include: ["$.entries"], partial: [], exclude: [], domain: "developer_note_content" },
  "data/itemInfo.json": { status: "INCLUDED", include: ["$"], partial: [], exclude: [], domain: "item_definition" },
  "data/itemList.json": { status: "INCLUDED", include: ["$"], partial: [], exclude: [], domain: "item_restriction" },
  "data/member.json": { status: "PARTIAL", include: ["$.shop", "$.lordShop", "$.matzangField.shop"], partial: ["$.master", "$.admin", "$.allowedUsers2", "$.allowedUsers4", "$.allowedUsers6", "$.allowedUsersHoipass", "$.HoiCastle.taxRate", "$.hoiHappyFoundation.feeRate", "$.petSkillSystem"], exclude: ["$.attend_list", "$.member", "$.checkcnt", "$.monster", "$.star", "$.mc", "$.petbattlewinner", "$.toplv", "$.auction", "$.topgame", "$.intervalIDs", "$.isSpecialCharactersEventFlag", "$.topCarrotGive", "$.topThermo", "$.adv", "$.miniPetTop", "$.intimacyTop", "$.matzangField.participants", "$.previnterval"], domain: "shop_access_and_runtime_mixed" },
  "data/memberBagCheck/memberBagCheck.json": { status: "PARTIAL", include: [], partial: ["$.*.*:item-definition-crosswalk"], exclude: ["$:inventory-quantity-snapshot"], domain: "item_ownership_crosswalk" },
  "data/member_pet.json": { status: "PARTIAL", include: [], partial: ["$.*.pettype", "$.*.petimg", "$.*.elemental", "$.*.ring:item-definition-crosswalk"], exclude: ["$:pet-ownership-state"], domain: "pet_ownership_crosswalk" },
  "data/member_title.json": { status: "PARTIAL", include: [], partial: ["$.member.*:title-definition-crosswalk"], exclude: ["$:title-ownership-state"], domain: "title_ownership_crosswalk" },
  "data/miniPetCollectionInfo.json": { status: "INCLUDED", include: ["$"], partial: [], exclude: [], domain: "mini_pet_collection_policy" },
  "data/miniPetData.json": { status: "INCLUDED", include: ["$"], partial: [], exclude: [], domain: "mini_pet_definition_policy" },
  "data/miniPet_collection.json": { status: "PARTIAL", include: [], partial: ["$.member.*:mini-pet-definition-crosswalk"], exclude: ["$:mini-pet-collection-ownership-state"], domain: "mini_pet_collection_ownership_crosswalk" },
  "data/miniPet_title.json": { status: "PARTIAL", include: [], partial: ["$.member.*:title-definition-crosswalk"], exclude: ["$:mini-pet-title-ownership-state"], domain: "mini_pet_title_ownership_crosswalk" },
  "data/packageInfo.json": { status: "INCLUDED", include: ["$"], partial: [], exclude: [], domain: "package_definition_reward" },
  "data/packageLog.json": { status: "EXCLUDED", include: [], partial: [], exclude: ["$"], domain: "package_purchase_ledger" },
  "data/petExploreData.json": { status: "PARTIAL", include: ["$.notice"], partial: [], exclude: ["$.bet", "$.userBet", "$.autoFixedDungeon", "$.record"], domain: "pet_explore_content_and_runtime_state" },
  "data/petHomeComments.json": { status: "EXCLUDED", include: [], partial: [], exclude: ["$"], domain: "user_generated_comment_state" },
  "data/petSkillData.json": { status: "PARTIAL", include: [], partial: ["$.*.petSkills.*:skill-definition-crosswalk"], exclude: ["$:pet-skill-ownership-state"], domain: "pet_skill_ownership_crosswalk" },
  "data/petSweetHomeData.json": { status: "PARTIAL", include: [], partial: ["$.*.placedFurniture.*:furniture-definition-crosswalk", "$.*.furnitureBag.*:furniture-definition-crosswalk"], exclude: ["$:home-ownership-runtime-state"], domain: "home_ownership_crosswalk" },
  "data/petSweetHomeInfo.json": { status: "INCLUDED", include: ["$"], partial: [], exclude: [], domain: "home_building_furniture_definition" },
  "data/pet_title.json": { status: "PARTIAL", include: [], partial: ["$.member.*:title-definition-crosswalk"], exclude: ["$:pet-title-ownership-state"], domain: "pet_title_ownership_crosswalk" },
  "data/punchRankData.json": { status: "EXCLUDED", include: [], partial: [], exclude: ["$"], domain: "ranking_runtime_state" },
  "data/requestMonitorConfig.json": { status: "INCLUDED", include: ["$"], partial: [], exclude: [], domain: "system_rate_limit_configuration" },
  "data/trialTower.json": { status: "EXCLUDED", include: [], partial: [], exclude: ["$"], domain: "trial_tower_runtime_state" },
  "data/trialTowerBoss.json": { status: "INCLUDED", include: ["$"], partial: [], exclude: [], domain: "tower_boss_definition_reward" },
};

const JSON_CANONICAL_TARGETS = {
  tower_boss_definition_reward: "typed tower definition/reward policy tables",
  developer_note_content: "versioned developer-note content provider",
  guild_shop_and_ownership: "guild shop policy + guild_warehouse_stacks definition crosswalk",
  item_definition: "item_definitions/object_source_bindings",
  item_restriction: "item policy/version provider",
  shop_access_and_runtime_mixed: "typed shop/access/config providers",
  item_ownership_crosswalk: "item_definitions + inventory_stacks/inventory_instances",
  pet_ownership_crosswalk: "pet_definitions + player_pets",
  title_ownership_crosswalk: "title_definitions + player_titles",
  mini_pet_collection_policy: "mini-pet collection policy tables",
  mini_pet_definition_policy: "mini-pet definitions/policy tables",
  mini_pet_collection_ownership_crosswalk: "mini-pet definitions + owned_mini_pets",
  mini_pet_title_ownership_crosswalk: "title_definitions + title ownership projection",
  package_definition_reward: "package_catalog/command_aliases/reward_rules",
  pet_explore_content_and_runtime_state: "pet-explore content policy provider",
  pet_skill_ownership_crosswalk: "skill_definitions + pet_skill_inventory/pet_skills",
  home_ownership_crosswalk: "furniture definitions + furniture_inventory_instances",
  home_building_furniture_definition: "home/furniture definition and draw-pool policy tables",
  pet_title_ownership_crosswalk: "title_definitions + pet_titles",
  system_rate_limit_configuration: "configuration_sets/values",
};

// wildcard path 규칙을 실제 JSON leaf 경로와 비교한다.
function jsonPathMatches(path, expression) {
  const rule = expression.split(":")[0];
  if (rule === "$") return true;
  const escaped = rule
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^.\\[\\]]+");
  return new RegExp(`^${escaped}(?:\\.|\\[|$)`).test(path);
}

// JSON leaf를 포함·교차매핑·제외 중 하나로 확정한다.
function classifyJsonLeaf(path, explicit) {
  if (explicit.status === "INCLUDED") {
    return { disposition: "INCLUDED", matchedRule: explicit.include[0] || "$", reason: "definition/policy content is catalog scope", canonicalTarget: JSON_CANONICAL_TARGETS[explicit.domain] };
  }
  if (explicit.status === "EXCLUDED") {
    return { disposition: "EXCLUDED", matchedRule: explicit.exclude[0] || "$", reason: "runtime ownership, ledger, user-generated, ranking, or transient state; source hash/count only", canonicalTarget: null };
  }
  const partial = explicit.partial.find((rule) => jsonPathMatches(path, rule));
  if (partial) {
    return { disposition: "CROSSWALK", matchedRule: partial, reason: "runtime ownership leaf retained only to resolve a canonical definition foreign key", canonicalTarget: JSON_CANONICAL_TARGETS[explicit.domain] };
  }
  const included = explicit.include.find((rule) => jsonPathMatches(path, rule));
  if (included) {
    return { disposition: "INCLUDED", matchedRule: included, reason: "embedded definition or policy leaf is catalog scope", canonicalTarget: JSON_CANONICAL_TARGETS[explicit.domain] };
  }
  const excluded = explicit.exclude.find((rule) => jsonPathMatches(path, rule));
  return {
    disposition: "EXCLUDED",
    matchedRule: excluded || "UNLISTED_RUNTIME_STATE_DEFAULT",
    reason: excluded ? "explicit runtime/ownership state exclusion" : "unlisted leaf in a mixed state file defaults to runtime/ownership state, never to an implicit catalog definition",
    canonicalTarget: null,
  };
}

// 민감한 값이나 동적 key를 노출하지 않고 모든 leaf 배정 건수를 집계한다.
function summarizeJsonLeafCoverage(value, explicit) {
  const leaves = flattenLeaves(value);
  const groups = new Map();
  for (const leaf of leaves) {
    const assignment = classifyJsonLeaf(leaf.path, explicit);
    const key = JSON.stringify(assignment);
    let group = groups.get(key);
    if (!group) {
      group = { ...assignment, leafCount: 0, pathHashes: [] };
      groups.set(key, group);
    }
    group.leafCount += 1;
    group.pathHashes.push(sha256(leaf.path));
  }
  const assignments = [...groups.values()].map((group) => ({
    disposition: group.disposition,
    matchedRule: group.matchedRule,
    reason: group.reason,
    canonicalTarget: group.canonicalTarget,
    domain: explicit.domain,
    consumer: `json-domain:${explicit.domain}`,
    leafCount: group.leafCount,
    pathSetHash: sha256(group.pathHashes.sort().join("\n")),
  }));
  const assignedLeafCount = assignments.reduce((sum, group) => sum + group.leafCount, 0);
  return { totalLeafCount: leaves.length, assignedLeafCount, gapCount: leaves.length - assignedLeafCount, assignments };
}

// JSON의 민감한 행 값 없이 구조·건수·해시 근거를 만든다.
function summarizeJsonSource(ref, path) {
  const text = gitShow(ref, path);
  const value = JSON.parse(text);
  const topLevel = Array.isArray(value)
    ? { kind: "array", count: value.length }
    : { kind: "object", count: value && typeof value === "object" ? Object.keys(value).length : 0 };
  const explicit = JSON_PATH_CLASSIFICATION[path];
  if (!explicit) throw new Error(`JSON classification missing: ${path}`);
  return {
    path,
    sha256: sha256(text),
    byteLength: Buffer.byteLength(text, "utf8"),
    topLevel,
    classification: explicit,
    leafCoverage: summarizeJsonLeafCoverage(value, explicit),
  };
}

// Git commit 시각을 결정적 생성 시각으로 사용한다.
function gitCommitTime(ref) {
  return execFileSync("git", ["show", "-s", "--format=%cI", ref], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

// leaf 배열을 path 조회 맵으로 바꾼다.
function leafMap(value) {
  return new Map(flattenLeaves(value).map((leaf) => [leaf.path, leaf.value]));
}

const prodCommit = gitRevParse(PROD_REF);
const prodCommitTimestamp = gitCommitTimestamp(prodCommit);
const mainSource = gitShow(prodCommit, "main.js");
const infoSource = gitShow(prodCommit, "Info.js");
const prodVersionMatch = mainSource.match(/HoiBotVersion\s*=\s*["']([^"']+)["']/);
if (!prodVersionMatch) throw new Error("HoiBotVersion not found in production source");
const prodVersion = prodVersionMatch[1];
const baselineMain = gitShow(CLASSIFICATION_BASELINE, "main.js");
const namedCatalogs = [
  buildNamedCatalog("main.js", mainSource, "guildLevelTable", "var guildLevelTable =", "guild_progression", "guild_contribution_level_policies"),
  buildNamedCatalog("main.js", mainSource, "PET_SKILL_COMPAT_GROUPS", "const PET_SKILL_COMPAT_GROUPS =", "pet_skill_policy", "pet_skill_compatibility_groups/members"),
  buildNamedCatalog("main.js", mainSource, "PET_SKILL_EQUAL_GRADE_WEIGHT_TOTALS", "const PET_SKILL_EQUAL_GRADE_WEIGHT_TOTALS =", "pet_skill_draw_policy", "pet_skill_draw_policy_versions/weights"),
  buildNamedCatalog("main.js", mainSource, "PET_SKILL_LIST", "const PET_SKILL_LIST =", "pet_skill_definition", "skill_definitions/pet_skills/object_source_bindings"),
  buildNamedCatalog("main.js", mainSource, "ticketTierData", "const ticketTierData =", "tier_policy", "tier_definition_and_progression_policy"),
  buildNamedCatalog("main.js", mainSource, "GLOBAL_CONFIG", "const GLOBAL_CONFIG =", "all_domain_configuration", "typed_domain_policy_tables + configuration_sets/values"),
  buildNamedCatalog("main.js", mainSource, "MINI_PET_COMBINATION_REWARDS", "const MINI_PET_COMBINATION_REWARDS =", "mini_pet_combination", "mini_pet_combine_recipe/reward_policy"),
  buildNamedCatalog("main.js", mainSource, "ELITE_MINIPET_COMBINATION_REWARDS", "const ELITE_MINIPET_COMBINATION_REWARDS =", "mini_pet_combination", "mini_pet_elite_combine_recipes/rewards"),
  buildNamedCatalog("main.js", mainSource, "MASTER_MINIPET_COMBINATION_REWARDS", "const MASTER_MINIPET_COMBINATION_REWARDS =", "mini_pet_combination", "mini_pet_master_combine_recipe/reward_policy"),
  buildNamedCatalog("main.js", mainSource, "petTypes1", "const petTypes1 =", "pet_definition", "pet_definitions/object_source_bindings"),
  buildNamedCatalog("main.js", mainSource, "petTypes2", "const petTypes2 =", "pet_definition", "pet_definitions/object_source_bindings"),
  buildNamedCatalog("main.js", mainSource, "petTypes3", "const petTypes3 =", "pet_definition", "pet_definitions/object_source_bindings"),
  buildNamedCatalog("main.js", mainSource, "PENDANT_GRADE_TABLE", "var PENDANT_GRADE_TABLE =", "pendant_definition", "pendant_definition/policy"),
  buildNamedCatalog("main.js", mainSource, "PENDANT_UPGRADE_TABLE", "var PENDANT_UPGRADE_TABLE =", "pendant_upgrade_policy", "pendant_upgrade_policy_versions/levels"),
  buildNamedCatalog("Info.js", infoSource, "GLOBAL_CONFIG", "const GLOBAL_CONFIG =", "read_model_configuration", "same canonical domain configuration providers as main.js"),
  buildNamedCatalog("Info.js", infoSource, "ticketTierData", "const ticketTierData =", "tier_policy_read_model", "same canonical tier policy provider as main.js"),
  buildNamedCatalog("Info.js", infoSource, "TIER_PET_SKILL_EXP", "const TIER_PET_SKILL_EXP =", "pet_skill_tier_projection", "skill_definitions/pet_skills projection"),
];

const prodPetSkills = evaluateAssignedLiteral(mainSource, "const PET_SKILL_LIST =");
const baselinePetSkills = evaluateAssignedLiteral(baselineMain, "const PET_SKILL_LIST =");
const baselineNames = new Set(baselinePetSkills.map((entry) => entry.name));
const postBaselinePetSkills = prodPetSkills.filter((entry) => !baselineNames.has(entry.name)).map((entry) => entry.name);
const mainTier = evaluateAssignedLiteral(mainSource, "const ticketTierData =");
const infoTier = evaluateAssignedLiteral(infoSource, "const ticketTierData =");
const mainGlobal = evaluateAssignedLiteral(mainSource, "const GLOBAL_CONFIG =");
const infoGlobal = evaluateAssignedLiteral(infoSource, "const GLOBAL_CONFIG =");
const mainGlobalLeaves = leafMap(mainGlobal);
const infoGlobalLeaves = leafMap(infoGlobal);
const tierDrift = [];
for (const tier of new Set([...Object.keys(mainTier), ...Object.keys(infoTier)])) {
  for (const field of new Set([...Object.keys(mainTier[tier] || {}), ...Object.keys(infoTier[tier] || {})])) {
    if (JSON.stringify(mainTier[tier]?.[field]) !== JSON.stringify(infoTier[tier]?.[field])) {
      tierDrift.push({ tier, field, main: mainTier[tier]?.[field] ?? null, info: infoTier[tier]?.[field] ?? null });
    }
  }
}

// 유일한 suffix leaf를 찾아 path와 값을 반환한다.
function findGlobalLeaf(map, field) {
  const matches = [...map.entries()].filter(([path]) => path.endsWith(`.${field}`));
  if (matches.length !== 1) throw new Error(`GLOBAL_CONFIG leaf must be unique: ${field} (${matches.length})`);
  return { path: matches[0][0], value: matches[0][1] };
}

const globalDrift = ["battleBagMax", "cleanupTriggerCount", "cleanupKeepCount", "transferFeeMax"].map((field) => {
  const main = findGlobalLeaf(mainGlobalLeaves, field);
  const info = findGlobalLeaf(infoGlobalLeaves, field);
  if (main.path !== info.path) throw new Error(`GLOBAL_CONFIG projection path mismatch: ${field}`);
  return { field, path: main.path, main: main.value, info: info.value, canonical: "main.js runtime value", projection: "Info.js read model" };
});
const infoOnlyCharmSkills = { path: "$.petSkill.charmSkills", value: infoGlobal.petSkill?.charmSkills ?? null };
if (!infoOnlyCharmSkills.value || typeof infoOnlyCharmSkills.value !== "object") throw new Error("Info-only charmSkills missing");
if (mainGlobal.petSkill?.charmSkills) throw new Error("charmSkills is no longer Info-only");

const identityContracts = [
  { domain: "object_registry", stableKey: "object_type + object_code + version", legacyMapping: "object_source_bindings(source_kind, source_key, source_hash)", definitionTable: "object_registry/object_aliases/object_source_bindings", ownershipTruth: null, foreignKeys: ["aliases.object_id -> object_registry.id", "bindings.object_id -> object_registry.id"], provider: "ItemProvider/reward target registry" },
  { domain: "item", stableKey: "item_code", legacyMapping: "source file + category + legacy name/key", definitionTable: "item_definitions", ownershipTruth: "inventory_stacks/inventory_instances + inventory_ledger", foreignKeys: ["inventory_*.item_definition_id -> item_definitions.id"], provider: "ItemProvider" },
  { domain: "currency", stableKey: "currency_code", legacyMapping: "legacy field/path + currency kind", definitionTable: "currency_definitions", ownershipTruth: "currency_accounts + currency_ledger", foreignKeys: ["currency_accounts.currency_definition_id -> currency_definitions.id"], provider: "currency adjustment provider" },
  { domain: "pet_skill", stableKey: "skill_code + policy_version", legacyMapping: "PET_SKILL_LIST source index/name/effect hash", definitionTable: "skill_definitions", ownershipTruth: "pet_skill_inventory + pet_skills projection", foreignKeys: ["pet_skill_inventory.skill_definition_id -> skill_definitions.id"], provider: "pet-skill catalog/provider" },
  { domain: "pet", stableKey: "pet_code + appearance_code", legacyMapping: "petTypes source group/index/emoji/stat hash", definitionTable: "pet_definitions/object_source_bindings", ownershipTruth: "player_pets", foreignKeys: ["player_pets.pet_definition_id -> pet_definitions.id"], provider: "pet definition provider" },
  { domain: "mini_pet", stableKey: "mini_pet_code", legacyMapping: "miniPetData source row + immutable stat/display hash", definitionTable: "existing mini-pet definition tables", ownershipTruth: "owned_mini_pets", foreignKeys: ["owned_mini_pets.definition_id -> mini-pet definition id"], provider: "mini-pet provider" },
  { domain: "furniture", stableKey: "furniture_code", legacyMapping: "petSweetHomeInfo source row; repeated draw rows become pool weight", definitionTable: "existing furniture definitions/draw pools", ownershipTruth: "furniture_inventory_instances + ledger", foreignKeys: ["furniture_inventory_instances.definition_id -> furniture definition id"], provider: "furniture provider" },
  { domain: "title_badge_pendant", stableKey: "typed code + scope/version", legacyMapping: "source scope + legacy key + invariant hash", definitionTable: "title_definitions/home_badge_definitions + typed pendant extension", ownershipTruth: "player_titles/pet_titles, badge ownership, inventory_instances; equipment tables are projections", foreignKeys: ["ownership.definition_id -> typed definition id"], provider: "typed domain providers" },
  { domain: "pass", stableKey: "pass_code + entitlement_policy_version", legacyMapping: "support pass code + source scope", definitionTable: "support_pass_definitions", ownershipTruth: "player_support_passes + change_events", foreignKeys: ["player_support_passes.pass_definition_id -> support_pass_definitions.id"], provider: "support pass provider" },
  { domain: "guild_asset", stableKey: "guild_id + resource_code/item_code", legacyMapping: "guildData resource/warehouse path + legacy item key", definitionTable: "currency/item definitions", ownershipTruth: "guild_resource_accounts/ledger and guild_warehouse_stacks/ledger remain separate", foreignKeys: ["guild asset rows -> guild and canonical definition ids"], provider: "guild resource/warehouse providers" },
  { domain: "package", stableKey: "package_code + published_version", legacyMapping: "packageInfo key/command alias/reward row", definitionTable: "package_catalog/aliases/reward_rules", ownershipTruth: "canonical target domain ownership only; package_item_* is compatibility/retirement", foreignKeys: ["reward target object_id -> object_registry.id"], provider: "PackageDomainItemProvider converges to ItemProvider" },
  { domain: "configuration", stableKey: "domain + config_key + version", legacyMapping: "source symbol/path/line + literal hash", definitionTable: "typed domain policy tables or configuration_sets/values", ownershipTruth: null, foreignKeys: ["published version -> immutable configuration set/version"], provider: "typed configuration provider" },
];

const carryForwardEvidence = [
  { slice: "SL-INV-READ", gates: "G1~7 true/G8 false", evidence: "0ea01c6,a554f2c,d16d32a,db0cec7,a23ba5f" },
  { slice: "SL-INV-MUTATE", gates: "G1~7 true/G8 false", evidence: "7c389be,c69c8f8,migration33,fixture/restart/runtime158" },
  { slice: "SL-PACKAGE-REFERENCE-QUERIES", gates: "G1~7 true/G8 false", evidence: "92be6f3,aeff897,migration095/096,package58/source59" },
  { slice: "SL-PACKAGE-USE", gates: "G1~7 true/G8 false", evidence: "db958c62,b07181f,consumer63/63,replay/rollback/concurrency/Shadow" },
  { slice: "SL-PACKAGE-CATALOG-ADMIN-MUTATE", gates: "G1~7 true/G8 false", evidence: "d1b84c50,migration47,Maria5/5" },
  { slice: "SL-PACKAGE-CATALOG-ADD-WIZARD", gates: "G1~7 true/G8 false", evidence: "7a2c360,migration48" },
  { slice: "SL-MINIPET-INTEGRATION-BATCH-01", gates: "G1~7 true/G8 false", evidence: "eccd437,tests200,restart replay" },
  { slice: "SL-HOME-FURNITURE-BAG-LIFECYCLE", gates: "G1~7 true/G8 false", evidence: "f310e4f,migration197,furniture_inventory_instances" },
  { slice: "SL-HOME-FURNITURE-DRAW-01", gates: "G1~7 true/G8 false", evidence: "ed8ada1d,migration337,catalog1551/1551,grades6,weight100000" },
  { slice: "SL-PENDANT-PROBABILITY-READ", gates: "G1~7 true/G8 false", evidence: "309ae02,definitions13/rate100,migration142/restart" },
  { slice: "SL-PET-SKILL-READ", gates: "G1~7 true/G8 false", evidence: "af3aa11,ff84f63,migrations184~185" },
  { slice: "SL-HOME-BADGE-INVENTORY-QUERIES", gates: "G1~7 true/G8 false", evidence: "cfc432de,204/204,migration374" },
  { slice: "SL-HOME-BADGE-GACHA-OPEN-01-03", gates: "G1~7 true/G8 false", evidence: "4732b998,migration375" },
  { slice: "SL-HOME-BADGE-CUBE", gates: "G1~7 true/G8 false", evidence: "ffa782be,migration376" },
  { slice: "SL-CONTRIBUTION-PASS-REGISTRY", gates: "G1~7 true/G8 false", evidence: "f26b2c7,support_pass tables" },
  { slice: "SL-DIAMOND-PASS-REGISTRY", gates: "G1~7 true/G8 false", evidence: "9de8152,support_pass tables" },
  { slice: "SL-PLAYER-TITLE-READ", gates: "G1~7 true/G8 false", evidence: "migration234,title_definitions/player_titles" },
  { slice: "SL-PET-TITLE-SELECT", gates: "G1~7 true/G8 false", evidence: "46ba83c,migrations180/172" },
  { slice: "SL-SUPPORT-PREMIUM-NOTICE-SEND", gates: "G1~7 true/G8 false", evidence: "ab8e9c94,WBS599/CMD1331/DB1310:1313/VAL10113:10124" },
];

const fixtureContract = {
  sourceSnapshot: ["backup id", "source ref/version", "relative path", "sha256", "byte count", "parse/encoding status", "record/leaf count"],
  staging: { isolation: "fresh non-operational MariaDB schema or transaction-scoped temporary staging", rows: ["batch_id", "source_path", "source_path_hash", "source_key_hash", "domain", "stable_key", "payload_hash", "mapping_version", "disposition"], sensitiveData: "never copy values into evidence; fixtures are synthetic and identifiers are masked/hashed" },
  canonicalResolution: ["stable key resolves exactly one definition", "all CROSSWALK rows resolve an existing definition FK", "ownership rows never create a second definition truth", "package rewards resolve through object registry and canonical provider"],
  parity: ["source file count/hash", "leaf assigned=total and gap=0", "definition/stable-key count", "reward/pool weight total", "ownership crosswalk count", "ledger/account balance invariant"],
  dryRun: "resolve and diff only; canonical writes and side effects remain zero",
  transaction: "one source-domain batch per transaction with deterministic batch_id",
  rollback: "rollback transaction or delete only rows tagged by uncommitted batch_id; prior published version and ownership remain unchanged",
  replay: "same source hash + catalog version + mapping version yields identical diff and no duplicate definition/ledger row",
  idempotency: "unique(batch_id, source_path_hash, source_key_hash, mapping_version) and provider operation key",
  restart: "reconnect and replay after process/database restart must preserve hashes, counts, selected published version, and zero duplicate effects",
  shadow: "compare legacy read projection with canonical read projection; no command dispatch or operational mutation",
};

const mainLiterals = aggregateLiterals(mainSource, "main.js");
const infoLiterals = aggregateLiterals(infoSource, "Info.js");
const jsonPaths = listDataJsonPaths(prodCommit);
const jsonSnapshots = jsonPaths.map((path) => summarizeJsonSource(prodCommit, path));
const literalOccurrences = [...mainLiterals, ...infoLiterals].flatMap((group) => group.occurrences);
const literalGovernanceMissing = literalOccurrences.filter((row) => {
  return !row.disposition || !row.reason || !row.domain || !row.consumer || (row.disposition !== "EXCLUDED" && !row.canonicalTarget);
}).length;
const literalDispositionCounts = literalOccurrences.reduce((counts, row) => {
  counts[row.disposition] = (counts[row.disposition] || 0) + 1;
  return counts;
}, {});
const jsonClassificationCounts = jsonSnapshots.reduce((counts, snapshot) => {
  const status = snapshot.classification.status;
  counts[status] = (counts[status] || 0) + 1;
  return counts;
}, {});
const jsonLeafAssignmentCount = jsonSnapshots.reduce((sum, snapshot) => sum + snapshot.leafCoverage.assignedLeafCount, 0);
const jsonLeafGapCount = jsonSnapshots.reduce((sum, snapshot) => sum + snapshot.leafCoverage.gapCount, 0);
const freezeDecisionText = readFileSync(FREEZE_DECISION, "utf8");

const manifest = {
  schemaVersion: 3,
  sliceId: "SL-COMMON-ASSET-COVERAGE-CORRECTION-02",
  executionId: "개발자-CATALOG-BATCH-ASSET-COVERAGE-CORRECTION-02-202608311441",
  leaseRow: 2438,
  phase: "FREEZE_CLASSIFICATION",
  catalogVersion: `ASSET-FREEZE-v${prodVersion}-${prodCommit.slice(0, 8)}-02`,
  generatedAt: prodCommitTimestamp,
  baselines: {
    originalCatalogVersion: "ASSET-FREEZE-v2.400-a286279b-01",
    classificationBaseline: CLASSIFICATION_BASELINE,
    productionRef: PROD_REF,
    productionCommit: prodCommit,
    productionVersion: prodVersion,
  },
  coverageContract: {
    javascriptSources: ["main.js", "Info.js"],
    jsonGlob: "data/**/*.json",
    includedKinds: ["definition", "ownership-model mapping", "policy", "rate", "limit", "cost", "schedule", "message", "effect", "reward", "shop", "recipe", "system setting"],
    literalDefault: "INCLUDED_UNTYPED_LEGACY_CONSTANT",
    runtimeInstances: "separate ownership/state model; their static defaults and rules remain included",
    crudRequired: true,
    hardDeleteWhenReferenced: false,
    requiredLifecycle: ["draft", "publish", "retire/disable", "version", "audit", "rollback"],
    referencedDefinitionDeletion: "FORBIDDEN",
    classificationStatuses: ["INCLUDED", "CROSSWALK", "EXCLUDED"],
    implicitOrUnresolvedStatusAllowed: false,
  },
  sourceSnapshots: {
    main: {
      path: "main.js",
      ref: PROD_REF,
      sha256: sha256(mainSource),
      lineCount: mainSource.split(/\r?\n/).length,
      literals: mainLiterals,
    },
    info: {
      path: "Info.js",
      ref: PROD_REF,
      sha256: sha256(infoSource),
      lineCount: infoSource.split(/\r?\n/).length,
      literals: infoLiterals,
    },
    json: jsonSnapshots,
  },
  classificationClosure: {
    literalOccurrenceCount: literalOccurrences.length,
    literalGovernanceMissing,
    literalDispositionCounts,
    jsonFileCount: jsonSnapshots.length,
    jsonExplicitClassificationCount: jsonSnapshots.filter((snapshot) => Boolean(snapshot.classification.status)).length,
    jsonClassificationMissing: jsonSnapshots.filter((snapshot) => !snapshot.classification.status).length,
    jsonClassificationCounts,
    jsonLeafAssignmentCount,
    jsonLeafGapCount,
    includeExcludeCrosswalkGap: literalGovernanceMissing + jsonLeafGapCount,
    gapZero: literalGovernanceMissing === 0 && jsonLeafGapCount === 0 && jsonSnapshots.every((snapshot) => Boolean(snapshot.classification.status)),
    wbs626Dependency: "CLOSED_BY_WBS682_CLASSIFICATION; prior COMPLETE3/PARTIAL4/GAP2/CONFLICT3 findings are resolved into explicit disposition, canonical truth, and implementation backlog without changing prior Gates",
    gateCarryForwardPolicy: "preserve verified G1~7 evidence; this classification creates no new Gate evidence and leaves Gate8 false",
  },
  governanceDecision: {
    path: "freeze-decision.md",
    sha256: sha256(freezeDecisionText),
  },
  namedCatalogs,
  exactFindings: {
    petSkill: {
      baselineActive: baselinePetSkills.length,
      productionActive: prodPetSkills.length,
      postBaselineActive: postBaselinePetSkills,
      commentedBacklog: ["길드의 심장", "기사도", "야호", "성실한 일꾼"],
      activeSeedCorrectionCount: postBaselinePetSkills.length,
    },
    globalConfig: {
      sectionCount: Object.keys(evaluateAssignedLiteral(mainSource, "const GLOBAL_CONFIG =")).length,
      leafCount: flattenLeaves(evaluateAssignedLiteral(mainSource, "const GLOBAL_CONFIG =")).length,
    },
    miniPetCombination: {
      normalRows: Object.values(evaluateAssignedLiteral(mainSource, "const MINI_PET_COMBINATION_REWARDS =")).reduce((sum, rows) => sum + rows.length, 0),
      eliteRows: evaluateAssignedLiteral(mainSource, "const ELITE_MINIPET_COMBINATION_REWARDS =").length,
      masterRows: evaluateAssignedLiteral(mainSource, "const MASTER_MINIPET_COMBINATION_REWARDS =").length,
    },
    petAppearance: {
      rows: ["petTypes1", "petTypes2", "petTypes3"].reduce((sum, symbol) => {
        return sum + evaluateAssignedLiteral(mainSource, `const ${symbol} =`).reduce((groupSum, group) => groupSum + group.emojis.length, 0);
      }, 0),
    },
    crossSourceDrift: {
      ticketTierLeafDifferences: tierDrift,
      ticketTierLeafDifferenceCount: tierDrift.length,
      canonicalTruth: {
        ticketTierData: "main.js values are canonical because response/runtime mutation, fee, progression, and rank consumers execute there; all 49 Info.js differences become read-model projection mappings",
        globalConfigOverlap: "main.js runtime values are canonical for shared keys; Info.js must consume the published provider projection",
        infoOnlyCharmSkills: "derive from canonical skill_definitions/pet_skills effect fields plus condition policy; Info.js value is a temporary read-model hint, not a second truth",
      },
      globalConfigResolutions: globalDrift,
      infoOnlyCharmSkills,
    },
  },
  identityContracts,
  fixtureContract,
  carryForwardEvidence,
  canonicalDependencies: [
    { order: 0, slice: "SL-COMMON-ASSET-CATALOG-PROVIDER-01", role: "object_registry/alias/source binding and ItemProvider; carry forward" },
    { order: 1, slice: "SL-COMMON-CONFIGURATION-CATALOG-CRUD-01", role: "typed scalar config version/publish/audit/rollback; required new classification" },
    { order: 2, slice: "SL-ASSET-PET-SKILL-CATALOG-CRUD-01", role: "93 active definitions, compatibility, effects, draw and post-baseline 3" },
    { order: 3, slice: "SL-ASSET-PET-DEFINITION-APPEARANCE-CRUD-01", role: "72 appearance definitions; reuse player_pets ownership" },
    { order: 4, slice: "SL-ASSET-MINIPET-POLICY-CATALOG-CRUD-01", role: "grade14 and combination 151+5+3; reuse mini-pet definitions/ownership" },
    { order: 5, slice: "SL-ASSET-DOMAIN-RULE-CATALOG-CRUD-WAVE", role: "GLOBAL_CONFIG 34 sections and inline rate/limit/cost/schedule/message/effect consumers by domain" },
    { order: 6, slice: "SL-ASSET-GUILD-RESOURCE-WAREHOUSE-CONVERGENCE-01", role: "close frozen missing/conflict/crosswalk gaps" },
    { order: 7, slice: "CATALOG-BATCH-ASSET-CONSUMER-CLOSURE-AUDIT-02", role: "prove no source literal/catalog consumer remains disconnected" },
  ],
  dataMigrationReady: false,
  dataMigrationReadinessScope: {
    classificationFreezeReady: true,
    backupIntegrityReviewReady: true,
    stagingContractReady: true,
    canonicalWriteReady: false,
    goAuthorized: false,
  },
  dataMigrationBlockers: [
    "SL-COMMON-CONFIGURATION-CATALOG-CRUD-01 and domain rule consumer waves are classified but not implemented/validated through Gate 1~7",
    "the three post-freeze active PET skills require a separate seed/provider implementation Lease and MariaDB parity evidence",
    "the JSON staging loader and frozen fixture contract lack isolated MariaDB dry-run/rollback/replay/idempotency evidence",
    "consumer closure implementation must prove canonical read projections for ticketTierData/GLOBAL_CONFIG and all CROSSWALK foreign keys",
  ],
  invariants: {
    schemaChanged: false,
    providerChanged: false,
    migrationAdded: false,
    runtimeChanged: false,
    gateChanged: false,
    featureProdChanged: false,
    operationalDatabaseChanged: false,
  },
};

// 동결 manifest의 완전성 불변식을 검증한다.
function validateManifest(value) {
  if (value.classificationClosure.literalGovernanceMissing !== 0) throw new Error(`literal classification gaps: ${value.classificationClosure.literalGovernanceMissing}`);
  if (value.classificationClosure.jsonLeafGapCount !== 0) throw new Error(`JSON leaf classification gaps: ${value.classificationClosure.jsonLeafGapCount}`);
  if (!value.classificationClosure.gapZero || value.classificationClosure.includeExcludeCrosswalkGap !== 0) throw new Error("classification closure is not gap0");
  if (value.sourceSnapshots.json.length !== Object.keys(JSON_PATH_CLASSIFICATION).length) throw new Error("JSON source/classification count mismatch");
  if (value.exactFindings.petSkill.baselineActive !== 90 || value.exactFindings.petSkill.productionActive !== 93) throw new Error("PET skill active count mismatch");
  if (value.exactFindings.petSkill.postBaselineActive.join("|") !== "전설의 몽둥이|무쌍귀신|무쌍신화") throw new Error("PET skill post-baseline set mismatch");
  if (value.exactFindings.petSkill.commentedBacklog.length !== 4) throw new Error("PET skill commented backlog mismatch");
  if (value.exactFindings.crossSourceDrift.ticketTierLeafDifferenceCount !== 49) throw new Error("ticketTierData drift mismatch");
  const expectedGlobal = [[9, 13], [9, 13], [8, 12], [25, 16]];
  value.exactFindings.crossSourceDrift.globalConfigResolutions.forEach((row, index) => {
    if (row.main !== expectedGlobal[index][0] || row.info !== expectedGlobal[index][1]) throw new Error(`GLOBAL_CONFIG drift mismatch: ${row.path}`);
  });
  const charmSkills = value.exactFindings.crossSourceDrift.infoOnlyCharmSkills.value;
  if (!charmSkills || typeof charmSkills !== "object" || Array.isArray(charmSkills) || Object.keys(charmSkills).length === 0) throw new Error("Info-only charmSkills missing");
  if (value.dataMigrationReady || value.dataMigrationReadinessScope.goAuthorized) throw new Error("classification task must not authorize migration GO");
}

validateManifest(manifest);
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: OUTPUT,
  catalogVersion: manifest.catalogVersion,
  mainUniqueLiterals: manifest.sourceSnapshots.main.literals.length,
  infoUniqueLiterals: manifest.sourceSnapshots.info.literals.length,
  jsonFiles: manifest.sourceSnapshots.json.length,
  namedCatalogs: manifest.namedCatalogs.length,
  literalGapCount: manifest.classificationClosure.literalGovernanceMissing,
  jsonLeafGapCount: manifest.classificationClosure.jsonLeafGapCount,
  dataMigrationReady: manifest.dataMigrationReady,
}, null, 2));
