// 홈알림 slash와 단축 별칭은 exact 입력만 허용합니다.
export function isHomeActivityAlertReadCommand(message:string|undefined):boolean{return message==="/홈알림"||message==="ㅎㄹ";}
export function normalizeHomeActivityAlertReadDispatchMessage(message:string):string{return isHomeActivityAlertReadCommand(message)?message:"";}
