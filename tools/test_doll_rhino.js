const assert=require("assert"),fs=require("fs"),path=require("path"),os=require("os"),vm=require("vm"),child=require("child_process");
const jar=process.argv[2];assert(jar&&fs.existsSync(jar),"Rhino jar required");
const main=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");
const info=fs.readFileSync(path.join(__dirname,"..","Info.js"),"utf8");
function block(marker){const start=main.indexOf(marker);assert(start>=0,marker);let n=0;for(let i=main.indexOf("{",start);i<main.length;i++){if(main[i]==="{")n++;if(main[i]==="}"&&--n===0)return main.slice(start,i+1);}throw Error(marker);}
const context={testRoom:"test"};for(let i=1;i<=100;i++)context["room"+i]="room"+i;vm.createContext(context);vm.runInContext(block("const GLOBAL_CONFIG = {").replace("const ","var "),context);vm.runInContext(block("const ticketTierData =").replace("const ","var "),context);
const names=["parseJsonContent","isSearchAuthenticationCount","roundToTwo","normalizeTicketTierName","getTicketTierStage","getTierExperienceBonus","getLevelRequiredExperience","getAdventureLevelTitle","processAdventureLevelUps","applyAdventureExperienceBooster","addMemberExperienceWithTierBonus","normalizePendantTransitionItemName","normalizeUniversalCollectionKeyBagItems","normalizePendantTransitionBagItem","removeItem","getDollRequest","isDollTestRoomCommand","buildDollTestRoomRestrictionMessage","validateDollCatalog","getDollShard","getDollSuccessPercent","getDollSize","getDollRecordCharm","buildDollRepresentative","compareDollRows","applyDollDraw"];
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,"..","data/dollCatalog.json"),"utf8"));
let text="org.mozilla.javascript.Context.getCurrentContext().compileString("+JSON.stringify(main)+",'main.js',1,null);\norg.mozilla.javascript.Context.getCurrentContext().compileString("+JSON.stringify(info)+",'Info.js',1,null);\nvar GLOBAL_CONFIG="+JSON.stringify(context.GLOBAL_CONFIG)+";\nvar ticketTierData="+JSON.stringify(context.ticketTierData)+";\n"+names.map(n=>block("function "+n+"(")).join("\n")+"\n";
text += [
"function getAutoDailyBatchContext(){return null;} function replyAutoDailyAdventureLevelUps(){}",
"var catalog=parseJsonContent("+JSON.stringify(JSON.stringify(catalog))+", 'dollCatalog.json');",
"validateDollCatalog(catalog);",
"function checkRank(d,p,g,u){return u;}if(!isDollTestRoomCommand('/인형도감 일반1')||isDollTestRoomCommand('/티어'))throw new Error('Doll room command scope');",
"if(buildDollTestRoomRestrictionMessage({member:{u:{guild:{id:'gone'}}}},{guilds:{}},'u').indexOf(GLOBAL_CONFIG.doll.allowedRoom)<0)throw new Error('Room notice');",
"var missing=false;try{validateDollCatalog(null);}catch(e){missing=String(e).indexOf('19개')>=0;}if(!missing)throw new Error('Missing install diagnosis');",
"function check(v,label){if(!v)throw new Error(label);}",
'check(getDollSuccessPercent("킹")===15,"King success");',
'check(getDollRequest("/인형뽑기 1")===null,"suffix guard");',
'var data={member:{u:{point:1000000000,bag:{},boostercnt:999,lv:1,exp:0,rank:{tier:"킹"}}}},pet={u:{petexp:1}},store={schemaVersion:1,users:{}},index={schemaVersion:1,users:{}};',
"data.member.u.bag[GLOBAL_CONFIG.doll.ticketName]=1;",
'var result=applyDollDraw(data,pet,catalog,store,index,"u","id","2026.10.13",function(){return 0;});',
'check(result.fresh&&result.experience.total===69,"fresh exp");',
'check(data.member.u.point===1000000000&&pet.u.dollCharm===2500,"ticket priority");',
"data.member.u.bag[GLOBAL_CONFIG.doll.ticketName]=1;",
'result=applyDollDraw(data,pet,catalog,store,index,"u","id","2026.10.13",function(){return 0;});',
'check(pet.u.dollCharm===2525&&pet.u.dollCharm/2===1262.5,"fraction charm");',
'print("PASS Rhino 1.7.15: 1000 catalog, guards, tier, draw, EXP, charm");'
].join("\n");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hoibot-doll-rhino-")),file=path.join(dir,"test.js");fs.writeFileSync(file,text,"utf8");
const result=child.spawnSync("java",["-Dfile.encoding=UTF-8","-cp",path.resolve(jar),"org.mozilla.javascript.tools.shell.Main","-opt","-1","-version","200","-encoding","UTF-8","-f",file],{encoding:"utf8"});process.stdout.write(result.stdout||"");process.stderr.write(result.stderr||"");assert.strictEqual(result.status,0);
