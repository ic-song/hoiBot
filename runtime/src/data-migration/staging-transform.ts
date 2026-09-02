import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import type {
  FilterDecision,
  FilterDecisionManifest
} from "./filter-policy.js";

export interface StagingTransformEntry {
  sourcePathSha256: string;
  sourceContentSha256: string;
  decision: FilterDecision;
  format: "JSON" | "TEXT" | "JAVASCRIPT" | "BINARY";
  rootKind: "ARRAY" | "OBJECT" | "SCALAR" | "TEXT" | "BINARY";
  recordCount: number;
  stagingPayloadSha256: string | null;
  status: "STAGED" | "QUARANTINED" | "EXCLUDED";
}

export interface StagingTransformManifest {
  format: "hoibot-isolated-staging-v1";
  catalogVersion: string;
  policyVersion: string;
  decisionSha256: string;
  generatedAt: string;
  sourceFileCount: number;
  stagedFileCount: number;
  quarantinedFileCount: number;
  excludedFileCount: number;
  reviewFileCount: number;
  sourceBytes: number;
  stagingPayloadBytes: number;
  stagingSha256: string;
  entries: StagingTransformEntry[];
}

interface PrivateStagingEnvelope {
  sourcePathSha256: string;
  sourceContentSha256: string;
  decision: FilterDecision;
  format: StagingTransformEntry["format"];
  payload: unknown;
}

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function collectFiles(root: string, current: string, output: string[]): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const absolutePath = join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error("SOURCE_SYMLINK_NOT_ALLOWED");
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

function describePayload(
  extension: string,
  bytes: Buffer
): Pick<PrivateStagingEnvelope, "format" | "payload"> &
  Pick<StagingTransformEntry, "rootKind" | "recordCount"> {
  if (extension === ".json") {
    const payload: unknown = JSON.parse(UTF8_DECODER.decode(bytes));
    if (Array.isArray(payload)) {
      return { format: "JSON", payload, rootKind: "ARRAY", recordCount: payload.length };
    }
    if (payload && typeof payload === "object") {
      return {
        format: "JSON",
        payload,
        rootKind: "OBJECT",
        recordCount: Object.keys(payload).length
      };
    }
    return { format: "JSON", payload, rootKind: "SCALAR", recordCount: 1 };
  }

  if (extension === ".txt" || extension === ".js") {
    return {
      format: extension === ".js" ? "JAVASCRIPT" : "TEXT",
      payload: UTF8_DECODER.decode(bytes),
      rootKind: "TEXT",
      recordCount: 1
    };
  }

  return {
    format: "BINARY",
    payload: bytes.toString("base64"),
    rootKind: "BINARY",
    recordCount: 1
  };
}

async function writePrivatePayloadIfAbsent(path: string, serialized: string): Promise<void> {
  try {
    const existing = await readFile(path);
    if (sha256(existing) !== sha256(serialized)) throw new Error("STAGING_PAYLOAD_CONFLICT");
    return;
  } catch (error) {
    if (error instanceof Error && error.message === "STAGING_PAYLOAD_CONFLICT") throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }

  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, serialized, "utf8");
  await rename(temporaryPath, path);
}

