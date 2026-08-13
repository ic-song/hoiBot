import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const registryPath = path.join(repositoryRoot, "COMMAND_REGISTRY.md");
const outputPath = path.resolve(import.meta.dirname, "../inventory/commands.json");
const sourceNames = ["main.js", "Info.js"];
const sources = Object.fromEntries(await Promise.all(sourceNames.map(async (name) => [name, await readFile(path.join(repositoryRoot, name), "utf8")])));
const registry = await readFile(registryPath, "utf8");

const domains = [
  { id: "admin-ops", pattern: /관리|운영|서버|복구|백업|동기화|검사|초기화|공지|차단|해제|설정/, tables: ["admin_operators", "command_audit", "configuration_sets"] },
  { id: "attendance", pattern: /출석|미출석|출첵/, tables: ["attendance_programs", "player_attendance"] },
  { id: "market-package", pattern: /시장|거래|판매|구매|패키지|오픈|상점/, tables: ["market_listings", "market_settlements", "package_definitions", "package_purchases"] },
  { id: "guild-castle", pattern: /길드|캐슬|영주|공성|창고/, tables: ["guilds", "guild_members", "castle_battle_seasons", "castle_battle_participants"] },
  { id: "home", pattern: /홈|가구|집|방문|댓글|좋아요/, tables: ["player_homes", "owned_furniture", "furniture_placements", "home_activity_events"] },
  { id: "mini-pet", pattern: /미니펫|미펫/, tables: ["mini_pet_definitions", "owned_mini_pets", "mini_pet_collection_entries"] },
  { id: "pet", pattern: /펫|스킬|매력|탐험|펜던트|정령|반지/, tables: ["player_pets", "pet_skills", "pet_equipment", "pet_expedition_runs"] },
  { id: "event-ranking", pattern: /순위|랭킹|대전|레이드|시련|탑|보스|펀치|이벤트/, tables: ["event_seasons", "player_event_progress", "leaderboards", "leaderboard_entries", "player_tower_progress"] },
  { id: "inventory", pattern: /가방|아이템|소지품|티켓|조합|장착|큐브/, tables: ["item_definitions", "inventory_stacks", "inventory_instances", "inventory_ledger"] },
  { id: "economy-profile", pattern: /포인트|다이아|재화|레벨|정보|타이틀|가입|회원/, tables: ["players", "player_profiles", "currency_accounts", "currency_ledger", "player_titles"] },
  { id: "community", pattern: /게시판|글|당근|요청/, tables: ["community_boards", "community_posts"] }
];

