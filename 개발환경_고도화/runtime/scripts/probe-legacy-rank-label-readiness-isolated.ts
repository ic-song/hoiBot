import mariadb from "mariadb";
import { LegacyRankLabelSideEffectReadinessProvider } from "../src/inventory/legacy-rank-label-side-effect-readiness-provider.js";

const connection=await mariadb.createConnection({
  host:process.env.DATABASE_HOST!,
  port:Number(process.env.DATABASE_PORT!),
  user:process.env.DATABASE_USER!,
  password:process.env.DATABASE_PASSWORD!,
  database:process.env.DATABASE_NAME!,
  bigIntAsNumber:false,
});
try{
  const result=await new LegacyRankLabelSideEffectReadinessProvider().resolve(
    {query:async<T>(sql:string,values:readonly unknown[]=[])=>await connection.query(sql,[...values]) as T},
    {canonicalPlayerId:"pempty01",legacyPlayerId:"isolated-empty",externalIdentityId:"isolated-empty",displayName:"isolated-empty",rankEmoji:"",platformCode:"kakao",externalContextId:"isolated-room",selectionSource:"ACTIVE_CONTEXT"},
  );
  process.stdout.write(JSON.stringify(result));
}finally{
  await connection.end();
}
