import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { createScopedDatabaseClient } from "../database.js";
import {
  assertObjectIdentityCandidate,
  createObjectAuditValues,
  MariaObjectIdentityAuditProvider
} from "../identity/object-identity-audit-provider.js";

export type CanonicalTitleDomain = "member" | "pet" | "mini_pet";
export type CanonicalTitleReleaseStatus = "sold" | "removed";

export interface CanonicalTitleDefinitionInput {
  domain: CanonicalTitleDomain;
  actor: string;
  sourceSystem: string;
  sourceIdentifier: string;
  titleName: string;
  baseSalePrice: bigint;
}

export interface CanonicalTitleGrantInput {
  domain: CanonicalTitleDomain;
  actor: string;
  sourceSystem: string;
  requestKey: string;
  playerId: string;
  titleDefinitionId: string;
  acquisitionSequence: bigint;
  acquiredTime: string;
  acquisitionPrice?: bigint | null;
}

export interface CanonicalTitleSelectionInput {
  domain: CanonicalTitleDomain;
  actor: string;
  playerId: string;
  ownedTitleId: string;
}

export interface CanonicalTitleDefinitionResult {
  titleDefinitionId: string;
  replayed: boolean;
}

export interface CanonicalTitleGrantResult {
  ownedTitleId: string;
  replayed: boolean;
}

export interface CanonicalOwnedTitleView {
  ownedTitleId: string;
  titleDefinitionId: string;
  titleName: string;
  baseSalePrice: bigint;
  acquisitionPrice: bigint | null;
  acquisitionSequence: bigint;
  acquiredTime: string;
  selected: boolean;
}

interface DomainConfig {
  definitionTable: string;
  definitionId: string;
  ownershipTable: string;
  ownedId: string;
  selectionTable: string;
  definitionObjectType: string;
  ownedObjectType: string;
  definitionNamespace: string;
  ownershipNamespace: string;
}

interface DefinitionRow { title_name: string; base_sale_price: bigint; }
interface OwnedRow {
  player_id: string;
  title_definition_id: string;
  acquisition_sequence: bigint;
  acquired_time: string;
  acquisition_price: bigint | null;
  ownership_status: string;
}

const KST_TIME = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const UNSIGNED_BIGINT_MAX = 18446744073709551615n;
const DOMAIN_CONFIG: Record<CanonicalTitleDomain, DomainConfig> = {
  member: {
    definitionTable: "canonical_member_title_definitions", definitionId: "member_title_id",
    ownershipTable: "canonical_owned_member_title_instances", ownedId: "owned_member_title_id",
    selectionTable: "canonical_member_title_selections", definitionObjectType: "MEMBER_TITLE_DEFINITION",
    ownedObjectType: "OWNED_MEMBER_TITLE", definitionNamespace: "memberTitleDefinition", ownershipNamespace: "ownedMemberTitle"
  },
  pet: {
    definitionTable: "canonical_pet_title_definitions", definitionId: "pet_title_id",
    ownershipTable: "canonical_owned_pet_title_instances", ownedId: "owned_pet_title_id",
    selectionTable: "canonical_pet_title_selections", definitionObjectType: "PET_TITLE_DEFINITION",
    ownedObjectType: "OWNED_PET_TITLE", definitionNamespace: "petTitleDefinition", ownershipNamespace: "ownedPetTitle"
  },
  mini_pet: {
    definitionTable: "canonical_mini_pet_title_definitions", definitionId: "mini_pet_title_id",
    ownershipTable: "canonical_owned_mini_pet_title_instances", ownedId: "owned_mini_pet_title_id",
    selectionTable: "canonical_mini_pet_title_selections", definitionObjectType: "MINI_PET_TITLE_DEFINITION",
    ownedObjectType: "OWNED_MINI_PET_TITLE", definitionNamespace: "miniPetTitleDefinition", ownershipNamespace: "ownedMiniPetTitle"
  }
};

function config(domain: CanonicalTitleDomain): DomainConfig {
  const value = DOMAIN_CONFIG[domain];
  if (value === undefined) throw new Error("CANONICAL_TITLE_DOMAIN_INVALID");
  return value;
}

