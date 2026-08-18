export type GuildForceExpelCommand = { kind: "ignored" } | { kind: "usage" } | { kind: "expel"; targetName: string };

const COMMAND = "/길드강제제명";

// 길드 강제제명 명령 후보만 dispatch 대상으로 분류합니다.
export function isGuildForceExpelCommandCandidate(message: string | undefined): boolean {
  return message === COMMAND || message?.indexOf(COMMAND + " ") === 0;
}

// 공백을 포함할 수 있는 대상 닉네임을 정확한 명령 접두사 뒤에서 추출합니다.
export function parseGuildForceExpelCommand(message: string): GuildForceExpelCommand {
  if (message === COMMAND) return { kind: "usage" };
  if (!isGuildForceExpelCommandCandidate(message)) return { kind: "ignored" };
  const targetName = message.slice(COMMAND.length).trim();
  return targetName === "" ? { kind: "usage" } : { kind: "expel", targetName };
}

// 강제제명 성공 답장을 레거시 형식으로 생성합니다.
export function buildGuildForceExpelCompletedMessage(targetName: string, guildName: string, guildMark: string): string {
  return "✅ 길드 강제제명 완료\n유저: " + targetName + "\n길드: " + guildName + (guildMark === "" ? "" : "(" + guildMark + ")");
}
