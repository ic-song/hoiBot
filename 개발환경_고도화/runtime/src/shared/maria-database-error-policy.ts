import { hasCurrentTransactionCapability, hasRootTransactionCapability, type DatabaseClient, type DatabaseTransaction } from "../database.js";
import { types as nodeTypes } from "node:util";

export const MARIA_DATABASE_ERROR_POLICY_VERSION = "RFA03_MARIA_ERROR_RETRY_V1" as const;
export const CUID8_COLLISION_MAX_ATTEMPTS = 8;

export type MariaDatabaseErrorKind =
  | "CUID8_PRIMARY_KEY_COLLISION"
  | "BUSINESS_UNIQUE_CONFLICT"
  | "FOREIGN_KEY_CONFLICT"
  | "TRANSACTION_DEADLOCK"
  | "TRANSACTION_LOCK_WAIT_TIMEOUT"
  | "OTHER";

export interface Cuid8CollisionContext {
  readonly candidate: string;
}

export interface MariaDatabaseErrorClassification {
  readonly kind: MariaDatabaseErrorKind;
  readonly code: string | undefined;
  readonly errno: number | undefined;
  readonly constraintName: string | undefined;
}

type ErrorFields = { readonly code?: unknown; readonly errno?: unknown; readonly message?: unknown; readonly sqlMessage?: unknown };

function readErrorFields(error: unknown): ErrorFields | undefined {
  if (typeof error !== "object" || error === null || nodeTypes.isProxy(error)) return undefined;
  try {
    const value = (key: keyof ErrorFields): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(error, key);
      return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
    };
    return { code: value("code"), errno: value("errno"), message: value("message"), sqlMessage: value("sqlMessage") };
  } catch {
    return undefined;
  }
}

function exactMariaError(fields: ErrorFields | undefined, code: string, errno: number): boolean {
  return fields?.code === code && fields.errno === errno;
}

function constraintFrom(fields: ErrorFields | undefined): string | undefined {
  const text = typeof fields?.sqlMessage === "string" ? fields.sqlMessage : typeof fields?.message === "string" ? fields.message : "";
  const match = /for key\s+['`"]([^'`"]+)['`"]/i.exec(text);
  if (match?.[1] === undefined) return undefined;
  const qualified = match[1].split(".").at(-1);
  return qualified === undefined ? undefined : qualified;
}

function validCuid8(value: string): boolean {
  return /^[a-z][a-z0-9]{7}$/.test(value);
}

// MariaDB connector의 code와 errno가 함께 일치할 때만 오류 의미를 확정합니다.
export function classifyMariaDatabaseError(error: unknown, context?: Cuid8CollisionContext): MariaDatabaseErrorClassification {
  const fields = readErrorFields(error);
  const code = typeof fields?.code === "string" ? fields.code : undefined;
  const errno = typeof fields?.errno === "number" ? fields.errno : undefined;
  const constraintName = constraintFrom(fields);
  let kind: MariaDatabaseErrorKind = "OTHER";
  if (exactMariaError(fields, "ER_LOCK_DEADLOCK", 1213)) kind = "TRANSACTION_DEADLOCK";
  else if (exactMariaError(fields, "ER_LOCK_WAIT_TIMEOUT", 1205)) kind = "TRANSACTION_LOCK_WAIT_TIMEOUT";
  else if (exactMariaError(fields, "ER_ROW_IS_REFERENCED_2", 1451) || exactMariaError(fields, "ER_NO_REFERENCED_ROW_2", 1452)) kind = "FOREIGN_KEY_CONFLICT";
  else if (exactMariaError(fields, "ER_DUP_ENTRY", 1062)) {
    kind = context !== undefined && validCuid8(context.candidate) && constraintName?.toLowerCase() === "primary"
      ? "CUID8_PRIMARY_KEY_COLLISION"
      : "BUSINESS_UNIQUE_CONFLICT";
  }
  return Object.freeze({ kind, code, errno, constraintName });
}

export function isMariaBusinessUniqueConflict(error: unknown, constraintName: string): boolean {
  const classified = classifyMariaDatabaseError(error);
  return classified.kind === "BUSINESS_UNIQUE_CONFLICT" && classified.constraintName?.toLowerCase() === constraintName.toLowerCase();
}

export interface Cuid8InsertOptions {
  readonly generate: () => string;
  readonly maxAttempts?: number;
  readonly exhaustedErrorCode?: string;
}

function assertAttempts(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > CUID8_COLLISION_MAX_ATTEMPTS) throw new Error("RFA03_RETRY_ATTEMPTS_INVALID");
}

