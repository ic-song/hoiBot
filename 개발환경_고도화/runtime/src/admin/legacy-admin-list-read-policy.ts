// Legacy /관리자명단 reply contract, intentionally independent from the internal operator API.
export function buildLegacyAdminListReply(adminSource: unknown, allsee: string): string {
  const names = getLegacyAdminNames(adminSource);
  if (names.length === 0) return "현재 관리자가 없습니다.";

  let message = "🛠 관리자 명단\n";
  message += "━━━━━━━━━━━━\n";
  message += `총 관리자 수: ${formatLegacyCount(names.length)}명\n`;
  message += "━━━━━━━━━━━━\n";
  message += `관리자 명단 보기👈${allsee}\n`;
  names.forEach((name, index) => { message += `${index + 1}. ${name}\n`; });
  return message.trim();
}

// Legacy data.admin stores public administrator names as object keys.
export function getLegacyAdminNames(adminSource: unknown): string[] {
  if (adminSource === null || typeof adminSource !== "object") return [];
  return Object.keys(adminSource).sort((left, right) => left.localeCompare(right, "ko"));
}

function formatLegacyCount(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
