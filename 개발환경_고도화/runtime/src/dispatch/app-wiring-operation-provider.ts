import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hasConsistentRootTransactionCapability, type CapableDatabaseClient, type ControlledDatabaseTransaction, type DatabaseClient, type DatabaseTransaction, type DatabaseWriteResult, type ReadOnlySnapshotTransaction } from "../database.js";
import { assertReadOnlySqlStatement } from "../database/read-only-sql-boundary.js";
import { OBJECT_IDENTITY_MAX_ATTEMPTS, assertObjectIdentityCandidate, createObjectAuditValues, createObjectIdentityCandidate, type ObjectIdentityCandidateGenerator } from "../identity/object-identity-audit-provider.js";
import { assertVerifiedEnvironmentContext, type VerifiedEnvironmentContext } from "../runtime/environment-context.js";
import { withMariaTransactionRetry } from "../shared/maria-database-error-policy.js";

export type AppWiringEntrypointKind = "IRIS" | "AUTOMATIC" | "ADMIN" | "WEB";
export type AppWiringRoute = "MODERN" | "SHADOW" | "LEGACY_FALLBACK" | "REJECT";
export type AppWiringEffectMode = "READ_ONLY" | "MUTATION";
export type AppWiringClaimState = "CLAIMED" | "MUTATION_STARTED" | "COMPLETED" | "FAILED";
export interface AppWiringReceiptResult { status: string; referenceId?: string; resultFingerprint?: string }
export interface AppWiringClaimInput { entrypointKind: AppWiringEntrypointKind; externalRequestId: string; normalizedPayload: unknown; actor: string }
export interface AppWiringRouteDecision { route: AppWiringRoute; effectMode: AppWiringEffectMode; reasonCode: string; commandCode?: string; handlerKey?: string }
export interface AppWiringClaim {
  readonly appWiringOperationId: string; readonly requestIdentityFingerprint: string; readonly requestNamespace: string;
  readonly entrypointKind: AppWiringEntrypointKind; readonly externalRequestId: string; readonly requestKey: string;
  readonly payloadFingerprint: string; readonly route: AppWiringRoute; readonly effectMode: AppWiringEffectMode;
  readonly reasonCode: string; readonly commandCode?: string; readonly handlerKey?: string; readonly claimState: AppWiringClaimState;
  readonly result?: Readonly<AppWiringReceiptResult>; readonly errorCode?: string;
}
export type AppWiringLegacyTerminalClaim = Omit<AppWiringClaim,"effectMode"> & { readonly claimState: "COMPLETED"|"FAILED"; readonly legacyTerminalMetadata: true };
export type AppWiringReplayClaim = AppWiringClaim | AppWiringLegacyTerminalClaim;
export type AppWiringPreparedClaim = { readonly claim: AppWiringClaim; readonly replayed: false } | { readonly claim: AppWiringReplayClaim; readonly replayed: true };
type ActivePreparedClaim = Extract<AppWiringPreparedClaim,{replayed:false}>;
export interface AppWiringHandlerOutcome<T> { readonly value: T; readonly receipt: AppWiringReceiptResult }
export interface AppWiringIrisReplyDraft {
  readonly eventId: string;
  readonly commandCode: string;
  readonly destinationId: string;
  readonly data: string;
}
export interface AppWiringIrisNoReplyDraft {
  readonly kind: "NO_REPLY";
  readonly eventId: string;
  readonly commandCode: string;
}
export interface AppWiringReadOnlyReplyOutcome<T> extends AppWiringHandlerOutcome<T> {
  readonly reply: AppWiringIrisReplyDraft;
}
export interface AppWiringPersistedReply<T> {
  readonly value: T;
  readonly reply: { readonly outboxId: string; readonly room: string; readonly data: string };
}
export type AppWiringTypedReceipt =
  | { readonly receiptKind: "DAILY_PRAYER"; readonly dailyPrayerOperationId: string; readonly resultFingerprint: string }
  | { readonly receiptKind: "HOME_AGGREGATE"; readonly homeAggregateOperationId: string; readonly resultFingerprint: string }
  | { readonly receiptKind: "MARKET"; readonly marketOperationId: string; readonly resultFingerprint: string }
  | { readonly receiptKind: "MEMBER_TITLE"; readonly memberTitleOperationId: string; readonly resultFingerprint: string }
  | { readonly receiptKind: "MINI_PET_TITLE"; readonly miniPetTitleOperationId: string; readonly resultFingerprint: string }
  | { readonly receiptKind: "PACKAGE_USE"; readonly packageUseOperationId: string; readonly resultFingerprint: string }
  | { readonly receiptKind: "PET_EXPLORE"; readonly petExploreOperationId: string; readonly resultFingerprint: string }
  | { readonly receiptKind: "PET_EXPLORE_EVENT_CONTROL"; readonly petExploreEventControlOperationId: string; readonly resultFingerprint: string }
  | { readonly receiptKind: "PET_TITLE"; readonly petTitleOperationId: string; readonly resultFingerprint: string }
  | { readonly receiptKind: "PET_TITLE_BATCH"; readonly petTitleBatchOperationId: string; readonly resultFingerprint: string }
  | { readonly receiptKind: "PLAYER_IDENTITY"; readonly playerIdentityOperationId: string; readonly resultFingerprint: string };
export interface AppWiringMutationHandlerOutcome<T> {
  readonly value: T;
  readonly receipt: AppWiringReceiptResult & { readonly resultFingerprint: string };
  readonly typedReceipt: AppWiringTypedReceipt;
}
export interface AppWiringMutationReplyOutcome<T> extends AppWiringMutationHandlerOutcome<T> {
  readonly reply: AppWiringIrisReplyDraft;
}
export type AppWiringMutationIrisOutcome<T> =
  | (AppWiringMutationHandlerOutcome<T> & { readonly reply: AppWiringIrisReplyDraft })
  | (AppWiringMutationHandlerOutcome<T> & { readonly noReply: AppWiringIrisNoReplyDraft });
export type AppWiringPersistedMutationIrisOutcome<T> =
  | { readonly value: T; readonly reply: AppWiringPersistedReply<T>["reply"] }
  | { readonly value: T; readonly noReply: { readonly kind: "NO_REPLY" } };
export interface AppWiringMutationReplyContext { readonly operationId: bigint }
export interface AppWiringReadParticipant { query<T>(sql: string, values?: readonly unknown[]): Promise<T> }
export type AppWiringReadOnlyTerminalStatus = "SHADOW_EVALUATED" | "SHADOW_DENIED";
export type AppWiringAtomicReadOnlyShadowResult<T> =
  | { readonly status: "completed"; readonly replayed: false; readonly resultFingerprint: string; readonly terminalStatus: AppWiringReadOnlyTerminalStatus; readonly receiptProjection: unknown; readonly value: T }
  | { readonly status: "completed"; readonly replayed: true; readonly resultFingerprint: string; readonly terminalStatus: AppWiringReadOnlyTerminalStatus; readonly receiptProjection: unknown }
  | { readonly status: "failed"; readonly replayed: boolean; readonly errorCode: string };
export interface AppWiringAtomicReadOnlyEvaluation<T>{readonly value:T;readonly receiptProjection:unknown;readonly terminalStatus?:AppWiringReadOnlyTerminalStatus}
export interface AppWiringMutationParticipant extends AppWiringReadParticipant {
  execute(sql: string, values?: readonly unknown[]): Promise<DatabaseWriteResult>;
  withTransaction<T>(work: (participant: AppWiringMutationParticipant) => Promise<T>): Promise<T>;
}

interface ClaimRow {
  app_wiring_operation_id: string; request_identity_fingerprint: string; request_namespace: string; entrypoint_kind: AppWiringEntrypointKind;
  external_request_id: string; request_key: string; payload_fingerprint: string; route: AppWiringRoute; effect_mode: AppWiringEffectMode | null;
  reason_code: string; command_code: string | null; handler_key: string | null; claim_state: AppWiringClaimState;
  result_json: string | null; error_code: string | null; lease_token: string | null; lease_generation: bigint | number | string | null;
  lease_expires_time: string | null; attempt_count: bigint | number | string | null; recovery_status: string | null; recovery_code: string | null;
}
interface PreparedSecret { leaseToken: string | null; leaseGeneration: bigint; actor: string }
interface ReadOnlyReplyRow {
  operation_id: bigint | number | string;
  idempotency_scope: string;
  idempotency_key: string;
  operation_status: string;
  operation_result_json: string | Record<string, unknown> | null;
  event_id: bigint | number | string;
  command_code: string;
  execution_status: string;
  result_code: string | null;
  outbox_id: bigint | number | string | null;
  provider_code: string | null;
  destination_id: string | null;
  message_type: string | null;
  payload_json: string | { data?: unknown } | null;
}
const secrets = new WeakMap<AppWiringPreparedClaim, PreparedSecret>();
const CLAIM_COLUMNS = "app_wiring_operation_id,request_identity_fingerprint,request_namespace,entrypoint_kind,external_request_id,request_key,payload_fingerprint,route,effect_mode,reason_code,command_code,handler_key,claim_state,result_json,error_code,lease_token,lease_generation,lease_expires_time,attempt_count,recovery_status,recovery_code";