function assertActorAndSource(actor: string, sourceSystem: string, sourceIdentifier: string): void {
  if (actor.trim() === "" || actor.length > 100) throw new Error("CANONICAL_TITLE_ACTOR_INVALID");
  if (!/^[A-Za-z0-9_.-]{1,50}$/.test(sourceSystem)) throw new Error("CANONICAL_TITLE_SOURCE_SYSTEM_INVALID");
  if (sourceIdentifier.trim() === "" || sourceIdentifier.length > 191) throw new Error("CANONICAL_TITLE_SOURCE_IDENTIFIER_INVALID");
}

function assertDefinitionInput(input: CanonicalTitleDefinitionInput): void {
  config(input.domain);
  assertActorAndSource(input.actor, input.sourceSystem, input.sourceIdentifier);
  if (input.titleName.trim() === "" || input.titleName.length > 255) throw new Error("CANONICAL_TITLE_NAME_INVALID");
  if (input.baseSalePrice < 0n || input.baseSalePrice > UNSIGNED_BIGINT_MAX) throw new Error("CANONICAL_TITLE_PRICE_INVALID");
}

function assertGrantInput(input: CanonicalTitleGrantInput): void {
  config(input.domain);
  assertActorAndSource(input.actor, input.sourceSystem, input.requestKey);
  if (input.requestKey.length > 182) throw new Error("CANONICAL_TITLE_REQUEST_KEY_INVALID");
  assertObjectIdentityCandidate(input.playerId);
  assertObjectIdentityCandidate(input.titleDefinitionId);
  if (input.acquisitionSequence < 1n || input.acquisitionSequence > UNSIGNED_BIGINT_MAX) throw new Error("CANONICAL_TITLE_SEQUENCE_INVALID");
  if (input.acquisitionPrice !== undefined && input.acquisitionPrice !== null && (input.acquisitionPrice < 0n || input.acquisitionPrice > UNSIGNED_BIGINT_MAX)) throw new Error("CANONICAL_TITLE_ACQUISITION_PRICE_INVALID");
  if (!KST_TIME.test(input.acquiredTime)) throw new Error("CANONICAL_TITLE_ACQUIRED_TIME_INVALID");
}

function assertSelectionInput(input: CanonicalTitleSelectionInput): void {
  config(input.domain);
  if (input.actor.trim() === "" || input.actor.length > 100) throw new Error("CANONICAL_TITLE_ACTOR_INVALID");
  assertObjectIdentityCandidate(input.playerId);
  assertObjectIdentityCandidate(input.ownedTitleId);
}

// 세 타이틀 도메인의 식별자는 공용 provider를 사용하되 테이블과 FK는 도메인별로 분리합니다.
export class MariaCanonicalTitleRepository {
  constructor(private readonly database: DatabaseClient, private readonly now: () => Date = () => new Date()) {}

