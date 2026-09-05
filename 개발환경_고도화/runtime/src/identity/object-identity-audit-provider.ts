import { init, isCuid } from "@paralleldrive/cuid2";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import {
  insertWithCuid8CollisionRetry,
  isMariaBusinessUniqueConflict,
  withMariaTransactionRetry
} from "../shared/maria-database-error-policy.js";

export const OBJECT_IDENTITY_LENGTH = 8;
export const OBJECT_IDENTITY_MAX_ATTEMPTS = 8;
const createCuid2 = init({ length: OBJECT_IDENTITY_LENGTH });

export interface ObjectAuditValues {
  INSERT_USER: string;
  INSERT_TIME: string;
  UPDATE_USER: string;
  UPDATE_TIME: string;
}

export interface ObjectIdentityCrosswalkInput {
  actor: string;
  objectType: string;
  sourceSystem: string;
  sourceNamespace: string;
  sourceIdentifier: string;
}

export interface ObjectImportBindingInput extends Omit<ObjectIdentityCrosswalkInput, "sourceIdentifier"> {
  sourceLocatorSha256: string;
  payloadFingerprint: string;
}

export interface ObjectIdentityCrosswalkResult {
  objectIdentityId: string;
  objectIdentityCrosswalkId: string;
  replayed: boolean;
  audit: ObjectAuditValues;
}

export type ObjectIdentityCandidateGenerator = () => string;

// 검증 가능한 CUID2 라이브러리로 8자리 canonical PK 후보를 생성합니다.
export function createObjectIdentityCandidate(): string {
  return createCuid2();
}

// 후보가 공용 CUID2 8자리 계약을 만족하는지 확인합니다.
export function assertObjectIdentityCandidate(value: string): void {
  if (!isCuid(value, { minLength: OBJECT_IDENTITY_LENGTH, maxLength: OBJECT_IDENTITY_LENGTH })) throw new Error("OBJECT_IDENTITY_CANDIDATE_INVALID");
}

