export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  irisSharedToken: string;
  irisBaseUrl: string;
  irisImageForwardRoomId: string;
  imageMaxBytes: number;
  imageDownloadTimeoutMs: number;
  bodyLimitBytes: number;
  rawPayloadLogging: boolean;
  recentEventsEnabled: boolean;
  recentEventLimit: number;
  version: string;
}

const DEFAULT_VERSION = "0.1.0";

// Iris HTTP API 주소를 검증하고 끝의 슬래시를 제거합니다.
function readHttpUrl(value: string | undefined, fallback: string, name: string): string {
  const rawValue = value?.trim() || fallback;
  const parsed = new URL(rawValue);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must use http or https.`);
  }

  return rawValue.replace(/\/+$/, "");
}

// 양의 정수 환경 변수를 안전하게 읽습니다.
function readPositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

// boolean 환경 변수를 안전하게 읽습니다.
function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  return value.toLowerCase() === "true";
}

// 서버 실행에 필요한 환경 설정을 구성하고 검증합니다.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const irisSharedToken = env.IRIS_SHARED_TOKEN?.trim() ?? "";
  if (irisSharedToken.length < 16) {
    throw new Error("IRIS_SHARED_TOKEN must contain at least 16 characters.");
  }

  const nodeEnv = env.NODE_ENV?.trim() || "development";

  return {
    nodeEnv,
    host: env.HOST?.trim() || "0.0.0.0",
    port: readPositiveInteger(env.PORT, 3100, "PORT"),
    irisSharedToken,
    irisBaseUrl: readHttpUrl(env.IRIS_BASE_URL, "http://127.0.0.1:3000", "IRIS_BASE_URL"),
    irisImageForwardRoomId: env.IRIS_IMAGE_FORWARD_ROOM_ID?.trim() ?? "",
    imageMaxBytes: readPositiveInteger(env.IMAGE_MAX_BYTES, 10_485_760, "IMAGE_MAX_BYTES"),
    imageDownloadTimeoutMs: readPositiveInteger(
      env.IMAGE_DOWNLOAD_TIMEOUT_MS,
      10_000,
      "IMAGE_DOWNLOAD_TIMEOUT_MS"
    ),
    bodyLimitBytes: readPositiveInteger(env.BODY_LIMIT_BYTES, 1_048_576, "BODY_LIMIT_BYTES"),
    rawPayloadLogging: readBoolean(env.RAW_PAYLOAD_LOGGING, nodeEnv !== "production"),
    recentEventsEnabled: readBoolean(env.RECENT_EVENTS_ENABLED, nodeEnv !== "production"),
    recentEventLimit: readPositiveInteger(env.RECENT_EVENT_LIMIT, 50, "RECENT_EVENT_LIMIT"),
    version: env.APP_VERSION?.trim() || DEFAULT_VERSION
  };
}