const mutationPattern = /saveJsonFile|FileStream\.write|removeItem|addItem|point\s*[+\-*/]?=|delete\s+|\.push\(|\.splice\(|구매|판매|장착|해제|삭제|초기화|가입|오픈|조합/;
const pathPattern = /\b[A-Za-z_$][\w$]*(?:Path|File)\b/g;

function extractCells(line) {
  const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
  return cells.length >= 5 ? cells : undefined;
}

function commandVariants(label) {
  const variants = [...label.matchAll(/`(\/[^`]+)`/g)].map((match) => match[1].trim());
  if (variants.length > 0) return variants;
  const plain = label.match(/\/[가-힣A-Za-z0-9#]+(?:\s+\[[^\]]+\])?/g);
  return plain?.map((value) => value.trim()) ?? [];
}

function commandBase(variant) {
  return variant.split(/[\s,]/, 1)[0].replace(/[)]+$/, "");
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function evidenceFor(sourceName, bases) {
  const source = sources[sourceName];
  const occurrences = [];
  for (const base of bases) {
    let offset = 0;
    while (offset < source.length) {
      const index = source.indexOf(base, offset);
      if (index < 0) break;
      const context = source.slice(Math.max(0, index - 1200), Math.min(source.length, index + 1800));
      occurrences.push({
        command: base,
        line: lineNumberAt(source, index),
        mutationEvidence: mutationPattern.test(context),
        loadEvidence: /loadJsonFile|JSON\.parse|FileStream\.read/.test(context),
        saveEvidence: /saveJsonFile|FileStream\.write/.test(context),
        dataPaths: [...new Set(context.match(pathPattern) ?? [])].sort()
      });
      offset = index + base.length;
      if (occurrences.length >= 25) break;
    }
  }
  return occurrences;
}

const commands = [];
for (const line of registry.split(/\r?\n/)) {
  if (!line.startsWith("| `/")) continue;
  const cells = extractCells(line);
  if (cells === undefined) continue;
  const [label, sourceCell, unusedCell, deletedCell, note] = cells;
  const sourceName = sourceNames.find((name) => sourceCell.includes(name));
  if (sourceName === undefined) continue;
  const variants = commandVariants(label);
  const bases = [...new Set(variants.map(commandBase))];
  const occurrences = evidenceFor(sourceName, bases);
  const deleted = deletedCell === "[x]";
  const unused = unusedCell === "[x]";
  const status = deleted
    ? occurrences.length === 0 ? "registry-deleted" : "deleted-literal-found"
    : occurrences.length > 0 ? "source-literal-found" : "unverified";
  const domain = domains.find((candidate) => candidate.pattern.test(`${label} ${note}`)) ?? { id: "uncategorized", tables: [] };
  const mutation = occurrences.some((occurrence) => occurrence.mutationEvidence);
  commands.push({
    label,
    variants,
    bases,
    sourceFile: sourceName,
    unused,
    deleted,
    note: note === "-" ? null : note,
    status,
    domain: domain.id,
    sliceType: mutation ? "mutation" : "read",
    mappedTables: domain.tables,
    sourceOccurrences: occurrences
  });
}

const registeredBases = new Set(commands.flatMap((command) => command.bases));
const unregisteredCandidates = [];
for (const sourceName of sourceNames) {
  const lines = sources[sourceName].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/\bmsg\b/.test(line) || !/["']\//.test(line)) continue;
    for (const match of line.matchAll(/["'](\/[가-힣A-Za-z0-9#]+)[^"']*["']/g)) {
      const base = match[1];
      if (!registeredBases.has(base)) unregisteredCandidates.push({ command: base, sourceFile: sourceName, line: index + 1 });
    }
  }
}

const uniqueUnregistered = [...new Map(unregisteredCandidates.map((candidate) => [`${candidate.sourceFile}:${candidate.command}`, candidate])).values()]
  .sort((left, right) => left.sourceFile.localeCompare(right.sourceFile) || left.command.localeCompare(right.command, "ko"));
const statusCounts = Object.fromEntries([...new Set(commands.map((command) => command.status))].sort().map((status) => [status, commands.filter((command) => command.status === status).length]));
const domainCounts = Object.fromEntries([...new Set(commands.map((command) => command.domain))].sort().map((domain) => [domain, commands.filter((command) => command.domain === domain).length]));

const artifact = {
  schemaVersion: 1,
  sources: {
    registry: "COMMAND_REGISTRY.md",
    code: sourceNames,
    sourceOfTruth: "current code",
    method: "registry rows re-verified by exact command-base occurrences and nearby load/save evidence",
    limitation: "source-literal-found는 실행 guard 확정이 아니며 슬라이스 착수 시 branch·helper·출력·save flow를 다시 수동 검증한다."
  },
  summary: {
    registryCommandGroups: commands.length,
    activeCommandGroups: commands.filter((command) => !command.deleted).length,
    unusedCommandGroups: commands.filter((command) => command.unused).length,
    deletedLiteralReviewRequired: commands.filter((command) => command.status === "deleted-literal-found").length,
    unverifiedActive: commands.filter((command) => command.status === "unverified" && !command.deleted).length,
    mutationSlices: commands.filter((command) => command.sliceType === "mutation" && !command.deleted).length,
    readSlices: commands.filter((command) => command.sliceType === "read" && !command.deleted).length,
    unregisteredSourceCandidates: uniqueUnregistered.length,
    statusCounts,
    domainCounts
  },
  commands,
  unregisteredCandidates: uniqueUnregistered
};

await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(artifact.summary)}\n`);
