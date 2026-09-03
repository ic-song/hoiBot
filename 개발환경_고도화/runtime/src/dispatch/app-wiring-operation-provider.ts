import { createHash } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../database.js";
import {
  OBJECT_IDENTITY_MAX_ATTEMPTS,
  assertObjectIdentityCandidate,
  createObjectAuditValues,
  createObjectIdentityCandidate,
  type ObjectIdentityCandidateGenerator
} from "../identity/object-identity-audit-provider.js";
import { assertVerifiedEnvironmentContext, type VerifiedEnvironmentContext } from "../runtime/environment-context.js";

export type AppWiringEntrypointKind = "IRIS" | "AUTOMATIC" | "ADMIN" | "WEB";
export type AppWiringRoute = "MODERN" | "SHADOW" | "LEGACY_FALLBACK" | "REJECT";
export type AppWiringClaimState = "CLAIMED" | "MUTATION_STARTED" | "COMPLETED" | "FAILED";

export interface AppWiringReceiptResult {
  status: string;
  referenceId?: string;
  resultFingerprint?: string;
}

export interface AppWiringClaimInput {
  entrypointKind: AppWiringEntrypointKind;
  externalRequestId: string;
  normalizedPayload: unknown;
  actor: string;
}

export interface AppWiringRouteDecision {
  route: AppWiringRoute;
  reasonCode: string;
  commandCode?: string;
  handlerKey?: string;
}

export interface AppWiringClaim {
  readonly appWiringOperationId: string;
  readonly requestIdentityFingerprint: string;
  readonly requestNamespace: string;
  readonly entrypointKind: AppWiringEntrypointKind;
  readonly externalRequestId: string;
  readonly requestKey: string;
  readonly payloadFingerprint: string;
  readonly route: AppWiringRoute;
  readonly reasonCode: string;
  readonly commandCode?: string;
  readonly handlerKey?: string;
  readonly claimState: AppWiringClaimState;
  readonly result: Readonly<AppWiringReceiptResult> | undefined;
  readonly errorCode?: string;
}

type MutableAppWiringClaim = { -readonly [Key in keyof AppWiringClaim]: AppWiringClaim[Key] };

export interface AppWiringExecution {
  readonly claim: AppWiringClaim;
  readonly database: DatabaseClient;
  readonly replayed: boolean;
  complete(result: AppWiringReceiptResult): Promise<void>;
  fail(errorCode: string): Promise<void>;
}

interface ClaimRow {
  app_wiring_operation_id: string;
  request_identity_fingerprint: string;
  request_namespace: string;
  entrypoint_kind: AppWiringEntrypointKind;
  external_request_id: string;
  request_key: string;
  payload_fingerprint: string;
  route: AppWiringRoute;
  reason_code: string;
  command_code: string | null;
  handler_key: string | null;
  claim_state: AppWiringClaimState;
  result_json: string | null;
  error_code: string | null;
}

type SqlExecutor = Pick<DatabaseTransaction, "query" | "execute">;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function serializePayload(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("APP_WIRING_PAYLOAD_NOT_SERIALIZABLE");
  return serialized;
}

function normalizeSafeResult(value: AppWiringReceiptResult): { serialized: string; result: Readonly<AppWiringReceiptResult> } {
  const keys = Object.keys(value);
  if (keys.some((key) => !["status", "referenceId", "resultFingerprint"].includes(key))) throw new Error("APP_WIRING_RESULT_KEY_FORBIDDEN");
  const status = value.status;
  const referenceId = value.referenceId;
  const resultFingerprint = value.resultFingerprint;
  if (typeof status !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(status)) throw new Error("APP_WIRING_RESULT_STATUS_INVALID");
  if (referenceId !== undefined && (typeof referenceId !== "string" || !/^[A-Za-z0-9._:@/-]{1,191}$/.test(referenceId))) throw new Error("APP_WIRING_RESULT_REFERENCE_INVALID");
  if (resultFingerprint !== undefined && (typeof resultFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(resultFingerprint))) throw new Error("APP_WIRING_RESULT_FINGERPRINT_INVALID");
  const result = Object.freeze({ status, ...(referenceId === undefined ? {} : { referenceId }), ...(resultFingerprint === undefined ? {} : { resultFingerprint }) });
  return { serialized: JSON.stringify(result), result };
}

