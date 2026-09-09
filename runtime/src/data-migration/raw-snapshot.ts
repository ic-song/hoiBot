import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

export interface RawSnapshotEntry {
  pathSha256: string;
  size: number;
  contentSha256: string;
}

export interface RawSnapshotManifest {
  format: "hoibot-raw-snapshot-v1";
  generatedAt: string;
  sourceLabel: string;
  fileCount: number;
  jsonFileCount: number;
  textFileCount: number;
  totalBytes: number;
  manifestSha256: string;
  entries: RawSnapshotEntry[];
}

export interface RawSnapshotComparison {
  equal: boolean;
  reasons: string[];
  missingPathSha256: string[];
  additionalPathSha256: string[];
  changedPathSha256: string[];
}

export interface RawLandingBundleEntry extends RawSnapshotEntry {
  storageName: string;
}

export interface RawLandingBundleManifest {
  format: "hoibot-raw-landing-bundle-v1";
  generatedAt: string;
  sourceLabel: string;
  snapshotManifestSha256: string;
  fileCount: number;
  totalBytes: number;
  bundleSha256: string;
  entries: RawLandingBundleEntry[];
}

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const TEXT_EXTENSIONS = new Set([".json", ".txt"]);

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeBytesIfAbsent(path: string, bytes: Buffer): Promise<void> {
  try {
    const existing = await readFile(path);
    if (sha256(existing) !== sha256(bytes)) throw new Error("RAW_LANDING_PAYLOAD_CONFLICT");
    return;
  } catch (error) {
    if (error instanceof Error && error.message === "RAW_LANDING_PAYLOAD_CONFLICT") throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, path);
}

async function collectFiles(root: string, current: string, output: string[]): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

  for (const entry of entries) {
    const absolutePath = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`SYMLINK_NOT_ALLOWED:${sha256(relative(root, absolutePath))}`);
    }
    if (entry.isDirectory()) {
      await collectFiles(root, absolutePath, output);
      continue;
    }
    if (entry.isFile()) {
      output.push(absolutePath);
    }
  }
}

function normalizeRelativePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join("/");
}

// 운영 RAW 디렉터리를 원문 비노출 SHA-256 manifest로 변환한다.
export async function buildRawSnapshotManifest(
  sourceRoot: string,
  sourceLabel = "operational-data"
): Promise<RawSnapshotManifest> {
  const root = resolve(sourceRoot);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error("SOURCE_NOT_DIRECTORY");
  }

  const files: string[] = [];
  await collectFiles(root, root, files);
  if (files.length === 0) {
    throw new Error("EMPTY_SNAPSHOT");
  }

  let jsonFileCount = 0;
  let textFileCount = 0;
  let totalBytes = 0;
  const entries: RawSnapshotEntry[] = [];

  for (const absolutePath of files) {
    const relativePath = normalizeRelativePath(root, absolutePath);
    const bytes = await readFile(absolutePath);
    const extension = extname(relativePath).toLowerCase();

    if (TEXT_EXTENSIONS.has(extension)) {
      let text: string;
      try {
        text = UTF8_DECODER.decode(bytes);
      } catch {
        throw new Error(`INVALID_UTF8:${sha256(relativePath)}`);
      }
      textFileCount += 1;
      if (extension === ".json") {
        try {
          JSON.parse(text);
        } catch {
          throw new Error(`INVALID_JSON:${sha256(relativePath)}`);
        }
        jsonFileCount += 1;
      }
    }

    totalBytes += bytes.byteLength;
    entries.push({
      pathSha256: sha256(relativePath),
      size: bytes.byteLength,
      contentSha256: sha256(bytes)
    });
  }

  const canonicalLines = entries.map(
    (entry) => `${entry.pathSha256}|${entry.size}|${entry.contentSha256}`
  );

  return {
    format: "hoibot-raw-snapshot-v1",
    generatedAt: new Date().toISOString(),
    sourceLabel,
    fileCount: entries.length,
    jsonFileCount,
    textFileCount,
    totalBytes,
    manifestSha256: sha256(canonicalLines.join("\n")),
    entries
  };
}

