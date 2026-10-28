// 실제 7인수 응답에서 주사위 연타가 잠금 대기에 누적되지 않는지 검증한다.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),cp=require('child_process'),os=require('os');
const h=require('./test_mini_games'),marble=require('./test_guild_marble'),baseline='67fe0b98473e24463cc801203a3509da494bd77e';
const old=cp.execFileSync('git',['show',baseline+':main.js'],{encoding:'utf8',maxBuffer:8*1024*1024}).replace(/\r\n/g,'\n');
const accepted=['ㅎㅈ',' ㅎㅈ ','/호월주사위','dev/ㅎㅈ','dev/호월주사위','dev//ㅎㅈ','dev/ ㅎㅈ '];
let groups=0;function test(n,f){f();console.log('PASS DICE BURST '+(++groups)+' '+n);}
test('baseline takes blocking lock; 500 mixed normal/DEV requests now return before IO or transaction',()=>{
 const g=marble.createHarness(),c=g.c;let locks=0,tries=0,unlocks=0,io=0;
 const flow={lock(){locks++;throw Error('blocking wait');},tryLock(wait,unit){assert.equal(wait,0);assert.equal(unit,'MILLISECONDS');tries++;return false;},unlock(){unlocks++;throw Error('not owner');}};
 c.commandDataFlowLock={writeLock:()=>flow,readLock:()=>flow};c.dataTransactionLock={tryLock(){throw Error('transaction reached');}};
 c.FileStream.read=()=>{io++;throw Error('unexpected IO');};const after=c.response;
 vm.runInContext(h.block(old,'function response('),c);assert.throws(()=>c.response('r','ㅎㅈ','a',true,c.replier,null,'test'),/blocking wait/);assert.equal(locks,1);c.response=after;locks=0;
 for(let i=0;i<500;i++)c.response('r'+i,accepted[i%accepted.length],'a'+i,true,c.replier,null,'test');
 assert.deepStrictEqual([locks,tries,unlocks,io],[0,500,0,0]);assert.equal(c.getDataSaveTransaction(),null);assert.equal(c.commandContextThreadLocal.get(),null);
});
test('other commands and invalid shortcuts retain existing lock path; maintenance returns before lock',()=>{
 const g=marble.createHarness(),c=g.c;let locks=0,tries=0;const flow={lock(){locks++;throw Error('existing blocking path');},tryLock(){tries++;return false;},unlock(){throw Error('not held');}};
 c.commandDataFlowLock={writeLock:()=>flow,readLock:()=>flow};
 for(const msg of ['/금고','/밸런스','/리셋','/ㅎㅈ','ㅎㅈ 해봐','문장ㅎㅈ','/호월주사위 해봐'])assert.throws(()=>c.response('r',msg,'a',true,c.replier,null,'test'),/existing blocking path/);
 assert.equal(tries,0);assert.equal(locks,7);c.GLOBAL_CONFIG.maintenance.testRoomOnly=true;c.response('not-test','ㅎㅈ','a',true,c.replier,null,'test');assert.equal(locks,7);assert.equal(tries,0);
});
test('accepted flow lock is released exactly once if transaction is busy',()=>{
 const g=marble.createHarness(),c=g.c;let depth=0,unlocks=0,tries=0;
 const flow={lock(){throw Error('dice waited');},tryLock(){depth++;return true;},unlock(){assert.equal(depth,1);depth--;unlocks++;}};
 c.commandDataFlowLock={writeLock:()=>flow,readLock:()=>flow};c.dataTransactionLock={tryLock(){tries++;return false;}};
 for(const msg of accepted)c.response('r',msg,'a',true,c.replier,null,'test');assert.equal(depth,0);assert.equal(unlocks,accepted.length);assert.equal(tries,accepted.length);assert.equal(c.getDataSaveTransaction(),null);
});
test('unexpected lock errors are not hidden and cannot read or save data',()=>{
 const g=marble.createHarness(),c=g.c,flow={tryLock(){throw Error('synthetic lock failure');},unlock(){throw Error('not owner');}};
 c.commandDataFlowLock={writeLock:()=>flow};assert.throws(()=>c.response('r','ㅎㅈ','a',true,c.replier,null,'test'),/synthetic lock failure/);assert.equal(c.getDataSaveTransaction(),null);
});
test('uncontended real callback still produces two screens and one reward; blocked errors release context',()=>{
 const src=fs.readFileSync(path.join(__dirname,'test_mini_game_missing_journal.js'),'utf8');
 const r=new Function('require',src.slice(0,src.indexOf("\ntest('normal state"))+'\nreturn {fixture,callback};')(require);
 for(const dev of [false,true]){const f=r.fixture();if(dev)f.seed(true);const prefix=dev?'dev/':'',base=dev?'/sdcard/호이랜드_dev/':'/sdcard/호이랜드/';
  const first=r.callback(f,prefix+'ㅎㅈ');assert(!first.error);assert(first.text.includes('첫 번째 굴림'));
  const before=f.read(dev).member.a.point,last=r.callback(f,dev?'dev/호월주사위':'/호월주사위');assert(!last.error);assert(last.text.includes('최종 결과'));
  const u=f.state(dev).dice.users['$'+f.id('a',dev)];assert.equal(u.used,1);assert.equal(u.game.phase,'DONE');assert.equal(f.read(dev).member.a.point,before+f.state(dev).ledger[u.game.rewardId].amount);
  assert.equal(f.c.getDataSaveTransaction(),null);assert.equal(f.c.commandContextThreadLocal.get(),null);
  const original=f.disk()[base+'miniGameState.json'];f.disk()[base+'miniGameState.json']='{';r.callback(f,prefix+'ㅎㅈ');assert.equal(f.disk()[base+'miniGameState.json'],'{');assert.equal(f.c.getDataSaveTransaction(),null);assert.equal(f.c.commandContextThreadLocal.get(),null);f.disk()[base+'miniGameState.json']=original;
 }
});
if(process.argv[2]){
 const definitions=['isDevCommandMessage','stripDevCommandPrefix','getMiniGameObservedVaultId','getResponseDataFlowLock','isExclusiveDataMutationCommandMessage','getManualResetDirectOperation'].map(n=>h.block(h.main,'function '+n+'(')).join('\n');
 const script=`var cx=org.mozilla.javascript.Context.getCurrentContext();cx.compileString(${JSON.stringify(h.main)},'main.js',1,null);cx.compileString(${JSON.stringify(fs.readFileSync(path.join(h.root,'Info.js'),'utf8'))},'Info.js',1,null);print('PASS Rhino full Main/Info compile');
var GLOBAL_CONFIG=${JSON.stringify(h.fixture().c.GLOBAL_CONFIG)},testRoom='test',flow=new java.util.concurrent.locks.ReentrantReadWriteLock(true),commandDataFlowLock=flow;
var dataTransactionLock={tryLock:function(){return false;}},fileReads=0;
var FileStream={read:function(){fileReads++;throw Error('unexpected file read');}},Api={replyRoom:function(){throw Error('unexpected reply');}};
function isAutoDailyEntryCommandMessage(){return false;}function isServerRaidMutationCommand(){return false;}
${definitions}
${h.block(old,'function response(').replace('function response(','function oldResponse(')}
${h.block(h.main,'function response(')}
function check(v,m){if(!v)throw Error(m);}var inputs=${JSON.stringify(accepted)};
function burst(fn,writer){var held=writer?flow.writeLock():flow.readLock(),started=new java.util.concurrent.CountDownLatch(64),done=new java.util.concurrent.CountDownLatch(64),errors=new java.util.concurrent.ConcurrentLinkedQueue(),threads=[];held.lock();
 try{for(var i=0;i<64;i++)(function(index){var thread=new java.lang.Thread(new java.lang.Runnable({run:function(){started.countDown();try{fn('room',inputs[index%inputs.length],'u'+index,true,{reply:function(){throw Error('unexpected reply');}},null,'test');}catch(e){errors.add(String(e));}finally{done.countDown();}}}));threads.push(thread);thread.start();})(i);
 check(started.await(5,java.util.concurrent.TimeUnit.SECONDS),'threads started');var completed=done.await(fn===oldResponse?150:3000,java.util.concurrent.TimeUnit.MILLISECONDS),queued=flow.getQueueLength();
 if(fn===oldResponse)check(!completed&&queued>0,'baseline callbacks queue while another response holds lock');else check(completed&&queued===0,'burst returns without a lock queue');
 }finally{held.unlock();for(var j=0;j<threads.length;j++)threads[j].join(5000);}
 check(done.getCount()===0&&errors.isEmpty(),'all callbacks exit with no unlock/IO error '+errors);check(flow.getQueueLength()===0&&!flow.isWriteLocked()&&flow.getReadLockCount()===0,'all flow locks released');check(fileReads===0,'rejected burst never reads files');return queued;
}
for(var i=0;i<2;i++){var prior=burst(oldResponse,!!i),now=burst(response,!!i);print('PASS Rhino 64-thread dice burst '+(i?'writer':'reader')+' held: baseline queue '+prior+' -> '+now+'; normal/DEV aliases return without IO');}
var interruptedErrors=new java.util.concurrent.ConcurrentLinkedQueue(),interruptedDone=new java.util.concurrent.CountDownLatch(1);flow.writeLock().lock();
var interruptedWorker=new java.lang.Thread(new java.lang.Runnable({run:function(){try{java.lang.Thread.currentThread().interrupt();response('r','ㅎㅈ','a',true,{reply:function(){}},null,'test');check(java.lang.Thread.currentThread().isInterrupted(),'interrupt flag restored');}catch(e){interruptedErrors.add(String(e));}finally{java.lang.Thread.interrupted();interruptedDone.countDown();}}}));
try{interruptedWorker.start();check(interruptedDone.await(3,java.util.concurrent.TimeUnit.SECONDS),'interrupted input never waits');}finally{flow.writeLock().unlock();interruptedWorker.join(5000);}check(interruptedErrors.isEmpty(),'interrupt safe '+interruptedErrors);print('PASS Rhino interrupted dice callback returns without queue/IO and preserves interruption');
`;
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'dice-burst-rhino-')),'test.js');fs.writeFileSync(file,script,'utf8');const r=cp.spawnSync('java',['-Xmx1024m','-Dfile.encoding=UTF-8','-cp',process.argv[2],'org.mozilla.javascript.tools.shell.Main','-version','200','-opt','-1','-encoding','UTF-8',file],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');assert.equal(r.status,0);
}
console.log('PASS dice burst '+groups+' callback groups');