function assertInput(input: AppWiringClaimInput): void {
  if (!/^(IRIS|AUTOMATIC|ADMIN|WEB)$/.test(input.entrypointKind)) throw new Error("APP_WIRING_ENTRYPOINT_INVALID");
  if (!/^[A-Za-z0-9._:@/-]{1,172}$/.test(input.externalRequestId)) throw new Error("APP_WIRING_EXTERNAL_REQUEST_ID_INVALID");
  createObjectAuditValues(input.actor);
}

function assertDecision(decision: AppWiringRouteDecision): void {
  if (!/^(MODERN|SHADOW|LEGACY_FALLBACK|REJECT)$/.test(decision.route)) throw new Error("APP_WIRING_ROUTE_INVALID");
  if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(decision.reasonCode)) throw new Error("APP_WIRING_REASON_CODE_INVALID");
  for (const [value, code] of [[decision.commandCode, "APP_WIRING_COMMAND_CODE_INVALID"], [decision.handlerKey, "APP_WIRING_HANDLER_KEY_INVALID"]] as const) {
    if (value !== undefined && (value.trim() === "" || value.length > 100 || !/^[A-Za-z0-9_.:-]+$/.test(value))) throw new Error(code);
  }
  if (decision.route !== "REJECT" && decision.commandCode === undefined && decision.handlerKey === undefined) throw new Error("APP_WIRING_HANDLER_REQUIRED");
}

function isDuplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";
  return code === "ER_DUP_ENTRY" || /duplicate entry/i.test(message);
}

function parseResult(value: string | null): AppWiringReceiptResult | undefined {
  if (value === null) return undefined;
  try {
    const parsed = JSON.parse(value) as AppWiringReceiptResult;
    return normalizeSafeResult(parsed).result;
  } catch { throw new Error("APP_WIRING_RESULT_JSON_INVALID"); }
}

function toClaim(row: ClaimRow): MutableAppWiringClaim {
  return {
    appWiringOperationId: row.app_wiring_operation_id,
    requestIdentityFingerprint: row.request_identity_fingerprint,
    requestNamespace: row.request_namespace,
    entrypointKind: row.entrypoint_kind,
    externalRequestId: row.external_request_id,
    requestKey: row.request_key,
    payloadFingerprint: row.payload_fingerprint,
    route: row.route,
    reasonCode: row.reason_code,
    ...(row.command_code === null ? {} : { commandCode: row.command_code }),
    ...(row.handler_key === null ? {} : { handlerKey: row.handler_key }),
    claimState: row.claim_state,
    result: parseResult(row.result_json),
    ...(row.error_code === null ? {} : { errorCode: row.error_code })
  };
}

function claimSnapshot(claim: MutableAppWiringClaim): AppWiringClaim {
  const result = claim.result === undefined ? undefined : Object.freeze({ ...claim.result });
  return Object.freeze({ ...claim, result });
}

async function readClaim(executor: SqlExecutor, fingerprint: string, lock: boolean): Promise<ClaimRow | undefined> {
  const suffix = lock ? " FOR UPDATE" : "";
  return (await executor.query<ClaimRow[]>(
    "SELECT app_wiring_operation_id,request_identity_fingerprint,request_namespace,entrypoint_kind,external_request_id,request_key,payload_fingerprint,route,reason_code,command_code,handler_key,claim_state,result_json,error_code FROM canonical_app_wiring_operations WHERE request_identity_fingerprint=?" + suffix,
    [fingerprint]
  ))[0];
}

