type TokenKind="WORD"|"QUOTED_IDENTIFIER"|"STRING"|"SYMBOL";
interface SqlToken { readonly kind:TokenKind;readonly value:string;readonly position:number }

const FORBIDDEN_WORDS=new Set([
  "INSERT","UPDATE","DELETE","REPLACE","MERGE","CREATE","ALTER","DROP","TRUNCATE","RENAME","CALL","DO","HANDLER","SET","UNLOCK","GRANT","REVOKE","LOAD","PROCEDURE",
]);
const SIDE_EFFECT_FUNCTIONS=new Set(["GET_LOCK","RELEASE_LOCK","RELEASE_ALL_LOCKS","LAST_INSERT_ID","SLEEP","BENCHMARK"]);
const SAFE_BUILTIN_FUNCTIONS=new Set([
  "ABS","AVG","CAST","CEIL","CEILING","CHAR_LENGTH","COALESCE","CONCAT","CONCAT_WS","CONVERT","COUNT","CURRENT_TIMESTAMP","DATE_FORMAT","FIND_IN_SET","FLOOR","FROM_UNIXTIME","GREATEST","HEX","IFNULL","JSON_EXTRACT","JSON_UNQUOTE","JSON_VALUE","LEAST","LEFT","LENGTH","LOWER","LTRIM","MATCH","MAX","MD5","MIN","MOD","NOW","NULLIF","OCTET_LENGTH","RIGHT","ROUND","RTRIM","SHA2","SUBSTR","SUBSTRING","SUM","TIMESTAMPDIFF","TRIM","UNHEX","UNIX_TIMESTAMP","UPPER","UTC_TIMESTAMP",
]);
const STRUCTURAL_PARENS=new Set(["AS","EXISTS","IN","OVER"]);

function fail(code="APP_WIRING_QUERY_NOT_READ_ONLY"):never { throw new Error(code); }
function tokenize(sql:string):SqlToken[]{
  const tokens:SqlToken[]=[];
  for(let index=0;index<sql.length;){
    const char=sql[index]!;
    if(/\s/u.test(char)){index+=1;continue;}
    if(char===";"||char==="\0")fail();
    if(char==="#"||(char==="-"&&sql[index+1]==="-")||(char==="/"&&sql[index+1]==="*"))fail();
    if(char==="'"||char==='"'){
      const quote=char,start=index;index+=1;let closed=false;
      while(index<sql.length){const current=sql[index]!;if(current==="\\")fail();if(current===quote){if(sql[index+1]===quote){index+=2;continue;}index+=1;closed=true;break;}index+=1;}
      if(!closed)fail();tokens.push({kind:"STRING",value:sql.slice(start,index),position:start});continue;
    }
    if(char==="`"){
      const start=index;index+=1;let closed=false;
      while(index<sql.length){if(sql[index]==="`"){if(sql[index+1]==="`"){index+=2;continue;}index+=1;closed=true;break;}index+=1;}
      if(!closed)fail();tokens.push({kind:"QUOTED_IDENTIFIER",value:sql.slice(start,index),position:start});continue;
    }
    if(/[A-Za-z_]/.test(char)){
      const start=index;index+=1;while(index<sql.length&&/[A-Za-z0-9_$]/.test(sql[index]!))index+=1;
      tokens.push({kind:"WORD",value:sql.slice(start,index).toUpperCase(),position:start});continue;
    }
    if(/[0-9]/.test(char)){const start=index;index+=1;while(index<sql.length&&/[0-9A-Fa-f_xX.]/.test(sql[index]!))index+=1;tokens.push({kind:"SYMBOL",value:sql.slice(start,index),position:start});continue;}
    if("(),.?=<>+-*/%!&|:@".includes(char)){tokens.push({kind:"SYMBOL",value:char,position:index});index+=1;continue;}
    fail();
  }
  return tokens;
}
function word(tokens:readonly SqlToken[],index:number,value:string):boolean{return tokens[index]?.kind==="WORD"&&tokens[index]!.value===value;}
function matchingParen(tokens:readonly SqlToken[],open:number):number{
  if(tokens[open]?.value!=="(")fail();let depth=0;
  for(let index=open;index<tokens.length;index+=1){if(tokens[index]!.value==="(")depth+=1;else if(tokens[index]!.value===")"&&--depth===0)return index;}
  fail();
}
function skipCteList(tokens:readonly SqlToken[],start:number,cteColumnOpens:Set<number>):number{
  let index=start;if(word(tokens,index,"RECURSIVE"))index+=1;
  while(index<tokens.length){
    if(tokens[index]?.kind!=="WORD"&&tokens[index]?.kind!=="QUOTED_IDENTIFIER")fail();index+=1;
    if(tokens[index]?.value==="("){cteColumnOpens.add(tokens[index]!.position);index=matchingParen(tokens,index)+1;}
    if(!word(tokens,index,"AS"))fail();index+=1;if(tokens[index]?.value!=="(")fail();
    const close=matchingParen(tokens,index);const body=tokens.slice(index+1,close);if(body.length===0)fail();assertRootRead(body,cteColumnOpens);index=close+1;
    if(tokens[index]?.value!==",")return index;index+=1;
  }
  fail();
}
function assertRootRead(tokens:readonly SqlToken[],cteColumnOpens:Set<number>):void{
  let index=0;if(word(tokens,index,"EXPLAIN")){index+=1;if(word(tokens,index,"FORMAT")){index+=1;if(tokens[index]?.value!=="=")fail();index+=1;if(tokens[index]?.kind!=="WORD")fail();index+=1;}}
  if(word(tokens,index,"SELECT"))return;
  if(word(tokens,index,"WITH")){index=skipCteList(tokens,index+1,cteColumnOpens);if(word(tokens,index,"SELECT"))return;}
  fail();
}

