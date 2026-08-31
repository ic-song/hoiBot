import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, it } from "node:test";

const execFileAsync = promisify(execFile);
const setupScript = fileURLToPath(new URL("../scripts/setup-local-env.mjs", import.meta.url));

// 임시 디렉터리에서 환경설정 생성 명령을 실행합니다.
async function runSetup(directory: string): Promise<string> {
  const result = await execFileAsync(process.execPath, [setupScript], { cwd: directory });
  return result.stdout;
}

describe("local environment bootstrap", () => {
  it("creates .env from the tracked example without exposing a secret", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hoibot-env-create-"));
    await writeFile(join(directory, ".env.example"), "DATABASE_ENABLED=false\nSAFE_VALUE=example\n", "utf8");

    assert.match(await runSetup(directory), /생성했습니다/);
    assert.equal(await readFile(join(directory, ".env"), "utf8"), "DATABASE_ENABLED=false\nSAFE_VALUE=example\n");
  });

  it("preserves an existing .env byte-for-byte", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hoibot-env-preserve-"));
    await writeFile(join(directory, ".env.example"), "VALUE=example\n", "utf8");
    await writeFile(join(directory, ".env"), "VALUE=local-secret\n", "utf8");

    assert.match(await runSetup(directory), /보존했습니다/);
    assert.equal(await readFile(join(directory, ".env"), "utf8"), "VALUE=local-secret\n");
  });
});
