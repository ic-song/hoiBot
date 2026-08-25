import type { MiniPetReadResult } from "./catalog-projection-repository.js";

// 인자 없는 미니펫 통계 명령만 실행 대상으로 인정합니다.
export function isMiniPetGradeStatsReadCommand(message: string | undefined): boolean {
  return message === "/미니펫통계";
}

// bag-only 등급 집계를 고정 순서·소수 한 자리 비율과 총합으로 출력합니다.
export function formatMiniPetGradeStats(result: MiniPetReadResult): string {
  const lines = ["📊 미니펫 등급별 통계"];
  if (result.gradeTotalCount === 0) return [...lines, "보유 중인 가방 미니펫이 없습니다."].join("\n");
  for (const row of result.gradeAggregate) {
    lines.push(`${row.grade}: ${row.count}마리 (${row.percentage}%)`);
  }
  lines.push(`총합: ${result.gradeTotalCount}마리`);
  return lines.join("\n");
}
