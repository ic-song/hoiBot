const assert=require("assert"),fs=require("fs"),path=require("path"),child=require("child_process");
const {runtime,sample,dir,baselineRef}=require("./test_raid_attack_profile_rhino.js");
const jar=process.argv[2];
const current=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8").replace(/\r\n/g,"\n");
const baseline=child.execFileSync("git",["show",baselineRef+":main.js"],{encoding:"utf8",maxBuffer:20*1024*1024}).replace(/\r\n/g,"\n");

// 분기 복제 없이 실제 7인수 response 전체를 실행하고 응답 API만 latch로 멈춘다.
function run(label,main,deferred,throwReply){
 const root=path.join(dir,label).replace(/\\/g,"/")+"/";fs.mkdirSync(root,{recursive:true});
 for(const[p,text]of Object.entries(sample.disk))if(p.startsWith("/sdcard/호이랜드/"))fs.writeFileSync(root+p.slice("/sdcard/호이랜드/".length),text,"utf8");
 let script=runtime(main,root,"");
 const start=main.indexOf("function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {"),end=main.indexOf("///////////////////////////////////////////////////////////////////////////////////////////////",start);
 script+=main.slice(start,end);
 for(const name of ["getResponseDataFlowLock","isDevCommandMessage","stripDevCommandPrefix","getCarrotTradeReply"])script+=sample.block(main,"function "+name+"(")+"\n";
 script+=
 "var autoDailyQuestInternalDepth=0,errorLogPath=DATA_ROOT_PATH+'error.json',Master=['master'],errors=new java.util.concurrent.ConcurrentLinkedQueue();\n"+
 "function isAutoDailyEntryCommandMessage(){return false;}function isExclusiveDataMutationCommandMessage(msg){return String(msg).indexOf('레이드공격')!==-1;}function isDollTestRoomCommand(){return false;}function getMissingDevDataFiles(){return [];}function isMasterIdentity(s){return s==='master';}function isAdminIdentity(){return false;}function isMaster(s){return isMasterIdentity(s);}function isAdmin(){return false;}function isAccountSuspended(){return false;}function hasAttendedToday(){return true;}function isAttendanceFreeCommand(){return false;}function hasActiveHoiPassAccess(){return true;}function validateMiniPetRobberyPending(){throw Error('unexpected robbery pending');}\n"+
 "FileStream.write=function(p,t){java.nio.file.Files.write(java.nio.file.Paths.get(String(p)),new java.lang.String(t).getBytes('UTF-8'));};var logFails="+throwReply+";function debuggerLog(t){if(logFails)throw Error('logging transport failed');errors.add(String(t));}\n"+
 "var entered=new java.util.concurrent.CountDownLatch(1),release=new java.util.concurrent.CountDownLatch(1),secondDone=new java.util.concurrent.CountDownLatch(1),queryDone=new java.util.concurrent.CountDownLatch(1),firstDone=new java.util.concurrent.CountDownLatch(1),heldAtReply=null,secondMessage='',queryMessage='';\n"+
 "function thread(fn){return new java.lang.Thread(new java.lang.Runnable({run:function(){try{fn();}catch(e){errors.add(String(e));}}}));}\n"+
 "var first=thread(function(){response('room8','/레이드공격','a',true,{reply:function(text){heldAtReply={data:dataTransactionLock.isHeldByCurrentThread(),command:commandDataFlowLock.isWriteLockedByCurrentThread()};check(loadJsonFile(filePath,'raid').member.a.point===1000003300,'save precedes reply');entered.countDown();check(release.await(8,java.util.concurrent.TimeUnit.SECONDS),'release timeout');if("+throwReply+")throw Error('reply failed');}},null,'com.kakao.talk');firstDone.countDown();});first.start();check(entered.await(5,java.util.concurrent.TimeUnit.SECONDS),'first reply entered '+errors);\n"+
 "var second=thread(function(){response('room8','/레이드공격','a',true,{reply:function(text){secondMessage=String(text);}},null,'com.kakao.talk');secondDone.countDown();});second.start();var secondBeforeRelease=secondDone.await(1500,java.util.concurrent.TimeUnit.MILLISECONDS);\n"+
 "var query=thread(function(){response('room8','/레이드턴','a',true,{reply:function(text){queryMessage=String(text);}},null,'com.kakao.talk');queryDone.countDown();});query.start();var queryBeforeRelease=queryDone.await(300,java.util.concurrent.TimeUnit.MILLISECONDS);\n"+
 "check(secondBeforeRelease==="+deferred+",'second attack before release');check(queryBeforeRelease==="+deferred+",'query before release');check(heldAtReply.data==="+(!deferred)+"&&heldAtReply.command==="+(!deferred)+",'API lock ownership');release.countDown();first.join(5000);second.join(5000);query.join(5000);check(!first.isAlive()&&!second.isAlive()&&!query.isAlive(),'threads terminate');check(errors.isEmpty(),'errors '+errors);\n"+
 "var d=loadJsonFile(filePath,'raid'),p=d.serverRaid.current.accounts[d.member.a.serverRaidAccount.id];check(p.attacks.length===2&&d.member.a.point===1000006600,'two attacks/rewards exactly once');check(p.attacks.every(function(a){return a.R===110000&&a.P===3300&&a.D===110000;}),'unchanged charm/critical/reward');check(secondMessage.indexOf('3300')!==-1&&secondMessage.indexOf('3/5')!==-1,'second response has its own saved reward/remaining turns');check(!dataTransactionLock.isLocked()&&!commandDataFlowLock.isWriteLocked(),'no leaked locks');print('PASS "+label+": actual full callback; locks/data/reward/second attack/query checked');\n";
 const file=path.join(dir,label+".js");fs.writeFileSync(file,script,"utf8");
 const r=child.spawnSync("java",["-Xmx1024m","-Dfile.encoding=UTF-8","-cp",path.resolve(jar),"org.mozilla.javascript.tools.shell.Main","-opt","-1","-version","200","-encoding","UTF-8","-f",file],{encoding:"utf8",timeout:30000,maxBuffer:2*1024*1024});
 process.stdout.write(r.stdout||"");process.stderr.write(r.stderr||"");assert.equal(r.status,0,label+" / "+file);
}
run("baseline-blocking-reply",baseline,false,false);
run("deferred-reply",current,true,false);
run("reply-and-log-exceptions",current,true,true);
