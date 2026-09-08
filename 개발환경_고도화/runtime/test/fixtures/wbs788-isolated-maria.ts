export interface Wbs788IsolatedMariaConfig {
  host: "127.0.0.1";
  port: number;
  user: string;
  password: string;
  name: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`WBS788_ISOLATION_${name}_REQUIRED`);
  return value;
}

// 시험 활성화 시 연결 생성보다 먼저 localhost·비운영 포트·전용 DB 이름을 fail closed 합니다.
export function requireWbs788IsolatedMariaEnvironment(env: NodeJS.ProcessEnv): Wbs788IsolatedMariaConfig {
  const host = required(env, "DATABASE_HOST");
  const portText = required(env, "DATABASE_PORT");
  const name = required(env, "DATABASE_NAME");
  const port = Number(portText);
  if (host !== "127.0.0.1") throw new Error("WBS788_ISOLATION_HOST_FORBIDDEN");
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || port === 3306) throw new Error("WBS788_ISOLATION_PORT_FORBIDDEN");
  if (!/^hoibot_wbs788(?:_[a-z0-9_]+)?$/.test(name)) throw new Error("WBS788_ISOLATION_DATABASE_NAME_FORBIDDEN");
  return {
    host,
    port,
    user: required(env, "DATABASE_USER"),
    password: required(env, "DATABASE_PASSWORD"),
    name,
  };
}