  async registerDefinition(input: CanonicalTitleDefinitionInput): Promise<CanonicalTitleDefinitionResult> {
    assertDefinitionInput(input);
    const domain = config(input.domain);
    return this.database.withTransaction(async (transaction) => {
      const identity = new MariaObjectIdentityAuditProvider(createScopedDatabaseClient(transaction));
      const result = await identity.registerCrosswalk({
        actor: input.actor,
        objectType: domain.definitionObjectType,
        sourceSystem: input.sourceSystem,
        sourceNamespace: domain.definitionNamespace,
        sourceIdentifier: input.sourceIdentifier
      });
      if (result.replayed) {
        const existing = (await transaction.query<DefinitionRow[]>(
          `SELECT title_name,base_sale_price FROM ${domain.definitionTable} WHERE ${domain.definitionId}=? FOR UPDATE`,
          [result.objectIdentityId]
        ))[0];
        if (existing === undefined) throw new Error("CANONICAL_TITLE_DEFINITION_REPLAY_INCOMPLETE");
        if (existing.title_name !== input.titleName || BigInt(existing.base_sale_price) !== input.baseSalePrice) throw new Error("CANONICAL_TITLE_DEFINITION_SOURCE_CONFLICT");
        return { titleDefinitionId: result.objectIdentityId, replayed: true };
      }
      const audit = result.audit;
      await transaction.execute(
        `INSERT INTO ${domain.definitionTable}(${domain.definitionId},title_name,base_sale_price,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,TRUE,?,?,?,?)`,
        [result.objectIdentityId, input.titleName, input.baseSalePrice, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
      );
      return { titleDefinitionId: result.objectIdentityId, replayed: false };
    });
  }

  async updateDefinition(input: Pick<CanonicalTitleDefinitionInput, "domain" | "actor" | "titleName" | "baseSalePrice"> & { titleDefinitionId: string }): Promise<void> {
    config(input.domain);
    if (input.actor.trim() === "" || input.actor.length > 100 || input.titleName.trim() === "" || input.titleName.length > 255 || input.baseSalePrice < 0n || input.baseSalePrice > UNSIGNED_BIGINT_MAX) throw new Error("CANONICAL_TITLE_DEFINITION_UPDATE_INVALID");
    assertObjectIdentityCandidate(input.titleDefinitionId);
    const domain = config(input.domain);
    const audit = createObjectAuditValues(input.actor, this.now());
    await this.database.withTransaction(async (transaction) => {
      const existing = (await transaction.query<Array<{ title_definition_id: string }>>(
        `SELECT ${domain.definitionId} AS title_definition_id FROM ${domain.definitionTable} WHERE ${domain.definitionId}=? FOR UPDATE`,
        [input.titleDefinitionId]
      ))[0];
      if (existing === undefined) throw new Error("CANONICAL_TITLE_DEFINITION_NOT_FOUND");
      await transaction.execute(
        `UPDATE ${domain.definitionTable} SET title_name=?,base_sale_price=?,UPDATE_USER=?,UPDATE_TIME=? WHERE ${domain.definitionId}=?`,
        [input.titleName, input.baseSalePrice, audit.UPDATE_USER, audit.UPDATE_TIME, input.titleDefinitionId]
      );
    });
  }

  async grant(input: CanonicalTitleGrantInput): Promise<CanonicalTitleGrantResult> {
    assertGrantInput(input);
    const domain = config(input.domain);
    return this.database.withTransaction(async (transaction) => {
      const identity = new MariaObjectIdentityAuditProvider(createScopedDatabaseClient(transaction));
      const result = await identity.registerCrosswalk({
        actor: input.actor,
        objectType: domain.ownedObjectType,
        sourceSystem: input.sourceSystem,
        sourceNamespace: domain.ownershipNamespace,
        sourceIdentifier: `${input.playerId}:${input.requestKey}`
      });
      if (result.replayed) return this.verifyGrantReplay(transaction, domain, result.objectIdentityId, input);
      const audit = result.audit;
      await transaction.execute(
        `INSERT INTO ${domain.ownershipTable}(${domain.ownedId},player_id,${domain.definitionId},acquisition_sequence,acquired_time,acquisition_price,ownership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,'owned',?,?,?,?)`,
        [result.objectIdentityId, input.playerId, input.titleDefinitionId, input.acquisitionSequence, input.acquiredTime, input.acquisitionPrice ?? null, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
      );
      return { ownedTitleId: result.objectIdentityId, replayed: false };
    });
  }

  async select(input: CanonicalTitleSelectionInput): Promise<void> {
    assertSelectionInput(input);
    const domain = config(input.domain);
    const audit = createObjectAuditValues(input.actor, this.now());
    await this.database.withTransaction(async (transaction) => {
      const owned = (await transaction.query<Array<{ owned_title_id: string }>>(
        `SELECT ${domain.ownedId} AS owned_title_id FROM ${domain.ownershipTable} WHERE ${domain.ownedId}=? AND player_id=? AND ownership_status='owned' FOR UPDATE`,
        [input.ownedTitleId, input.playerId]
      ))[0];
      if (owned === undefined) throw new Error("CANONICAL_TITLE_OWNED_INSTANCE_NOT_FOUND");
      await transaction.execute(
        `INSERT INTO ${domain.selectionTable}(player_id,${domain.ownedId},INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ${domain.ownedId}=VALUES(${domain.ownedId}),UPDATE_USER=VALUES(UPDATE_USER),UPDATE_TIME=VALUES(UPDATE_TIME)`,
        [input.playerId, input.ownedTitleId, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
      );
    });
  }

  async release(input: CanonicalTitleSelectionInput & { status: CanonicalTitleReleaseStatus }): Promise<boolean> {
    assertSelectionInput(input);
    const domain = config(input.domain);
    const audit = createObjectAuditValues(input.actor, this.now());
    return this.database.withTransaction(async (transaction) => {
      const row = (await transaction.query<Array<{ ownership_status: string }>>(
        `SELECT ownership_status FROM ${domain.ownershipTable} WHERE ${domain.ownedId}=? AND player_id=? FOR UPDATE`,
        [input.ownedTitleId, input.playerId]
      ))[0];
      if (row === undefined) throw new Error("CANONICAL_TITLE_OWNED_INSTANCE_NOT_FOUND");
      if (row.ownership_status === input.status) return true;
      if (row.ownership_status !== "owned") throw new Error("CANONICAL_TITLE_RELEASE_STATUS_CONFLICT");
      await transaction.execute(`DELETE FROM ${domain.selectionTable} WHERE player_id=? AND ${domain.ownedId}=?`, [input.playerId, input.ownedTitleId]);
      await transaction.execute(
        `UPDATE ${domain.ownershipTable} SET ownership_status=?,UPDATE_USER=?,UPDATE_TIME=? WHERE ${domain.ownedId}=? AND player_id=?`,
        [input.status, audit.UPDATE_USER, audit.UPDATE_TIME, input.ownedTitleId, input.playerId]
      );
      return false;
    });
  }

  async listOwned(domainName: CanonicalTitleDomain, playerId: string): Promise<CanonicalOwnedTitleView[]> {
    assertObjectIdentityCandidate(playerId);
    const domain = config(domainName);
    const rows = await this.database.query<Array<{
      owned_title_id: string; title_definition_id: string; title_name: string; base_sale_price: bigint;
      acquisition_price: bigint | null; acquisition_sequence: bigint; acquired_time: string; selected_flag: number;
    }>>(
      `SELECT owned.${domain.ownedId} AS owned_title_id,owned.${domain.definitionId} AS title_definition_id,definition_row.title_name,definition_row.base_sale_price,owned.acquisition_price,owned.acquisition_sequence,owned.acquired_time,CASE WHEN selection_row.${domain.ownedId} IS NULL THEN 0 ELSE 1 END AS selected_flag FROM ${domain.ownershipTable} owned JOIN ${domain.definitionTable} definition_row ON definition_row.${domain.definitionId}=owned.${domain.definitionId} LEFT JOIN ${domain.selectionTable} selection_row ON selection_row.player_id=owned.player_id AND selection_row.${domain.ownedId}=owned.${domain.ownedId} WHERE owned.player_id=? AND owned.ownership_status='owned' ORDER BY owned.acquisition_sequence,owned.${domain.ownedId}`,
      [playerId]
    );
    return rows.map((row) => ({
      ownedTitleId: row.owned_title_id,
      titleDefinitionId: row.title_definition_id,
      titleName: row.title_name,
      baseSalePrice: BigInt(row.base_sale_price),
      acquisitionPrice: row.acquisition_price === null ? null : BigInt(row.acquisition_price),
      acquisitionSequence: BigInt(row.acquisition_sequence),
      acquiredTime: row.acquired_time,
      selected: Number(row.selected_flag) === 1
    }));
  }

  private async verifyGrantReplay(transaction: DatabaseTransaction, domain: DomainConfig, ownedTitleId: string, input: CanonicalTitleGrantInput): Promise<CanonicalTitleGrantResult> {
    const row = (await transaction.query<OwnedRow[]>(
      `SELECT player_id,${domain.definitionId} AS title_definition_id,acquisition_sequence,acquired_time,acquisition_price,ownership_status FROM ${domain.ownershipTable} WHERE ${domain.ownedId}=? FOR UPDATE`,
      [ownedTitleId]
    ))[0];
    if (row === undefined) throw new Error("CANONICAL_TITLE_GRANT_REPLAY_INCOMPLETE");
    if (
      row.player_id !== input.playerId || row.title_definition_id !== input.titleDefinitionId ||
      BigInt(row.acquisition_sequence) !== input.acquisitionSequence || row.acquired_time !== input.acquiredTime ||
      (row.acquisition_price === null ? null : BigInt(row.acquisition_price)) !== (input.acquisitionPrice ?? null)
    ) throw new Error("CANONICAL_TITLE_GRANT_REQUEST_CONFLICT");
    if (row.ownership_status !== "owned") throw new Error("CANONICAL_TITLE_GRANT_RELEASED_REPLAY");
    return { ownedTitleId, replayed: true };
  }
}