function assertReplay(row: ClaimRow, input: AppWiringClaimInput, namespace: string, requestKey: string, payloadFingerprint: string): void {
  if (row.request_namespace !== namespace || row.entrypoint_kind !== input.entrypointKind || row.external_request_id !== input.externalRequestId || row.request_key !== requestKey) throw new Error("APP_WIRING_REQUEST_IDENTITY_DRIFT");
  if (row.payload_fingerprint !== payloadFingerprint) throw new Error("APP_WIRING_PAYLOAD_DRIFT");
}

function createClaimBoundDatabase(database: DatabaseClient, claim: MutableAppWiringClaim, actor: string, now: () => Date): DatabaseClient {
  let mutationStarted = claim.claimState === "MUTATION_STARTED";
  let transition: Promise<void> | undefined;
  const beginMutation = async (executor: Pick<DatabaseTransaction, "execute">): Promise<void> => {
    if (claim.route === "SHADOW") throw new Error("APP_WIRING_SHADOW_WRITE_FORBIDDEN");
    if (claim.claimState === "COMPLETED" || claim.claimState === "FAILED") throw new Error("APP_WIRING_TERMINAL_CLAIM_WRITE_FORBIDDEN");
    if (mutationStarted) return;
    transition ??= (async () => {
      const audit = createObjectAuditValues(actor, now());
      const updated = await executor.execute(
        "UPDATE canonical_app_wiring_operations SET claim_state='MUTATION_STARTED',UPDATE_USER=?,UPDATE_TIME=? WHERE app_wiring_operation_id=? AND claim_state='CLAIMED'",
        [audit.UPDATE_USER, audit.UPDATE_TIME, claim.appWiringOperationId]
      );
      if (updated.affectedRows !== 1n && claim.claimState !== "MUTATION_STARTED") throw new Error("APP_WIRING_MUTATION_TRANSITION_CONFLICT");
      mutationStarted = true;
      claim.claimState = "MUTATION_STARTED";
    })();
    try { await transition; } finally { transition = undefined; }
  };

  return {
    ping: () => database.ping(),
    verifyRollback: () => database.verifyRollback(),
    query: async <T>(sql: string, values: readonly unknown[] = []) => {
      await beginMutation(database);
      return database.query<T>(sql, values);
    },
    execute: async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
      await beginMutation(database);
      return database.execute(sql, values);
    },
    withTransaction: async <T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> => {
      const startedBeforeTransaction = mutationStarted;
      try {
        return await database.withTransaction(async (transaction) => {
          const wrapped: DatabaseTransaction = {
            query: async <R>(sql: string, values: readonly unknown[] = []) => {
              await beginMutation(transaction);
              return transaction.query<R>(sql, values);
            },
            execute: async (sql: string, values: readonly unknown[] = []) => {
              await beginMutation(transaction);
              return transaction.execute(sql, values);
            }
          };
          return work(wrapped);
        });
      } catch (error) {
        if (!startedBeforeTransaction && mutationStarted) {
          mutationStarted = false;
          claim.claimState = "CLAIMED";
        }
        throw error;
      }
    },
    close: () => database.close()
  };
}

export class MariaAppWiringOperationProvider {
  constructor(
    private readonly database: DatabaseClient,
    private readonly environment: VerifiedEnvironmentContext,
    private readonly generate: ObjectIdentityCandidateGenerator = createObjectIdentityCandidate,
    private readonly maxAttempts = OBJECT_IDENTITY_MAX_ATTEMPTS,
    private readonly now: () => Date = () => new Date()
  ) {
    assertVerifiedEnvironmentContext(environment);
  }

