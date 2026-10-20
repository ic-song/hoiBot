const assert=require("assert"),fs=require("fs"),path=require("path"),child=require("child_process");
const {runtime,dir,baselineRef}=require("./test_raid_attack_profile_rhino.js");
const jar=process.argv[2];
const baseline=child.execFileSync("git",["show",baselineRef+":main.js"],{encoding:"utf8",maxBuffer:20*1024*1024}).replace(/\r\n/g,"\n");
const current=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8").replace(/\r\n/g,"\n");

// 참가자 수만 늘린 동일 공격 안내를 실제 Rhino에서 비교한다. 저장·네트워크 시간은 포함하지 않는다.
function run(label,source){
 const scenario=`
var report=[];
for(var sizeIndex=0;sizeIndex<3;sizeIndex++){
 var count=[100,1000,5000][sizeIndex],round={accounts:{}},servers=GLOBAL_CONFIG.serverRaid.servers;
 for(var i=0;i<count;i++)round.accounts['id'+i]={id:'id'+i,server:servers[i%servers.length],damage:String(i%11*100000),attacks:[{id:'attack'+i,R:100000,D:100000,P:3000,remaining:4,critical:false,rewardPercent:3,rewardBasis:'raidCharm'}]};
 var d={serverRaid:{current:round,wins:{}}},p=round.accounts.id1,samples=[],message='',original=JSON.stringify(round);
 for(var n=0;n<15;n++){var start=timerNow();message=buildServerRaidAttackMessage(d,p,p.attacks[0],'synthetic');var elapsed=timerNow()-start;if(n>=5)samples.push(elapsed);}
 samples.sort(function(a,b){return a-b;});check(JSON.stringify(round)===original,'message changed round');
 var freeze=JSON.parse(original);buildServerRaidResults(freeze,true,true);
 report.push({participants:count,medianMs:samples[Math.floor(samples.length/2)],samples:samples,message:message,frozen:freeze});
}
print('RESULT '+JSON.stringify(report));
`;
 const script=path.join(dir,label+".js");fs.writeFileSync(script,runtime(source,dir.replace(/\\/g,"/")+"/",scenario),"utf8");
 const r=child.spawnSync("java",["-Xmx1024m","-Dfile.encoding=UTF-8","-cp",path.resolve(jar),"org.mozilla.javascript.tools.shell.Main","-opt","-1","-version","200","-encoding","UTF-8","-f",script],{encoding:"utf8",timeout:60000,maxBuffer:20*1024*1024});
 assert.equal(r.status,0,(r.stdout||"")+(r.stderr||""));return JSON.parse(r.stdout.split(/\r?\n/).find(s=>s.startsWith("RESULT ")).slice(7));
}
const before=run("ranking-before",baseline),after=run("ranking-after",current);
for(let i=0;i<before.length;i++){assert.equal(after[i].message,before[i].message);assert.deepStrictEqual(after[i].frozen,before[i].frozen);}
const report={baseline:baselineRef,environment:"local Rhino 1.7.15 interpreter; synthetic ranking/message only, not Android timing",samples:10,warmup:5,messagesAndSettlementEqual:true,results:before.map((v,i)=>({participants:v.participants,beforeMedianMs:v.medianMs,afterMedianMs:after[i].medianMs,beforeSamples:v.samples,afterSamples:after[i].samples}))};
if(process.argv[3])fs.writeFileSync(path.resolve(process.argv[3]),JSON.stringify(report,null,2)+"\n","utf8");
console.log(JSON.stringify(report,null,2));
