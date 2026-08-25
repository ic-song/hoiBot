import { createHash } from "node:crypto";
import { ApplicationError } from "../shared/application-error.js";
import type {
  MiniPetCatalogProjectionRepository, MiniPetEnvironmentCode, MiniPetProjectionCode,
  MiniPetPublishedSnapshotInput, MiniPetReadResult
} from "./catalog-projection-repository.js";

const COLLECTION_ALLOWED_GRADES = ["창조", "창세", "태초+", "태초", "초월+", "초월", "신화+", "신화"] as const;
const DRAW_RATE_ALLOWED_GRADES = ["일반", "고급", "희귀", "영웅", "전설", "전설+", "신화", "신화+", "초월", "초월+", "태초", "태초+", "창세", "창조"] as const;

// 발행된 등급 목록이 원본 계약의 길이와 순서를 정확히 따르는지 확인합니다.
function hasExactGradeOrder(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((grade, index) => grade === expected[index]);
}

export interface MiniPetProjectionRequest {
  projectionCode: MiniPetProjectionCode;
  environmentCode: MiniPetEnvironmentCode;
  poolVersion: string;
  snapshotAt: string;
  providerEventId: string;
  viewerExternalUserId?: string;
  targetPlayerId?: string;
  replyDestinationId?: string;
  requestChannelId?: string;
}

// 재시작 replay에서 요청 의미가 바뀌지 않았는지 확인할 hash를 생성합니다.
function requestHash(request: MiniPetProjectionRequest): string {
  return createHash("sha256").update(JSON.stringify({
    projectionCode: request.projectionCode, environmentCode: request.environmentCode,
    poolVersion: request.poolVersion, snapshotAt: request.snapshotAt,
    viewerExternalUserId: request.viewerExternalUserId,
    targetPlayerId: request.targetPlayerId ?? null,
    replyDestinationId: request.replyDestinationId ?? null,
    requestChannelId: request.requestChannelId ?? null
  })).digest("hex");
}

export class MiniPetCatalogProjectionService {
  constructor(
    private readonly repository: MiniPetCatalogProjectionRepository,
    private readonly expectedEnvironmentCode: MiniPetEnvironmentCode
  ) {}

  // read projection만 허용하고 mutation/draw 실행은 이 provider에서 거부합니다.
  async read(request: MiniPetProjectionRequest): Promise<MiniPetReadResult> {
    if (request.environmentCode !== this.expectedEnvironmentCode) {
      throw new ApplicationError("MINIPET_ENVIRONMENT_MISMATCH", "요청과 provider DB 환경이 일치하지 않습니다.", 409);
    }
    if (request.poolVersion.trim().length === 0 || Number.isNaN(new Date(request.snapshotAt).getTime())) {
      throw new ApplicationError("MINIPET_SNAPSHOT_PIN_INVALID", "poolVersion과 snapshotAt이 필요합니다.", 422);
    }
    if ((request.projectionCode === "inventory" || request.projectionCode === "admin_info")
      && request.targetPlayerId === undefined) {
      throw new ApplicationError("MINIPET_TARGET_REQUIRED", "대상 player ID가 필요합니다.", 422);
    }
    if ((request.projectionCode === "inventory" || request.projectionCode === "admin_info"
      || request.projectionCode === "collection") && request.viewerExternalUserId === undefined) {
      throw new ApplicationError("MINIPET_VIEWER_REQUIRED", "보호된 projection은 조회 identity가 필요합니다.", 422);
    }
    if (request.projectionCode === "admin_info" && request.requestChannelId === undefined) {
      throw new ApplicationError("MINIPET_ADMIN_CHANNEL_REQUIRED", "관리자 조회 채널 ID가 필요합니다.", 422);
    }
    return this.repository.read({ ...request, requestHash: requestHash(request) });
  }

  // 최신 published snapshot을 pin한 뒤 장착 미니펫 순위를 동일 event로 재생 가능하게 읽습니다.
  async readLatestEquippedRank(request: {
    environmentCode: MiniPetEnvironmentCode;
    providerEventId: string;
  }): Promise<MiniPetReadResult> {
    if (request.environmentCode !== this.expectedEnvironmentCode) {
      throw new ApplicationError("MINIPET_ENVIRONMENT_MISMATCH", "요청과 provider DB 환경이 일치하지 않습니다.", 409);
    }
    const pin = await this.repository.resolveLatestSnapshotPin(request.environmentCode);
    return this.read({
      projectionCode: "equipped_rank",
      environmentCode: request.environmentCode,
      poolVersion: pin.poolVersion,
      snapshotAt: pin.snapshotAt,
      providerEventId: request.providerEventId
    });
  }