// KST 기준 24시간 감사 시각을 표준 문자열로 변환합니다.
export function formatKstDateTime(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((entry) => entry.type === type)?.value ?? "";
  const result = `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(result)) throw new Error("OBJECT_AUDIT_KST_FORMAT_INVALID");
  return result;
}

// insert와 update에 사용할 감사 값을 같은 KST 시각으로 생성합니다.
export function createObjectAuditValues(actor: string, now: Date = new Date()): ObjectAuditValues {
  if (actor.trim() === "" || actor.length > 100) throw new Error("OBJECT_AUDIT_ACTOR_INVALID");
  const timestamp = formatKstDateTime(now);
  return { INSERT_USER: actor, INSERT_TIME: timestamp, UPDATE_USER: actor, UPDATE_TIME: timestamp };
}

interface CrosswalkRow extends ObjectAuditValues { object_identity_crosswalk_id: string; object_identity_id: string; }
interface ImportCrosswalkRow extends CrosswalkRow { object_type: string; payload_fingerprint: string | null; }

// source namespace와 식별자는 원문을 보존하되 저장 가능한 명시 입력만 허용합니다.
function assertSourceLocator(input: Pick<ObjectIdentityCrosswalkInput, "sourceSystem" | "sourceNamespace" | "sourceIdentifier">): void {
  const asciiToken = (value: string, maxLength: number, code: string): void => {
    if (value.trim() === "" || value.length > maxLength || !/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(code);
  };
  asciiToken(input.sourceSystem, 50, "OBJECT_IDENTITY_SOURCE_SYSTEM_INVALID");
  asciiToken(input.sourceNamespace, 100, "OBJECT_IDENTITY_SOURCE_NAMESPACE_INVALID");
  if (input.sourceIdentifier.trim() === "" || input.sourceIdentifier.length > 191) throw new Error("OBJECT_IDENTITY_SOURCE_IDENTIFIER_INVALID");
}

function assertCrosswalkInput(input: ObjectIdentityCrosswalkInput): void {
  assertSourceLocator(input);
  if (!/^[A-Z][A-Z0-9_]{0,49}$/.test(input.objectType)) throw new Error("OBJECT_IDENTITY_TYPE_INVALID");
}

function assertImportBindingInput(input: ObjectImportBindingInput): void {
  assertCrosswalkInput({ ...input, sourceIdentifier: input.sourceLocatorSha256 });
  if (!/^[0-9a-f]{64}$/.test(input.sourceLocatorSha256)) throw new Error("OBJECT_IDENTITY_IMPORT_SOURCE_LOCATOR_INVALID");
  if (!/^[0-9a-f]{64}$/.test(input.payloadFingerprint)) throw new Error("OBJECT_IDENTITY_IMPORT_PAYLOAD_FINGERPRINT_INVALID");
}

// CUID2 후보를 DB PK 충돌 확인과 제한된 재시도로 예약합니다.
async function reserveIdentity(
  insert: (candidate: string) => Promise<void>,
  generate: ObjectIdentityCandidateGenerator,
  maxAttempts: number
): Promise<string> {
  return insertWithCuid8CollisionRetry(async (candidate) => {
    assertObjectIdentityCandidate(candidate);
    await insert(candidate);
  }, { generate, maxAttempts, exhaustedErrorCode: "OBJECT_IDENTITY_COLLISION_RETRY_EXHAUSTED" });
}

// 레거시/source 식별자를 canonical object identity PK로 멱등 연결합니다.
export class MariaObjectIdentityAuditProvider {
  constructor(
    private readonly database: DatabaseClient,
    private readonly generate: ObjectIdentityCandidateGenerator = createObjectIdentityCandidate,
    private readonly maxAttempts = OBJECT_IDENTITY_MAX_ATTEMPTS,
    private readonly now: () => Date = () => new Date()
  ) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > OBJECT_IDENTITY_MAX_ATTEMPTS) throw new Error("OBJECT_IDENTITY_MAX_ATTEMPTS_INVALID");
  }

  async registerCrosswalk(input: ObjectIdentityCrosswalkInput): Promise<ObjectIdentityCrosswalkResult> {
    assertCrosswalkInput(input);
    const audit = createObjectAuditValues(input.actor, this.now());
    try {
      return await withMariaTransactionRetry(this.database, {
        maxAttempts: this.maxAttempts,
        allowRetry: () => true,
        exhaustedErrorCode: "OBJECT_IDENTITY_TRANSACTION_RETRY_EXHAUSTED"
      }, async (transaction) => {
          const existing = (await transaction.query<CrosswalkRow[]>(
            "SELECT object_identity_crosswalk_id,object_identity_id,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME FROM object_identity_crosswalks WHERE source_system=? AND source_namespace=? AND source_identifier=? FOR UPDATE",
            [input.sourceSystem, input.sourceNamespace, input.sourceIdentifier]
          ))[0];
          if (existing !== undefined) return { objectIdentityId: existing.object_identity_id, objectIdentityCrosswalkId: existing.object_identity_crosswalk_id, replayed: true, audit: auditFrom(existing) };
          const objectIdentityId = await reserveIdentity(
        (candidate) => transaction.execute(
          "INSERT INTO object_identities(object_identity_id,object_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?)",
          [candidate, input.objectType, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
        ).then(() => undefined), this.generate, this.maxAttempts
          );
          const crosswalkId = await reserveIdentity((candidate) => transaction.execute(
            "INSERT INTO object_identity_crosswalks(object_identity_crosswalk_id,object_identity_id,source_system,source_namespace,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?)",
            [candidate, objectIdentityId, input.sourceSystem, input.sourceNamespace, input.sourceIdentifier, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
          ).then(() => undefined), this.generate, this.maxAttempts);
          return { objectIdentityId, objectIdentityCrosswalkId: crosswalkId, replayed: false, audit };
      });
    } catch (error) {
      if (!isMariaBusinessUniqueConflict(error, "uq_object_identity_crosswalk_source")) throw error;
      const concurrent = (await this.database.query<CrosswalkRow[]>(
        "SELECT object_identity_crosswalk_id,object_identity_id,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME FROM object_identity_crosswalks WHERE source_system=? AND source_namespace=? AND source_identifier=?",
        [input.sourceSystem, input.sourceNamespace, input.sourceIdentifier]
      ))[0];
      if (concurrent !== undefined) return { objectIdentityId: concurrent.object_identity_id, objectIdentityCrosswalkId: concurrent.object_identity_crosswalk_id, replayed: true, audit: auditFrom(concurrent) };
      throw error;
    }
  }

  // 호출자가 소유한 transaction 안에서 locator와 payload fingerprint를 canonical identity에 결합합니다.
  // 오류를 내부 commit/rollback으로 감추지 않아 caller가 전체 작업을 rollback할 수 있습니다.
  async registerImportBinding(transaction: DatabaseTransaction, input: ObjectImportBindingInput): Promise<ObjectIdentityCrosswalkResult> {
    assertImportBindingInput(input);
    const existing = (await transaction.query<ImportCrosswalkRow[]>(
      "SELECT crosswalk.object_identity_crosswalk_id,crosswalk.object_identity_id,crosswalk.payload_fingerprint,identity.object_type,crosswalk.INSERT_USER,crosswalk.INSERT_TIME,crosswalk.UPDATE_USER,crosswalk.UPDATE_TIME FROM object_identity_crosswalks crosswalk JOIN object_identities identity ON identity.object_identity_id=crosswalk.object_identity_id WHERE crosswalk.source_system=? AND crosswalk.source_namespace=? AND crosswalk.source_identifier=? FOR UPDATE",
      [input.sourceSystem, input.sourceNamespace, input.sourceLocatorSha256]
    ))[0];
    if (existing !== undefined) {
      if (existing.object_type !== input.objectType) throw new Error("OBJECT_IDENTITY_IMPORT_TYPE_MISMATCH");
      if (existing.payload_fingerprint === null) throw new Error("OBJECT_IDENTITY_IMPORT_PAYLOAD_UNVERIFIED");
      if (existing.payload_fingerprint !== input.payloadFingerprint) throw new Error("OBJECT_IDENTITY_IMPORT_PAYLOAD_DRIFT");
      return { objectIdentityId: existing.object_identity_id, objectIdentityCrosswalkId: existing.object_identity_crosswalk_id, replayed: true, audit: auditFrom(existing) };
    }

    const audit = createObjectAuditValues(input.actor, this.now());
    const objectIdentityId = await reserveIdentity(
      (candidate) => transaction.execute(
        "INSERT INTO object_identities(object_identity_id,object_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?)",
        [candidate, input.objectType, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
      ).then(() => undefined),
      this.generate,
      this.maxAttempts
    );
    const objectIdentityCrosswalkId = await insertWithCuid8CollisionRetry(async (candidate) => {
        assertObjectIdentityCandidate(candidate);
        await transaction.execute(
          "INSERT INTO object_identity_crosswalks(object_identity_crosswalk_id,object_identity_id,source_system,source_namespace,source_identifier,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?)",
          [candidate, objectIdentityId, input.sourceSystem, input.sourceNamespace, input.sourceLocatorSha256, input.payloadFingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
        );
      }, { generate: this.generate, maxAttempts: this.maxAttempts, exhaustedErrorCode: "OBJECT_IDENTITY_CROSSWALK_COLLISION_RETRY_EXHAUSTED" });
    return { objectIdentityId, objectIdentityCrosswalkId, replayed: false, audit };
  }

  // source 식별자의 감사 주체만 변경하고 canonical PK는 보존합니다.
  async touchCrosswalk(input: Pick<ObjectIdentityCrosswalkInput, "actor" | "sourceSystem" | "sourceNamespace" | "sourceIdentifier">): Promise<ObjectAuditValues> {
    assertSourceLocator(input);
    const audit = createObjectAuditValues(input.actor, this.now());
    const result = await this.database.execute(
      "UPDATE object_identity_crosswalks SET UPDATE_USER=?,UPDATE_TIME=? WHERE source_system=? AND source_namespace=? AND source_identifier=?",
      [audit.UPDATE_USER, audit.UPDATE_TIME, input.sourceSystem, input.sourceNamespace, input.sourceIdentifier]
    );
    if (result.affectedRows !== 1n) throw new Error("OBJECT_IDENTITY_CROSSWALK_NOT_FOUND");
    return audit;
  }
}

function auditFrom(row: ObjectAuditValues): ObjectAuditValues {
  return { INSERT_USER: row.INSERT_USER, INSERT_TIME: row.INSERT_TIME, UPDATE_USER: row.UPDATE_USER, UPDATE_TIME: row.UPDATE_TIME };
}
