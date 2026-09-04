import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { CapableDatabaseClient, ControlledDatabaseTransaction, DatabaseWriteResult, ReadOnlySnapshotTransaction } from "../database.js";
import { assertReadOnlySqlStatement } from "../database/read-only-sql-boundary.js";
import { OBJECT_IDENTITY_MAX_ATTEMPTS, assertObjectIdentityCandidate, createObjectAuditValues, createObjectIdentityCandidate, type ObjectIdentityCandidateGenerator } from "../identity/object-identity-audit-provider.js";
import { assertVerifiedEnvironmentContext, type VerifiedEnvironmentContext } from "../runtime/environment-context.js";

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
  | { readonly receiptKind: "PLAYER_IDENTITY"; readonly playerIdentityOperationId: string; readonly resultFingerprint: string };
export interface AppWiringMutationHandlerOutcome<T> {
  readonly value: T;
  readonly receipt: AppWiringReceiptResult & { readonly resultFingerprint: string };
  readonly typedReceipt: AppWiringTypedReceipt;
}
export interface AppWiringMutationReplyOutcome<T> extends AppWiringMutationHandlerOutcome<T> {
  readonly reply: AppWiringIrisReplyDraft;
}
export interface AppWiringMutationReplyContext { readonly operationId: bigint }
export interface AppWiringReadParticipant { query<T>(sql: string, values?: readonly unknown[]): Promise<T> }
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
  outbox_id: bigint | number | string;
  provider_code: string;
  destination_id: string;
  message_type: string;
  payload_json: string | { data?: unknown };
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
function readPayloadData(payload: ReadOnlyReplyRow["payload_json"]): string {
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
  PLAYER_IDENTITY: ["player_identity_operation_id","canonical_player_identity_operations","operation_status","playerIdentityOperationId",9]
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
}

