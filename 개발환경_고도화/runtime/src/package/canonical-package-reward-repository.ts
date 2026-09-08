import { createHash } from "node:crypto";
// OBJECT_DATA_MODEL_STANDARD_CANONICAL_PROVIDER: additive canonical model, excluded from frozen legacy-provider inventories.
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { createScopedDatabaseClient } from "../database.js";
import { MariaObjectIdentityAuditProvider } from "../identity/object-identity-audit-provider.js";
import { classifyMariaDatabaseError } from "../shared/maria-database-error-policy.js";

const MAX_TRANSACTION_ATTEMPTS = 3;
const CONCURRENT_REPLAY_READ_ATTEMPTS = 3;
const TRANSACTION_RETRY_DELAY_MS = 30;
export const CANONICAL_PACKAGE_MAX_NESTED_DEPTH = 8;
export const CANONICAL_PACKAGE_REQUEST_KEY_MAX_LENGTH = 182;
const PROBABILITY_SCALE = 10_000_000_000n;

interface RewardBase { sourceRewardIdentifier: string; rewardOrder: number; quantity: bigint; probability?: string; }
export interface CanonicalPackageItemReward extends RewardBase { kind: "item"; itemId: string; }
export interface CanonicalPackageNestedReward extends RewardBase { kind: "package"; packageId: string; }
export interface CanonicalPackageGapReward {
  kind: "gap";
  sourceRewardIdentifier: string;
  rewardOrder: number;
  targetKind: "item" | "package";
  targetSourceIdentifier: string;
  targetDisplayName: string;
  quarantineReason: string;
}
export type CanonicalPackageReward = CanonicalPackageItemReward | CanonicalPackageNestedReward | CanonicalPackageGapReward;

export interface CanonicalPackageImportInput {
  actor: string;
  sourceSystem: string;
  sourceNamespace: string;
  sourceIdentifier: string;
  requestKey: string;
  packageName: string;
  packageDescription?: string;
  maxOpenQuantity: number;
  active: boolean;
  selectionMode: "all" | "weighted_one";
  rewards: readonly CanonicalPackageReward[];
}

export interface CanonicalPackageImportResult { packageDefinitionOperationId: string; packageId: string; replayed: boolean; }
interface ReplayRow { package_definition_operation_id: string; package_id: string; payload_fingerprint: string; }
interface ImportRow { package_id: string; payload_fingerprint: string; }
interface TargetRow { target_id: string; }

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function assertId(value: string): void { if (!/^[a-z][a-z0-9]{7}$/.test(value)) throw new Error("CANONICAL_PACKAGE_TARGET_IDENTIFIER_INVALID"); }
export function assertSafeCanonicalNestedPackageTarget(sourcePackageId: string, targetPackageId: string): void {
  assertId(sourcePackageId); assertId(targetPackageId);
  if (sourcePackageId === targetPackageId) throw new Error("CANONICAL_PACKAGE_NESTED_SELF_REFERENCE");
}
function assertText(value: string, max: number, error: string): void { if (value.trim() === "" || value.length > max) throw new Error(error); }
function probability(value: string | undefined): { normalized: string; units: bigint } {
  const candidate = value ?? "1";
  const matched = /^(0|1)(?:\.([0-9]{1,10}))?$/.exec(candidate);
  if (matched === null) throw new Error("CANONICAL_PACKAGE_REWARD_PROBABILITY_INVALID");
  const fraction = (matched[2] ?? "").padEnd(10, "0");
  if (matched[1] === "1" && /[1-9]/.test(fraction)) throw new Error("CANONICAL_PACKAGE_REWARD_PROBABILITY_INVALID");
  const units = BigInt(matched[1]!) * PROBABILITY_SCALE + BigInt(fraction || "0");
  if (units <= 0n || units > PROBABILITY_SCALE) throw new Error("CANONICAL_PACKAGE_REWARD_PROBABILITY_INVALID");
  return { normalized: `${matched[1]}.${fraction}`, units };
}

