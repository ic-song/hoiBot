const assert=require("assert"),fs=require("fs"),path=require("path"),os=require("os"),vm=require("vm"),child=require("child_process");
const jar=process.argv[2];assert(jar&&fs.existsSync(jar),"Rhino jar required");
const main=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8").replace(/\r\n/g,"\n"),info=fs.readFileSync(path.join(__dirname,"..","Info.js"),"utf8");
// 현재 소스에서 검증할 함수·블록을 추출하는 함수
function block(source,marker){const start=source.indexOf(marker);assert(start>=0,marker);let depth=0;for(let i=source.indexOf("{",start);i<source.length;i++){if(source[i]==="{")depth++;if(source[i]==="}"&&--depth===0)return source.slice(start,i+1);}throw Error(marker);}
const config={testRoom:"test"};for(let i=1;i<=100;i++)config["room"+i]="room"+i;vm.createContext(config);vm.runInContext(block(main,"const GLOBAL_CONFIG = {")+";this.config=GLOBAL_CONFIG;",config);
const names=["createCommandContext","getCurrentContext","enterCommandContext","exitCommandContext","getDataFileName","resolveActiveDataPath","parseJsonContent","ensureParentFolder","loadJsonFile","saveJsonFile","getDataSaveTransaction","beginDataSaveTransaction","endDataSaveTransaction","prepareManagedJsonTransactionEntry","rollbackDataSaveTransaction","getManagedJsonBackupPath","getManagedJsonSecondaryBackupPath","isProtectedManagedJsonPath","parseManagedJsonContent","getProtectedJsonSaveLock","writeVerifiedJsonFile","isOrderLogRoomBot","isMasterIdentity","isAdminIdentity","isMaster","isAdmin","isSearchAuthenticationCount","isRecordRoomCommand","prepareRecordRoomArchive","buildRecordArchiveMessage","buildAdventureStarterCompleteMessage"];
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hoibot-oct20-rhino-")),root=path.join(dir,"data").replace(/\\/g,"/")+"/",devRoot=path.join(dir,"dev").replace(/\\/g,"/")+"/";
fs.mkdirSync(root);fs.mkdirSync(devRoot);
const seed={record:Array.from({length:3752},(_,i)=>({user:"synthetic"+i,content:(i%2?"":"凸")+"원본 기록 "+i,date:"10/20 12:00",extra:i})),memo:[{content:"memo"}]};
fs.writeFileSync(root+"board.json",JSON.stringify(seed));fs.writeFileSync(devRoot+"board.json",JSON.stringify(seed));
const commandStart=main.indexOf("                var recordCommandBoard = null;"),commandEnd=main.indexOf('\n                if (',main.indexOf('Api.replyRoom(room91, notifyMessage);',commandStart));
let runtime="var GLOBAL_CONFIG="+JSON.stringify(config.config)+";\n"+names.map(n=>block(main,"function "+n+"(")).join("\n")+`
var DATA_ROOT_PATH=${JSON.stringify(root)},DEV_DATA_ROOT_PATH=${JSON.stringify(devRoot)},filePath=DATA_ROOT_PATH+"member.json",boardPath=DATA_ROOT_PATH+"board.json",COMMON_DATA_FILE_MAP={};
var Master=["master"],Admins=["admin"],room90="GM",room91="staff",room92="서버관리자",testRoom="test",messages=[];
var commandContextThreadLocal=new java.lang.ThreadLocal(),dataSaveTransactionThreadLocal=new java.lang.ThreadLocal(),dataTransactionLock=new java.util.concurrent.locks.ReentrantLock(),protectedJsonSaveLocks={};
var MANAGED_BACKUP_SECONDARY_ROTATION_MS=24*60*60*1000;
var FileStream={read:function(p){return String(new java.lang.String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(String(p))),"UTF-8"));}};
function getAutoDailyBatchContext(){return null;}function debuggerLog(){}function checkRank(d,p,g,u){return u;}
function check(v,label){if(!v)throw new Error(label);}
var replier={reply:function(text){messages.push(String(text));}},Api={replyRoom:function(){return true;}};
function boot(){
`+main.slice(main.indexOf("var startupRecordCurrentFile ="),main.indexOf("if (initData.serverRaid && serverRaidHasWork(initData.serverRaid)) {"))+`}
function record(msg,user,dev){var prev=enterCommandContext(createCommandContext(dev,dev?testRoom:"주문기록방"));beginDataSaveTransaction();var sender=user,data={member:{}},petData={},guildData={};try{
`+main.slice(commandStart,commandEnd)+`
}catch(e){rollbackDataSaveTransaction();throw e;}finally{endDataSaveTransaction();exitCommandContext(prev);}}
`;
let script="var context=org.mozilla.javascript.Context.getCurrentContext();\ncontext.compileString("+JSON.stringify(main)+",'main.js',1,null);\ncontext.compileString("+JSON.stringify(info)+",'Info.js',1,null);\nvar runtime="+JSON.stringify(runtime)+`;\n`;
script+=`
function run(scope,code){return context.evaluateString(scope,code,"oct20-scenario",1,null);}
function fresh(){var s=new org.mozilla.javascript.ImporterTopLevel(context);run(s,runtime);return s;}
var s=fresh();run(s,"boot();var b=loadJsonFile(boardPath);check(b.recordArchive1.records.length===3752&&b.record.length===0,'full archive');check(b.recordArchive1.records[0].content==='凸원본 기록 0'&&b.recordArchive1.records[3751].extra===3751,'content preserved');check(new java.io.File(DATA_ROOT_PATH+'board_back.json').exists(),'managed backup');check(isProtectedManagedJsonPath(boardPath),'protected board');record('/기록 new record','오픈채팅봇',false);check(loadJsonFile(boardPath).record[0].user==='오픈채팅봇','real actor kept');");
print("PASS Rhino archive: 3752 synthetic records, actual Java UTF-8 files, protected atomic save and backups, real record command");
s=fresh();run(s,"boot();var b=loadJsonFile(boardPath);check(b.record.length===1&&b.recordArchive1.records.length===3752,'fresh scope restart preserves new record');record('/기록보관소1 188','master',false);check(messages[0].indexOf('3752. [synthetic3751]')!==-1,'last archive page');");
print("PASS Rhino restart: fresh global scope reload, no repeated reset, archive last page accessible");
run(s,"var original=new java.io.File(boardPath);check(original.renameTo(new java.io.File(boardPath+'.rollback')),'simulate stop between renames');");
s=fresh();run(s,"boot();var b=loadJsonFile(boardPath);check(b.record.length===1&&b.recordArchive1.records.length===3752,'rollback publication recovered');check(!new java.io.File(boardPath+'.rollback').exists(),'rollback restored by rename');");
print("PASS Rhino interrupted publication: real file rename gap, new global scope restores validated original and new records");
run(s,"record('/기록 dev record','master',true);var prod=loadJsonFile(boardPath);var prev=enterCommandContext(createCommandContext(true,'test'));try{var d=loadJsonFile(boardPath);check(d.record.length===1&&d.recordArchive1.records.length===3752,'DEV migration');}finally{exitCommandContext(prev);}check(JSON.stringify(loadJsonFile(boardPath))===JSON.stringify(prod),'PROD isolation');");
print("PASS Rhino DEV: first request archive, new record and publication paths isolated from production");
run(s,"var prev=enterCommandContext(createCommandContext(false,'주문기록방'));try{check(isMaster('오픈채팅봇')&&isAdmin('오픈채팅봇')&&isMasterIdentity('오픈채팅봇'),'bot privilege');check(!isMaster('ordinary'),'ordinary denied');}finally{exitCommandContext(prev);}prev=enterCommandContext(createCommandContext(false,'서버관리자'));try{check(!isMaster('오픈채팅봇')&&isMaster('master'),'original room unchanged');}finally{exitCommandContext(prev);}var text=buildAdventureStarterCompleteMessage('신규 남','test',true,true);check(text.indexOf('[신규 남]님에게')===0&&text.indexOf('지급!')===-1&&text.indexOf('능력과 장착 정보를 확인할 수 있어요.')!==-1,'simplified UI');check(!dataTransactionLock.isLocked()&&dataSaveTransactionThreadLocal.get()===null&&commandContextThreadLocal.get()===null,'lock/context released');");
print("PASS Rhino policy/UI: scoped bot privileges, ordinary roles unchanged, simplified message, real Java locks released");
`;
const file=path.join(dir,"test.js");fs.writeFileSync(file,script,"utf8");
const result=child.spawnSync("java",["-Dfile.encoding=UTF-8","-cp",path.resolve(jar),"org.mozilla.javascript.tools.shell.Main","-opt","-1","-version","200","-encoding","UTF-8","-f",file],{encoding:"utf8",timeout:60000});
process.stdout.write(result.stdout||"");process.stderr.write(result.stderr||"");assert.strictEqual(result.status,0);
