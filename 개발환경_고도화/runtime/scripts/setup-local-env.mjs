import { constants } from "node:fs";
import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 개발 기본 설정을 기존 파일을 덮어쓰지 않고 .env로 복사합니다.
export async function ensureLocalEnv(directory = process.cwd()) {
  const source = resolve(directory, ".env.example");
  const destination = resolve(directory, ".env");
  try {
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    return "created";
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      return "preserved";
    }
    throw error;
  }
}

const entryPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (fileURLToPath(import.meta.url) === entryPath) {
  const result = await ensureLocalEnv();
  process.stdout.write(result === "created"
    ? ".env를 개발 기본값으로 생성했습니다. 실제 secret은 로컬에서만 변경하세요.\n"
    : "기존 .env를 보존했습니다.\n");
}