function assertInput(input: CanonicalPackageImportInput): void {
  assertText(input.actor, 100, "CANONICAL_PACKAGE_ACTOR_INVALID");
  if (!/^[A-Za-z0-9_.-]{1,50}$/.test(input.sourceSystem)) throw new Error("CANONICAL_PACKAGE_SOURCE_SYSTEM_INVALID");
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(input.sourceNamespace)) throw new Error("CANONICAL_PACKAGE_SOURCE_NAMESPACE_INVALID");
  assertText(input.sourceIdentifier, 191, "CANONICAL_PACKAGE_SOURCE_IDENTIFIER_INVALID");
  assertText(input.requestKey, CANONICAL_PACKAGE_REQUEST_KEY_MAX_LENGTH, "CANONICAL_PACKAGE_REQUEST_KEY_INVALID");
  assertText(input.packageName, 255, "CANONICAL_PACKAGE_NAME_INVALID");
  if (input.packageDescription !== undefined && input.packageDescription.length > 65535) throw new Error("CANONICAL_PACKAGE_DESCRIPTION_INVALID");
  if (!Number.isInteger(input.maxOpenQuantity) || input.maxOpenQuantity < 1) throw new Error("CANONICAL_PACKAGE_MAX_OPEN_INVALID");
  const orders = new Set<number>();
  const sourceRewards = new Set<string>();
  for (const reward of input.rewards) {
    assertText(reward.sourceRewardIdentifier, 191, "CANONICAL_PACKAGE_REWARD_SOURCE_INVALID");
    if (!Number.isInteger(reward.rewardOrder) || reward.rewardOrder < 1 || orders.has(reward.rewardOrder)) throw new Error("CANONICAL_PACKAGE_REWARD_ORDER_INVALID");
    if (sourceRewards.has(reward.sourceRewardIdentifier)) throw new Error("CANONICAL_PACKAGE_REWARD_SOURCE_DUPLICATE");
    orders.add(reward.rewardOrder); sourceRewards.add(reward.sourceRewardIdentifier);
    const raw = reward as unknown as Record<string, unknown>;
    if (reward.kind === "gap") {
      if ("itemId" in raw || "packageId" in raw || "quantity" in raw || "probability" in raw) throw new Error("CANONICAL_PACKAGE_REWARD_TARGET_SHAPE_INVALID");
      assertText(reward.targetSourceIdentifier, 191, "CANONICAL_PACKAGE_GAP_TARGET_SOURCE_INVALID");
      assertText(reward.targetDisplayName, 255, "CANONICAL_PACKAGE_GAP_TARGET_NAME_INVALID");
      if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(reward.quarantineReason)) throw new Error("CANONICAL_PACKAGE_GAP_REASON_INVALID");
    } else {
      if (reward.kind === "item" && (!("itemId" in raw) || "packageId" in raw)) throw new Error("CANONICAL_PACKAGE_REWARD_TARGET_SHAPE_INVALID");
      if (reward.kind === "package" && (!("packageId" in raw) || "itemId" in raw)) throw new Error("CANONICAL_PACKAGE_REWARD_TARGET_SHAPE_INVALID");
      if (reward.quantity <= 0n) throw new Error("CANONICAL_PACKAGE_REWARD_QUANTITY_INVALID");
      probability(reward.probability);
      assertId(reward.kind === "item" ? reward.itemId : reward.packageId);
    }
  }
  if (input.selectionMode === "weighted_one") {
    if (input.rewards.some((reward) => reward.kind === "gap")) throw new Error("CANONICAL_PACKAGE_WEIGHTED_GAP_UNSAFE");
    const total = input.rewards.reduce((sum, reward) => sum + (reward.kind === "gap" ? 0n : probability(reward.probability).units), 0n);
    if (total !== PROBABILITY_SCALE) throw new Error("CANONICAL_PACKAGE_WEIGHTED_PROBABILITY_SUM_INVALID");
  }
}

function payloadFingerprint(input: CanonicalPackageImportInput): string {
  const rewards = [...input.rewards].sort((left, right) => left.rewardOrder - right.rewardOrder).map((reward) => reward.kind === "gap"
    ? { ...reward }
    : { ...reward, quantity: reward.quantity.toString(), probability: probability(reward.probability).normalized });
  return hash(JSON.stringify({
    sourceSystem: input.sourceSystem,
    sourceNamespace: input.sourceNamespace,
    sourceIdentifier: input.sourceIdentifier,
    packageName: input.packageName,
    packageDescription: input.packageDescription ?? null,
    maxOpenQuantity: input.maxOpenQuantity,
    active: input.active,
    selectionMode: input.selectionMode,
    rewards,
  }));
}