  async acquire(input: AppWiringClaimInput, resolveRoute: () => AppWiringRouteDecision | Promise<AppWiringRouteDecision>): Promise<AppWiringExecution> {
    assertInput(input);
    const requestKey = `${input.entrypointKind}:${input.externalRequestId}`;
    const requestIdentityFingerprint = sha256Hex(JSON.stringify([this.environment.requestNamespace, input.entrypointKind, input.externalRequestId]));
    const payloadFingerprint = sha256Hex(serializePayload(input.normalizedPayload));
    let replayed = false;
    const row = await this.database.withTransaction(async (transaction) => {
      const existing = await readClaim(transaction, requestIdentityFingerprint, true);
      if (existing !== undefined) {
        assertReplay(existing, input, this.environment.requestNamespace, requestKey, payloadFingerprint);
        if (existing.claim_state === "CLAIMED" || existing.claim_state === "MUTATION_STARTED") throw new Error("APP_WIRING_REQUEST_IN_PROGRESS");
        replayed = true;
        return existing;
      }
      const decision = await resolveRoute();
      assertDecision(decision);
      const audit = createObjectAuditValues(input.actor, this.now());
      for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
        const candidate = this.generate();
        assertObjectIdentityCandidate(candidate);
        try {
          await transaction.execute(
            "INSERT INTO canonical_app_wiring_operations(app_wiring_operation_id,request_identity_fingerprint,request_namespace,entrypoint_kind,external_request_id,request_key,payload_fingerprint,environment_code,database_identity,route,reason_code,command_code,handler_key,claim_state,result_json,error_code,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'CLAIMED',NULL,NULL,?,?,?,?)",
            [candidate,requestIdentityFingerprint,this.environment.requestNamespace,input.entrypointKind,input.externalRequestId,requestKey,payloadFingerprint,this.environment.environmentCode,this.environment.databaseIdentity,decision.route,decision.reasonCode,decision.commandCode ?? null,decision.handlerKey ?? null,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]
          );
          return (await readClaim(transaction, requestIdentityFingerprint, true))!;
        } catch (error) {
          if (!isDuplicate(error)) throw error;
          const raced = await readClaim(transaction, requestIdentityFingerprint, true);
          if (raced !== undefined) {
            assertReplay(raced, input, this.environment.requestNamespace, requestKey, payloadFingerprint);
            throw new Error("APP_WIRING_REQUEST_IN_PROGRESS");
          }
        }
      }
      throw new Error("APP_WIRING_ID_COLLISION_RETRY_EXHAUSTED");
    });
    const claim = toClaim(row);
    const bound = createClaimBoundDatabase(this.database, claim, input.actor, this.now);
    const finish = async (state: "COMPLETED" | "FAILED", result: AppWiringReceiptResult | undefined, errorCode?: string): Promise<void> => {
      if (claim.claimState === state) return;
      if (claim.claimState === "COMPLETED" || claim.claimState === "FAILED") throw new Error("APP_WIRING_TERMINAL_TRANSITION_FORBIDDEN");
      if (errorCode !== undefined && !/^[A-Z][A-Z0-9_]{0,99}$/.test(errorCode)) throw new Error("APP_WIRING_ERROR_CODE_INVALID");
      const safeResult = result === undefined ? undefined : normalizeSafeResult(result);
      const resultJson = safeResult?.serialized ?? null;
      const audit = createObjectAuditValues(input.actor, this.now());
      const updated = await this.database.execute(
        "UPDATE canonical_app_wiring_operations SET claim_state=?,result_json=?,error_code=?,UPDATE_USER=?,UPDATE_TIME=? WHERE app_wiring_operation_id=? AND claim_state IN ('CLAIMED','MUTATION_STARTED')",
        [state,resultJson,errorCode ?? null,audit.UPDATE_USER,audit.UPDATE_TIME,claim.appWiringOperationId]
      );
      if (updated.affectedRows !== 1n) throw new Error("APP_WIRING_TERMINAL_TRANSITION_CONFLICT");
      claim.claimState = state;
      claim.result = safeResult?.result;
      if (errorCode === undefined) delete claim.errorCode; else claim.errorCode = errorCode;
    };
    return {
      get claim() { return claimSnapshot(claim); },
      database: bound,
      replayed,
      complete: (result) => finish("COMPLETED", result),
      fail: (errorCode) => finish("FAILED", undefined, errorCode)
    };
  }
}
