export type OneDayPassCommand={action:"add";target:string;option:"permanent"|"dated";endDate:string|null;rawEndDate:string}|{action:"delete";target:string};
const ADD="/원데이패스추가",DELETE="/원데이패스삭제";
// 원데이패스 추가·삭제 후보를 쉼표 포함 완전한 형태로 제한합니다.
export function isOneDayPassCommandCandidate(message:string|undefined):boolean{return message!==undefined&&/^\/원데이패스(?:추가|삭제),\s*.+$/.test(message);}
function date(raw:string):string|null{const m=/^(\d{2})\.(\d{2})\.(\d{2})$/.exec(raw);if(!m)return null;const y=2000+Number(m[1]),mo=Number(m[2]),d=Number(m[3]),v=new Date(Date.UTC(y,mo-1,d));return v.getUTCFullYear()===y&&v.getUTCMonth()===mo-1&&v.getUTCDate()===d?`${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`:null;}
// 대상과 선택적 종료일·영구권을 해석합니다.
export function parseOneDayPassCommand(message:string):OneDayPassCommand|null{if(!isOneDayPassCommandCandidate(message))return null;const body=message.slice(message.indexOf(",")+1).trim();if(!body)return null;if(message.startsWith(`${DELETE},`))return{action:"delete",target:body};const parts=body.split(/\s+/),last=parts.at(-1)!;if(last==="영구권"){const target=parts.slice(0,-1).join(" ").trim();return target?{action:"add",target,option:"permanent",endDate:null,rawEndDate:last}:null;}if(/^\d{2}\.\d{2}\.\d{2}$/.test(last)){const target=parts.slice(0,-1).join(" ").trim(),endDate=date(last);return target&&endDate?{action:"add",target,option:"dated",endDate,rawEndDate:last}:null;}return{action:"add",target:body,option:"permanent",endDate:null,rawEndDate:"영구권"};}
// parameterized 명령을 대표 DB alias로 정규화합니다.
export function normalizeOneDayPassDispatchMessage(message:string):string{const c=parseOneDayPassCommand(message);return c?.action==="add"?ADD:c?.action==="delete"?DELETE:message;}