export class MariaAppWiringOperationProvider {
  constructor(private readonly database: CapableDatabaseClient, private readonly environment: VerifiedEnvironmentContext,
    private readonly generate: ObjectIdentityCandidateGenerator = createObjectIdentityCandidate,
    private readonly maxAttempts = OBJECT_IDENTITY_MAX_ATTEMPTS, private readonly now: () => Date = () => new Date(),
    private readonly generateLeaseToken: () => string = () => randomBytes(32).toString("hex"), private readonly leaseDurationMs = 30_000) {
    assertVerifiedEnvironmentContext(environment);
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
        const typedIds:Array<string|null>=Array(10).fill(null);typedIds[binding.position]=binding.operationId;
        const audit=createObjectAuditValues(secret.actor,this.now());
        let linkId:string|undefined;
        for(let attempt=0;attempt<this.maxAttempts;attempt+=1){const candidate=this.generate();assertObjectIdentityCandidate(candidate);try{const linked=await tx.execute("INSERT INTO canonical_app_wiring_receipt_links(canonical_app_wiring_receipt_link_id,app_wiring_operation_id,receipt_kind,result_fingerprint,daily_prayer_operation_id,home_aggregate_operation_id,market_operation_id,member_title_operation_id,mini_pet_title_operation_id,package_use_operation_id,pet_explore_operation_id,pet_explore_event_control_operation_id,pet_title_operation_id,player_identity_operation_id,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[candidate,claim.claim.appWiringOperationId,binding.kind,binding.fingerprint,...typedIds,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);if(linked.affectedRows!==1n)throw new Error("APP_WIRING_RECEIPT_LINK_NOT_PERSISTED");linkId=candidate;break;}catch(error){if(!isDuplicate(error))throw error;if(!isPrimaryKeyDuplicate(error))throw new Error("APP_WIRING_RECEIPT_LINK_BUSINESS_CONFLICT");}}
        if(linkId===undefined)throw new Error("APP_WIRING_RECEIPT_LINK_ID_COLLISION_RETRY_EXHAUSTED");
        completedOutcome=outcome;expectedResultJson=receipt.serialized;expectedBinding=binding;expectedLinkId=linkId;terminalAttempted=true;
        const result=await tx.execute("UPDATE canonical_app_wiring_operations SET claim_state='COMPLETED',result_json=?,error_code=NULL,lease_token=NULL,lease_expires_time=NULL,recovery_status='NONE',recovery_code=NULL,UPDATE_USER=?,UPDATE_TIME=? WHERE app_wiring_operation_id=? AND claim_state='MUTATION_STARTED' AND lease_token=? AND lease_generation=? AND lease_expires_time>?",[receipt.serialized,audit.UPDATE_USER,audit.UPDATE_TIME,claim.claim.appWiringOperationId,secret.leaseToken,secret.leaseGeneration,audit.UPDATE_TIME]);
        if(result.affectedRows!==1n)throw new Error("APP_WIRING_TERMINAL_TRANSITION_CONFLICT");return outcome.value;
      });
    } catch(error) {
      if(terminalAttempted&&completedOutcome!==undefined&&expectedResultJson!==undefined&&expectedBinding!==undefined&&expectedLinkId!==undefined){
        const reconciled=await this.database.withControlledTransaction(async tx=>readClaim(tx,claim.claim.requestIdentityFingerprint));
        if(exactTerminalIdentity(reconciled,claim.claim,secret)&&reconciled.claim_state==="COMPLETED"&&reconciled.result_json===expectedResultJson&&reconciled.lease_token===null){
          const link=(await this.database.withControlledTransaction(tx=>tx.query<Array<Record<string,unknown>>>("SELECT canonical_app_wiring_receipt_link_id,app_wiring_operation_id,receipt_kind,result_fingerprint,daily_prayer_operation_id,home_aggregate_operation_id,market_operation_id,member_title_operation_id,mini_pet_title_operation_id,package_use_operation_id,pet_explore_operation_id,pet_explore_event_control_operation_id,pet_title_operation_id,player_identity_operation_id FROM canonical_app_wiring_receipt_links WHERE canonical_app_wiring_receipt_link_id=? FOR UPDATE",[expectedLinkId!])))[0];
          const columns=["daily_prayer_operation_id","home_aggregate_operation_id","market_operation_id","member_title_operation_id","mini_pet_title_operation_id","package_use_operation_id","pet_explore_operation_id","pet_explore_event_control_operation_id","pet_title_operation_id","player_identity_operation_id"];
          if(link?.canonical_app_wiring_receipt_link_id===expectedLinkId&&link.app_wiring_operation_id===claim.claim.appWiringOperationId&&link.receipt_kind===expectedBinding.kind&&link.result_fingerprint===expectedBinding.fingerprint&&columns.every((column,index)=>link[column]===(index===expectedBinding!.position?expectedBinding!.operationId:null)))return completedOutcome.value;
        }
      }
      throw error;
    }
  }