// 후보 생성 insert 경계에서 확인된 CUID8 PK 충돌만 제한적으로 재시도합니다.
export async function insertWithCuid8CollisionRetry(
  insert: (candidate: string) => Promise<void>,
  options: Cuid8InsertOptions,
): Promise<string> {
  const maxAttempts = options.maxAttempts ?? CUID8_COLLISION_MAX_ATTEMPTS;
  assertAttempts(maxAttempts);
  let lastCollision: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = options.generate();
    if (!validCuid8(candidate)) throw new Error("RFA03_CUID8_CANDIDATE_INVALID");
    try {
      await insert(candidate);
      return candidate;
    } catch (error) {
      if (classifyMariaDatabaseError(error, { candidate }).kind !== "CUID8_PRIMARY_KEY_COLLISION") throw error;
      lastCollision = error;
    }
  }
  throw new Error(options.exhaustedErrorCode ?? "RFA03_CUID8_COLLISION_RETRY_EXHAUSTED", { cause: lastCollision });
}

export interface MariaTransactionRetryOptions {
  readonly maxAttempts: number;
  readonly allowRetry: (kind: "TRANSACTION_DEADLOCK" | "TRANSACTION_LOCK_WAIT_TIMEOUT") => boolean;
  readonly exhaustedErrorCode?: string;
  readonly rootTransaction?: <T>(work:(transaction:DatabaseTransaction)=>Promise<T>)=>Promise<T>;
}

const brandedTransactionRetryExhaustions=new WeakSet<object>();
function exhausted(errorCode:string,cause?:unknown):Error{const error=new Error(errorCode,{cause});brandedTransactionRetryExhaustions.add(error);return error;}
export function isMariaTransactionRetryExhaustion(error:unknown,errorCode:string):boolean{return error instanceof Error&&error.message===errorCode&&brandedTransactionRetryExhaustions.has(error);}

// 매 시도마다 새 transaction을 시작하며, 도메인이 허용한 1213/1205만 transaction 전체에서 재시도합니다.
export async function withMariaTransactionRetry<T>(
  database: DatabaseClient,
  options: MariaTransactionRetryOptions,
  work: (transaction: DatabaseTransaction, attemptNumber: number) => Promise<T>,
): Promise<T> {
  assertAttempts(options.maxAttempts);
  const root = options.rootTransaction===undefined?(hasRootTransactionCapability(database)?database.withRootTransaction.bind(database):undefined):options.rootTransaction;
  if (!root) {
    if (!hasCurrentTransactionCapability(database)) throw new Error("RFA03_TRANSACTION_BOUNDARY_CAPABILITY_REQUIRED");
    // 상위 owner의 transaction을 savepoint 없이 정확히 한 번 사용하고 모든 오류를 그대로 전파합니다.
    return database.withCurrentTransaction(transaction => work(transaction, 1));
  }
  for (let attempt = 0; attempt < options.maxAttempts; attempt += 1) {
    try {
      return await root(transaction => work(transaction, attempt + 1));
    } catch (error) {
      const kind = classifyMariaDatabaseError(error).kind;
      const transactionKind = kind === "TRANSACTION_DEADLOCK" || kind === "TRANSACTION_LOCK_WAIT_TIMEOUT" ? kind : undefined;
      // root transaction에서도 도메인이 허용한 transient conflict만 재시도합니다.
      if (transactionKind === undefined || !options.allowRetry(transactionKind)) throw error;
      if (attempt + 1 === options.maxAttempts) throw exhausted(options.exhaustedErrorCode ?? "RFA03_TRANSACTION_RETRY_EXHAUSTED",error);
    }
  }
  throw exhausted(options.exhaustedErrorCode ?? "RFA03_TRANSACTION_RETRY_EXHAUSTED");
}
