// 일반 회원가입 명령만 웹 가입 진입으로 분리합니다.
export function isSiteSignupEntryCommand(message: string | undefined): boolean {
  return message === "/가입";
}

// 카카오톡에서 웹 가입과 인증 순서를 안내합니다.
export function buildSiteSignupEntryMessage(): string {
  return [
    "🌍 호이월드 회원가입",
    "웹사이트 /signup 에서 계정을 만든 뒤,",
    "발급된 8자리 코드로 카카오톡에 /인증 코드 를 입력해 주세요.",
    "예: /인증 ABCD2345"
  ].join("\n");
}
