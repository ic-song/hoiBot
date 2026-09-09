import type { DatabaseClient } from "../database.js";

export type EnvironmentCode = "dev" | "prod";

export interface EnvironmentContext {
  readonly environmentCode: EnvironmentCode;
  readonly databaseIdentity: string;
  readonly requestNamespace: string;
}

const VERIFIED_ENVIRONMENT_CONTEXT: unique symbol = Symbol("VerifiedEnvironmentContext");
const VERIFIED_CONTEXTS = new WeakSet<object>();

export interface VerifiedEnvironmentContext extends EnvironmentContext {
  readonly [VERIFIED_ENVIRONMENT_CONTEXT]: true;
}

export interface EnvironmentContextInput {
  readonly environmentCode: EnvironmentCode;
  readonly databaseIdentity: string;
}

export const REQUEST_NAMESPACE_MAX_LENGTH = 76;
export const STARTUP_DATABASE_IDENTITY_QUERY = "SELECT DATABASE() AS database_identity";

const DATABASE_IDENTITY_PATTERN = /^[A-Za-z0-9_$-]{1,64}$/;
const LEGACY_DATA_ROOTS: Readonly<Record<EnvironmentCode, string>> = Object.freeze({
  dev: "/sdcard/호이랜드_dev/",
  prod: "/sdcard/호이랜드/"
});

interface DatabaseIdentityRow {
  database_identity: unknown;
}

/**
 * 명시적으로 전달된 dev/prod와 DB 식별자만으로 프로세스 단위 환경 경계를 만듭니다.
 * NODE_ENV 또는 레거시 경로를 환경 선택자로 사용하지 않습니다.
 */
export function createEnvironmentContext(input: EnvironmentContextInput): EnvironmentContext {
  if (input.environmentCode !== "dev" && input.environmentCode !== "prod") {
    throw new Error("environmentCode must be explicitly set to dev or prod.");
  }
  if (!DATABASE_IDENTITY_PATTERN.test(input.databaseIdentity)) {
    throw new Error("databaseIdentity must match [A-Za-z0-9_$-]{1,64} exactly.");
  }

  const requestNamespace = buildRequestNamespace(input.environmentCode, input.databaseIdentity);
  return Object.freeze({
    environmentCode: input.environmentCode,
    databaseIdentity: input.databaseIdentity,
    requestNamespace
  });
}

/** EnvironmentContext의 공식 namespace 공식을 한곳에서 적용합니다. */
export function buildRequestNamespace(
  environmentCode: EnvironmentCode,
  databaseIdentity: string
): string {
  const requestNamespace = `hoibot:${environmentCode}:${databaseIdentity}`;
  if (requestNamespace.length > REQUEST_NAMESPACE_MAX_LENGTH) {
    throw new Error(`requestNamespace exceeds ${REQUEST_NAMESPACE_MAX_LENGTH} characters.`);
  }
  return requestNamespace;
}

/** 검증된 컨텍스트와 결합되는 레거시 데이터 루트를 반환합니다. */
export function resolveLegacyDataRoot(context: EnvironmentContext): string {
  assertEnvironmentContextInvariant(context);
  return LEGACY_DATA_ROOTS[context.environmentCode];
}

/**
 * 첫 일반 DB 접근이나 entrypoint 등록 전에 실제 연결 DB를 byte-for-byte 검증합니다.
 * 기존 DatabaseClient.query 계약만 사용하며 성공 시 같은 frozen context를 반환합니다.
 */
export async function verifyStartupDatabaseIdentity(
  database: Pick<DatabaseClient, "query">,
  context: EnvironmentContext
): Promise<VerifiedEnvironmentContext> {
  assertEnvironmentContextInvariant(context);
  const rows = await database.query<DatabaseIdentityRow[]>(STARTUP_DATABASE_IDENTITY_QUERY);
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("Startup database identity verification must return exactly one row.");
  }

  const actualIdentity = rows[0]?.database_identity;
  if (typeof actualIdentity !== "string" || actualIdentity.length === 0) {
    throw new Error("Startup database identity verification returned a null or empty identity.");
  }
  if (actualIdentity !== context.databaseIdentity) {
    throw new Error("Startup database identity does not match EnvironmentContext.databaseIdentity byte-for-byte.");
  }

  const verified = {
    environmentCode: context.environmentCode,
    databaseIdentity: context.databaseIdentity,
    requestNamespace: context.requestNamespace
  } as EnvironmentContext & { [VERIFIED_ENVIRONMENT_CONTEXT]?: true };
  Object.defineProperty(verified, VERIFIED_ENVIRONMENT_CONTEXT, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });
  VERIFIED_CONTEXTS.add(verified);
  return Object.freeze(verified) as VerifiedEnvironmentContext;
}

/** 검증 함수가 발급한 frozen context만 허용하는 런타임 경계 guard입니다. */
export function assertVerifiedEnvironmentContext(
  value: unknown
): asserts value is VerifiedEnvironmentContext {
  if (typeof value !== "object" || value === null
    || !VERIFIED_CONTEXTS.has(value)
    || (value as { [VERIFIED_ENVIRONMENT_CONTEXT]?: unknown })[VERIFIED_ENVIRONMENT_CONTEXT] !== true
    || !Object.isFrozen(value)) {
    throw new Error("VerifiedEnvironmentContext must be issued by verifyStartupDatabaseIdentity.");
  }
  assertEnvironmentContextInvariant(value as EnvironmentContext);
}

function assertEnvironmentContextInvariant(context: EnvironmentContext): void {
  if (!Object.isFrozen(context)) {
    throw new Error("EnvironmentContext must be immutable and created by createEnvironmentContext.");
  }
  if (context.environmentCode !== "dev" && context.environmentCode !== "prod") {
    throw new Error("EnvironmentContext has an invalid environmentCode.");
  }
  if (!DATABASE_IDENTITY_PATTERN.test(context.databaseIdentity)) {
    throw new Error("EnvironmentContext has an invalid databaseIdentity.");
  }
  if (context.requestNamespace !== buildRequestNamespace(context.environmentCode, context.databaseIdentity)) {
    throw new Error("EnvironmentContext requestNamespace does not match its environment and database identity.");
  }
}