function sha(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function badPayload(): never { throw new Error("APP_WIRING_PAYLOAD_NOT_CANONICAL_JSON"); }
function stableJson(value: unknown): string {
  const ancestors = new WeakSet<object>();
  const visit = (current: unknown, depth: number): string => {
    if (depth > 64) return badPayload();
    if (current === null) return "null";
    if (typeof current === "string") return JSON.stringify(current);
    if (typeof current === "boolean") return current ? "true" : "false";
    if (typeof current === "number") return Number.isFinite(current) ? JSON.stringify(current) : badPayload();
    if (typeof current !== "object" || ancestors.has(current)) return badPayload();
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype) return badPayload();
        const keys = Reflect.ownKeys(current);
        if (keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= current.length))) return badPayload();
        const items: string[] = [];
        for (let i = 0; i < current.length; i += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(i));
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return badPayload();
          items.push(visit(descriptor.value, depth + 1));
        }
        return `[${items.join(",")}]`;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) return badPayload();
      const keys = Reflect.ownKeys(current);
      if (keys.some((key) => typeof key !== "string")) return badPayload();
      const entries: string[] = [];
      for (const key of (keys as string[]).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return badPayload();
        entries.push(`${JSON.stringify(key)}:${visit(descriptor.value, depth + 1)}`);
      }
      return `{${entries.join(",")}}`;
    } catch (error) {
      if (error instanceof Error && error.message === "APP_WIRING_PAYLOAD_NOT_CANONICAL_JSON") throw error;
      return badPayload();
    } finally { ancestors.delete(current); }
  };
  return visit(value, 0);
}
function assertDomainMutation(sql: string): void {
  const statement = sql.trim();
  if (!/^(?:INSERT|UPDATE|DELETE)\b/i.test(statement) || statement.includes(";") || /--|#|\/\*/.test(statement)) throw new Error("APP_WIRING_MUTATION_STATEMENT_FORBIDDEN");
  if (/\bcanonical_app_wiring_operations\b/i.test(statement)) throw new Error("APP_WIRING_CLAIM_TABLE_MUTATION_FORBIDDEN");
  if (/\bcanonical_app_wiring_receipt_links\b/i.test(statement)) throw new Error("APP_WIRING_RECEIPT_LINK_COORDINATOR_ONLY");
}
function assertMutationReplyDomainMutation(sql: string): void {
  assertDomainMutation(sql);
  if (/\b(?:operations|command_executions|outbox_messages)\b/i.test(sql)) throw new Error("APP_WIRING_REPLY_TABLE_COORDINATOR_ONLY");
}
function safeResult(value: AppWiringReceiptResult): { serialized: string; value: Readonly<AppWiringReceiptResult> } {
  if (Object.keys(value).some((key) => !["status", "referenceId", "resultFingerprint"].includes(key))) throw new Error("APP_WIRING_RESULT_KEY_FORBIDDEN");
  const status = value.status, referenceId = value.referenceId, resultFingerprint = value.resultFingerprint;
  if (typeof status !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(status)) throw new Error("APP_WIRING_RESULT_STATUS_INVALID");
  if (referenceId !== undefined && (typeof referenceId !== "string" || !/^[A-Za-z0-9._:@/-]{1,191}$/.test(referenceId))) throw new Error("APP_WIRING_RESULT_REFERENCE_INVALID");
  if (resultFingerprint !== undefined && (typeof resultFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(resultFingerprint))) throw new Error("APP_WIRING_RESULT_FINGERPRINT_INVALID");
  const normalized = Object.freeze({ status, ...(referenceId === undefined ? {} : { referenceId }), ...(resultFingerprint === undefined ? {} : { resultFingerprint }) });
  return { serialized: JSON.stringify(normalized), value: normalized };
}
function validateReadOnlyReplyDraft(reply: AppWiringIrisReplyDraft): void {
  if (reply.eventId.length === 0 || reply.eventId.length > 128) throw new Error("APP_WIRING_REPLY_EVENT_ID_INVALID");
  if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(reply.commandCode)) throw new Error("APP_WIRING_REPLY_COMMAND_CODE_INVALID");
  if (reply.destinationId.length === 0 || reply.destinationId.length > 191) throw new Error("APP_WIRING_REPLY_DESTINATION_INVALID");
  if (reply.data.length === 0) throw new Error("APP_WIRING_REPLY_DATA_INVALID");
}
function validateNoReplyDraft(noReply: AppWiringIrisNoReplyDraft): void {
  if (noReply.kind !== "NO_REPLY") throw new Error("APP_WIRING_NO_REPLY_KIND_INVALID");
  if (noReply.eventId.length === 0 || noReply.eventId.length > 128) throw new Error("APP_WIRING_REPLY_EVENT_ID_INVALID");
  if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(noReply.commandCode)) throw new Error("APP_WIRING_REPLY_COMMAND_CODE_INVALID");
}
function readPayloadData(payload: ReadOnlyReplyRow["payload_json"]): string {
  if (payload === null) throw new Error("APP_WIRING_REPLY_PAYLOAD_INVALID");
  const parsed = typeof payload === "string" ? JSON.parse(payload) as { data?: unknown } : payload;
  if (typeof parsed.data !== "string" || parsed.data.length === 0) throw new Error("APP_WIRING_REPLY_PAYLOAD_INVALID");
  return parsed.data;
}
function parsedResult(value: string | null): Readonly<AppWiringReceiptResult> | undefined {
  if (value === null) return undefined;
  try { return safeResult(JSON.parse(value) as AppWiringReceiptResult).value; } catch { throw new Error("APP_WIRING_RESULT_JSON_INVALID"); }
}
function validateInput(input: AppWiringClaimInput): void {
  if (!/^(IRIS|AUTOMATIC|ADMIN|WEB)$/.test(input.entrypointKind)) throw new Error("APP_WIRING_ENTRYPOINT_INVALID");
  if (!/^[A-Za-z0-9._:@/-]{1,172}$/.test(input.externalRequestId)) throw new Error("APP_WIRING_EXTERNAL_REQUEST_ID_INVALID");
  createObjectAuditValues(input.actor);
}
function validateDecision(decision: AppWiringRouteDecision): void {
  if (!/^(MODERN|SHADOW|LEGACY_FALLBACK|REJECT)$/.test(decision.route)) throw new Error("APP_WIRING_ROUTE_INVALID");
  if (!/^(READ_ONLY|MUTATION)$/.test(decision.effectMode)) throw new Error("APP_WIRING_EFFECT_MODE_INVALID");
  if ((decision.route === "SHADOW" || decision.route === "REJECT") && decision.effectMode !== "READ_ONLY") throw new Error("APP_WIRING_ROUTE_EFFECT_INVALID");
  if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(decision.reasonCode)) throw new Error("APP_WIRING_REASON_CODE_INVALID");
  for (const [field, code] of [[decision.commandCode,"APP_WIRING_COMMAND_CODE_INVALID"],[decision.handlerKey,"APP_WIRING_HANDLER_KEY_INVALID"]] as const) if (field !== undefined && (!/^[A-Za-z0-9_.:-]{1,100}$/.test(field))) throw new Error(code);
  if (decision.route !== "REJECT" && decision.commandCode === undefined && decision.handlerKey === undefined) throw new Error("APP_WIRING_HANDLER_REQUIRED");
}
function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && (("code" in error && String(error.code) === "ER_DUP_ENTRY") || ("message" in error && /duplicate entry/i.test(String(error.message))));
}
function isPrimaryKeyDuplicate(error:unknown):boolean{
  if(!isDuplicate(error)||typeof error!=="object"||error===null)return false;
  const identity="constraint" in error?String(error.constraint):("key" in error?String(error.key):"");
  const message="message" in error?String(error.message):"";
  return identity==="PRIMARY"||/for key\s+['`]?PRIMARY['`]?/i.test(message);
}
function claimFields(row:ClaimRow){return { appWiringOperationId: row.app_wiring_operation_id, requestIdentityFingerprint: row.request_identity_fingerprint,
    requestNamespace: row.request_namespace, entrypointKind: row.entrypoint_kind, externalRequestId: row.external_request_id,
    requestKey: row.request_key, payloadFingerprint: row.payload_fingerprint, route: row.route,
    reasonCode: row.reason_code, ...(row.command_code === null ? {} : { commandCode: row.command_code }),
    ...(row.handler_key === null ? {} : { handlerKey: row.handler_key }), claimState: row.claim_state,
    ...(row.result_json === null ? {} : { result: parsedResult(row.result_json) }), ...(row.error_code === null ? {} : { errorCode: row.error_code }) };}
function toClaim(row: ClaimRow): AppWiringClaim {
  if (row.effect_mode === null) throw new Error("APP_WIRING_LEGACY_METADATA_DRAIN_REQUIRED");
  return Object.freeze({ ...claimFields(row), effectMode:row.effect_mode });
}
function toReplayClaim(row:ClaimRow):AppWiringReplayClaim{
  if(row.effect_mode!==null)return toClaim(row);
  if(row.claim_state!=="COMPLETED"&&row.claim_state!=="FAILED")throw new Error("APP_WIRING_LEGACY_ACTIVE_DRAIN_REQUIRED");
  return Object.freeze({...claimFields(row),claimState:row.claim_state,legacyTerminalMetadata:true});
}
async function readClaim(tx: Pick<ControlledDatabaseTransaction,"query">, fingerprint: string): Promise<ClaimRow | undefined> {
  return (await tx.query<ClaimRow[]>(`SELECT ${CLAIM_COLUMNS} FROM canonical_app_wiring_operations WHERE request_identity_fingerprint=? FOR UPDATE`, [fingerprint]))[0];
}
function checkReplay(row: ClaimRow, input: AppWiringClaimInput, namespace: string, requestKey: string, payload: string): void {
  if (row.request_namespace !== namespace || row.entrypoint_kind !== input.entrypointKind || row.external_request_id !== input.externalRequestId || row.request_key !== requestKey) throw new Error("APP_WIRING_REQUEST_IDENTITY_DRIFT");
  if (row.payload_fingerprint !== payload) throw new Error("APP_WIRING_PAYLOAD_DRIFT");
}
async function assertAtomicRequestEnvironment(tx:Pick<DatabaseTransaction,"query">,namespace:string,input:AppWiringClaimInput):Promise<void>{
  const rows=await tx.query<Array<{request_namespace:string}>>("SELECT request_namespace FROM canonical_app_wiring_operations WHERE entrypoint_kind=? AND external_request_id=? AND request_namespace<>? ORDER BY app_wiring_operation_id LIMIT 1 FOR UPDATE",[input.entrypointKind,input.externalRequestId,namespace]);
  if(rows.length!==0)throw new Error("APP_WIRING_ATOMIC_ENVIRONMENT_DRIFT");
}
async function assertAtomicNoReplyReceipt(tx:Pick<DatabaseTransaction,"query">,row:ClaimRow,receipt:Readonly<AppWiringReceiptResult>,sourceEventId:string,validateReceiptProjection?:(projection:unknown)=>void):Promise<{terminalStatus:AppWiringReadOnlyTerminalStatus;receiptProjection:unknown}>{
  if((receipt.status!=="SHADOW_EVALUATED"&&receipt.status!=="SHADOW_DENIED")||receipt.referenceId===undefined||receipt.resultFingerprint===undefined)throw new Error("APP_WIRING_ATOMIC_COMPLETED_RECEIPT_INVALID");
  const records=await tx.query<Array<{operation_id:bigint|number|string;idempotency_scope:string;idempotency_key:string;operation_status:string;operation_result_json:string|Record<string,unknown>|null;event_id:string;command_code:string;execution_status:string;result_code:string|null;outbox_id:bigint|number|string|null}>>(
    `SELECT operation.id operation_id,operation.idempotency_scope,operation.idempotency_key,operation.status operation_status,operation.result_json operation_result_json,
            execution.event_id,execution.command_code,execution.execution_status,execution.result_code,outbox.id outbox_id
       FROM operations operation JOIN command_executions execution ON execution.operation_id=operation.id LEFT JOIN outbox_messages outbox ON outbox.operation_id=operation.id
      WHERE operation.id=? LIMIT 2 FOR UPDATE`,[receipt.referenceId]);
  if(records.length!==1)throw new Error("APP_WIRING_ATOMIC_NO_REPLY_CARDINALITY_INVALID");
  const record=records[0]!,stored=typeof record.operation_result_json==="string"?JSON.parse(record.operation_result_json)as Record<string,unknown>:record.operation_result_json;
  if(String(record.operation_id)!==receipt.referenceId||record.idempotency_scope!=="app-wiring.read-only-no-reply"||record.idempotency_key!==row.app_wiring_operation_id
    ||record.operation_status!=="completed"||record.command_code!==row.command_code
    ||record.execution_status!=="completed"||record.result_code!==(receipt.status==="SHADOW_DENIED"?"ignored":"no_reply")||record.outbox_id!==null||stored===null
    ||stored.appWiringOperationId!==row.app_wiring_operation_id||stored.requestIdentityFingerprint!==row.request_identity_fingerprint
    ||stored.requestNamespace!==row.request_namespace||stored.payloadFingerprint!==row.payload_fingerprint||stored.eventId!==record.event_id||record.event_id!==sourceEventId
    ||stored.commandCode!==row.command_code||stored.route!==row.route||stored.reasonCode!==row.reason_code||stored.handlerKey!==(row.handler_key??null)
    ||stored.resultFingerprint!==receipt.resultFingerprint||stored.status!==receipt.status||stored.delivery!=="NO_REPLY"
    ||!("receiptProjection" in stored)||sha(stableJson(stored.receiptProjection))!==receipt.resultFingerprint)throw new Error("APP_WIRING_ATOMIC_NO_REPLY_RECEIPT_DRIFT");
  validateReceiptProjection?.(stored.receiptProjection);
  return{terminalStatus:receipt.status,receiptProjection:stored.receiptProjection};
}
type AtomicFailedReceipt={readonly operationId:bigint|number|string;readonly eventId:string};
async function assertAtomicFailedReceipt(tx:Pick<DatabaseTransaction,"query">,row:ClaimRow,sourceEventId:string):Promise<AtomicFailedReceipt>{
  const records=await tx.query<Array<{operation_id:bigint|number|string;idempotency_scope:string;idempotency_key:string;operation_status:string;operation_result_json:string|Record<string,unknown>|null;event_id:string;command_code:string;execution_status:string;result_code:string|null;outbox_id:bigint|number|string|null}>>(
    `SELECT operation.id operation_id,operation.idempotency_scope,operation.idempotency_key,operation.status operation_status,operation.result_json operation_result_json,
            execution.event_id,execution.command_code,execution.execution_status,execution.result_code,outbox.id outbox_id
       FROM operations operation JOIN command_executions execution ON execution.operation_id=operation.id LEFT JOIN outbox_messages outbox ON outbox.operation_id=operation.id
      WHERE operation.idempotency_scope='app-wiring.read-only-no-reply' AND operation.idempotency_key=? LIMIT 2 FOR UPDATE`,[row.app_wiring_operation_id]);
  if(records.length!==1)throw new Error("APP_WIRING_ATOMIC_FAILED_RECEIPT_CARDINALITY_INVALID");
  const record=records[0]!,stored=typeof record.operation_result_json==="string"?JSON.parse(record.operation_result_json)as Record<string,unknown>:record.operation_result_json;
  if(record.operation_status!=="failed"||record.command_code!==row.command_code||record.execution_status!=="failed"||record.outbox_id!==null
    ||record.result_code!==row.error_code||stored===null||stored.appWiringOperationId!==row.app_wiring_operation_id||stored.eventId!==record.event_id||record.event_id!==sourceEventId||stored.errorCode!==row.error_code
    ||stored.status!=="FAILED"||stored.delivery!=="NO_REPLY")throw new Error("APP_WIRING_ATOMIC_FAILED_RECEIPT_DRIFT");
  return{operationId:record.operation_id,eventId:record.event_id};
}
function prepared(row: ClaimRow, replayed: boolean, actor: string): AppWiringPreparedClaim {
  const value:AppWiringPreparedClaim = replayed ? Object.freeze({claim:toReplayClaim(row),replayed:true}) : Object.freeze({claim:toClaim(row),replayed:false});
  secrets.set(value, { leaseToken: row.lease_token, leaseGeneration: row.lease_generation === null ? 0n : BigInt(row.lease_generation), actor });
  return value;
}
function getSecret(value: AppWiringPreparedClaim, effect?: AppWiringEffectMode): PreparedSecret {
  const secret = secrets.get(value);
  if (secret === undefined) throw new Error("APP_WIRING_PREPARED_CLAIM_INVALID");
  if (value.replayed) throw new Error("APP_WIRING_REPLAY_EXECUTION_FORBIDDEN");
  if (effect !== undefined && value.claim.effectMode !== effect) throw new Error("APP_WIRING_EFFECT_EXECUTION_MISMATCH");
  if (secret.leaseToken === null) throw new Error("APP_WIRING_LEASE_MISSING");
  return secret;
}
function exactTerminalIdentity(row:ClaimRow|undefined,claim:AppWiringClaim,secret:PreparedSecret):row is ClaimRow{return row!==undefined&&row.app_wiring_operation_id===claim.appWiringOperationId&&row.request_identity_fingerprint===claim.requestIdentityFingerprint&&row.payload_fingerprint===claim.payloadFingerprint&&row.lease_generation!==null&&BigInt(row.lease_generation)===secret.leaseGeneration;}

type ReceiptBinding = { kind: string; column: string; table: string; statusColumn:string; operationId: string; fingerprint: string; position: number };
const RECEIPT_BINDINGS = {
  DAILY_PRAYER: ["daily_prayer_operation_id","canonical_daily_prayer_operations","operation_status","dailyPrayerOperationId",0],
  HOME_AGGREGATE: ["home_aggregate_operation_id","canonical_home_aggregate_operations","operation_status","homeAggregateOperationId",1],
  MARKET: ["market_operation_id","canonical_market_operations","operation_status","marketOperationId",2],
  MEMBER_TITLE: ["member_title_operation_id","canonical_member_title_operations","operation_status","memberTitleOperationId",3],
  MINI_PET_TITLE: ["mini_pet_title_operation_id","canonical_mini_pet_title_operations","operation_status","miniPetTitleOperationId",4],
  PACKAGE_USE: ["package_use_operation_id","canonical_package_use_operations","operation_status","packageUseOperationId",5],
  PET_EXPLORE: ["pet_explore_operation_id","canonical_pet_explore_operations","operation_status","petExploreOperationId",6],
  PET_EXPLORE_EVENT_CONTROL: ["pet_explore_event_control_operation_id","canonical_pet_explore_event_control_operations","operation_status","petExploreEventControlOperationId",7],
  PET_TITLE: ["pet_title_operation_id","canonical_pet_title_operations","operation_status","petTitleOperationId",8],
  PET_TITLE_BATCH: ["pet_title_batch_operation_id","canonical_pet_title_batch_operations","operation_status","petTitleBatchOperationId",9],
  PLAYER_IDENTITY: ["player_identity_operation_id","canonical_player_identity_operations","operation_status","playerIdentityOperationId",10]
} as const;
const RECEIPT_ID_COLUMNS = Object.values(RECEIPT_BINDINGS).map((binding) => binding[0]);
function receiptBinding(receipt: AppWiringTypedReceipt): ReceiptBinding {
  if (typeof receipt !== "object" || receipt === null || !("receiptKind" in receipt) || typeof receipt.receiptKind !== "string" || !(receipt.receiptKind in RECEIPT_BINDINGS)) throw new Error("APP_WIRING_TYPED_RECEIPT_REQUIRED");
  const binding = RECEIPT_BINDINGS[receipt.receiptKind as keyof typeof RECEIPT_BINDINGS];
  const operationId = receipt[binding[3] as keyof typeof receipt];
  if (typeof operationId !== "string") throw new Error("APP_WIRING_TYPED_RECEIPT_INVALID");
  assertObjectIdentityCandidate(operationId);
  if (!/^[0-9a-f]{64}$/.test(receipt.resultFingerprint)) throw new Error("APP_WIRING_TYPED_RECEIPT_FINGERPRINT_INVALID");
  return { kind: receipt.receiptKind, column: binding[0], table: binding[1], statusColumn:binding[2], operationId, fingerprint: receipt.resultFingerprint, position: binding[4] };
}

async function assertStoredMutationReceipt(tx:ControlledDatabaseTransaction,row:ClaimRow):Promise<void>{
  const result=parsedResult(row.result_json);
  if(result?.resultFingerprint===undefined)throw new Error("APP_WIRING_REPLAY_RESULT_FINGERPRINT_REQUIRED");
  const links=await tx.query<Array<Record<string,unknown>>>(`SELECT canonical_app_wiring_receipt_link_id,app_wiring_operation_id,receipt_kind,result_fingerprint,${RECEIPT_ID_COLUMNS.join(",")} FROM canonical_app_wiring_receipt_links WHERE app_wiring_operation_id=? FOR UPDATE`,[row.app_wiring_operation_id]);
  if(links.length!==1)throw new Error("APP_WIRING_REPLAY_RECEIPT_LINK_CARDINALITY_INVALID");
  const link=links[0]!;
  const kind=typeof link.receipt_kind==="string"?link.receipt_kind:"";
  if(!(kind in RECEIPT_BINDINGS))throw new Error("APP_WIRING_REPLAY_RECEIPT_KIND_INVALID");
  const binding=RECEIPT_BINDINGS[kind as keyof typeof RECEIPT_BINDINGS];
  const operationId=link[binding[0]];
  if(typeof operationId!=="string")throw new Error("APP_WIRING_REPLAY_TYPED_RECEIPT_ID_INVALID");
  assertObjectIdentityCandidate(operationId);
  if(result.referenceId!==undefined&&result.referenceId!==operationId)throw new Error("APP_WIRING_REPLAY_REFERENCE_ID_MISMATCH");
  if(link.app_wiring_operation_id!==row.app_wiring_operation_id||link.result_fingerprint!==result.resultFingerprint||!RECEIPT_ID_COLUMNS.every((column,index)=>link[column]===(index===binding[4]?operationId:null)))throw new Error("APP_WIRING_REPLAY_RECEIPT_LINK_MISMATCH");
  const typed=(await tx.query<Array<{result_fingerprint:string;operation_status:string}>>(`SELECT result_fingerprint,${binding[2]} operation_status FROM ${binding[1]} WHERE ${binding[0]}=? FOR UPDATE`,[operationId]))[0];
  if(typed===undefined)throw new Error("APP_WIRING_REPLAY_TYPED_RECEIPT_NOT_FOUND");
  if(typed.operation_status!=="COMPLETED")throw new Error("APP_WIRING_REPLAY_TYPED_RECEIPT_NOT_COMPLETED");
  if(typed.result_fingerprint!==result.resultFingerprint)throw new Error("APP_WIRING_REPLAY_TYPED_RECEIPT_FINGERPRINT_MISMATCH");
  if(kind==="PET_TITLE_BATCH")await assertStoredPetTitleBatchReceipt(tx,operationId,result.resultFingerprint);
}

// PET_TITLE batch 재생 전에 header와 정확 대상·참여자 집합을 다시 해시해 하위 증거 변조를 차단합니다.
async function assertStoredPetTitleBatchReceipt(tx:ControlledDatabaseTransaction,operationId:string,resultFingerprint:string):Promise<void>{
  const header=(await tx.query<Array<{operation_type:string;result_contract_version:string;affected_player_count:bigint|string;affected_title_count:bigint|string;target_count:bigint|string;target_set_fingerprint:string;result_fingerprint:string;operation_status:string}>>(
    "SELECT operation_type,result_contract_version,affected_player_count,affected_title_count,target_count,target_set_fingerprint,result_fingerprint,operation_status FROM canonical_pet_title_batch_operations WHERE pet_title_batch_operation_id=? FOR UPDATE",
    [operationId],
  ))[0];
  if(header===undefined||header.operation_status!=="COMPLETED"||header.result_fingerprint!==resultFingerprint)throw new Error("APP_WIRING_REPLAY_PET_TITLE_BATCH_HEADER_INVALID");
  if(header.operation_type!=="ADMIN_RESET"&&header.operation_type!=="ADMIN_SYNC")throw new Error("APP_WIRING_REPLAY_PET_TITLE_BATCH_OPERATION_INVALID");
  if(!((header.result_contract_version==="LEGACY")
    ||(header.result_contract_version==="MEMBER_KEY_V1"&&header.operation_type==="ADMIN_SYNC")
    ||(header.result_contract_version==="RESET_V1"&&header.operation_type==="ADMIN_RESET")))throw new Error("APP_WIRING_REPLAY_PET_TITLE_BATCH_CONTRACT_INVALID");
  const targetRows=await tx.query<Array<{player_id:string;member_key_before:string|null;acquisition_sequence:bigint|string;owned_pet_title_id:string;selection_status_before:string;reason_type:string}>>(
    "SELECT player_id,member_key_before,acquisition_sequence,owned_pet_title_id,selection_status_before,reason_type FROM canonical_pet_title_batch_operation_targets WHERE pet_title_batch_operation_id=? ORDER BY player_id,acquisition_sequence,owned_pet_title_id FOR UPDATE",
    [operationId],
  );
  const targets=targetRows.map(target=>({playerId:target.player_id,memberKeyBefore:target.member_key_before,acquisitionSequence:String(target.acquisition_sequence),ownedPetTitleId:target.owned_pet_title_id,selected:target.selection_status_before==="SELECTED"}));
  if(targetRows.some(target=>(target.member_key_before!==null&&(Array.from(target.member_key_before).length===0||Array.from(target.member_key_before).length>255))||(header.result_contract_version==="MEMBER_KEY_V1"&&target.member_key_before===null)||(target.selection_status_before!=="SELECTED"&&target.selection_status_before!=="NOT_SELECTED")||target.reason_type!==header.operation_type))throw new Error("APP_WIRING_REPLAY_PET_TITLE_BATCH_TARGET_INVALID");
  const fingerprintTargets=header.result_contract_version==="MEMBER_KEY_V1"?targets:targets.map(({memberKeyBefore:_,...legacyTarget})=>legacyTarget);
  const targetSetFingerprint=sha(JSON.stringify({targets:fingerprintTargets}));
  if(BigInt(header.target_count)!==BigInt(targets.length)||BigInt(header.affected_title_count)!==BigInt(targets.length)||header.target_set_fingerprint!==targetSetFingerprint)throw new Error("APP_WIRING_REPLAY_PET_TITLE_BATCH_TARGET_DRIFT");
  const expectedCounts=new Map<string,bigint>();
  for(const target of targets)expectedCounts.set(target.playerId,(expectedCounts.get(target.playerId)??0n)+1n);
  const participants=await tx.query<Array<{player_id:string;participant_role:string;affected_title_count:bigint|string}>>(
    "SELECT player_id,participant_role,affected_title_count FROM canonical_pet_title_batch_operation_participants WHERE pet_title_batch_operation_id=? ORDER BY player_id FOR UPDATE",
    [operationId],
  );
  const affectedPlayerIds=[...expectedCounts.keys()].sort();
  const affectedMemberKeys=header.result_contract_version==="MEMBER_KEY_V1"?affectedPlayerIds.map(playerId=>{
    const memberKeys=new Set(targets.filter(target=>target.playerId===playerId).map(target=>target.memberKeyBefore));
    if(memberKeys.size!==1||memberKeys.has(null))throw new Error("APP_WIRING_REPLAY_PET_TITLE_BATCH_MEMBER_KEY_DRIFT");
    return [...memberKeys][0]!;
  }):[];
  if(BigInt(header.affected_player_count)!==BigInt(affectedPlayerIds.length)||participants.length!==affectedPlayerIds.length
    ||participants.some((participant,index)=>participant.player_id!==affectedPlayerIds[index]||participant.participant_role!=="AFFECTED_OWNER"||BigInt(participant.affected_title_count)!==expectedCounts.get(participant.player_id)))throw new Error("APP_WIRING_REPLAY_PET_TITLE_BATCH_PARTICIPANT_DRIFT");
  const projection=header.result_contract_version==="MEMBER_KEY_V1"
    ?{operationType:header.operation_type,affectedPlayerIds,affectedMemberKeys,affectedPlayerCount:affectedPlayerIds.length,affectedTitleCount:targets.length,targetSetFingerprint}
    :{operationType:header.operation_type,affectedPlayerIds,affectedPlayerCount:affectedPlayerIds.length,affectedTitleCount:targets.length,targetSetFingerprint};
  if(sha(JSON.stringify(projection))!==resultFingerprint)throw new Error("APP_WIRING_REPLAY_PET_TITLE_BATCH_RESULT_DRIFT");
}

export class MariaAppWiringOperationProvider {
  constructor(private readonly database: CapableDatabaseClient, private readonly environment: VerifiedEnvironmentContext,
    private readonly generate: ObjectIdentityCandidateGenerator = createObjectIdentityCandidate,
    private readonly maxAttempts = OBJECT_IDENTITY_MAX_ATTEMPTS, private readonly now: () => Date = () => new Date(),
    private readonly generateLeaseToken: () => string = () => randomBytes(32).toString("hex"), private readonly leaseDurationMs = 30_000) {
    assertVerifiedEnvironmentContext(environment);
  }

  // 공용 recovery coordinator가 동일한 verified DB 객체만 사용하도록 고정합니다.
  assertRecoveryDatabase(database:DatabaseClient):void{if(database!==this.database)throw new Error("APP_WIRING_RECOVERY_DATABASE_BINDING_MISMATCH");if(!hasConsistentRootTransactionCapability(this.database))throw new Error("APP_WIRING_RECOVERY_ROOT_TRANSACTION_REQUIRED");}

  // app-wiring provider가 자기 verified DB의 exact transient root retry를 소유합니다.
  withAtomicReadOnlyRootRetry<T>(work:(transaction:DatabaseTransaction,attemptNumber:number)=>Promise<T>):Promise<T>{
    if(!hasConsistentRootTransactionCapability(this.database))throw new Error("APP_WIRING_RECOVERY_ROOT_TRANSACTION_REQUIRED");
    return withMariaTransactionRetry(this.database,{maxAttempts:3,allowRetry:kind=>kind==="TRANSACTION_DEADLOCK"||kind==="TRANSACTION_LOCK_WAIT_TIMEOUT",exhaustedErrorCode:"APP_WIRING_READ_ONLY_RETRY_EXHAUSTED",rootTransaction:this.database.withConsistentRootTransaction.bind(this.database)},work);
  }

  // 실패 terminal 기록도 같은 verified DB에서 exact transient만 제한 재시도합니다.
  withAtomicReadOnlyFailureRetry<T>(work:(transaction:DatabaseTransaction,attemptNumber:number)=>Promise<T>):Promise<T>{
    if(!hasConsistentRootTransactionCapability(this.database))throw new Error("APP_WIRING_RECOVERY_ROOT_TRANSACTION_REQUIRED");
    return withMariaTransactionRetry(this.database,{maxAttempts:3,allowRetry:kind=>kind==="TRANSACTION_DEADLOCK"||kind==="TRANSACTION_LOCK_WAIT_TIMEOUT",exhaustedErrorCode:"APP_WIRING_READ_ONLY_FAILURE_PERSIST_RETRY_EXHAUSTED",rootTransaction:this.database.withConsistentRootTransaction.bind(this.database)},work);
  }

  // 상위 event transaction 안에서 SHADOW 조회와 NO_REPLY terminal receipt를 원자 확정합니다.
  async executeAtomicReadOnlyShadowInTransaction<T>(transaction:DatabaseTransaction,input:{
    claim:AppWiringClaimInput;decision:AppWiringRouteDecision;sourceEventId:string;attemptCount:number;duplicateClaim:boolean;
    evaluate:(database:AppWiringReadParticipant,claim:AppWiringClaim)=>Promise<AppWiringAtomicReadOnlyEvaluation<T>>;
    validateReceiptProjection?:(projection:unknown)=>void;
  }):Promise<AppWiringAtomicReadOnlyShadowResult<T>>{
    validateInput(input.claim);validateDecision(input.decision);
    if(input.decision.route!=="SHADOW"||input.decision.effectMode!=="READ_ONLY")throw new Error("APP_WIRING_ATOMIC_READ_ONLY_SHADOW_ROUTE_REQUIRED");
    if(input.decision.commandCode===undefined)throw new Error("APP_WIRING_ATOMIC_COMMAND_CODE_REQUIRED");
    if(input.sourceEventId.length===0||input.sourceEventId.length>128)throw new Error("APP_WIRING_ATOMIC_EVENT_ID_INVALID");
    if(!Number.isInteger(input.attemptCount)||input.attemptCount<1||input.attemptCount>8)throw new Error("APP_WIRING_ATOMIC_ATTEMPT_COUNT_INVALID");
    const requestKey=`${input.claim.entrypointKind}:${input.claim.externalRequestId}`;
    const fingerprint=sha(JSON.stringify([this.environment.requestNamespace,input.claim.entrypointKind,input.claim.externalRequestId]));
    const payload=sha(stableJson(input.claim.normalizedPayload));
    await assertAtomicRequestEnvironment(transaction,this.environment.requestNamespace,input.claim);
    const found=await readClaim(transaction,fingerprint);
    let operationId:string|undefined,failedReceipt:AtomicFailedReceipt|undefined,token:string|undefined,generation=1n,totalAttemptCount=BigInt(input.attemptCount);
    if(found!==undefined){
      checkReplay(found,input.claim,this.environment.requestNamespace,requestKey,payload);
      if(found.route!==input.decision.route||found.effect_mode!=="READ_ONLY"||found.reason_code!==input.decision.reasonCode
        ||found.command_code!==(input.decision.commandCode??null)||found.handler_key!==(input.decision.handlerKey??null))throw new Error("APP_WIRING_ATOMIC_ROUTE_DRIFT");
      if(found.claim_state==="FAILED"){
        failedReceipt=await assertAtomicFailedReceipt(transaction,found,input.sourceEventId);
        if(found.error_code!=="APP_WIRING_READ_ONLY_RETRY_EXHAUSTED")return{status:"failed",replayed:true,errorCode:found.error_code??"APP_WIRING_ATOMIC_FAILED_RECEIPT_INVALID"};
        if(found.lease_generation===null||found.attempt_count===null)throw new Error("APP_WIRING_ATOMIC_FAILED_METADATA_INVALID");
        token=this.generateLeaseToken();if(!/^[0-9a-f]{64}$/.test(token))throw new Error("APP_WIRING_LEASE_TOKEN_INVALID");
        generation=BigInt(found.lease_generation)+1n;totalAttemptCount=BigInt(found.attempt_count)+BigInt(input.attemptCount);
        const reclaimed=await transaction.execute("UPDATE canonical_app_wiring_operations SET claim_state='CLAIMED',result_json=NULL,error_code=NULL,lease_token=?,lease_generation=?,lease_expires_time=?,attempt_count=?,recovery_status='RECOVERED',recovery_code='TRANSIENT_EXHAUSTED_RESTART',UPDATE_USER=?,UPDATE_TIME=? WHERE app_wiring_operation_id=? AND claim_state='FAILED' AND error_code='APP_WIRING_READ_ONLY_RETRY_EXHAUSTED' AND lease_generation=?",[token,generation,createObjectAuditValues(input.claim.actor,this.now()).UPDATE_TIME,totalAttemptCount,createObjectAuditValues(input.claim.actor,this.now()).UPDATE_USER,createObjectAuditValues(input.claim.actor,this.now()).UPDATE_TIME,found.app_wiring_operation_id,found.lease_generation]);
        if(reclaimed.affectedRows!==1n)throw new Error("APP_WIRING_ATOMIC_FAILED_RECLAIM_CONFLICT");operationId=found.app_wiring_operation_id;
      }else{
      if(found.claim_state!=="COMPLETED")throw new Error("APP_WIRING_ATOMIC_NON_TERMINAL_CLAIM");
      const receipt=parsedResult(found.result_json);
      if(receipt===undefined)throw new Error("APP_WIRING_ATOMIC_COMPLETED_RECEIPT_INVALID");const persisted=await assertAtomicNoReplyReceipt(transaction,found,receipt,input.sourceEventId,input.validateReceiptProjection);
      return{status:"completed",replayed:true,resultFingerprint:receipt.resultFingerprint!,...persisted};
      }
    }
    if(found===undefined&&input.duplicateClaim)throw new Error("ATOMIC_EVENT_WITHOUT_RECEIPT_RECOVERY_REQUIRED");
    const audit=createObjectAuditValues(input.claim.actor,this.now());
    if(token===undefined){token=this.generateLeaseToken();if(!/^[0-9a-f]{64}$/.test(token))throw new Error("APP_WIRING_LEASE_TOKEN_INVALID");}
    for(let attempt=0;operationId===undefined&&attempt<this.maxAttempts;attempt+=1){
      const candidate=this.generate();assertObjectIdentityCandidate(candidate);
      try{
        await transaction.execute("INSERT INTO canonical_app_wiring_operations(app_wiring_operation_id,request_identity_fingerprint,request_namespace,entrypoint_kind,external_request_id,request_key,payload_fingerprint,environment_code,database_identity,route,reason_code,command_code,handler_key,claim_state,effect_mode,lease_token,lease_generation,lease_expires_time,attempt_count,recovery_status,recovery_code,result_json,error_code,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'CLAIMED','READ_ONLY',?,1,?,?,'NONE',NULL,NULL,NULL,?,?,?,?)",[candidate,fingerprint,this.environment.requestNamespace,input.claim.entrypointKind,input.claim.externalRequestId,requestKey,payload,this.environment.environmentCode,this.environment.databaseIdentity,input.decision.route,input.decision.reasonCode,input.decision.commandCode??null,input.decision.handlerKey??null,token,audit.UPDATE_TIME,totalAttemptCount,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);
        operationId=candidate;break;
      }catch(error){if(!isPrimaryKeyDuplicate(error))throw error;}
    }
    if(operationId===undefined)throw new Error("APP_WIRING_ID_COLLISION_RETRY_EXHAUSTED");
    const claim=Object.freeze({appWiringOperationId:operationId,requestIdentityFingerprint:fingerprint,requestNamespace:this.environment.requestNamespace,
      entrypointKind:input.claim.entrypointKind,externalRequestId:input.claim.externalRequestId,requestKey,payloadFingerprint:payload,
      route:input.decision.route,effectMode:"READ_ONLY" as const,reasonCode:input.decision.reasonCode,
      ...(input.decision.commandCode===undefined?{}:{commandCode:input.decision.commandCode}),...(input.decision.handlerKey===undefined?{}:{handlerKey:input.decision.handlerKey}),claimState:"CLAIMED" as const});
    const evaluation=await input.evaluate(this.readParticipant(transaction),claim);
    input.validateReceiptProjection?.(evaluation.receiptProjection);
    const terminalStatus=evaluation.terminalStatus??"SHADOW_EVALUATED";
    if(terminalStatus!=="SHADOW_EVALUATED"&&terminalStatus!=="SHADOW_DENIED")throw new Error("APP_WIRING_ATOMIC_TERMINAL_STATUS_INVALID");
    const resultFingerprint=sha(stableJson(evaluation.receiptProjection));
    let receiptOperationId:bigint|number|string;
    if(failedReceipt===undefined){
      const operation=await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'app-wiring.read-only-no-reply',?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),operationId]);
      receiptOperationId=operation.insertId;
      const executionSql=terminalStatus==="SHADOW_DENIED"
        ?"INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','ignored',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"
        :"INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','no_reply',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))";
      await transaction.execute(executionSql,[input.sourceEventId,input.decision.commandCode,receiptOperationId]);
    }else{
      if(failedReceipt.eventId!==input.sourceEventId)throw new Error("APP_WIRING_ATOMIC_FAILED_RECEIPT_EVENT_DRIFT");
      receiptOperationId=failedReceipt.operationId;
      const operationReclaimed=await transaction.execute("UPDATE operations SET status='processing',result_json=NULL,completed_at=NULL WHERE id=? AND idempotency_scope='app-wiring.read-only-no-reply' AND idempotency_key=? AND status='failed'",[receiptOperationId,operationId]);
      if(operationReclaimed.affectedRows!==1n)throw new Error("APP_WIRING_ATOMIC_FAILED_OPERATION_RECLAIM_CONFLICT");
      const executionReclaimSql=terminalStatus==="SHADOW_DENIED"
        ?"UPDATE command_executions SET execution_status='completed',result_code='ignored',completed_at=UTC_TIMESTAMP(3) WHERE operation_id=? AND event_id=? AND command_code=? AND execution_status='failed' AND result_code='APP_WIRING_READ_ONLY_RETRY_EXHAUSTED'"
        :"UPDATE command_executions SET execution_status='completed',result_code='no_reply',completed_at=UTC_TIMESTAMP(3) WHERE operation_id=? AND event_id=? AND command_code=? AND execution_status='failed' AND result_code='APP_WIRING_READ_ONLY_RETRY_EXHAUSTED'";
      const executionReclaimed=await transaction.execute(executionReclaimSql,[receiptOperationId,input.sourceEventId,input.decision.commandCode]);
      if(executionReclaimed.affectedRows!==1n)throw new Error("APP_WIRING_ATOMIC_FAILED_EXECUTION_RECLAIM_CONFLICT");
    }
    const operationResult=JSON.stringify({appWiringOperationId:operationId,requestIdentityFingerprint:fingerprint,requestNamespace:this.environment.requestNamespace,
      payloadFingerprint:payload,eventId:input.sourceEventId,commandCode:input.decision.commandCode,route:input.decision.route,
      reasonCode:input.decision.reasonCode,handlerKey:input.decision.handlerKey??null,resultFingerprint,receiptProjection:evaluation.receiptProjection,status:terminalStatus,delivery:"NO_REPLY"});
    const operationTerminal=await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=? AND status='processing'",[operationResult,receiptOperationId]);
    if(operationTerminal.affectedRows!==1n)throw new Error("APP_WIRING_ATOMIC_NO_REPLY_OPERATION_CONFLICT");
    const receipt=safeResult({status:terminalStatus,referenceId:receiptOperationId.toString(),resultFingerprint});
    const terminal=await transaction.execute("UPDATE canonical_app_wiring_operations SET claim_state='COMPLETED',result_json=?,error_code=NULL,lease_token=NULL,lease_expires_time=NULL,recovery_status='NONE',recovery_code=NULL,UPDATE_USER=?,UPDATE_TIME=? WHERE app_wiring_operation_id=? AND claim_state='CLAIMED' AND lease_token=? AND lease_generation=?",[receipt.serialized,audit.UPDATE_USER,audit.UPDATE_TIME,operationId,token,generation]);
    if(terminal.affectedRows!==1n)throw new Error("APP_WIRING_ATOMIC_TERMINAL_TRANSITION_CONFLICT");
    return{status:"completed",replayed:false,resultFingerprint,terminalStatus,receiptProjection:evaluation.receiptProjection,value:evaluation.value};
  }

  // 최종 실패를 같은 request identity의 durable FAILED terminal로 기록합니다.
  async recordAtomicReadOnlyShadowFailureInTransaction(transaction:DatabaseTransaction,input:{claim:AppWiringClaimInput;decision:AppWiringRouteDecision;sourceEventId:string;attemptCount:number;errorCode:string;validateReceiptProjection?:(projection:unknown)=>void}):Promise<AppWiringAtomicReadOnlyShadowResult<never>>{
    validateInput(input.claim);validateDecision(input.decision);
    if(input.decision.route!=="SHADOW"||input.decision.effectMode!=="READ_ONLY")throw new Error("APP_WIRING_ATOMIC_READ_ONLY_SHADOW_ROUTE_REQUIRED");
    if(input.decision.commandCode===undefined)throw new Error("APP_WIRING_ATOMIC_COMMAND_CODE_REQUIRED");
    if(input.sourceEventId.length===0||input.sourceEventId.length>128)throw new Error("APP_WIRING_ATOMIC_EVENT_ID_INVALID");
    if(!Number.isInteger(input.attemptCount)||input.attemptCount<1||input.attemptCount>8)throw new Error("APP_WIRING_ATOMIC_ATTEMPT_COUNT_INVALID");
    if(!/^[A-Z][A-Z0-9_]{0,63}$/.test(input.errorCode))throw new Error("APP_WIRING_ATOMIC_ERROR_CODE_INVALID");
    const requestKey=`${input.claim.entrypointKind}:${input.claim.externalRequestId}`;
    const fingerprint=sha(JSON.stringify([this.environment.requestNamespace,input.claim.entrypointKind,input.claim.externalRequestId]));
    const payload=sha(stableJson(input.claim.normalizedPayload));
    await assertAtomicRequestEnvironment(transaction,this.environment.requestNamespace,input.claim);
    const found=await readClaim(transaction,fingerprint);
    if(found!==undefined){
      checkReplay(found,input.claim,this.environment.requestNamespace,requestKey,payload);
      if(found.route!==input.decision.route||found.effect_mode!=="READ_ONLY"||found.reason_code!==input.decision.reasonCode
        ||found.command_code!==(input.decision.commandCode??null)||found.handler_key!==(input.decision.handlerKey??null))throw new Error("APP_WIRING_ATOMIC_ROUTE_DRIFT");
      if(found.claim_state==="FAILED"){
        const failedReceipt=await assertAtomicFailedReceipt(transaction,found,input.sourceEventId);
        if(found.error_code==="APP_WIRING_READ_ONLY_RETRY_EXHAUSTED"){
          if(found.attempt_count===null||found.lease_generation===null)throw new Error("APP_WIRING_ATOMIC_FAILED_METADATA_INVALID");
          const audit=createObjectAuditValues(input.claim.actor,this.now());
          const nextError=input.errorCode;
          if(nextError!==found.error_code){
            const failedResult=JSON.stringify({appWiringOperationId:found.app_wiring_operation_id,eventId:input.sourceEventId,errorCode:nextError,status:"FAILED",delivery:"NO_REPLY"});
            const operationUpdated=await transaction.execute("UPDATE operations SET result_json=? WHERE id=? AND status='failed' AND idempotency_scope='app-wiring.read-only-no-reply' AND idempotency_key=?",[failedResult,failedReceipt.operationId,found.app_wiring_operation_id]);
            if(operationUpdated.affectedRows!==1n)throw new Error("APP_WIRING_ATOMIC_FAILED_OPERATION_UPDATE_CONFLICT");
            const executionUpdated=await transaction.execute("UPDATE command_executions SET result_code=? WHERE operation_id=? AND event_id=? AND command_code=? AND execution_status='failed' AND result_code='APP_WIRING_READ_ONLY_RETRY_EXHAUSTED'",[nextError,failedReceipt.operationId,input.sourceEventId,input.decision.commandCode]);
            if(executionUpdated.affectedRows!==1n)throw new Error("APP_WIRING_ATOMIC_FAILED_EXECUTION_UPDATE_CONFLICT");
          }
          const updated=await transaction.execute("UPDATE canonical_app_wiring_operations SET error_code=?,attempt_count=?,lease_generation=?,recovery_status='RECOVERED',recovery_code='TRANSIENT_EXHAUSTED_RESTART',UPDATE_USER=?,UPDATE_TIME=? WHERE app_wiring_operation_id=? AND claim_state='FAILED' AND error_code='APP_WIRING_READ_ONLY_RETRY_EXHAUSTED' AND attempt_count=? AND lease_generation=?",[nextError,BigInt(found.attempt_count)+BigInt(input.attemptCount),BigInt(found.lease_generation)+1n,audit.UPDATE_USER,audit.UPDATE_TIME,found.app_wiring_operation_id,found.attempt_count,found.lease_generation]);
          if(updated.affectedRows!==1n)throw new Error("APP_WIRING_ATOMIC_FAILED_RETRY_RECORD_CONFLICT");
          return{status:"failed",replayed:true,errorCode:nextError};
        }
        return{status:"failed",replayed:true,errorCode:found.error_code??"APP_WIRING_ATOMIC_FAILED_RECEIPT_INVALID"};
      }
      if(found.claim_state!=="COMPLETED")throw new Error("APP_WIRING_ATOMIC_NON_TERMINAL_CLAIM");
      const receipt=parsedResult(found.result_json);
      if(receipt===undefined)throw new Error("APP_WIRING_ATOMIC_COMPLETED_RECEIPT_INVALID");const persisted=await assertAtomicNoReplyReceipt(transaction,found,receipt,input.sourceEventId,input.validateReceiptProjection);
      return{status:"completed",replayed:true,resultFingerprint:receipt.resultFingerprint!,...persisted};
    }
    const audit=createObjectAuditValues(input.claim.actor,this.now());
    for(let attempt=0;attempt<this.maxAttempts;attempt+=1){
      const candidate=this.generate();assertObjectIdentityCandidate(candidate);
      try{
        await transaction.execute("INSERT INTO canonical_app_wiring_operations(app_wiring_operation_id,request_identity_fingerprint,request_namespace,entrypoint_kind,external_request_id,request_key,payload_fingerprint,environment_code,database_identity,route,reason_code,command_code,handler_key,claim_state,effect_mode,lease_token,lease_generation,lease_expires_time,attempt_count,recovery_status,recovery_code,result_json,error_code,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'FAILED','READ_ONLY',NULL,0,NULL,?,'NONE',NULL,NULL,?,?,?,?,?)",[candidate,fingerprint,this.environment.requestNamespace,input.claim.entrypointKind,input.claim.externalRequestId,requestKey,payload,this.environment.environmentCode,this.environment.databaseIdentity,input.decision.route,input.decision.reasonCode,input.decision.commandCode??null,input.decision.handlerKey??null,input.attemptCount,input.errorCode,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);
        const operation=await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,result_json,created_at,completed_at) VALUES (?,'app-wiring.read-only-no-reply',?,'external_identity',NULL,'iris','failed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[randomUUID(),candidate,JSON.stringify({appWiringOperationId:candidate,eventId:input.sourceEventId,errorCode:input.errorCode,status:"FAILED",delivery:"NO_REPLY"})]);
        await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'failed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.sourceEventId,input.decision.commandCode,operation.insertId,input.errorCode]);
        return{status:"failed",replayed:false,errorCode:input.errorCode};
      }catch(error){if(!isPrimaryKeyDuplicate(error))throw error;}
    }
    throw new Error("APP_WIRING_ID_COLLISION_RETRY_EXHAUSTED");
  }

  async prepare(input: AppWiringClaimInput, resolveRoute: () => AppWiringRouteDecision | Promise<AppWiringRouteDecision>): Promise<AppWiringPreparedClaim> {
    validateInput(input);
    const requestKey = `${input.entrypointKind}:${input.externalRequestId}`;
    const fingerprint = sha(JSON.stringify([this.environment.requestNamespace,input.entrypointKind,input.externalRequestId]));
    const payload = sha(stableJson(input.normalizedPayload));
    const time = this.now(), audit = createObjectAuditValues(input.actor, time);
    const expires = createObjectAuditValues(input.actor, new Date(time.getTime() + this.leaseDurationMs)).UPDATE_TIME;
    const token = this.generateLeaseToken();
    if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("APP_WIRING_LEASE_TOKEN_INVALID");
    let inserted:{id:string;decision:AppWiringRouteDecision}|undefined;
    try{return await this.database.withControlledTransaction(async (tx) => {
      const existing = async (row: ClaimRow): Promise<AppWiringPreparedClaim> => {
        checkReplay(row,input,this.environment.requestNamespace,requestKey,payload);
        if (row.claim_state === "COMPLETED" || row.claim_state === "FAILED") {
          if(row.claim_state==="COMPLETED"&&row.effect_mode==="MUTATION")await assertStoredMutationReceipt(tx,row);
          return prepared(row,true,input.actor);
        }
        if ((row.claim_state === "CLAIMED" || row.claim_state === "MUTATION_STARTED") && (row.effect_mode === null || row.lease_generation === null || row.attempt_count === null || row.recovery_status === null)) throw new Error("APP_WIRING_LEGACY_ACTIVE_DRAIN_REQUIRED");
        if (row.effect_mode === null || row.lease_generation === null || row.attempt_count === null || row.recovery_status === null) throw new Error("APP_WIRING_LEGACY_METADATA_DRAIN_REQUIRED");
        if (row.claim_state === "MUTATION_STARTED") throw new Error("APP_WIRING_MUTATION_RECOVERY_REQUIRED");
        if (row.lease_expires_time === null || row.lease_token === null) throw new Error("APP_WIRING_LEGACY_ACTIVE_DRAIN_REQUIRED");
        if (row.lease_expires_time > audit.UPDATE_TIME) throw new Error("APP_WIRING_REQUEST_IN_PROGRESS");
        const oldGeneration = BigInt(row.lease_generation);
        const generation = oldGeneration + 1n;
        const attemptCount = BigInt(row.attempt_count) + 1n;
        const effectMode = row.effect_mode;
        const update = await tx.execute("UPDATE canonical_app_wiring_operations SET lease_token=?,lease_generation=?,lease_expires_time=?,attempt_count=attempt_count+1,recovery_status='RECOVERED',recovery_code='EXPIRED_CLAIM_TAKEOVER',UPDATE_USER=?,UPDATE_TIME=? WHERE app_wiring_operation_id=? AND claim_state='CLAIMED' AND lease_generation=? AND lease_token=?", [token,generation,expires,audit.UPDATE_USER,audit.UPDATE_TIME,row.app_wiring_operation_id,oldGeneration,row.lease_token]);
        if (update.affectedRows !== 1n) throw new Error("APP_WIRING_LEASE_FENCE_CONFLICT");
        return prepared({ ...row, effect_mode: effectMode, lease_token: token, lease_generation: generation, lease_expires_time: expires, attempt_count: attemptCount, recovery_status: "RECOVERED", recovery_code: "EXPIRED_CLAIM_TAKEOVER" },false,input.actor);
      };
      const found = await readClaim(tx,fingerprint);
      if (found !== undefined) return existing(found);
      const decision = await resolveRoute(); validateDecision(decision);
      for (let attempt=0; attempt<this.maxAttempts; attempt+=1) {
        const id=this.generate(); assertObjectIdentityCandidate(id);
        try {
          await tx.execute("INSERT INTO canonical_app_wiring_operations(app_wiring_operation_id,request_identity_fingerprint,request_namespace,entrypoint_kind,external_request_id,request_key,payload_fingerprint,environment_code,database_identity,route,reason_code,command_code,handler_key,claim_state,effect_mode,lease_token,lease_generation,lease_expires_time,attempt_count,recovery_status,recovery_code,result_json,error_code,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'CLAIMED',?,?,1,?,1,'NONE',NULL,NULL,NULL,?,?,?,?)", [id,fingerprint,this.environment.requestNamespace,input.entrypointKind,input.externalRequestId,requestKey,payload,this.environment.environmentCode,this.environment.databaseIdentity,decision.route,decision.reasonCode,decision.commandCode??null,decision.handlerKey??null,decision.effectMode,token,expires,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);
          inserted={id,decision};
          const row=await readClaim(tx,fingerprint); if(row===undefined) throw new Error("APP_WIRING_CLAIM_INSERT_NOT_VISIBLE"); return prepared(row,false,input.actor);
        } catch(error) {
          if(!isDuplicate(error)) throw error;
          const raced=await readClaim(tx,fingerprint); if(raced!==undefined) return existing(raced);
        }
      }
      throw new Error("APP_WIRING_ID_COLLISION_RETRY_EXHAUSTED");
    });}catch(error){
      if(inserted!==undefined){
        const row=await this.database.withControlledTransaction(tx=>readClaim(tx,fingerprint));
        if(row?.app_wiring_operation_id===inserted.id&&row.request_identity_fingerprint===fingerprint&&row.payload_fingerprint===payload&&row.route===inserted.decision.route&&row.effect_mode===inserted.decision.effectMode&&row.claim_state==="CLAIMED"&&row.lease_token===token&&row.lease_generation!==null&&BigInt(row.lease_generation)===1n)return prepared(row,false,input.actor);
      }
      throw error;
    }
  }

  async runMutation<T>(claim: ActivePreparedClaim, handler: (db: AppWiringMutationParticipant, claim: AppWiringClaim) => Promise<AppWiringMutationHandlerOutcome<T>>): Promise<T> {
    const secret=getSecret(claim,"MUTATION");
    if(claim.claim.route === "SHADOW" || claim.claim.route === "REJECT") throw new Error("APP_WIRING_ROUTE_EFFECT_INVALID");
    let terminalAttempted=false;
    let completedOutcome:AppWiringMutationHandlerOutcome<T>|undefined;
    let expectedResultJson:string|undefined;
    let expectedBinding:ReceiptBinding|undefined;
    let expectedLinkId:string|undefined;
    try {
      return await this.database.withControlledTransaction(async(tx) => {
        await this.assertLease(tx,claim,secret,true);
        const ensureMutationStarted=async():Promise<void>=>{
          const audit=createObjectAuditValues(secret.actor,this.now());
          const transition=await tx.execute("UPDATE canonical_app_wiring_operations SET claim_state='MUTATION_STARTED',recovery_status='PENDING',recovery_code='ACTIVE_MUTATION_IN_PROGRESS',UPDATE_USER=?,UPDATE_TIME=? WHERE app_wiring_operation_id=? AND claim_state='CLAIMED' AND lease_token=? AND lease_generation=? AND lease_expires_time>?",[audit.UPDATE_USER,audit.UPDATE_TIME,claim.claim.appWiringOperationId,secret.leaseToken,secret.leaseGeneration,audit.UPDATE_TIME]);
          if(transition.affectedRows===1n)return;
          const row=await readClaim(tx,claim.claim.requestIdentityFingerprint);
          if(row?.claim_state!=="MUTATION_STARTED"||row.lease_token!==secret.leaseToken||row.lease_generation===null||BigInt(row.lease_generation)!==secret.leaseGeneration)throw new Error("APP_WIRING_MUTATION_TRANSITION_CONFLICT");
          if(row.lease_expires_time===null||row.lease_expires_time<=audit.UPDATE_TIME)throw new Error("APP_WIRING_LEASE_EXPIRED");
        };
        let participant!:AppWiringMutationParticipant;
        participant={query:async<R>(sql:string,values:readonly unknown[]=[])=>{assertReadOnlySqlStatement(sql,true);return tx.query<R>(sql,values);},execute:async(sql:string,values:readonly unknown[]=[])=>{assertDomainMutation(sql);await ensureMutationStarted();return tx.execute(sql,values);},withTransaction:<R>(work:(db:AppWiringMutationParticipant)=>Promise<R>)=>tx.withSavepoint(()=>work(participant))};
        const outcome=await handler(participant,claim.claim);
        await this.assertMutationLease(tx,claim,secret,true);
        const receipt=safeResult(outcome.receipt);
        if(receipt.value.resultFingerprint===undefined)throw new Error("APP_WIRING_MUTATION_RESULT_FINGERPRINT_REQUIRED");
        const binding=receiptBinding(outcome.typedReceipt);
        if(binding.fingerprint!==receipt.value.resultFingerprint)throw new Error("APP_WIRING_RECEIPT_FINGERPRINT_MISMATCH");
        const typed=(await tx.query<Array<{result_fingerprint:string;operation_status:string}>>(`SELECT result_fingerprint,${binding.statusColumn} FROM ${binding.table} WHERE ${binding.column}=? FOR UPDATE`,[binding.operationId]))[0];
        if(typed===undefined)throw new Error("APP_WIRING_TYPED_RECEIPT_NOT_FOUND");
        if(typed.operation_status!=="COMPLETED")throw new Error("APP_WIRING_TYPED_RECEIPT_NOT_COMPLETED");
        if(typed.result_fingerprint!==binding.fingerprint)throw new Error("APP_WIRING_TYPED_RECEIPT_FINGERPRINT_MISMATCH");
        const typedIds:Array<string|null>=Array(11).fill(null);typedIds[binding.position]=binding.operationId;
        const audit=createObjectAuditValues(secret.actor,this.now());
        let linkId:string|undefined;
        for(let attempt=0;attempt<this.maxAttempts;attempt+=1){const candidate=this.generate();assertObjectIdentityCandidate(candidate);try{const linked=await tx.execute("INSERT INTO canonical_app_wiring_receipt_links(canonical_app_wiring_receipt_link_id,app_wiring_operation_id,receipt_kind,result_fingerprint,daily_prayer_operation_id,home_aggregate_operation_id,market_operation_id,member_title_operation_id,mini_pet_title_operation_id,package_use_operation_id,pet_explore_operation_id,pet_explore_event_control_operation_id,pet_title_operation_id,pet_title_batch_operation_id,player_identity_operation_id,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[candidate,claim.claim.appWiringOperationId,binding.kind,binding.fingerprint,...typedIds,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);if(linked.affectedRows!==1n)throw new Error("APP_WIRING_RECEIPT_LINK_NOT_PERSISTED");linkId=candidate;break;}catch(error){if(!isDuplicate(error))throw error;if(!isPrimaryKeyDuplicate(error))throw new Error("APP_WIRING_RECEIPT_LINK_BUSINESS_CONFLICT");}}
        if(linkId===undefined)throw new Error("APP_WIRING_RECEIPT_LINK_ID_COLLISION_RETRY_EXHAUSTED");
        completedOutcome=outcome;expectedResultJson=receipt.serialized;expectedBinding=binding;expectedLinkId=linkId;terminalAttempted=true;
        const result=await tx.execute("UPDATE canonical_app_wiring_operations SET claim_state='COMPLETED',result_json=?,error_code=NULL,lease_token=NULL,lease_expires_time=NULL,recovery_status='NONE',recovery_code=NULL,UPDATE_USER=?,UPDATE_TIME=? WHERE app_wiring_operation_id=? AND claim_state='MUTATION_STARTED' AND lease_token=? AND lease_generation=? AND lease_expires_time>?",[receipt.serialized,audit.UPDATE_USER,audit.UPDATE_TIME,claim.claim.appWiringOperationId,secret.leaseToken,secret.leaseGeneration,audit.UPDATE_TIME]);
        if(result.affectedRows!==1n)throw new Error("APP_WIRING_TERMINAL_TRANSITION_CONFLICT");return outcome.value;
      });
    } catch(error) {
      if(terminalAttempted&&completedOutcome!==undefined&&expectedResultJson!==undefined&&expectedBinding!==undefined&&expectedLinkId!==undefined){
        const reconciled=await this.database.withControlledTransaction(async tx=>readClaim(tx,claim.claim.requestIdentityFingerprint));
        if(exactTerminalIdentity(reconciled,claim.claim,secret)&&reconciled.claim_state==="COMPLETED"&&reconciled.result_json===expectedResultJson&&reconciled.lease_token===null){
          const link=(await this.database.withControlledTransaction(tx=>tx.query<Array<Record<string,unknown>>>(`SELECT canonical_app_wiring_receipt_link_id,app_wiring_operation_id,receipt_kind,result_fingerprint,${RECEIPT_ID_COLUMNS.join(",")} FROM canonical_app_wiring_receipt_links WHERE canonical_app_wiring_receipt_link_id=? FOR UPDATE`,[expectedLinkId!])))[0];
          const columns=RECEIPT_ID_COLUMNS;
          if(link?.canonical_app_wiring_receipt_link_id===expectedLinkId&&link.app_wiring_operation_id===claim.claim.appWiringOperationId&&link.receipt_kind===expectedBinding.kind&&link.result_fingerprint===expectedBinding.fingerprint&&columns.every((column,index)=>link[column]===(index===expectedBinding!.position?expectedBinding!.operationId:null)))return completedOutcome.value;
        }
      }
      throw error;
    }
  }

  // 기존 reply 전용 API를 보존하고, 명시적 NO_REPLY가 필요한 소비자는 공용 union API를 사용합니다.
  async runMutationReply<T>(claim:ActivePreparedClaim,handler:(db:AppWiringMutationParticipant,claim:AppWiringClaim,context:AppWiringMutationReplyContext)=>Promise<AppWiringMutationReplyOutcome<T>>):Promise<AppWiringPersistedReply<T>>{
    const outcome=await this.runMutationIrisOutcome(claim,handler);
    if (!("reply" in outcome)) throw new Error("APP_WIRING_MUTATION_REPLY_EXPECTED");
    return outcome;
  }

  // MODERN mutation의 typed receipt와 REPLY/NO_REPLY 결과를 같은 controlled transaction에 참여시킵니다.
  async runMutationIrisOutcome<T>(claim:ActivePreparedClaim,handler:(db:AppWiringMutationParticipant,claim:AppWiringClaim,context:AppWiringMutationReplyContext)=>Promise<AppWiringMutationIrisOutcome<T>>):Promise<AppWiringPersistedMutationIrisOutcome<T>>{
    if(claim.claim.entrypointKind!=="IRIS"||claim.claim.route!=="MODERN"||claim.claim.effectMode!=="MUTATION")throw new Error("APP_WIRING_MUTATION_REPLY_ROUTE_INVALID");
    let persistedDelivery:AppWiringPersistedMutationIrisOutcome<T>|undefined;
    let expectedReceipt:Readonly<AppWiringReceiptResult>|undefined;
    const value=await this.runMutation(claim,async(database,activeClaim)=>{
      const operation=await database.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'app-wiring.mutation-reply',?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(),activeClaim.appWiringOperationId],
      );
      let domainParticipant!:AppWiringMutationParticipant;
      domainParticipant=Object.freeze({
        query:<R>(sql:string,values:readonly unknown[]=[])=>database.query<R>(sql,values),
        execute:(sql:string,values:readonly unknown[]=[])=>{assertMutationReplyDomainMutation(sql);return database.execute(sql,values);},
        withTransaction:<R>(work:(db:AppWiringMutationParticipant)=>Promise<R>)=>database.withTransaction(()=>work(domainParticipant)),
      });
      const outcome=await handler(domainParticipant,activeClaim,Object.freeze({operationId:operation.insertId}));
      const binding=receiptBinding(outcome.typedReceipt);
      if(outcome.receipt.referenceId!==undefined&&outcome.receipt.referenceId!==binding.operationId)throw new Error("APP_WIRING_REPLY_REFERENCE_TYPED_RECEIPT_MISMATCH");
      const hasReply="reply" in outcome;
      const hasNoReply="noReply" in outcome;
      if(hasReply===hasNoReply)throw new Error("APP_WIRING_MUTATION_IRIS_OUTCOME_INVALID");
      if(hasReply){
        if(outcome.receipt.status==="NO_REPLY")throw new Error("APP_WIRING_REPLY_STATUS_INVALID");
        validateReadOnlyReplyDraft(outcome.reply);
        const reply=await this.persistIrisReply(database,activeClaim,outcome.reply,operation.insertId,outcome.receipt.status,outcome.receipt.resultFingerprint,binding.operationId);
        persistedDelivery={value:outcome.value,reply};
      }else{
        if(outcome.receipt.status!=="NO_REPLY")throw new Error("APP_WIRING_NO_REPLY_STATUS_INVALID");
        validateNoReplyDraft(outcome.noReply);
        await this.persistIrisNoReply(database,activeClaim,outcome.noReply,operation.insertId,outcome.receipt.status,outcome.receipt.resultFingerprint,binding.operationId);
        persistedDelivery={value:outcome.value,noReply:Object.freeze({kind:"NO_REPLY"})};
      }
      expectedReceipt=Object.freeze({status:outcome.receipt.status,referenceId:binding.operationId,resultFingerprint:outcome.receipt.resultFingerprint});
      return {...outcome,receipt:{...outcome.receipt,referenceId:binding.operationId}};
    });
    if(persistedDelivery===undefined||expectedReceipt===undefined)throw new Error("APP_WIRING_MUTATION_REPLY_NOT_PERSISTED");
    const verified=await this.replayMutationIrisOutcome({...claim.claim,claimState:"COMPLETED",result:expectedReceipt});
    if("reply" in persistedDelivery){
      if(!("reply" in verified)||verified.reply.outboxId!==persistedDelivery.reply.outboxId||verified.reply.room!==persistedDelivery.reply.room||verified.reply.data!==persistedDelivery.reply.data)throw new Error("APP_WIRING_MUTATION_REPLY_RECONCILIATION_DRIFT");
      return {value,reply:verified.reply};
    }
    if(!("noReply" in verified))throw new Error("APP_WIRING_MUTATION_REPLY_RECONCILIATION_DRIFT");
    return {value,noReply:verified.noReply};
  }

  async runReadOnly<T>(claim: ActivePreparedClaim, handler:(db:AppWiringReadParticipant,claim:AppWiringClaim)=>Promise<AppWiringHandlerOutcome<T>>):Promise<T>{
    const secret=getSecret(claim,"READ_ONLY"); if(claim.claim.route==="REJECT")throw new Error("APP_WIRING_REJECT_DATABASE_FORBIDDEN");
    const outcome=await this.database.withReadOnlySnapshot(tx=>handler(this.readParticipant(tx),claim.claim)); await this.complete(claim,secret,outcome.receipt); return outcome.value;
  }
  async runReadOnlyReply<T>(claim:ActivePreparedClaim,handler:(db:AppWiringReadParticipant,claim:AppWiringClaim)=>Promise<AppWiringReadOnlyReplyOutcome<T>>):Promise<AppWiringPersistedReply<T>>{
    const secret=getSecret(claim,"READ_ONLY");
    if(claim.claim.route!=="MODERN"||claim.claim.entrypointKind!=="IRIS")throw new Error("APP_WIRING_READ_ONLY_REPLY_ROUTE_INVALID");
    let completedOutcome:AppWiringReadOnlyReplyOutcome<T>|undefined;
    let expectedResultJson:string|undefined;
    let attempted=false;
    try{
      return await this.database.withControlledTransaction(async tx=>{
        await this.assertLease(tx,claim,secret,true);
        const outcome=await handler(this.readParticipant(tx),claim.claim);
        validateReadOnlyReplyDraft(outcome.reply);
        if(outcome.receipt.referenceId!==undefined)throw new Error("APP_WIRING_REPLY_REFERENCE_COORDINATOR_ONLY");
        const resultFingerprint=outcome.receipt.resultFingerprint??sha(stableJson({
          appWiringOperationId:claim.claim.appWiringOperationId,
          commandCode:outcome.reply.commandCode,
          data:outcome.reply.data,
          destinationId:outcome.reply.destinationId,
          eventId:outcome.reply.eventId,
          status:outcome.receipt.status,
        }));
        const operation=await tx.execute(
          "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'app-wiring.read-only-reply',?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))",
          [randomUUID(),claim.claim.appWiringOperationId],
        );
        await tx.execute(
          "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
          [outcome.reply.eventId,outcome.reply.commandCode,operation.insertId],
        );
        const outbox=await tx.execute(
          "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
          [operation.insertId,outcome.reply.destinationId,JSON.stringify({data:outcome.reply.data})],
        );
        const receipt=safeResult({status:outcome.receipt.status,referenceId:outbox.insertId.toString(),resultFingerprint});
        expectedResultJson=receipt.serialized;
        const operationResult=JSON.stringify({
          appWiringOperationId:claim.claim.appWiringOperationId,
          commandCode:outcome.reply.commandCode,
          data:outcome.reply.data,
          destinationId:outcome.reply.destinationId,
          eventId:outcome.reply.eventId,
          outboxId:outbox.insertId.toString(),
          resultFingerprint,
          status:outcome.receipt.status,
        });
        const legacyTerminal=await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=? AND status='processing'",[operationResult,operation.insertId]);
        if(legacyTerminal.affectedRows!==1n)throw new Error("APP_WIRING_REPLY_OPERATION_TRANSITION_CONFLICT");
        const audit=createObjectAuditValues(secret.actor,this.now());
        attempted=true;
        const terminal=await tx.execute("UPDATE canonical_app_wiring_operations SET claim_state='COMPLETED',result_json=?,error_code=NULL,lease_token=NULL,lease_expires_time=NULL,recovery_status='NONE',recovery_code=NULL,UPDATE_USER=?,UPDATE_TIME=? WHERE app_wiring_operation_id=? AND claim_state='CLAIMED' AND lease_token=? AND lease_generation=?",[receipt.serialized,audit.UPDATE_USER,audit.UPDATE_TIME,claim.claim.appWiringOperationId,secret.leaseToken,secret.leaseGeneration]);
        if(terminal.affectedRows!==1n)throw new Error("APP_WIRING_TERMINAL_TRANSITION_CONFLICT");
        completedOutcome=outcome;
        return {value:outcome.value,reply:{outboxId:outbox.insertId.toString(),room:outcome.reply.destinationId,data:outcome.reply.data}};
      });
    }catch(error){
      if(attempted&&completedOutcome!==undefined&&expectedResultJson!==undefined){
        const row=await this.database.withControlledTransaction(tx=>readClaim(tx,claim.claim.requestIdentityFingerprint));
        if(exactTerminalIdentity(row,claim.claim,secret)&&row.claim_state==="COMPLETED"&&row.result_json===expectedResultJson&&row.lease_token===null){
          const reply=await this.replayReadOnlyReply(toReplayClaim(row));
          return {value:completedOutcome.value,reply};
        }
      }
      throw error;
    }
  }
  async replayReadOnlyReply(claim:AppWiringReplayClaim):Promise<{readonly outboxId:string;readonly room:string;readonly data:string}>{
    return this.replayIrisReply(claim,"READ_ONLY","app-wiring.read-only-reply");
  }
  async replayMutationReply(claim:AppWiringReplayClaim):Promise<{readonly outboxId:string;readonly room:string;readonly data:string}>{
    const outcome=await this.replayMutationIrisOutcome(claim);
    if (!("reply" in outcome)) throw new Error("APP_WIRING_MUTATION_REPLY_EXPECTED");
    return outcome.reply;
  }
  async replayMutationIrisOutcome(claim:AppWiringReplayClaim):Promise<{readonly reply:{readonly outboxId:string;readonly room:string;readonly data:string}}|{readonly noReply:{readonly kind:"NO_REPLY"}}>{
    if(claim.claimState!=="COMPLETED"||claim.entrypointKind!=="IRIS"||!("effectMode" in claim)||claim.effectMode!=="MUTATION"||claim.route!=="MODERN"||claim.result?.referenceId===undefined||claim.result.resultFingerprint===undefined)throw new Error("APP_WIRING_REPLY_REPLAY_RECEIPT_INVALID");
    const rows=await this.database.withControlledTransaction(tx=>tx.query<ReadOnlyReplyRow[]>(
      `SELECT operation.id operation_id,operation.idempotency_scope,operation.idempotency_key,operation.status operation_status,
              operation.result_json operation_result_json,execution.event_id,execution.command_code,execution.execution_status,execution.result_code,
              outbox.id outbox_id,outbox.provider_code,outbox.destination_id,outbox.message_type,outbox.payload_json
         FROM operations operation
         JOIN command_executions execution ON execution.operation_id=operation.id
         LEFT JOIN outbox_messages outbox ON outbox.operation_id=operation.id
        WHERE operation.idempotency_scope=? AND operation.idempotency_key=? FOR UPDATE`,
      ["app-wiring.mutation-reply",claim.appWiringOperationId],
    ));
    if(rows.length!==1)throw new Error("APP_WIRING_REPLY_REPLAY_CARDINALITY_INVALID");
    const row=rows[0]!;
    const operationResult=typeof row.operation_result_json==="string"?JSON.parse(row.operation_result_json) as Record<string,unknown>:row.operation_result_json;
    if(row.idempotency_scope!=="app-wiring.mutation-reply"||row.idempotency_key!==claim.appWiringOperationId||row.operation_status!=="completed"
      ||row.execution_status!=="completed"||operationResult===null||operationResult.appWiringOperationId!==claim.appWiringOperationId
      ||operationResult.eventId!==row.event_id.toString()||operationResult.commandCode!==row.command_code
      ||operationResult.status!==claim.result.status||operationResult.resultFingerprint!==claim.result.resultFingerprint
      ||operationResult.typedReceiptId!==claim.result.referenceId)throw new Error("APP_WIRING_REPLY_REPLAY_DRIFT");
    if(operationResult.outcomeKind==="NO_REPLY"){
      if(claim.result.status!=="NO_REPLY"||row.result_code!=="no_reply"||row.outbox_id!==null||row.provider_code!==null||row.destination_id!==null||row.message_type!==null||row.payload_json!==null
        ||["outboxId","destinationId","data"].some(key=>Object.prototype.hasOwnProperty.call(operationResult,key)))throw new Error("APP_WIRING_REPLY_REPLAY_DRIFT");
      return Object.freeze({noReply:Object.freeze({kind:"NO_REPLY" as const})});
    }
    if(operationResult.outcomeKind!==undefined&&operationResult.outcomeKind!=="REPLY")throw new Error("APP_WIRING_REPLY_REPLAY_DRIFT");
    if(claim.result.status==="NO_REPLY"||row.result_code!=="reply_queued"||row.outbox_id===null||row.provider_code!=="iris"||row.destination_id===null||row.message_type!=="text"||row.payload_json===null)throw new Error("APP_WIRING_REPLY_REPLAY_DRIFT");
    const data=readPayloadData(row.payload_json);
    if(operationResult.destinationId!==row.destination_id||operationResult.data!==data||operationResult.outboxId!==row.outbox_id.toString())throw new Error("APP_WIRING_REPLY_REPLAY_DRIFT");
    return Object.freeze({reply:Object.freeze({outboxId:row.outbox_id.toString(),room:row.destination_id,data})});
  }
  private async replayIrisReply(claim:AppWiringReplayClaim,effectMode:AppWiringEffectMode,idempotencyScope:string):Promise<{readonly outboxId:string;readonly room:string;readonly data:string}>{
    if(claim.claimState!=="COMPLETED"||claim.entrypointKind!=="IRIS"||!("effectMode" in claim)||claim.effectMode!==effectMode||claim.result?.referenceId===undefined||claim.result.resultFingerprint===undefined)throw new Error("APP_WIRING_REPLY_REPLAY_RECEIPT_INVALID");
    if(effectMode==="MUTATION"&&claim.route!=="MODERN")throw new Error("APP_WIRING_MUTATION_REPLY_ROUTE_INVALID");
    const lookupByOutbox=effectMode==="READ_ONLY";
    const rows=await this.database.withControlledTransaction(tx=>tx.query<ReadOnlyReplyRow[]>(
      `SELECT operation.id operation_id,operation.idempotency_scope,operation.idempotency_key,operation.status operation_status,
              operation.result_json operation_result_json,execution.event_id,execution.command_code,execution.execution_status,execution.result_code,
              outbox.id outbox_id,outbox.provider_code,outbox.destination_id,outbox.message_type,outbox.payload_json
         FROM outbox_messages outbox
         JOIN operations operation ON operation.id=outbox.operation_id
         JOIN command_executions execution ON execution.operation_id=operation.id
        WHERE ${lookupByOutbox?"outbox.id=?":"operation.idempotency_scope=? AND operation.idempotency_key=?"} FOR UPDATE`,
      lookupByOutbox?[claim.result!.referenceId]:[idempotencyScope,claim.appWiringOperationId],
    ));
    if(rows.length!==1)throw new Error("APP_WIRING_REPLY_REPLAY_CARDINALITY_INVALID");
    const row=rows[0]!;
    if(row.outbox_id===null||row.destination_id===null||row.payload_json===null)throw new Error("APP_WIRING_REPLY_REPLAY_DRIFT");
    const operationResult=typeof row.operation_result_json==="string"?JSON.parse(row.operation_result_json) as Record<string,unknown>:row.operation_result_json;
    const data=readPayloadData(row.payload_json);
    if(row.idempotency_scope!==idempotencyScope||row.idempotency_key!==claim.appWiringOperationId||row.operation_status!=="completed"
      ||row.execution_status!=="completed"||row.result_code!=="reply_queued"||row.provider_code!=="iris"||row.message_type!=="text"
      ||(lookupByOutbox&&row.outbox_id.toString()!==claim.result.referenceId)||operationResult===null
      ||operationResult.appWiringOperationId!==claim.appWiringOperationId||operationResult.eventId!==row.event_id.toString()
      ||operationResult.commandCode!==row.command_code||operationResult.destinationId!==row.destination_id||operationResult.data!==data
      ||operationResult.outboxId!==row.outbox_id.toString()||operationResult.status!==claim.result.status
      ||operationResult.resultFingerprint!==claim.result.resultFingerprint
      ||(!lookupByOutbox&&operationResult.typedReceiptId!==claim.result.referenceId))throw new Error("APP_WIRING_REPLY_REPLAY_DRIFT");
    return Object.freeze({outboxId:row.outbox_id.toString(),room:row.destination_id,data});
  }
  async runReject<T>(claim:ActivePreparedClaim,handler:(claim:AppWiringClaim)=>Promise<AppWiringHandlerOutcome<T>>):Promise<T>{
    const secret=getSecret(claim,"READ_ONLY");if(claim.claim.route!=="REJECT")throw new Error("APP_WIRING_REJECT_ROUTE_REQUIRED");const outcome=await handler(claim.claim);await this.complete(claim,secret,outcome.receipt);return outcome.value;
  }
  async fail(claim:ActivePreparedClaim,errorCode:string):Promise<void>{
    if(!/^[A-Z][A-Z0-9_]{0,99}$/.test(errorCode))throw new Error("APP_WIRING_ERROR_CODE_INVALID");const secret=getSecret(claim);
    let attempted=false;
    try{await this.database.withControlledTransaction(async tx=>{await this.assertLease(tx,claim,secret,true);const audit=createObjectAuditValues(secret.actor,this.now());attempted=true;const result=await tx.execute("UPDATE canonical_app_wiring_operations SET claim_state='FAILED',result_json=NULL,error_code=?,lease_token=NULL,lease_expires_time=NULL,recovery_status='NONE',recovery_code=NULL,UPDATE_USER=?,UPDATE_TIME=? WHERE app_wiring_operation_id=? AND claim_state='CLAIMED' AND lease_token=? AND lease_generation=? AND lease_expires_time>?",[errorCode,audit.UPDATE_USER,audit.UPDATE_TIME,claim.claim.appWiringOperationId,secret.leaseToken,secret.leaseGeneration,audit.UPDATE_TIME]);if(result.affectedRows!==1n)throw new Error("APP_WIRING_FAILED_TRANSITION_CONFLICT");});}
    catch(error){if(attempted){const row=await this.database.withControlledTransaction(tx=>readClaim(tx,claim.claim.requestIdentityFingerprint));if(exactTerminalIdentity(row,claim.claim,secret)&&row.claim_state==="FAILED"&&row.error_code===errorCode&&row.lease_token===null)return;}throw error;}
  }
  private readParticipant(tx:Pick<ReadOnlySnapshotTransaction,"query">):AppWiringReadParticipant{return Object.freeze({query:async<T>(sql:string,values:readonly unknown[]=[])=>{assertReadOnlySqlStatement(sql,false);return tx.query<T>(sql,values);}});}
  private async persistIrisReply<T>(database:AppWiringMutationParticipant,claim:AppWiringClaim,reply:AppWiringIrisReplyDraft,operationId:bigint,status:string,resultFingerprint:string,typedReceiptId:string):Promise<AppWiringPersistedReply<T>["reply"]>{
    await database.execute(
      "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [reply.eventId,reply.commandCode,operationId],
    );
    const outbox=await database.execute(
      "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [operationId,reply.destinationId,JSON.stringify({data:reply.data})],
    );
    const operationResult=JSON.stringify({outcomeKind:"REPLY",appWiringOperationId:claim.appWiringOperationId,commandCode:reply.commandCode,data:reply.data,destinationId:reply.destinationId,eventId:reply.eventId,outboxId:outbox.insertId.toString(),resultFingerprint,status,typedReceiptId});
    const terminal=await database.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=? AND status='processing'",[operationResult,operationId]);
    if(terminal.affectedRows!==1n)throw new Error("APP_WIRING_REPLY_OPERATION_TRANSITION_CONFLICT");
    return Object.freeze({outboxId:outbox.insertId.toString(),room:reply.destinationId,data:reply.data});
  }
  private async persistIrisNoReply(database:AppWiringMutationParticipant,claim:AppWiringClaim,noReply:AppWiringIrisNoReplyDraft,operationId:bigint,status:string,resultFingerprint:string,typedReceiptId:string):Promise<void>{
    await database.execute(
      "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','no_reply',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [noReply.eventId,noReply.commandCode,operationId],
    );
    const operationResult=JSON.stringify({outcomeKind:"NO_REPLY",appWiringOperationId:claim.appWiringOperationId,commandCode:noReply.commandCode,eventId:noReply.eventId,resultFingerprint,status,typedReceiptId});
    const terminal=await database.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=? AND status='processing'",[operationResult,operationId]);
    if(terminal.affectedRows!==1n)throw new Error("APP_WIRING_REPLY_OPERATION_TRANSITION_CONFLICT");
  }
  private async complete(claim:ActivePreparedClaim,secret:PreparedSecret,value:AppWiringReceiptResult):Promise<void>{const receipt=safeResult(value);let attempted=false;try{await this.database.withControlledTransaction(async tx=>{await this.assertLease(tx,claim,secret,true);const audit=createObjectAuditValues(secret.actor,this.now());attempted=true;const result=await tx.execute("UPDATE canonical_app_wiring_operations SET claim_state='COMPLETED',result_json=?,error_code=NULL,lease_token=NULL,lease_expires_time=NULL,recovery_status='NONE',recovery_code=NULL,UPDATE_USER=?,UPDATE_TIME=? WHERE app_wiring_operation_id=? AND claim_state='CLAIMED' AND lease_token=? AND lease_generation=?",[receipt.serialized,audit.UPDATE_USER,audit.UPDATE_TIME,claim.claim.appWiringOperationId,secret.leaseToken,secret.leaseGeneration]);if(result.affectedRows!==1n)throw new Error("APP_WIRING_TERMINAL_TRANSITION_CONFLICT");});}catch(error){if(attempted){const row=await this.database.withControlledTransaction(tx=>readClaim(tx,claim.claim.requestIdentityFingerprint));if(exactTerminalIdentity(row,claim.claim,secret)&&row.claim_state==="COMPLETED"&&row.result_json===receipt.serialized&&row.lease_token===null)return;}throw error;}}
  private async assertLease(tx:ControlledDatabaseTransaction,claim:ActivePreparedClaim,secret:PreparedSecret,unexpired:boolean):Promise<void>{const row=await readClaim(tx,claim.claim.requestIdentityFingerprint);if(row===undefined||row.app_wiring_operation_id!==claim.claim.appWiringOperationId||row.claim_state!=="CLAIMED"||row.lease_token!==secret.leaseToken||row.lease_generation===null||BigInt(row.lease_generation)!==secret.leaseGeneration)throw new Error("APP_WIRING_LEASE_FENCE_CONFLICT");const now=createObjectAuditValues(secret.actor,this.now()).UPDATE_TIME;if(unexpired&&(row.lease_expires_time===null||row.lease_expires_time<=now))throw new Error("APP_WIRING_LEASE_EXPIRED");}
  private async assertMutationLease(tx:ControlledDatabaseTransaction,claim:ActivePreparedClaim,secret:PreparedSecret,unexpired:boolean):Promise<void>{const row=await readClaim(tx,claim.claim.requestIdentityFingerprint);if(row===undefined||row.app_wiring_operation_id!==claim.claim.appWiringOperationId||row.claim_state!=="MUTATION_STARTED"||row.lease_token!==secret.leaseToken||row.lease_generation===null||BigInt(row.lease_generation)!==secret.leaseGeneration)throw new Error("APP_WIRING_LEASE_FENCE_CONFLICT");const now=createObjectAuditValues(secret.actor,this.now()).UPDATE_TIME;if(unexpired&&(row.lease_expires_time===null||row.lease_expires_time<=now))throw new Error("APP_WIRING_LEASE_EXPIRED");}
}