// 승인 decision manifest를 사용해 원본 불변의 해시명 격리 staging을 생성한다.
export async function buildIsolatedStaging(
  sourceRoot: string,
  stagingRoot: string,
  decisions: FilterDecisionManifest,
  catalogVersion: string
): Promise<StagingTransformManifest> {
  const source = resolve(sourceRoot);
  const staging = resolve(stagingRoot);
  if (!(await stat(source)).isDirectory()) throw new Error("SOURCE_NOT_DIRECTORY");
  if (source === staging || staging.startsWith(`${source}${sep}`)) {
    throw new Error("STAGING_INSIDE_SOURCE_NOT_ALLOWED");
  }

  const sourceFiles: string[] = [];
  await collectFiles(source, source, sourceFiles);
  if (sourceFiles.length !== decisions.sourceFileCount) {
    throw new Error("SOURCE_DECISION_COUNT_MISMATCH");
  }

  const decisionsByPath = new Map(decisions.entries.map((entry) => [entry.pathSha256, entry]));
  const payloadDirectory = join(staging, decisions.decisionSha256, "payload");
  await mkdir(payloadDirectory, { recursive: true });
  const entries: StagingTransformEntry[] = [];
  const expectedPayloadNames = new Set<string>();
  let sourceBytes = 0;
  let stagingPayloadBytes = 0;

  for (const absolutePath of sourceFiles) {
    const relativePath = normalizedRelativePath(source, absolutePath);
    const sourcePathSha256 = sha256(relativePath);
    const decision = decisionsByPath.get(sourcePathSha256);
    if (!decision) throw new Error("SOURCE_DECISION_MISSING");
    const bytes = await readFile(absolutePath);
    sourceBytes += bytes.byteLength;
    if (sha256(bytes) !== decision.contentSha256 || bytes.byteLength !== decision.size) {
      throw new Error("SOURCE_DECISION_CONTENT_MISMATCH");
    }

    const described = describePayload(extname(relativePath).toLowerCase(), bytes);
    if (decision.decision === "EXCLUDE") {
      entries.push({
        sourcePathSha256,
        sourceContentSha256: decision.contentSha256,
        decision: decision.decision,
        format: described.format,
        rootKind: described.rootKind,
        recordCount: described.recordCount,
        stagingPayloadSha256: null,
        status: "EXCLUDED"
      });
      continue;
    }

    const envelope: PrivateStagingEnvelope = {
      sourcePathSha256,
      sourceContentSha256: decision.contentSha256,
      decision: decision.decision,
      format: described.format,
      payload: described.payload
    };
    const serialized = `${JSON.stringify(envelope)}\n`;
    const payloadName = `${sourcePathSha256}.json`;
    expectedPayloadNames.add(payloadName);
    await writePrivatePayloadIfAbsent(join(payloadDirectory, payloadName), serialized);
    stagingPayloadBytes += Buffer.byteLength(serialized);
    entries.push({
      sourcePathSha256,
      sourceContentSha256: decision.contentSha256,
      decision: decision.decision,
      format: described.format,
      rootKind: described.rootKind,
      recordCount: described.recordCount,
      stagingPayloadSha256: sha256(serialized),
      status: decision.decision === "QUARANTINE" ? "QUARANTINED" : "STAGED"
    });
  }

  const existingPayloadNames = (await readdir(payloadDirectory)).sort();
  if (
    existingPayloadNames.length !== expectedPayloadNames.size ||
    existingPayloadNames.some((name) => !expectedPayloadNames.has(name))
  ) {
    throw new Error("STAGING_UNEXPECTED_FILE");
  }

  entries.sort((left, right) => left.sourcePathSha256.localeCompare(right.sourcePathSha256, "en"));
  const canonical = entries.map(
    (entry) =>
      `${entry.sourcePathSha256}|${entry.sourceContentSha256}|${entry.decision}|${entry.format}|${entry.rootKind}|${entry.recordCount}|${entry.stagingPayloadSha256 ?? "-"}|${entry.status}`
  );

  return {
    format: "hoibot-isolated-staging-v1",
    catalogVersion,
    policyVersion: decisions.policyVersion,
    decisionSha256: decisions.decisionSha256,
    generatedAt: new Date().toISOString(),
    sourceFileCount: entries.length,
    stagedFileCount: entries.filter((entry) => entry.status === "STAGED").length,
    quarantinedFileCount: entries.filter((entry) => entry.status === "QUARANTINED").length,
    excludedFileCount: entries.filter((entry) => entry.status === "EXCLUDED").length,
    reviewFileCount: entries.filter((entry) => entry.decision === "REVIEW").length,
    sourceBytes,
    stagingPayloadBytes,
    stagingSha256: sha256(canonical.join("\n")),
    entries
  };
}

// 비노출 staging manifest를 임시 파일을 거쳐 원자적으로 저장한다.
export async function writeStagingTransformManifest(
  outputPath: string,
  manifest: StagingTransformManifest
): Promise<void> {
  const absoluteOutput = resolve(outputPath);
  const temporaryOutput = `${absoluteOutput}.tmp`;
  await mkdir(dirname(absoluteOutput), { recursive: true });
  await writeFile(temporaryOutput, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryOutput, absoluteOutput);
}

