import type { MiniPetReadResult } from "./catalog-projection-repository.js";

const COMMAND = "/미니펫확률";

// 인자나 suffix가 없는 legacy 확률 조회 명령만 허용합니다.
export function isMiniPetDrawRateReadCommand(message: string | undefined): boolean {
  return message === COMMAND;
}

// allowed source order와 raw probability를 legacy 4자리 확률표로 표시합니다.
export function formatMiniPetDrawRates(result: MiniPetReadResult): string {
  const total = Number(result.totalRawProbability);
  if (result.zeroTotal || !Number.isFinite(total) || total <= 0) {
    return "미니펫 뽑기 확률의 총합이 0입니다.";
  }
  const ratios = result.catalog.map((entry) => Number(entry.rawProbability ?? 0) / total);
  const lines = ["📊 미니펫 등급별 뽑기 확률"];
  result.catalog.forEach((entry, index) => {
    lines.push(`${entry.grade}: ${(ratios[index]! * 100).toFixed(4)}%`);
  });
  lines.push(`총 확률: ${ratios.reduce((sum, ratio) => sum + ratio, 0).toFixed(4)}`);
  return lines.join("\n");
}
