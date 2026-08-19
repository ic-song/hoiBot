// MessengerBot의 정적 HoiBotVersion 원천을 런타임에서 읽기 전용으로 제공합니다.
export const CURRENT_HOIBOT_VERSION = "2.393";

export interface HoiBotVersionProvider {
  getVersion(): string;
}

// 환경설정이나 DB를 참조하지 않는 버전 원천입니다.
export class StaticHoiBotVersionProvider implements HoiBotVersionProvider {
  getVersion(): string {
    return CURRENT_HOIBOT_VERSION;
  }
}

// 기존 MessengerBot의 exact guard와 `ver_` 응답 형식을 그대로 보존합니다.
export function adaptHoiBotVersionCommand(
  message: string,
  provider: HoiBotVersionProvider = new StaticHoiBotVersionProvider()
): string | undefined {
  if (message !== "/호이봇버전") {
    return undefined;
  }

  return `ver_${provider.getVersion()}`;
}
