import { init, isCuid } from "@paralleldrive/cuid2";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

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

interface CrosswalkRow { object_identity_crosswalk_id: string; object_identity_id: string; }

function isDuplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";
  return code === "ER_DUP_ENTRY" || /duplicate entry/i.test(message);
}

function isSourceDuplicate(error: unknown): boolean {
  if (!isDuplicate(error)) return false;
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  return message.includes("uq_object_identity_crosswalk_source");
}

// source namespace와 식별자는 원문을 보존하되 저장 가능한 명시 입력만 허용합니다.
function assertCrosswalkInput(input: ObjectIdentityCrosswalkInput): void {
  const asciiToken = (value: string, maxLength: number, code: string): void => {
    if (value.trim() === "" || value.length > maxLength || !/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(code);
  };
  asciiToken(input.objectType, 50, "OBJECT_IDENTITY_TYPE_INVALID");
  asciiToken(input.sourceSystem, 50, "OBJECT_IDENTITY_SOURCE_SYSTEM_INVALID");
  asciiToken(input.sourceNamespace, 100, "OBJECT_IDENTITY_SOURCE_NAMESPACE_INVALID");
  if (input.sourceIdentifier.trim() === "" || input.sourceIdentifier.length > 191) throw new Error("OBJECT_IDENTITY_SOURCE_IDENTIFIER_INVALID");
}

// CUID2 후보를 DB PK 충돌 확인과 제한된 재시도로 예약합니다.
async function reserveIdentity(
  insert: (candidate: string) => Promise<void>,
  generate: ObjectIdentityCandidateGenerator,
  maxAttempts: number
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = generate();
    assertObjectIdentityCandidate(candidate);
    try {
      await insert(candidate);
      return candidate;
    } catch (error) {
      if (!isDuplicate(error)) throw error;
    }
  }
  throw new Error("OBJECT_IDENTITY_COLLISION_RETRY_EXHAUSTED");
}

// 레거시/source 식별자를 canonical object identity PK로 멱등 연결합니다.
export class MariaObjectIdentityAuditProvider {
  constructor(
    private readonly database: DatabaseClient,
    private readonly generate: ObjectIdentityCandidateGenerator = createObjectIdentityCandidate,
    private readonly maxAttempts = OBJECT_IDENTITY_MAX_ATTEMPTS,
    private readonly now: () => Date = () => new Date()
  ) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("OBJECT_IDENTITY_MAX_ATTEMPTS_INVALID");
  }

  async registerCrosswalk(input: ObjectIdentityCrosswalkInput): Promise<ObjectIdentityCrosswalkResult> {
    assertCrosswalkInput(input);
    const audit = createObjectAuditValues(input.actor, this.now());
    return this.database.withTransaction(async (transaction) => {
      const existing = (await transaction.query<CrosswalkRow[]>(
        "SELECT object_identity_crosswalk_id,object_identity_id FROM object_identity_crosswalks WHERE source_system=? AND source_namespace=? AND source_identifier=? FOR UPDATE",
        [input.sourceSystem, input.sourceNamespace, input.sourceIdentifier]
      ))[0];
      if (existing !== undefined) return { objectIdentityId: existing.object_identity_id, objectIdentityCrosswalkId: existing.object_identity_crosswalk_id, replayed: true, audit };
      const objectIdentityId = await reserveIdentity(
        (candidate) => transaction.execute(
          "INSERT INTO object_identities(object_identity_id,object_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?)",
          [candidate, input.objectType, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
        ).then(() => undefined), this.generate, this.maxAttempts
      );
      for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
        const crosswalkId = this.generate();
        assertObjectIdentityCandidate(crosswalkId);
        try {
          await transaction.execute(
            "INSERT INTO object_identity_crosswalks(object_identity_crosswalk_id,object_identity_id,source_system,source_namespace,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?)",
            [crosswalkId, objectIdentityId, input.sourceSystem, input.sourceNamespace, input.sourceIdentifier, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
          );
          return { objectIdentityId, objectIdentityCrosswalkId: crosswalkId, replayed: false, audit };
        } catch (error) {
          if (isSourceDuplicate(error)) {
            const concurrent = (await transaction.query<CrosswalkRow[]>(
              "SELECT object_identity_crosswalk_id,object_identity_id FROM object_identity_crosswalks WHERE source_system=? AND source_namespace=? AND source_identifier=?",
              [input.sourceSystem, input.sourceNamespace, input.sourceIdentifier]
            ))[0];
            if (concurrent !== undefined) return { objectIdentityId: concurrent.object_identity_id, objectIdentityCrosswalkId: concurrent.object_identity_crosswalk_id, replayed: true, audit };
            throw error;
          }
          if (!isDuplicate(error)) throw error;
        }
      }
      throw new Error("OBJECT_IDENTITY_COLLISION_RETRY_EXHAUSTED");
    });
  }

  // source 식별자의 감사 주체만 변경하고 canonical PK는 보존합니다.
  async touchCrosswalk(input: Pick<ObjectIdentityCrosswalkInput, "actor" | "sourceSystem" | "sourceNamespace" | "sourceIdentifier">): Promise<ObjectAuditValues> {
    const audit = createObjectAuditValues(input.actor, this.now());
    const result = await this.database.execute(
      "UPDATE object_identity_crosswalks SET UPDATE_USER=?,UPDATE_TIME=? WHERE source_system=? AND source_namespace=? AND source_identifier=?",
      [audit.UPDATE_USER, audit.UPDATE_TIME, input.sourceSystem, input.sourceNamespace, input.sourceIdentifier]
    );
    if (result.affectedRows !== 1n) throw new Error("OBJECT_IDENTITY_CROSSWALK_NOT_FOUND");
    return audit;
  }
}
