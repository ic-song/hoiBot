export interface Wbs790MariaConfig { host:string;port:number;user:string;password:string;name:string; }

export function requireWbs790IsolatedMariaEnvironment(env:NodeJS.ProcessEnv):Wbs790MariaConfig {
  if(env.DATABASE_HOST!=="127.0.0.1")throw new Error("WBS790_HOST_FORBIDDEN");
  if(env.DATABASE_PORT!=="3347")throw new Error("WBS790_PORT_FORBIDDEN");
  if(env.DATABASE_USER!=="wbs790")throw new Error("WBS790_USER_FORBIDDEN");
  if(env.DATABASE_PASSWORD!=="test-only")throw new Error("WBS790_PASSWORD_FORBIDDEN");
  if(env.DATABASE_NAME!=="hoibot_wbs790")throw new Error("WBS790_DATABASE_NAME_FORBIDDEN");
  return {host:env.DATABASE_HOST,port:3347,user:env.DATABASE_USER,password:env.DATABASE_PASSWORD,name:env.DATABASE_NAME};
}