// 검증된 RAW snapshot을 경로 비노출 해시명과 원문 bytes 그대로 landing bundle로 만든다.
export async function buildRawLandingBundle(
  sourceRoot: string,
  bundleRoot: string,
  expected: RawSnapshotManifest
): Promise<RawLandingBundleManifest> {
  const source = resolve(sourceRoot);
  const bundle = resolve(bundleRoot);
  if (!(await stat(source)).isDirectory()) throw new Error("SOURCE_NOT_DIRECTORY");
  if (source === bundle || bundle.startsWith(`${source}${sep}`)) {
    throw new Error("RAW_LANDING_INSIDE_SOURCE_NOT_ALLOWED");
  }

  const files: string[] = [];
  await collectFiles(source, source, files);
  if (files.length !== expected.fileCount) throw new Error("RAW_LANDING_FILE_COUNT_MISMATCH");
  const expectedByPath = new Map(expected.entries.map((entry) => [entry.pathSha256, entry]));
  const payloadDirectory = join(bundle, expected.manifestSha256, "payload");
  await mkdir(payloadDirectory, { recursive: true });
  const entries: RawLandingBundleEntry[] = [];

  for (const absolutePath of files) {
    const relativePath = normalizeRelativePath(source, absolutePath);
    const pathSha256 = sha256(relativePath);
    const expectedEntry = expectedByPath.get(pathSha256);
    if (!expectedEntry) throw new Error("RAW_LANDING_PATH_NOT_IN_SNAPSHOT");
    const bytes = await readFile(absolutePath);
    if (bytes.byteLength !== expectedEntry.size || sha256(bytes) !== expectedEntry.contentSha256) {
      throw new Error("RAW_LANDING_SOURCE_DRIFT");
    }
    const storageName = `${pathSha256}.bin`;
    await writeBytesIfAbsent(join(payloadDirectory, storageName), bytes);
    entries.push({ ...expectedEntry, storageName });
  }

  entries.sort((left, right) => left.pathSha256.localeCompare(right.pathSha256, "en"));
  const expectedNames = new Set(entries.map((entry) => entry.storageName));
  const actualNames = (await readdir(payloadDirectory)).sort();
  if (actualNames.length !== expectedNames.size || actualNames.some((name) => !expectedNames.has(name))) {
    throw new Error("RAW_LANDING_UNEXPECTED_PAYLOAD");
  }
  const canonical = entries.map(
    (entry) => `${entry.pathSha256}|${entry.size}|${entry.contentSha256}|${entry.storageName}`
  );
  return {
    format: "hoibot-raw-landing-bundle-v1",
    generatedAt: new Date().toISOString(),
    sourceLabel: expected.sourceLabel,
    snapshotManifestSha256: expected.manifestSha256,
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    bundleSha256: sha256(canonical.join("\n")),
    entries
  };
}

// RAW landing bundle manifest를 임시 파일을 거쳐 원자적으로 저장한다.
export async function writeRawLandingBundleManifest(
  outputPath: string,
  manifest: RawLandingBundleManifest
): Promise<void> {
  const absoluteOutput = resolve(outputPath);
  const temporaryOutput = `${absoluteOutput}.tmp`;
  await mkdir(dirname(absoluteOutput), { recursive: true });
  await writeFile(temporaryOutput, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryOutput, absoluteOutput);
}

// 두 RAW manifest의 파일 수, 바이트 수와 전체 해시가 같은지 판정한다.
export function compareRawSnapshotManifests(
  expected: RawSnapshotManifest,
  actual: RawSnapshotManifest
): RawSnapshotComparison {
  const reasons: string[] = [];
  const expectedByPath = new Map(expected.entries.map((entry) => [entry.pathSha256, entry]));
  const actualByPath = new Map(actual.entries.map((entry) => [entry.pathSha256, entry]));
  const missingPathSha256 = [...expectedByPath.keys()]
    .filter((pathSha256) => !actualByPath.has(pathSha256))
    .sort();
  const additionalPathSha256 = [...actualByPath.keys()]
    .filter((pathSha256) => !expectedByPath.has(pathSha256))
    .sort();
  const changedPathSha256 = [...expectedByPath.entries()]
    .filter(([pathSha256, expectedEntry]) => {
      const actualEntry = actualByPath.get(pathSha256);
      return Boolean(
        actualEntry &&
          (expectedEntry.size !== actualEntry.size ||
            expectedEntry.contentSha256 !== actualEntry.contentSha256)
      );
    })
    .map(([pathSha256]) => pathSha256)
    .sort();

  if (expected.format !== actual.format) reasons.push("FORMAT_MISMATCH");
  if (expected.fileCount !== actual.fileCount) reasons.push("FILE_COUNT_MISMATCH");
  if (expected.jsonFileCount !== actual.jsonFileCount) reasons.push("JSON_COUNT_MISMATCH");
  if (expected.totalBytes !== actual.totalBytes) reasons.push("TOTAL_BYTES_MISMATCH");
  if (expected.manifestSha256 !== actual.manifestSha256) reasons.push("MANIFEST_HASH_MISMATCH");
  if (missingPathSha256.length > 0) reasons.push("MISSING_FILES");
  if (additionalPathSha256.length > 0) reasons.push("ADDITIONAL_FILES");
  if (changedPathSha256.length > 0) reasons.push("CHANGED_FILES");
  return {
    equal: reasons.length === 0,
    reasons,
    missingPathSha256,
    additionalPathSha256,
    changedPathSha256
  };
}

// manifest 파일을 같은 디렉터리의 임시 파일을 거쳐 원자적으로 저장한다.
export async function writeRawSnapshotManifest(
  outputPath: string,
  manifest: RawSnapshotManifest
): Promise<void> {
  const absoluteOutput = resolve(outputPath);
  const temporaryOutput = `${absoluteOutput}.tmp`;
  await mkdir(dirname(absoluteOutput), { recursive: true });
  await writeFile(temporaryOutput, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryOutput, absoluteOutput);
}