  // MODERN mutation의 도메인 영수증과 Iris outbox를 runMutation의 동일 controlled transaction에 참여시킵니다.
  async runMutationReply<T>(claim:ActivePreparedClaim,handler:(db:AppWiringMutationParticipant,claim:AppWiringClaim,context:AppWiringMutationReplyContext)=>Promise<AppWiringMutationReplyOutcome<T>>):Promise<AppWiringPersistedReply<T>>{
    if(claim.claim.entrypointKind!=="IRIS"||claim.claim.route!=="MODERN"||claim.claim.effectMode!=="MUTATION")throw new Error("APP_WIRING_MUTATION_REPLY_ROUTE_INVALID");
    let persistedReply:AppWiringPersistedReply<T>["reply"]|undefined;
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
      validateReadOnlyReplyDraft(outcome.reply);
      const binding=receiptBinding(outcome.typedReceipt);
      if(outcome.receipt.referenceId!==undefined&&outcome.receipt.referenceId!==binding.operationId)throw new Error("APP_WIRING_REPLY_REFERENCE_TYPED_RECEIPT_MISMATCH");
      const reply=await this.persistIrisReply(database,activeClaim,outcome.reply,operation.insertId,outcome.receipt.status,outcome.receipt.resultFingerprint,binding.operationId);
      persistedReply=reply;
      expectedReceipt=Object.freeze({status:outcome.receipt.status,referenceId:binding.operationId,resultFingerprint:outcome.receipt.resultFingerprint});
      return {...outcome,receipt:{...outcome.receipt,referenceId:binding.operationId}};
    });
    if(persistedReply===undefined||expectedReceipt===undefined)throw new Error("APP_WIRING_MUTATION_REPLY_NOT_PERSISTED");
    const verifiedReply=await this.replayMutationReply({...claim.claim,claimState:"COMPLETED",result:expectedReceipt});
    if(verifiedReply.outboxId!==persistedReply.outboxId||verifiedReply.room!==persistedReply.room||verifiedReply.data!==persistedReply.data)throw new Error("APP_WIRING_MUTATION_REPLY_RECONCILIATION_DRIFT");
    return {value,reply:verifiedReply};
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
    return this.replayIrisReply(claim,"MUTATION","app-wiring.mutation-reply");
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
    const operationResult=JSON.stringify({appWiringOperationId:claim.appWiringOperationId,commandCode:reply.commandCode,data:reply.data,destinationId:reply.destinationId,eventId:reply.eventId,outboxId:outbox.insertId.toString(),resultFingerprint,status,typedReceiptId});
    const terminal=await database.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=? AND status='processing'",[operationResult,operationId]);
    if(terminal.affectedRows!==1n)throw new Error("APP_WIRING_REPLY_OPERATION_TRANSITION_CONFLICT");
    return Object.freeze({outboxId:outbox.insertId.toString(),room:reply.destinationId,data:reply.data});
  }
  private async complete(claim:ActivePreparedClaim,secret:PreparedSecret,value:AppWiringReceiptResult):Promise<void>{const receipt=safeResult(value);let attempted=false;try{await this.database.withControlledTransaction(async tx=>{await this.assertLease(tx,claim,secret,true);const audit=createObjectAuditValues(secret.actor,this.now());attempted=true;const result=await tx.execute("UPDATE canonical_app_wiring_operations SET claim_state='COMPLETED',result_json=?,error_code=NULL,lease_token=NULL,lease_expires_time=NULL,recovery_status='NONE',recovery_code=NULL,UPDATE_USER=?,UPDATE_TIME=? WHERE app_wiring_operation_id=? AND claim_state='CLAIMED' AND lease_token=? AND lease_generation=?",[receipt.serialized,audit.UPDATE_USER,audit.UPDATE_TIME,claim.claim.appWiringOperationId,secret.leaseToken,secret.leaseGeneration]);if(result.affectedRows!==1n)throw new Error("APP_WIRING_TERMINAL_TRANSITION_CONFLICT");});}catch(error){if(attempted){const row=await this.database.withControlledTransaction(tx=>readClaim(tx,claim.claim.requestIdentityFingerprint));if(exactTerminalIdentity(row,claim.claim,secret)&&row.claim_state==="COMPLETED"&&row.result_json===receipt.serialized&&row.lease_token===null)return;}throw error;}}
  private async assertLease(tx:ControlledDatabaseTransaction,claim:ActivePreparedClaim,secret:PreparedSecret,unexpired:boolean):Promise<void>{const row=await readClaim(tx,claim.claim.requestIdentityFingerprint);if(row===undefined||row.app_wiring_operation_id!==claim.claim.appWiringOperationId||row.claim_state!=="CLAIMED"||row.lease_token!==secret.leaseToken||row.lease_generation===null||BigInt(row.lease_generation)!==secret.leaseGeneration)throw new Error("APP_WIRING_LEASE_FENCE_CONFLICT");const now=createObjectAuditValues(secret.actor,this.now()).UPDATE_TIME;if(unexpired&&(row.lease_expires_time===null||row.lease_expires_time<=now))throw new Error("APP_WIRING_LEASE_EXPIRED");}
  private async assertMutationLease(tx:ControlledDatabaseTransaction,claim:ActivePreparedClaim,secret:PreparedSecret,unexpired:boolean):Promise<void>{const row=await readClaim(tx,claim.claim.requestIdentityFingerprint);if(row===undefined||row.app_wiring_operation_id!==claim.claim.appWiringOperationId||row.claim_state!=="MUTATION_STARTED"||row.lease_token!==secret.leaseToken||row.lease_generation===null||BigInt(row.lease_generation)!==secret.leaseGeneration)throw new Error("APP_WIRING_LEASE_FENCE_CONFLICT");const now=createObjectAuditValues(secret.actor,this.now()).UPDATE_TIME;if(unexpired&&(row.lease_expires_time===null||row.lease_expires_time<=now))throw new Error("APP_WIRING_LEASE_EXPIRED");}
}
