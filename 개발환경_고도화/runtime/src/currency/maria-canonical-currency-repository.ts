import { createHash } from "node:crypto";
// OBJECT_DATA_MODEL_STANDARD_CANONICAL_PROVIDER: additive canonical model, excluded from the frozen legacy-provider inventory.
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { createScopedDatabaseClient } from "../database.js";
import { assertObjectIdentityCandidate, MariaObjectIdentityAuditProvider } from "../identity/object-identity-audit-provider.js";
import { assertCanonicalCurrencyDelta, UNSIGNED_BIGINT_MAX } from "./canonical-currency-amount.js";

export interface CanonicalCurrencyDefinitionInput {
  actor: string;
  sourceSystem: string;
  sourceNamespace: string;
  sourceIdentifier: string;
  currencyName: string;
  decimalPlaces: number;
  active?: boolean;
}

export interface CanonicalCurrencyAdjustmentInput {
  actor: string;
  playerId: string;
  currencyId: string;
  deltaMinorAmount: bigint;
  operationKind: string;
  reasonKey: string;
  requestKey: string;
}

export interface CanonicalCurrencyAdjustmentResult {
  currencyOperationId: string;
  playerCurrencyBalanceId: string;
  balanceAfterMinorAmount: bigint;
  replayed: boolean;
}

interface DefinitionImportRow { currency_id: string; payload_fingerprint: string; }
interface DefinitionRow { currency_id: string; active_flag: boolean | number; }
interface BalanceRow { player_currency_balance_id: string; balance_minor_amount: bigint | string; }
interface ReplayRow {
  currency_operation_id: string;
  player_currency_balance_id: string;
  operation_kind: string;
  payload_fingerprint: string;
  balance_after_minor_amount: bigint | string;
}

function text(value: string, maximum: number, error: string): void {
  if (value.trim() === "" || value.length > maximum) throw new Error(error);
}

function asciiKey(value: string, maximum: number, error: string): void {
  text(value, maximum, error);
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(value)) throw new Error(error);
}

function identifier(value: string): void {
  try { assertObjectIdentityCandidate(value); }
  catch { throw new Error("CANONICAL_CURRENCY_IDENTIFIER_INVALID"); }
}

function fingerprint(entries: readonly (readonly [string, string | number | boolean])[]): string {
  return createHash("sha256").update(JSON.stringify(entries), "utf8").digest("hex");
}

function duplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && (("code" in error && String(error.code) === "ER_DUP_ENTRY") || ("message" in error && /duplicate entry/i.test(String(error.message))));
}

function retryableLock(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  const errno = "errno" in error ? Number(error.errno) : Number.NaN;
  return code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT" || errno === 1213 || errno === 1205;
}

function replay(row: ReplayRow, operationKind: string, payloadFingerprint: string): CanonicalCurrencyAdjustmentResult {
  if (row.operation_kind !== operationKind || row.payload_fingerprint !== payloadFingerprint) throw new Error("CANONICAL_CURRENCY_REQUEST_PAYLOAD_CONFLICT");
  return {
    currencyOperationId: row.currency_operation_id,
    playerCurrencyBalanceId: row.player_currency_balance_id,
    balanceAfterMinorAmount: BigInt(row.balance_after_minor_amount),
    replayed: true,
  };
}

