const assert=require("assert"),fs=require("fs"),path=require("path"),os=require("os"),child=require("child_process");
const {createFixture}=require("./test_server_raid_delivery.js");
const h=createFixture(),jar=process.argv[2];assert(jar&&fs.existsSync(jar),"Rhino jar required");
const baselineRef="96633c05dd0c6eb66e24f6fb786bcae7a4c3fc62",baseline=child.execFileSync("git",["show",baselineRef+":main.js"],{encoding:"utf8",maxBuffer:20*1024*1024}).replace(/\r\n/g,"\n");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hoibot-raid-ranking-"));
// 실제 Rhino의 순위/메시지 함수를 참가자 규모별로 비교한다. 파일 저장·전송 시간은 제외한다.
function run(label,source){
 const domain=source.slice(source.indexOf("function serverRaidHeader("),source.indexOf("// 길드 영지전 관련 함수들"));
 const code="var GLOBAL_CONFIG="+JSON.stringify(h.c.GLOBAL_CONFIG)+";\n"+h.block(source,"function normalizeHoiServerLabel(")+"\n"+domain+`
function check(v,s){if(!v)throw Error(s);}function numberWithCommas(n){return String(n);}function timerNow(){return Number(java.lang.System.nanoTime())/1000000;}
var report=[];
for(var sizeIndex=0;sizeIndex<3;sizeIndex++){
 var count=[100,1000,5000][sizeIndex],round={accounts:{}},servers=GLOBAL_CONFIG.serverRaid.servers;
 for(var i=0;i<count;i++)round.accounts['id'+i]={id:'id'+i,server:servers[i%servers.length],damage:String(i%11*100000),attacks:[{id:'attack'+i,R:100000,D:100000,P:3000,remaining:4,critical:false,rewardPercent:3,rewardBasis:'raidCharm'}]};
 var d={serverRaid:{current:round,wins:{}}},p=round.accounts.id1,samples=[],message='',original=JSON.stringify(round);
 for(var n=0;n<15;n++){var start=timerNow();message=buildServerRaidAttackMessage(d,p,p.attacks[0],'synthetic');var elapsed=timerNow()-start;if(n>=5)samples.push(elapsed);}
 samples.sort(function(a,b){return a-b;});check(JSON.stringify(round)===original,'message changed round');var freeze=JSON.parse(original);buildServerRaidResults(freeze,true,true);
 report.push({participants:count,medianMs:samples[Math.floor(samples.length/2)],samples:samples,message:message,frozen:freeze});
}
print('RESULT '+JSON.stringify(report));`;
 const file=path.join(dir,label+".js");fs.writeFileSync(file,code,"utf8");const r=child.spawnSync("java",["-Xmx1024m","-Dfile.encoding=UTF-8","-cp",path.resolve(jar),"org.mozilla.javascript.tools.shell.Main","-opt","-1","-version","200","-encoding","UTF-8","-f",file],{encoding:"utf8",timeout:60000,maxBuffer:20*1024*1024});assert.equal(r.status,0,(r.stdout||"")+(r.stderr||""));return JSON.parse(r.stdout.split(/\r?\n/).find(s=>s.startsWith("RESULT ")).slice(7));
}
const before=run("before",baseline),after=run("after",h.main);for(let i=0;i<before.length;i++){assert.equal(after[i].message,before[i].message);assert.deepStrictEqual(after[i].frozen,before[i].frozen);}
const report={baseline:baselineRef,environment:"local Rhino 1.7.15 interpreter, synthetic ranking/message only; not Android timing",samples:10,warmup:5,messagesAndSettlementEqual:true,results:before.map((v,i)=>({participants:v.participants,beforeMedianMs:v.medianMs,afterMedianMs:after[i].medianMs,beforeSamples:v.samples,afterSamples:after[i].samples}))};if(process.argv[3])fs.writeFileSync(path.resolve(process.argv[3]),JSON.stringify(report,null,2)+"\n","utf8");console.log(JSON.stringify(report,null,2));