  // 최신 immutable snapshot에서 대상 이름을 해석한 뒤 관리자 전용 projection을 읽습니다.
  async readLatestAdminInfo(request: {
    environmentCode: MiniPetEnvironmentCode;
    providerEventId: string;
    viewerExternalUserId: string;
    requestChannelId: string;
    targetName: string;
  }): Promise<MiniPetReadResult> {
    if (request.environmentCode !== this.expectedEnvironmentCode) {
      throw new ApplicationError("MINIPET_ENVIRONMENT_MISMATCH", "요청과 provider DB 환경이 일치하지 않습니다.", 409);
    }
    const targetName = request.targetName.trim();
    if (targetName.length === 0) throw new ApplicationError("MINIPET_ADMIN_TARGET_REQUIRED", "사용법: /미니펫정보 [대상]", 422);
    const pin = await this.repository.resolveLatestSnapshotPin(request.environmentCode);
    const target = await this.repository.resolveTargetPlayer(
      request.environmentCode, pin.poolVersion, pin.snapshotAt, targetName
    );
    const result = await this.read({
      projectionCode: "admin_info",
      environmentCode: request.environmentCode,
      poolVersion: pin.poolVersion,
      snapshotAt: pin.snapshotAt,
      providerEventId: request.providerEventId,
      viewerExternalUserId: request.viewerExternalUserId,
      targetPlayerId: target.playerId,
      requestChannelId: request.requestChannelId
    });
    return { ...result, targetDisplayName: target.displayName };
  }

  // 정확한 8등급 collection snapshot을 pin해 현재 viewer의 컬렉션을 무변이로 읽습니다.
  async readLatestCollection(request: {
    environmentCode: MiniPetEnvironmentCode;
    providerEventId: string;
    viewerExternalUserId: string;
  }): Promise<MiniPetReadResult> {
    if (request.environmentCode !== this.expectedEnvironmentCode) {
      throw new ApplicationError("MINIPET_ENVIRONMENT_MISMATCH", "요청과 provider DB 환경이 일치하지 않습니다.", 409);
    }
    const pin = await this.repository.resolveLatestCollectionSnapshotPin(request.environmentCode);
    const result = await this.read({
      projectionCode: "collection",
      environmentCode: request.environmentCode,
      poolVersion: pin.poolVersion,
      snapshotAt: pin.snapshotAt,
      providerEventId: request.providerEventId,
      viewerExternalUserId: request.viewerExternalUserId
    });
    if (!hasExactGradeOrder(result.collectionGrades.map((row) => row.grade), COLLECTION_ALLOWED_GRADES)) {
      throw new ApplicationError("MINIPET_COLLECTION_GRADES_INVALID", "컬렉션 8등급 snapshot 순서가 올바르지 않습니다.", 409);
    }
    return result;
  }

  // current gradeTable과 allowedGrades를 immutable published snapshot으로 발행합니다.
  async publishSnapshot(request: MiniPetPublishedSnapshotInput) {
    if (request.environmentCode !== this.expectedEnvironmentCode) {
      throw new ApplicationError("MINIPET_ENVIRONMENT_MISMATCH", "요청과 provider DB 환경이 일치하지 않습니다.", 409);
    }
    const expectedGrades = request.catalogKind === "draw_rate" ? DRAW_RATE_ALLOWED_GRADES : COLLECTION_ALLOWED_GRADES;
    if (!hasExactGradeOrder(request.allowedGrades, expectedGrades)) {
      throw new ApplicationError("MINIPET_ALLOWED_GRADES_INVALID", `${request.catalogKind} snapshot의 allowedGrades 목록과 순서가 원본 계약과 일치해야 합니다.`, 422);
    }
    if (request.entries.some((entry) => !request.allowedGrades.includes(entry.grade))) {
      throw new ApplicationError("MINIPET_ENTRY_GRADE_INVALID", "catalog entry grade가 allowedGrades에 없습니다.", 422);
    }
    if (new Set(request.entries.map((entry) => entry.definitionCode)).size !== request.entries.length
      || new Set(request.entries.map((entry) => entry.sourceOrder)).size !== request.entries.length) {
      throw new ApplicationError("MINIPET_ENTRY_DUPLICATED", "catalog entry의 definitionCode와 sourceOrder는 중복될 수 없습니다.", 422);
    }
    return this.repository.publishSnapshot(request);
  }
}
