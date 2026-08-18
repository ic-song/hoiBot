import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

interface ProgressEvidence {
  schemaVersion: number;
  checkpoint: string;
  masterPlan: string;
  branchEvidence: {
    required: string;
    observed: string;
    head: string;
    upstream: string;
    upstreamHead: string;
  };
  sourceSnapshotEvidence: {
    path: string;
    fileCount: number;
    rootHash: string;
  };
}

interface GitResult {
  ok: boolean;
  output: string;
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.dirname(scriptDirectory);
const modernizationRoot = path.dirname(runtimeRoot);
const repositoryRoot = path.dirname(modernizationRoot);
const checkpointPath = path.join(modernizationRoot, "migration-control", "CHECKPOINT.md");
const progressPath = path.join(modernizationRoot, "migration-control", "progress.json");
const masterPlanPath = path.join(modernizationRoot, "migration-control", "MASTER_PLAN.md");
const resumeScriptPath = fileURLToPath(import.meta.url);
const errors: string[] = [];
const warnings: string[] = [];

// 경로를 Git과 증거 JSON에서 사용하는 슬래시 형식으로 변환합니다.
function portablePath(value: string): string {
  return value.replaceAll("\\", "/");
}

// 저장소 루트 기준 상대 경로를 반환합니다.
function repositoryRelative(value: string): string {
  return portablePath(path.relative(repositoryRoot, value));
}

// Git 명령을 shell 문자열 조합 없이 실행합니다.
function git(args: string[]): GitResult {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true
  });
  return {
    ok: result.status === 0,
    output: String(result.stdout ?? "").trim()
  };
}

// 체크포인트의 단일 행 메타데이터를 읽습니다.
function checkpointValue(markdown: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^- ${escaped}:\\s*(.+)$`, "m").exec(markdown);
  return match?.[1]?.trim().replace(/^`|`$/g, "");
}

// 체크포인트 섹션 본문을 읽습니다.
function checkpointSection(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.indexOf(`## ${heading}`);
  if (start < 0) return "";
  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.startsWith("## ")) break;
    body.push(line);
  }
  return body.join("\n").trim();
}