function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && (("code" in error && String(error.code) === "ER_DUP_ENTRY") || ("message" in error && /duplicate entry/i.test(String(error.message))));
}
function isRetryable(error: unknown): boolean {
  const kind = classifyMariaDatabaseError(error).kind;
  return kind === "TRANSACTION_DEADLOCK" || kind === "TRANSACTION_LOCK_WAIT_TIMEOUT";
}
async function waitBeforeConcurrentReplayRead(attempt: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, TRANSACTION_RETRY_DELAY_MS * (attempt + 1)));
}

export class MariaCanonicalPackageRewardRepository {
  constructor(private readonly database: DatabaseClient) {}

  async importDefinition(input: CanonicalPackageImportInput): Promise<CanonicalPackageImportResult> {
    assertInput(input);
    for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try { return await this.database.withTransaction((transaction) => this.importInTransaction(transaction, input)); }
      catch (error) {
        if (isDuplicate(error)) {
          const replay = await this.findReplay(input);
          if (replay !== undefined) return replay;
          if (attempt + 1 < MAX_TRANSACTION_ATTEMPTS) {
            await waitBeforeConcurrentReplayRead(attempt);
            continue;
          }
          const reconciled = await this.findConcurrentReplay(input);
          if (reconciled !== undefined) return reconciled;
        }
        if (isRetryable(error)) {
          if (attempt + 1 < MAX_TRANSACTION_ATTEMPTS) {
            await waitBeforeConcurrentReplayRead(attempt);
            continue;
          }
          const reconciled = await this.findConcurrentReplay(input);
          if (reconciled !== undefined) return reconciled;
        }
        throw error;
      }
    }
    throw new Error("CANONICAL_PACKAGE_TRANSACTION_RETRY_EXHAUSTED");
  }

  private async findConcurrentReplay(input: CanonicalPackageImportInput): Promise<CanonicalPackageImportResult | undefined> {
    for (let attempt = 0; attempt < CONCURRENT_REPLAY_READ_ATTEMPTS; attempt += 1) {
      await waitBeforeConcurrentReplayRead(attempt);
      const replay = await this.findReplay(input);
      if (replay !== undefined) return replay;
    }
    return undefined;
  }

  private async importInTransaction(transaction: DatabaseTransaction, input: CanonicalPackageImportInput): Promise<CanonicalPackageImportResult> {
    const fingerprint = payloadFingerprint(input);
    const replay = (await transaction.query<ReplayRow[]>(
      "SELECT package_definition_operation_id,package_id,payload_fingerprint FROM canonical_package_definition_replays WHERE source_system=? AND source_namespace=? AND request_key=? FOR UPDATE",
      [input.sourceSystem, input.sourceNamespace, input.requestKey],
    ))[0];
    if (replay !== undefined) return this.toReplay(replay, fingerprint);

    const imported = (await transaction.query<ImportRow[]>(
      "SELECT package_id,payload_fingerprint FROM canonical_package_definition_imports WHERE source_system=? AND source_namespace=? AND source_identifier=? FOR UPDATE",
      [input.sourceSystem, input.sourceNamespace, input.sourceIdentifier],
    ))[0];
    if (imported !== undefined && imported.payload_fingerprint !== fingerprint) throw new Error("CANONICAL_PACKAGE_SOURCE_PAYLOAD_CONFLICT");

    const scoped = createScopedDatabaseClient(transaction);
    const identity = new MariaObjectIdentityAuditProvider(scoped);
    let packageId = imported?.package_id;
    if (packageId === undefined) {
      const effectiveActive = input.active && input.rewards.every((reward) => reward.kind !== "gap");
      const definition = await identity.registerCrosswalk({ actor: input.actor, objectType: "PACKAGE", sourceSystem: input.sourceSystem, sourceNamespace: input.sourceNamespace, sourceIdentifier: input.sourceIdentifier });
      packageId = definition.objectIdentityId;
      const packageImport = await identity.registerCrosswalk({ actor: input.actor, objectType: "PACKAGE_IMPORT", sourceSystem: "CANONICAL_RUNTIME", sourceNamespace: "packageImport", sourceIdentifier: hash(`${input.sourceSystem}\u0000${input.sourceNamespace}\u0000${input.sourceIdentifier}`) });
      const group = await identity.registerCrosswalk({ actor: input.actor, objectType: "PACKAGE_REWARD_GROUP", sourceSystem: "CANONICAL_RUNTIME", sourceNamespace: "packageRewardGroup", sourceIdentifier: packageId });
      const audit = definition.audit;
      await transaction.execute(
        "INSERT INTO canonical_package_definitions(package_id,package_name,package_description,max_open_quantity,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?)",
        [packageId, input.packageName, input.packageDescription ?? null, input.maxOpenQuantity, effectiveActive, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME],
      );
      await transaction.execute(
        "INSERT INTO canonical_package_definition_imports(package_definition_import_id,package_id,source_system,source_namespace,source_identifier,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [packageImport.objectIdentityId, packageId, input.sourceSystem, input.sourceNamespace, input.sourceIdentifier, fingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME],
      );
      await transaction.execute(
        "INSERT INTO canonical_package_reward_groups(package_reward_group_id,package_id,selection_mode,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?)",
        [group.objectIdentityId, packageId, input.selectionMode, effectiveActive, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME],
      );
      for (const reward of [...input.rewards].sort((left, right) => left.rewardOrder - right.rewardOrder)) {
        await this.insertReward(transaction, identity, group.objectIdentityId, packageId, input, reward, audit);
      }
      const invalidDetail = (await transaction.query<Array<{ package_reward_entry_id: string; detail_count: number }>>(
        `SELECT reward_entry.package_reward_entry_id,
                (item_reward.package_reward_entry_id IS NOT NULL)
                +(nested_reward.package_reward_entry_id IS NOT NULL)
                +(quarantine.package_reward_entry_id IS NOT NULL) AS detail_count
           FROM canonical_package_reward_entries reward_entry
           LEFT JOIN canonical_package_item_rewards item_reward ON item_reward.package_reward_entry_id=reward_entry.package_reward_entry_id
           LEFT JOIN canonical_package_nested_rewards nested_reward ON nested_reward.package_reward_entry_id=reward_entry.package_reward_entry_id
           LEFT JOIN canonical_package_reward_quarantines quarantine ON quarantine.package_reward_entry_id=reward_entry.package_reward_entry_id
          WHERE reward_entry.package_reward_group_id=?
          HAVING detail_count<>1
          LIMIT 1 FOR UPDATE`,
        [group.objectIdentityId],
      ))[0];
      if (invalidDetail !== undefined) throw new Error("CANONICAL_PACKAGE_REWARD_DETAIL_XOR_INVALID");
    }

    const operation = await identity.registerCrosswalk({ actor: input.actor, objectType: "PACKAGE_DEFINITION_OPERATION", sourceSystem: "CANONICAL_RUNTIME", sourceNamespace: "packageDefinitionOperation", sourceIdentifier: hash(`${input.sourceSystem}\u0000${input.sourceNamespace}\u0000${input.requestKey}`) });
    const audit = operation.audit;
    await transaction.execute(
      "INSERT INTO canonical_package_definition_replays(package_definition_operation_id,source_system,source_namespace,request_key,payload_fingerprint,package_id,operation_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,'completed',?,?,?,?)",
      [operation.objectIdentityId, input.sourceSystem, input.sourceNamespace, input.requestKey, fingerprint, packageId, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME],
    );
    return { packageDefinitionOperationId: operation.objectIdentityId, packageId, replayed: imported !== undefined };
  }

  private async insertReward(
    transaction: DatabaseTransaction,
    identity: MariaObjectIdentityAuditProvider,
    groupId: string,
    packageId: string,
    input: CanonicalPackageImportInput,
    reward: CanonicalPackageReward,
    audit: { INSERT_USER: string; INSERT_TIME: string; UPDATE_USER: string; UPDATE_TIME: string },
  ): Promise<void> {
    if (reward.kind === "item") {
      const target = (await transaction.query<TargetRow[]>("SELECT item_id AS target_id FROM canonical_item_definitions WHERE item_id=? AND active_flag=TRUE FOR UPDATE", [reward.itemId]))[0];
      if (target === undefined) throw new Error("CANONICAL_PACKAGE_ITEM_TARGET_NOT_FOUND");
    } else if (reward.kind === "package") {
      assertSafeCanonicalNestedPackageTarget(packageId, reward.packageId);
      const target = (await transaction.query<TargetRow[]>("SELECT package_id AS target_id FROM canonical_package_definitions WHERE package_id=? AND active_flag=TRUE FOR UPDATE", [reward.packageId]))[0];
      if (target === undefined) throw new Error("CANONICAL_PACKAGE_NESTED_TARGET_NOT_FOUND");
      const unsafe = (await transaction.query<Array<{ package_id: string; depth: number }>>(
        `WITH RECURSIVE package_descendants(package_id,depth) AS (
           SELECT ? AS package_id,0 AS depth
           UNION ALL
           SELECT nested.package_id,package_descendants.depth+1
             FROM package_descendants
             JOIN canonical_package_reward_groups reward_group ON reward_group.package_id=package_descendants.package_id AND reward_group.active_flag=TRUE
             JOIN canonical_package_reward_entries reward_entry ON reward_entry.package_reward_group_id=reward_group.package_reward_group_id AND reward_entry.target_kind='package'
             JOIN canonical_package_nested_rewards nested ON nested.package_reward_entry_id=reward_entry.package_reward_entry_id
            WHERE package_descendants.depth<?
         )
         SELECT package_id,depth FROM package_descendants WHERE (package_id=? AND depth>0) OR depth>=? LIMIT 1 FOR UPDATE`,
        [reward.packageId, CANONICAL_PACKAGE_MAX_NESTED_DEPTH, packageId, CANONICAL_PACKAGE_MAX_NESTED_DEPTH],
      ))[0];
      if (unsafe !== undefined) throw new Error(unsafe.package_id === packageId ? "CANONICAL_PACKAGE_NESTED_CYCLE" : "CANONICAL_PACKAGE_NESTED_DEPTH_EXCEEDED");
    }
    const entry = await identity.registerCrosswalk({ actor: input.actor, objectType: "PACKAGE_REWARD_ENTRY", sourceSystem: "CANONICAL_RUNTIME", sourceNamespace: "packageRewardEntry", sourceIdentifier: hash(`${packageId}\u0000${reward.sourceRewardIdentifier}`) });
    await transaction.execute(
      "INSERT INTO canonical_package_reward_entries(package_reward_entry_id,package_reward_group_id,reward_order,target_kind,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?)",
      [entry.objectIdentityId, groupId, reward.rewardOrder, reward.kind, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME],
    );
    if (reward.kind === "item") {
      await transaction.execute("INSERT INTO canonical_package_item_rewards(package_reward_entry_id,item_id,quantity,probability,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?)", [entry.objectIdentityId, reward.itemId, reward.quantity, probability(reward.probability).normalized, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
    } else if (reward.kind === "package") {
      await transaction.execute("INSERT INTO canonical_package_nested_rewards(package_reward_entry_id,package_id,quantity,probability,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?)", [entry.objectIdentityId, reward.packageId, reward.quantity, probability(reward.probability).normalized, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
    } else {
      const quarantine = await identity.registerCrosswalk({ actor: input.actor, objectType: "PACKAGE_REWARD_QUARANTINE", sourceSystem: "CANONICAL_RUNTIME", sourceNamespace: "packageRewardQuarantine", sourceIdentifier: hash(`${packageId}\u0000${reward.sourceRewardIdentifier}`) });
      await transaction.execute(
        "INSERT INTO canonical_package_reward_quarantines(package_reward_quarantine_id,package_reward_entry_id,package_id,source_reward_identifier,target_kind,target_source_identifier,target_display_name,quarantine_reason,quarantine_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,'open',?,?,?,?)",
        [quarantine.objectIdentityId, entry.objectIdentityId, packageId, reward.sourceRewardIdentifier, reward.targetKind, reward.targetSourceIdentifier, reward.targetDisplayName, reward.quarantineReason, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME],
      );
    }
  }

  private async findReplay(input: CanonicalPackageImportInput): Promise<CanonicalPackageImportResult | undefined> {
    const replay = (await this.database.query<ReplayRow[]>("SELECT package_definition_operation_id,package_id,payload_fingerprint FROM canonical_package_definition_replays WHERE source_system=? AND source_namespace=? AND request_key=?", [input.sourceSystem, input.sourceNamespace, input.requestKey]))[0];
    return replay === undefined ? undefined : this.toReplay(replay, payloadFingerprint(input));
  }
  private toReplay(replay: ReplayRow, fingerprint: string): CanonicalPackageImportResult {
    if (replay.payload_fingerprint !== fingerprint) throw new Error("CANONICAL_PACKAGE_REQUEST_PAYLOAD_CONFLICT");
    return { packageDefinitionOperationId: replay.package_definition_operation_id, packageId: replay.package_id, replayed: true };
  }
}
