import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

export type FilterDecision = "KEEP" | "QUARANTINE" | "EXCLUDE" | "REVIEW";

export interface FilterPolicy {
  version: string;
  explicitExcludePathSha256: string[];
}

export interface FilterDecisionEntry {
  pathSha256: string;
  contentSha256: string;
  size: number;
  decision: FilterDecision;
  reasonCodes: string[];
  sensitiveKeyCategories: string[];
}

export interface FilterDecisionManifest {
  format: "hoibot-filter-decision-v1";
  policyVersion: string;
  generatedAt: string;
  sourceLabel: string;
  sourceFileCount: number;
  counts: Record<FilterDecision, number>;
  decisionSha256: string;
  entries: FilterDecisionEntry[];
}

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const SENSITIVE_KEY_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["AUTH_SECRET", /(password|passwd|secret|token|비밀번호|암호|토큰)/i],
  ["CONTACT", /(phone|mobile|telephone|email|전화|휴대폰|이메일)/i],
  ["LOCATION", /(address|주소|거주지)/i],
  ["GOVERNMENT_ID", /(resident|ssn|주민번호|주민등록)/i],
  ["FINANCIAL", /(accountnumber|bankaccount|계좌번호|은행계좌)/i],
  ["DEVICE_ID", /(deviceid|advertisingid|기기id|장치id)/i]
];

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeKey(key: string): string {
  return key.replace(/[\s_\-./]/g, "").toLowerCase();
}

function collectSensitiveKeyCategories(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSensitiveKeyCategories(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    for (const [category, pattern] of SENSITIVE_KEY_PATTERNS) {
      if (pattern.test(normalizedKey)) output.add(category);
    }
    collectSensitiveKeyCategories(child, output);
  }
}

async function collectFiles(root: string, current: string, output: string[]): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const absolutePath = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      output.push(absolutePath);
      continue;
    }
    if (entry.isDirectory()) {
      await collectFiles(root, absolutePath, output);
      continue;
    }
    if (entry.isFile()) output.push(absolutePath);
  }
}

function normalizedRelativePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join("/");
}

// 자동 제외가 없는 보수적인 기본 데이터 필터 정책을 생성한다.
export function createDefaultFilterPolicy(
  explicitExcludePathSha256: string[] = []
): FilterPolicy {
  return {
    version: "DATA-FILTER-v1",
    explicitExcludePathSha256: [...new Set(explicitExcludePathSha256)].sort()
  };
}

// 원본 값과 파일명을 노출하지 않는 필터 결정 manifest를 생성한다.
export async function buildFilterDecisionManifest(
  sourceRoot: string,
  policy: FilterPolicy,
  sourceLabel = "operational-data"
): Promise<FilterDecisionManifest> {
  const root = resolve(sourceRoot);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error("SOURCE_NOT_DIRECTORY");

  const files: string[] = [];
  await collectFiles(root, root, files);
  if (files.length === 0) throw new Error("EMPTY_SNAPSHOT");

  const explicitExcludes = new Set(policy.explicitExcludePathSha256);
  const entries: FilterDecisionEntry[] = [];

  for (const absolutePath of files) {
    const relativePath = normalizedRelativePath(root, absolutePath);
    const pathSha256 = sha256(relativePath);
    let bytes: Buffer;
    try {
      bytes = await readFile(absolutePath);
    } catch {
      entries.push({
        pathSha256,
        contentSha256: sha256("READ_FAILED"),
        size: 0,
        decision: "QUARANTINE",
        reasonCodes: ["READ_FAILED"],
        sensitiveKeyCategories: []
      });
      continue;
    }

    const extension = extname(relativePath).toLowerCase();
    const sensitiveKeyCategories = new Set<string>();
    let decision: FilterDecision = "KEEP";
    const reasonCodes: string[] = ["SUPPORTED_DATA_FILE"];

    if (explicitExcludes.has(pathSha256)) {
      decision = "EXCLUDE";
      reasonCodes.splice(0, reasonCodes.length, "EXPLICIT_PATH_HASH_EXCLUSION");
    } else if (extension === ".js") {
      decision = "REVIEW";
      reasonCodes.splice(0, reasonCodes.length, "EXECUTABLE_CONTENT");
    } else if (extension !== ".json" && extension !== ".txt") {
      decision = "QUARANTINE";
      reasonCodes.splice(0, reasonCodes.length, "UNSUPPORTED_EXTENSION");
    } else {
      let text: string;
      try {
        text = UTF8_DECODER.decode(bytes);
      } catch {
        decision = "QUARANTINE";
        reasonCodes.splice(0, reasonCodes.length, "INVALID_UTF8");
        text = "";
      }

      if (decision !== "QUARANTINE" && extension === ".json") {
        try {
          const parsed: unknown = JSON.parse(text);
          collectSensitiveKeyCategories(parsed, sensitiveKeyCategories);
          if (sensitiveKeyCategories.size > 0) {
            decision = "REVIEW";
            reasonCodes.splice(0, reasonCodes.length, "SENSITIVE_KEY_CATEGORY");
          }
        } catch {
          decision = "QUARANTINE";
          reasonCodes.splice(0, reasonCodes.length, "INVALID_JSON");
        }
      }
    }

    entries.push({
      pathSha256,
      contentSha256: sha256(bytes),
      size: bytes.byteLength,
      decision,
      reasonCodes: [...new Set(reasonCodes)].sort(),
      sensitiveKeyCategories: [...sensitiveKeyCategories].sort()
    });
  }

  entries.sort((left, right) => left.pathSha256.localeCompare(right.pathSha256, "en"));
  const counts: Record<FilterDecision, number> = {
    KEEP: 0,
    QUARANTINE: 0,
    EXCLUDE: 0,
    REVIEW: 0
  };
  for (const entry of entries) counts[entry.decision] += 1;
  const canonical = entries.map(
    (entry) =>
      `${entry.pathSha256}|${entry.contentSha256}|${entry.size}|${entry.decision}|${entry.reasonCodes.join(",")}|${entry.sensitiveKeyCategories.join(",")}`
  );

  return {
    format: "hoibot-filter-decision-v1",
    policyVersion: policy.version,
    generatedAt: new Date().toISOString(),
    sourceLabel,
    sourceFileCount: entries.length,
    counts,
    decisionSha256: sha256(canonical.join("\n")),
    entries
  };
}

// 필터 결정 manifest를 임시 파일을 거쳐 원자적으로 저장한다.
export async function writeFilterDecisionManifest(
  outputPath: string,
  manifest: FilterDecisionManifest
): Promise<void> {
  const absoluteOutput = resolve(outputPath);
  const temporaryOutput = `${absoluteOutput}.tmp`;
  await mkdir(dirname(absoluteOutput), { recursive: true });
  await writeFile(temporaryOutput, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryOutput, absoluteOutput);
}

