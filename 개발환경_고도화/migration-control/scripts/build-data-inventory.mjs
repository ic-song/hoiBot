import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const dataDirectory = path.join(repositoryRoot, "data");
const outputPath = path.join(repositoryRoot, "개발환경_고도화/migration-control/inventory/data-stores.json");
const sourceFiles = ["main.js", "Info.js"];
const manualClassifications = {
  "castleBattle.json": { classification: "reconciliation-only", reason: "현재 활성 경로는 castleBattle2.json이며 코드 참조가 없음" },
  "errorLog.json": { classification: "reconciliation-only", reason: "게임 상태가 아닌 최근 오류 진단 기록이며 FileStream.write로 덮어씀" },
  "game.txt": { classification: "reference", reason: "loadgametxtFromFile에서 읽는 게임 문구 목록" },
  "member2.json": { classification: "excluded", reason: "Info.js에 경로만 선언되고 실제 사용처가 없음" },
  "miniGameBot.js": { classification: "excluded", reason: "운영 데이터가 아닌 독립 JavaScript 파일이며 main.js와 Info.js 참조가 없음" }
};
const commonDataFiles = [
  "eventTowerBoss.json",
  "hoiBotChangeLog.json",
  "itemInfo.json",
  "miniPetCollectionInfo.json",
  "miniPetData.json",
  "petSweetHomeInfo.json",
  "trialTowerBoss.json"
];

function checksum(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  }));
  return nested.flat();
}

function rootSummary(value) {
  if (Array.isArray(value)) return { kind: "array", entries: value.length };
  if (value !== null && typeof value === "object") {
    const valueKinds = {};
    for (const child of Object.values(value)) {
      const kind = Array.isArray(child) ? "array" : child === null ? "null" : typeof child;
      valueKinds[kind] = (valueKinds[kind] ?? 0) + 1;
    }
    return { kind: "object", entries: Object.keys(value).length, valueKinds };
  }
  return { kind: value === null ? "null" : typeof value };
}

function countMatches(source, expression) {
  return Array.from(source.matchAll(expression)).length;
}

function classify({ extension, loadCount, saveCount, relativePath, repositoryPresent }) {
  if (manualClassifications[relativePath]) return manualClassifications[relativePath].classification;
  if (/^(?:backups\/)|_back\.json$|_before/i.test(relativePath)) return "reconciliation-only";
  if (extension !== ".json") return "unknown";
  if (saveCount > 0) return "authoritative";
  if (loadCount > 0) return "reference";
  return repositoryPresent ? "unknown" : "unknown";
}

const sources = {};
for (const sourceFile of sourceFiles) {
  sources[sourceFile] = await readFile(path.join(repositoryRoot, sourceFile), "utf8");
}

