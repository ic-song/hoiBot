export interface RecentEvent {
  requestId: string;
  receivedAt: string;
  payload: unknown;
}

export class RecentEventStore {
  private readonly events: RecentEvent[] = [];

  public constructor(private readonly limit: number) {}

  // 가장 최근 Iris 이벤트를 메모리에 제한된 개수만 보관합니다.
  public add(event: RecentEvent): void {
    this.events.unshift(event);
    if (this.events.length > this.limit) {
      this.events.length = this.limit;
    }
  }

  // 외부 변경을 막기 위해 최근 이벤트 목록의 복사본을 반환합니다.
  public list(): RecentEvent[] {
    return this.events.slice();
  }
}
