export interface FreeMarketCompletedLog {
  id: number;
  itemName: string;
  quantity: number;
  price: number;
  seller: string;
  buyer: string;
  completedAtMs: number;
  memberFeeApplied?: boolean;
}

export interface FreeMarketHistoryProvider {
  listCompletedLogs(): FreeMarketCompletedLog[];
  rankOf(name: string): string;
}

export function adaptFreeMarketHistoryCommand(message: string, provider: FreeMarketHistoryProvider): string | undefined {
  if (message !== "/자유시장거래현황" && message !== "ㅅㅅ") return undefined;
  const logs = provider.listCompletedLogs().slice(0).sort((a, b) => b.completedAtMs - a.completedAtMs || b.id - a.id);
  let out = "🤝 호월 자유시장 거래현황 🤝\n━━━━━━━━━━━━\n📖 최근 판매 완료된 거래금액이 표시됩니다\n📋[아이템x갯수][금액][판매]🤝[구매]\n💰수수료는 판매금액의 10%\n🏪 자유시장회원권 소지시 수수료 5%\n━━━━━━━━━━━━\n";
  if (logs.length === 0) return out + "최근 판매 완료된 거래가 표시됩니다.\n\n판매 완료된 거래가 없습니다.";
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i]!;
    out += `${i + 1}. [${log.itemName}x${log.quantity}개][${log.price}][${provider.rankOf(log.seller)}]🤝[${provider.rankOf(log.buyer)}]${log.memberFeeApplied ? " 자유시장회원권" : ""}\n\n`;
  }
  return out.trim();
}
