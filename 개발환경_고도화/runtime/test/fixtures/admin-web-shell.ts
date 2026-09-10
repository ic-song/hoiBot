import type { AdminSession } from "../../src/admin/auth-service.js";
import type { ProfileView } from "../../src/player/profile.js";

export const syntheticAdminSession: AdminSession = {
  sessionId: "9001",
  operatorId: "7001",
  loginId: "shadow.manager",
  displayName: "합성 운영자",
  roleCodes: ["manager"],
  permissions: ["overview.read", "player.read", "account.restrict", "game.currency.change", "managed_backup.execute", "data_backup.execute", "data_restore.execute", "audit.read", "activity.read", "incident.read", "monitoring.read", "package.catalog.manage", "admin.balance.manage"]
};
export const syntheticAdminRestrictions = [
  {
    id: "61001",
    restrictionType: "permanent_suspension",
    status: "active",
    reason: "합성 운영 정책 위반",
    startsAt: "2026-08-29T04:10:00.000Z",
    endsAt: null
  },
  {
    id: "61000",
    restrictionType: "temporary_suspension",
    status: "revoked",
    reason: "합성 기간 정지 해제",
    startsAt: "2026-08-28T01:00:00.000Z",
    endsAt: "2026-09-04T01:00:00.000Z"
  }
] as const;

export const syntheticAdminOverview = {
  activePlayers: "1280",
  activeRestrictions: "3",
  deletionGrace: "2",
  identityCandidates: "7",
  outboxFailures: "1",
  activeOperators: "4"
};

export const syntheticAdminPlayer: ProfileView = {
  playerId: "40001",
  displayName: "합성회원",
  profileVersion: "12",
  server: { code: "hoi-1", displayName: "호이 1서버" },
  joinedAt: "2026-08-28T03:20:00.000Z",
  level: "125",
  accumulatedLevel: "1250",
  experience: { current: "7200", next: "9000" },
  rebirthCount: "4",
  termsAgreed: true,
  firstSponsor: false,
  passes: [{ code: "attendance", enabled: true, permanent: false, endsAt: "2026-09-30T00:00:00.000Z" }],
  currencies: { point: "1200000", diamond: "350" },
  currencyAccounts: [
    { code: "diamond", balance: "350", version: "4" },
    { code: "point", balance: "1200000", version: "9" }
  ],
  counters: { attendance: "21", explore: "5" },
  activeTitle: "성실한 탐험가",
  titleCount: "8",
  petTitleCount: "2",
  guild: { id: "501", name: "합성길드", mark: "◆", roleCode: "member" },
  pet: { name: "테스트펫", typeCode: "synthetic", imageValue: null, experience: "4200", enhancementLevel: "6" },
  equippedMiniPet: null,
  home: { name: "합성 홈", likes: "42", charm: "125", floorArea: "30" },
  ranks: { overall: "18" },
  badges: ["synthetic-reader"]
};

export const syntheticAdminAccountLinks = [
  {
    playerId: "40001",
    portalAccountId: "portal-synthetic-01",
    portalGameAccountLinkId: "link-synthetic-01",
    playerRole: "primary",
    linkStatus: "active",
    portalAccountStatus: "active",
    maskedLoginId: "s******r",
    platformCode: "kakao",
    contextType: "open_chat",
    selectionStatus: "active",
    selectionVersion: "18446744073709551614",
    maskedExternalUserKey: "k********y"
  }
] as const;

export const syntheticAdminAudit = {
  id: "81001",
  operationId: "71001",
  actorType: "admin_operator",
  actorId: "7001",
  targetType: "player",
  targetId: "40001",
  actionCode: "player.profile.read",
  resultCode: "success",
  reason: "synthetic shadow fixture",
  createdAt: "2026-08-30T01:00:00.000Z"
};

export const syntheticMonitoringEvent = {
  id: "91001",
  eventId: "synthetic-event-001",
  eventCode: "message_media_observed",
  eventCategory: "message",
  monitoringGroup: "media",
  channelName: "합성 운영방",
  externalChannelId: "synthetic-channel",
  verifiedDisplayName: "합성회원",
  externalUserId: "synthetic-user",
  createdAt: "2026-08-30T01:02:00.000Z"
};