const pathEvidence = new Map();
const declarationPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*["']\/sdcard\/호이랜드(?:_dev)?\/([^"']+)["']/g;
for (const [sourceFile, source] of Object.entries(sources)) {
  for (const match of source.matchAll(declarationPattern)) {
    const variable = match[1];
    const relativePath = match[2].replaceAll("\\", "/");
    const evidence = pathEvidence.get(relativePath) ?? [];
    const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    evidence.push({
      sourceFile,
      variable,
      loadCount: countMatches(source, new RegExp(`\\bloadJsonFile\\s*\\(\\s*${escaped}\\b`, "g")),
      saveCount: source.split(/\r?\n/).filter((line) => /\bsaveJsonFile\s*\(/.test(line) && new RegExp(`\\b${escaped}\\b`).test(line)).length,
      backupSaveCount: source.split(/\r?\n/).filter((line) => /\bsavebackupJsonFile\s*\(/.test(line) && new RegExp(`\\b${escaped}\\b`).test(line)).length,
      directFileIoCount: source.split(/\r?\n/).filter((line) => /FileStream|java\.io\.File|writeVerifiedJsonFile/.test(line) && new RegExp(`\\b${escaped}\\b`).test(line)).length
    });
    pathEvidence.set(relativePath, evidence);
  }
}

const repositoryFiles = (await walk(dataDirectory)).sort();
const records = [];
const parsedJsonChecksums = [];
for (const absolutePath of repositoryFiles) {
  const content = await readFile(absolutePath);
  const relativePath = path.relative(repositoryRoot, absolutePath).replaceAll("\\", "/");
  const operationalRelativePath = relativePath.replace(/^data\//, "");
  const extension = path.extname(absolutePath).toLowerCase();
  const evidence = pathEvidence.get(operationalRelativePath) ?? [];
  const loadCount = evidence.reduce((total, item) => total + item.loadCount, 0);
  const saveCount = evidence.reduce((total, item) => total + item.saveCount, 0);
  let root = { kind: "non-json" };
  let parseStatus = "not-applicable";
  if (extension === ".json") {
    const text = content.toString("utf8");
    const fileChecksum = checksum(text);
    parsedJsonChecksums.push(`${operationalRelativePath}:${fileChecksum}`);
    try {
      root = rootSummary(JSON.parse(text));
      parseStatus = "valid";
    } catch {
      root = { kind: "invalid-json" };
      parseStatus = "invalid";
    }
  }
  records.push({
    path: relativePath,
    operationalPath: `/sdcard/호이랜드/${operationalRelativePath}`,
    repositoryPresent: true,
    extension,
    bytes: content.length,
    sha256: checksum(content),
    parseStatus,
    root,
    classification: classify({ extension, loadCount, saveCount, relativePath: operationalRelativePath, repositoryPresent: true }),
    manualClassificationReason: manualClassifications[operationalRelativePath]?.reason ?? null,
    evidence
  });
}

for (const [operationalRelativePath, evidence] of [...pathEvidence.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  if (records.some((record) => record.operationalPath === `/sdcard/호이랜드/${operationalRelativePath}`)) continue;
  const extension = path.extname(operationalRelativePath).toLowerCase();
  const loadCount = evidence.reduce((total, item) => total + item.loadCount, 0);
  const saveCount = evidence.reduce((total, item) => total + item.saveCount, 0);
  records.push({
    path: null,
    operationalPath: `/sdcard/호이랜드/${operationalRelativePath}`,
    repositoryPresent: false,
    extension,
    bytes: null,
    sha256: null,
    parseStatus: "not-observed",
    root: { kind: "unknown" },
    classification: classify({ extension, loadCount, saveCount, relativePath: operationalRelativePath, repositoryPresent: false }),
    manualClassificationReason: manualClassifications[operationalRelativePath]?.reason ?? null,
    evidence
  });
}

records.sort((left, right) => left.operationalPath.localeCompare(right.operationalPath));
const generatedAt = new Date().toISOString();
const inventory = {
  schemaVersion: 1,
  generatedAt,
  sourceSnapshot: {
    directory: "data",
    readOnly: true,
    repositoryFileCount: repositoryFiles.length,
    jsonFileCount: parsedJsonChecksums.length,
    rootHash: checksum(parsedJsonChecksums.sort().join("\n"))
  },
  collectionRules: {
    codeSources: sourceFiles,
    classifications: {
      authoritative: "현재 코드에서 saveJsonFile 대상임을 기계 확인",
      reference: "현재 코드에서 loadJsonFile만 확인",
      "reconciliation-only": "백업 또는 이전 전 snapshot 이름 규칙에 해당",
      excluded: "운영 데이터 이관 대상이 아님을 코드 사용처로 확인",
      unknown: "현재 기계 조사만으로 역할을 확정할 수 없음"
    },
    privacy: "원본 값, 사용자 키, KakaoTalk 원문은 기록하지 않음"
  },
  pathFlow: {
    productionRoot: "/sdcard/호이랜드/",
    developmentRoot: "/sdcard/호이랜드_dev/",
    resolver: "resolveActiveDataPath",
    commonDataFiles,
    note: "공통 파일은 DEV 전환 시에도 운영 루트에서 읽고, 나머지는 command context에 따라 DEV 루트로 치환됨"
  },
  stores: records,
  limitations: [
    "변수 별칭, helper 내부 간접 IO와 동적 경로는 수동 추적이 필요함",
    "repositoryPresent=false는 Android 운영 경로에 존재할 수 있으나 현재 Git snapshot에는 없음을 뜻함",
    "classification은 1차 기계 판정이며 기능별 조사에서 코드와 실제 운영 snapshot으로 재검증해야 함"
  ]
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, generatedAt, storeCount: records.length, sourceSnapshot: inventory.sourceSnapshot }, null, 2));
