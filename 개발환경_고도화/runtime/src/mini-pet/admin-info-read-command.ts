import type { MiniPetReadResult } from "./catalog-projection-repository.js";

const SECTION_ORDER = ["profile", "collection", "draw", "equipped", "battle", "bag"] as const;
const SECTION_LABELS: Record<(typeof SECTION_ORDER)[number], string> = {
  profile: "👤 기본 정보",
  collection: "📚 미니펫 도감",
  draw: "🎟️ 미니펫 뽑기",
  equipped: "🐹 장착 미니펫",
  battle: "⚔️ 전투 정보",
  bag: "🎒 미니펫 가방"
};

// exact 명령 또는 공백으로 구분된 전체 대상 이름만 관리자 조회 대상으로 해석합니다.
export function readMiniPetAdminInfoTarget(message: string | undefined): string | undefined {
  if (message === "/미니펫정보") return "";
  const match = /^\/미니펫정보\s+(\S(?:.*\S)?)$/.exec(message ?? "");
  return match?.[1];
}

// allowlist section 값을 레거시 스냅샷의 줄바꿈을 보존해 표시합니다.
function formatSectionValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("\n");
  return JSON.stringify(value);
}

// 관리자용 full snapshot을 고정된 허용 section 순서로만 출력합니다.
export function formatMiniPetAdminInfo(result: MiniPetReadResult): string {
  const snapshot = result.adminLegacySnapshot ?? {};
  const lines = [`🔎 ${result.targetDisplayName ?? "대상"}님의 미니펫 정보`];
  for (const section of SECTION_ORDER) {
    if (!(section in snapshot)) continue;
    lines.push("", SECTION_LABELS[section], formatSectionValue(snapshot[section]));
  }
  return lines.join("\n");
}