// Token-aware SQL boundary. Comments and statement separators are rejected before any DB driver sees them.
export function assertReadOnlySqlStatement(sql:string,lockAllowed=false):void{
  if(typeof sql!=="string"||sql.trim()==="")fail();const tokens=tokenize(sql);if(tokens.length===0)fail();const cteColumnOpens=new Set<number>();assertRootRead(tokens,cteColumnOpens);
  for(let index=0;index<tokens.length;index+=1){const token=tokens[index]!;if(token.kind!=="WORD")continue;
    if(FORBIDDEN_WORDS.has(token.value)&&!(lockAllowed&&token.value==="UPDATE"&&word(tokens,index-1,"FOR")))fail();
    if(SIDE_EFFECT_FUNCTIONS.has(token.value)&&tokens[index+1]?.value==="(")fail();
    if(token.value==="NEXT"&&word(tokens,index+1,"VALUE")&&word(tokens,index+2,"FOR"))fail();
    if(token.value==="NEXTVAL"&&tokens[index+1]?.value==="(")fail();
    if(tokens[index+1]?.value==="("&&!SAFE_BUILTIN_FUNCTIONS.has(token.value)&&!STRUCTURAL_PARENS.has(token.value)&&!cteColumnOpens.has(tokens[index+1]!.position))fail();
    if(token.value==="FOR"&&tokens[index-1]?.value===":")fail();
    if(token.value==="INTO"&&(word(tokens,index+1,"OUTFILE")||word(tokens,index+1,"DUMPFILE")||tokens[index+1]?.value==="@"))fail();
    if(!lockAllowed&&token.value==="FOR"&&word(tokens,index+1,"UPDATE"))fail("APP_WIRING_LOCKING_QUERY_FORBIDDEN");
    if(!lockAllowed&&token.value==="LOCK"&&word(tokens,index+1,"IN")&&word(tokens,index+2,"SHARE")&&word(tokens,index+3,"MODE"))fail("APP_WIRING_LOCKING_QUERY_FORBIDDEN");
  }
  for(let index=0;index<tokens.length-1;index+=1)if(tokens[index]!.kind==="QUOTED_IDENTIFIER"&&tokens[index+1]!.value==="("&&!cteColumnOpens.has(tokens[index+1]!.position))fail();
  for(let index=0;index<tokens.length-1;index+=1)if(tokens[index]!.value===":"&&tokens[index+1]!.value==="=")fail();
}