// SHA-256 문자열을 계산합니다.
function checksum(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// 현재 data JSON snapshot의 importer 호환 root hash를 계산합니다.
async function inspectSnapshot(sourceDirectory: string): Promise<{ fileCount: number; rootHash: string }> {
  const names = (await readdir(sourceDirectory, { recursive: true }))
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort();
  const rows: string[] = [];
  for (const name of names) {
    const normalized = portablePath(name);
    const content = await readFile(path.join(sourceDirectory, name), "utf8");
    rows.push(`${normalized}:${checksum(content)}`);
  }
  return { fileCount: names.length, rootHash: checksum(rows.join("\n")) };
}

// 로컬 migration 파일과 체크섬을 읽습니다.
async function inspectMigrations(): Promise<Map<string, string>> {
  const directory = path.join(runtimeRoot, "migrations");
  const names = (await readdir(directory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
    .sort();
  const values = new Map<string, string>();
  for (const name of names) values.set(name, checksum(await readFile(path.join(directory, name), "utf8")));
  return values;
}

const checkpoint = await readFile(checkpointPath, "utf8");
const progress = JSON.parse(await readFile(progressPath, "utf8")) as ProgressEvidence;
const taskKey = checkpointValue(checkpoint, "작업 키");
const taskName = checkpointValue(checkpoint, "작업 이름");
const taskState = checkpointValue(checkpoint, "작업 상태");
const checkpointVersion = checkpointValue(checkpoint, "체크포인트 버전");
const nextActionSection = checkpointSection(checkpoint, "다음 행동");
const nextActions = [...nextActionSection.matchAll(/^\d+\.\s+(.+)$/gm)].map((match) => match[1]!.trim());

if (taskKey !== "hoibot-rdb-migration") errors.push("체크포인트 작업 키가 예상과 다릅니다.");
if (taskName === undefined) errors.push("체크포인트 작업 이름이 없습니다.");
if (!new Set(["진행 중", "검증 완료", "작업 완료"]).has(taskState ?? "")) errors.push("체크포인트 작업 상태가 유효하지 않습니다.");
if (checkpointVersion === undefined || !/^\d+$/.test(checkpointVersion)) errors.push("체크포인트 버전이 유효하지 않습니다.");
if (nextActions.length !== 1) errors.push("체크포인트에는 정확히 하나의 다음 행동이 있어야 합니다.");
if (progress.schemaVersion !== 2) errors.push("progress.json schemaVersion이 2가 아닙니다.");
if (progress.checkpoint !== repositoryRelative(checkpointPath)) errors.push("progress.json의 체크포인트 경로가 실제 경로와 다릅니다.");
if (progress.masterPlan !== repositoryRelative(masterPlanPath)) errors.push("progress.json의 마스터 계획 경로가 실제 경로와 다릅니다.");

const branch = git(["branch", "--show-current"]);
const head = git(["rev-parse", "HEAD"]);
const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
const upstreamHead = upstream.ok ? git(["rev-parse", "@{u}"]) : { ok: false, output: "" };
const remoteUrl = git(["remote", "get-url", "origin"]);
const dirty = git(["-c", "core.quotepath=false", "status", "--porcelain=v1"]);
const dirtyPaths = dirty.output === "" ? [] : dirty.output.split(/\r?\n/).map((line) => portablePath(line.slice(3)));
const checkpointRelative = repositoryRelative(checkpointPath);
const checkpointTracked = git(["ls-files", "--error-unmatch", checkpointRelative]).ok;
const checkpointCommit = checkpointTracked ? git(["log", "-1", "--format=%H", "--", checkpointRelative]).output : "";
const checkpointPushed = checkpointCommit !== "" && upstream.ok
  ? git(["merge-base", "--is-ancestor", checkpointCommit, upstream.output]).ok
  : false;

if (!branch.ok || branch.output !== progress.branchEvidence.required) errors.push(`필수 브랜치가 아닙니다: ${branch.output || "unknown"}`);
if (head.ok && head.output !== progress.branchEvidence.head) warnings.push("progress.json의 HEAD 증거가 현재 HEAD와 다릅니다.");
if (upstream.ok && upstream.output !== progress.branchEvidence.upstream) warnings.push("progress.json의 upstream 증거가 현재 upstream과 다릅니다.");
if (upstreamHead.ok && upstreamHead.output !== progress.branchEvidence.upstreamHead) warnings.push("progress.json의 upstream HEAD 증거가 현재 원격 추적 HEAD와 다릅니다.");
if (dirtyPaths.length > 0) warnings.push(`working tree에 ${dirtyPaths.length}개의 변경 경로가 있습니다.`);
if (!checkpointTracked) warnings.push("체크포인트가 Git에 추적되지 않아 다른 PC에서 복구할 수 없습니다.");
else if (!checkpointPushed) warnings.push("체크포인트를 포함한 커밋이 upstream에 없어 다른 PC에서 복구할 수 없습니다.");

const requiredArtifacts = [
  checkpointPath,
  progressPath,
  masterPlanPath,
  resumeScriptPath,
  path.join(runtimeRoot, "scripts", "verify-legacy-import.ts"),
  path.join(repositoryRoot, ".codex", "skills", "hoibot-migrate-legacy-rdb", "SKILL.md"),
  path.join(repositoryRoot, ".codex", "skills", "hoibot-migrate-legacy-rdb", "agents", "openai.yaml"),
  path.join(repositoryRoot, ".codex", "skills", "hoibot-migrate-legacy-rdb", "references", "evidence-schema.md"),
  path.join(repositoryRoot, ".codex", "skills", "hoibot-migrate-legacy-rdb", "references", "slice-workflow.md"),
  path.join(repositoryRoot, ".codex", "skills", "hoibot-migrate-legacy-rdb", "scripts", "validate-slice-evidence.mjs")
];
const artifactEvidence = await Promise.all(requiredArtifacts.map(async (artifact) => {
  try {
    await readFile(artifact);
    const relative = repositoryRelative(artifact);
    const tracked = git(["ls-files", "--error-unmatch", relative]).ok;
    const commit = tracked ? git(["log", "-1", "--format=%H", "--", relative]).output : "";
    const pushed = commit !== "" && upstream.ok ? git(["merge-base", "--is-ancestor", commit, upstream.output]).ok : false;
    return { path: relative, exists: true, tracked, pushed };
  } catch {
    return { path: repositoryRelative(artifact), exists: false, tracked: false, pushed: false };
  }
}));
for (const artifact of artifactEvidence) if (!artifact.exists) errors.push(`필수 artifact가 없습니다: ${artifact.path}`);

const snapshotPath = path.resolve(repositoryRoot, progress.sourceSnapshotEvidence.path);
const snapshot = await inspectSnapshot(snapshotPath);
if (snapshot.fileCount !== progress.sourceSnapshotEvidence.fileCount) errors.push("JSON snapshot 파일 수가 기록과 다릅니다.");
if (snapshot.rootHash !== progress.sourceSnapshotEvidence.rootHash) errors.push("JSON snapshot root hash가 기록과 다릅니다.");

const localMigrations = await inspectMigrations();
let databaseEvidence: {
  enabled: boolean;
  reachable: boolean;
  appliedMigrationCount: number | null;
  localMigrationCount: number;
  checksumMismatches: string[];
  completedImportRunFound: boolean | null;
  error?: string;
} = {
  enabled: false,
  reachable: false,
  appliedMigrationCount: null,
  localMigrationCount: localMigrations.size,
  checksumMismatches: [],
  completedImportRunFound: null
};

try {
  const config = loadConfig();
  databaseEvidence.enabled = config.database.enabled;
  if (!config.database.enabled) {
    warnings.push("DATABASE_ENABLED가 false라 DB 증거를 확인하지 못했습니다.");
  } else {
    const database = createDatabaseClient(config.database);
    try {
      await database.ping();
      databaseEvidence.reachable = true;
      const applied = await database.query<Array<{ version: string; checksum: string }>>(
        "SELECT version, checksum FROM schema_migrations ORDER BY version"
      );
      databaseEvidence.appliedMigrationCount = applied.length;
      databaseEvidence.checksumMismatches = applied
        .filter((row) => localMigrations.get(row.version) !== row.checksum)
        .map((row) => row.version);
      const importRuns = await database.query<Array<{ id: bigint }>>(
        `SELECT id FROM legacy_import_runs
         WHERE source_root_hash = ? AND mode = 'apply' AND status = 'completed'
         ORDER BY id DESC LIMIT 1`,
        [snapshot.rootHash]
      );
      databaseEvidence.completedImportRunFound = importRuns[0] !== undefined;
      if (databaseEvidence.checksumMismatches.length > 0) errors.push("적용된 migration checksum이 로컬 파일과 다릅니다.");
      if (!databaseEvidence.completedImportRunFound) warnings.push("현재 snapshot과 일치하는 완료된 import run이 없습니다.");
    } finally {
      await database.close();
    }
  }
} catch (error) {
  databaseEvidence.error = error instanceof Error ? error.message : String(error);
  warnings.push("DB 증거 확인에 실패했습니다. DB가 필요한 다음 작업 전 재확인이 필요합니다.");
}

const crossPcReady = checkpointTracked && checkpointPushed && artifactEvidence.every((artifact) => artifact.tracked && artifact.pushed);
const result = {
  task: {
    key: taskKey ?? null,
    name: taskName ?? null,
    state: taskState ?? null,
    checkpointVersion: checkpointVersion ?? null,
    nextAction: nextActions[0] ?? null
  },
  worktree: {
    repositoryRoot: portablePath(repositoryRoot),
    branch: branch.output,
    head: head.output,
    upstream: upstream.output,
    upstreamHead: upstreamHead.output,
    remoteConfigured: remoteUrl.ok,
    dirtyPathCount: dirtyPaths.length
  },
  checkpoint: {
    path: checkpointRelative,
    tracked: checkpointTracked,
    pushed: checkpointPushed
  },
  artifacts: artifactEvidence,
  snapshot,
  database: databaseEvidence,
  safeToResume: errors.length === 0,
  crossPcReady,
  errors,
  warnings
};

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} else {
  process.stdout.write([
    `[재개 점검] ${result.task.name ?? result.task.key ?? "unknown"}`,
    `상태: ${result.task.state ?? "unknown"}`,
    `안전한 로컬 재개: ${result.safeToResume ? "예" : "아니요"}`,
    `다른 PC 재개 준비: ${result.crossPcReady ? "예" : "아니요"}`,
    `브랜치: ${result.worktree.branch} (${result.worktree.head.slice(0, 7)})`,
    `snapshot: ${result.snapshot.fileCount} files / ${result.snapshot.rootHash}`,
    `DB: ${result.database.reachable ? "연결됨" : "미확인"}, 완료 import run: ${result.database.completedImportRunFound === true ? "있음" : "없음 또는 미확인"}`,
    `오류: ${errors.length}건 / 경고: ${warnings.length}건`,
    ...errors.map((message) => `ERROR: ${message}`),
    ...warnings.map((message) => `WARN: ${message}`),
    `다음 행동: ${result.task.nextAction ?? "없음"}`
  ].join("\n") + "\n");
}

if (errors.length > 0) process.exitCode = 1;