// 잔액 잠금, 변경, replay 결과와 원장 추가를 하나의 MariaDB transaction으로 처리합니다.
export class MariaCanonicalCurrencyRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async registerDefinition(input: CanonicalCurrencyDefinitionInput): Promise<{ currencyId: string; replayed: boolean }> {
    asciiKey(input.sourceSystem, 50, "CANONICAL_CURRENCY_SOURCE_SYSTEM_INVALID");
    asciiKey(input.sourceNamespace, 100, "CANONICAL_CURRENCY_SOURCE_NAMESPACE_INVALID");
    text(input.sourceIdentifier, 191, "CANONICAL_CURRENCY_SOURCE_IDENTIFIER_INVALID");
    text(input.currencyName, 255, "CANONICAL_CURRENCY_NAME_INVALID");
    if (!Number.isInteger(input.decimalPlaces) || input.decimalPlaces < 0 || input.decimalPlaces > 9) throw new Error("CANONICAL_CURRENCY_DECIMAL_PLACES_INVALID");
    const payload = fingerprint([["currencyName", input.currencyName], ["decimalPlaces", input.decimalPlaces], ["active", input.active ?? true]]);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.database.withTransaction(async (transaction) => {
          const prior = (await transaction.query<DefinitionImportRow[]>("SELECT currency_id,payload_fingerprint FROM canonical_currency_definition_imports WHERE source_system=? AND source_namespace=? AND source_identifier=? FOR UPDATE", [input.sourceSystem, input.sourceNamespace, input.sourceIdentifier]))[0];
          if (prior !== undefined) {
            if (prior.payload_fingerprint !== payload) throw new Error("CANONICAL_CURRENCY_DEFINITION_PAYLOAD_CONFLICT");
            return { currencyId: prior.currency_id, replayed: true };
          }
          const identity = new MariaObjectIdentityAuditProvider(createScopedDatabaseClient(transaction));
          const definition = await identity.registerCrosswalk({ actor: input.actor, objectType: "CURRENCY", sourceSystem: input.sourceSystem, sourceNamespace: input.sourceNamespace, sourceIdentifier: input.sourceIdentifier });
          const imported = await identity.registerCrosswalk({ actor: input.actor, objectType: "CURRENCY_IMPORT", sourceSystem: input.sourceSystem, sourceNamespace: "currencyDefinitionImport", sourceIdentifier: createHash("sha256").update(`${input.sourceNamespace}:${input.sourceIdentifier}`, "utf8").digest("hex") });
          const audit = definition.audit;
          await transaction.execute("INSERT INTO canonical_currency_definitions(currency_id,currency_name,decimal_places,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?)", [definition.objectIdentityId, input.currencyName, input.decimalPlaces, input.active ?? true, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
          await transaction.execute("INSERT INTO canonical_currency_definition_imports(currency_definition_import_id,currency_id,source_system,source_namespace,source_identifier,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?)", [imported.objectIdentityId, definition.objectIdentityId, input.sourceSystem, input.sourceNamespace, input.sourceIdentifier, payload, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
          return { currencyId: definition.objectIdentityId, replayed: false };
        });
      } catch (error) {
        if (!duplicate(error) && !retryableLock(error)) throw error;
        const committed = (await this.database.query<DefinitionImportRow[]>("SELECT currency_id,payload_fingerprint FROM canonical_currency_definition_imports WHERE source_system=? AND source_namespace=? AND source_identifier=?", [input.sourceSystem, input.sourceNamespace, input.sourceIdentifier]))[0];
        if (committed !== undefined) {
          if (committed.payload_fingerprint !== payload) throw new Error("CANONICAL_CURRENCY_DEFINITION_PAYLOAD_CONFLICT");
          return { currencyId: committed.currency_id, replayed: true };
        }
        if (attempt === 2) throw error;
      }
    }
    throw new Error("CANONICAL_CURRENCY_DEFINITION_RETRY_EXHAUSTED");
  }

  public async adjustBalance(input: CanonicalCurrencyAdjustmentInput): Promise<CanonicalCurrencyAdjustmentResult> {
    identifier(input.playerId); identifier(input.currencyId);
    text(input.requestKey, 182, "CANONICAL_CURRENCY_REQUEST_KEY_INVALID");
    asciiKey(input.operationKind, 50, "CANONICAL_CURRENCY_OPERATION_KIND_INVALID");
    asciiKey(input.reasonKey, 100, "CANONICAL_CURRENCY_REASON_KEY_INVALID");
    assertCanonicalCurrencyDelta(input.deltaMinorAmount);
    const payload = fingerprint([["currencyId", input.currencyId], ["deltaMinorAmount", input.deltaMinorAmount.toString()], ["operationKind", input.operationKind], ["reasonKey", input.reasonKey]]);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await this.database.withTransaction((transaction) => this.adjustInTransaction(transaction, input, payload)); }
      catch (error) {
        if (!duplicate(error) && !retryableLock(error)) throw error;
        const committed = await this.findReplay(input.playerId, input.requestKey);
        if (committed !== undefined) return replay(committed, input.operationKind, payload);
        if (attempt === 2) throw error;
      }
    }
    throw new Error("CANONICAL_CURRENCY_OPERATION_RETRY_EXHAUSTED");
  }

  private async findReplay(playerId: string, requestKey: string): Promise<ReplayRow | undefined> {
    return (await this.database.query<ReplayRow[]>("SELECT currency_operation_id,player_currency_balance_id,operation_kind,payload_fingerprint,balance_after_minor_amount FROM canonical_currency_operations WHERE player_id=? AND request_key=?", [playerId, requestKey]))[0];
  }

  private async adjustInTransaction(transaction: DatabaseTransaction, input: CanonicalCurrencyAdjustmentInput, payload: string): Promise<CanonicalCurrencyAdjustmentResult> {
    const prior = (await transaction.query<ReplayRow[]>("SELECT currency_operation_id,player_currency_balance_id,operation_kind,payload_fingerprint,balance_after_minor_amount FROM canonical_currency_operations WHERE player_id=? AND request_key=? FOR UPDATE", [input.playerId, input.requestKey]))[0];
    if (prior !== undefined) return replay(prior, input.operationKind, payload);
    const definition = (await transaction.query<DefinitionRow[]>("SELECT currency_id,active_flag FROM canonical_currency_definitions WHERE currency_id=? FOR UPDATE", [input.currencyId]))[0];
    if (definition === undefined) throw new Error("CANONICAL_CURRENCY_DEFINITION_NOT_FOUND");
    if (definition.active_flag !== true && definition.active_flag !== 1) throw new Error("CANONICAL_CURRENCY_DEFINITION_INACTIVE");
    const identity = new MariaObjectIdentityAuditProvider(createScopedDatabaseClient(transaction));
    let balance = (await transaction.query<BalanceRow[]>("SELECT player_currency_balance_id,balance_minor_amount FROM canonical_player_currency_balances WHERE player_id=? AND currency_id=? FOR UPDATE", [input.playerId, input.currencyId]))[0];
    if (balance === undefined) {
      const created = await identity.registerCrosswalk({ actor: input.actor, objectType: "PLAYER_CURRENCY_BALANCE", sourceSystem: "CANONICAL_RUNTIME", sourceNamespace: "playerCurrencyBalance", sourceIdentifier: `${input.playerId}:${input.currencyId}` });
      const audit = created.audit;
      await transaction.execute("INSERT INTO canonical_player_currency_balances(player_currency_balance_id,player_id,currency_id,balance_minor_amount,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,0,?,?,?,?)", [created.objectIdentityId, input.playerId, input.currencyId, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      balance = { player_currency_balance_id: created.objectIdentityId, balance_minor_amount: 0n };
    }
    const before = BigInt(balance.balance_minor_amount);
    const after = before + input.deltaMinorAmount;
    if (after < 0n) throw new Error("CANONICAL_CURRENCY_BALANCE_INSUFFICIENT");
    if (after > UNSIGNED_BIGINT_MAX) throw new Error("CANONICAL_CURRENCY_BALANCE_OVERFLOW");
    const operation = await identity.registerCrosswalk({ actor: input.actor, objectType: "CURRENCY_OPERATION", sourceSystem: "CANONICAL_RUNTIME", sourceNamespace: "currencyOperation", sourceIdentifier: `${input.playerId}:${input.requestKey}` });
    const ledger = await identity.registerCrosswalk({ actor: input.actor, objectType: "CURRENCY_LEDGER_ENTRY", sourceSystem: "CANONICAL_RUNTIME", sourceNamespace: "currencyLedgerEntry", sourceIdentifier: `${operation.objectIdentityId}:1` });
    const audit = operation.audit;
    await transaction.execute("UPDATE canonical_player_currency_balances SET balance_minor_amount=?,UPDATE_USER=?,UPDATE_TIME=? WHERE player_currency_balance_id=?", [after.toString(), audit.UPDATE_USER, audit.UPDATE_TIME, balance.player_currency_balance_id]);
    await transaction.execute("INSERT INTO canonical_currency_operations(currency_operation_id,player_id,currency_id,player_currency_balance_id,request_key,operation_kind,reason_key,payload_fingerprint,delta_minor_amount,balance_after_minor_amount,operation_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,'completed',?,?,?,?)", [operation.objectIdentityId, input.playerId, input.currencyId, balance.player_currency_balance_id, input.requestKey, input.operationKind, input.reasonKey, payload, input.deltaMinorAmount.toString(), after.toString(), audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
    await transaction.execute("INSERT INTO canonical_currency_ledger_entries(currency_ledger_entry_id,currency_operation_id,player_currency_balance_id,sequence_number,delta_minor_amount,balance_after_minor_amount,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,1,?,?,?,?,?,?)", [ledger.objectIdentityId, operation.objectIdentityId, balance.player_currency_balance_id, input.deltaMinorAmount.toString(), after.toString(), audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
    return { currencyOperationId: operation.objectIdentityId, playerCurrencyBalanceId: balance.player_currency_balance_id, balanceAfterMinorAmount: after, replayed: false };
  }
}
