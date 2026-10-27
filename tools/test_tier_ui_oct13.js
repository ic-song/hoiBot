const assert=require("assert"),fs=require("fs"),path=require("path"),vm=require("vm");
const main=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");
function block(marker){const start=main.indexOf(marker);assert(start>=0,marker);let n=0;for(let i=main.indexOf("{",start);i<main.length;i++){if(main[i]==="{")n++;if(main[i]==="}"&&--n===0)return main.slice(start,i+1);}throw Error(marker);}
const c={testRoom:"test",allsee:"<ALLSEE>",numberWithCommas:v=>Number(v).toLocaleString("en-US"),getTierExploreBonusPercentByName:()=>5.5,loadJsonFile:()=>{throw Error("UI must not load");},saveJsonFile:()=>{throw Error("UI must not save");}};
for(let i=1;i<=100;i++)c["room"+i]="room"+i;vm.createContext(c);vm.runInContext(block("const GLOBAL_CONFIG = {"),c);vm.runInContext(block("const ticketTierData ="),c);
for(const name of ["normalizeTicketTierName","getTicketTierStage","formatTicketTierLabel","getDollSuccessPercent","buildTierQuoteStatusText","buildTierProgressMessage","buildTierPromotionSuccessMessage"])vm.runInContext(block("function "+name+"("),c);
function plan(){return{user:"💛합성 남",currentTierName:"노랑하트",targetTierName:"보라하트",targetTier:{ticket:35000,highticket:600,exp:10000},regular:10524,advanced:501,currentExploreBonus:5,targetExploreBonus:5.5,currentExperienceBonus:30,targetExperienceBonus:33,additionalRegular:49226,additionalLegendStone:0,additionalPetStone:0,combineCount:99,craftRegular:24750,craftLegendStone:198,craftPetStone:14850,tierTicketPurchaseQuantity:49226,tierTicketPurchaseBonus:0,quote:{available:true,totalCost:244319208700,basePrice:344582000000,itemPrice:240708580000,taxAmount:3610628700,taxRate:1.5,baseTaxRate:5,discountSkill:"VIP블랙카드",taxExempt:true,couponPlan:{usedCount:454,usages:[{rate:30},{rate:20},{rate:10}]}},couponHoldings:[{name:"티켓이벤트할인쿠폰🎟️(10%)",count:20}]}};
for(const failure of [false,true]){
 const p=plan(),snapshot=JSON.stringify(p),out=c.buildTierProgressMessage(p,failure),lines=out.split("\n");
 assert.strictEqual(JSON.stringify(p),snapshot);
 assert(out.includes("🧸 인형 성공확률 보너스: 20% 적용"));assert(out.includes("인형 성공확률 보너스\n20% → 21%"));
 assert(out.includes("⛰️ 펫탐험 보너스: 5% 적용\n📊 티어 경험치 보너스: 30exp 적용\n🧸"));
 assert(out.includes("💰 티켓 49,226장 구매\n🅟244,319,208,700\n\nVIP블랙카드📙 30%\n탈세자📙 세금 70% 면제\n쿠폰 30%·20%·10% 적용 예정\n세금 포함"));
 assert(out.includes("준비 후 /고급티켓조합 99\n→ /티어적용"));
 assert(out.includes("티어 승급티켓🎟\n보유 10,524 / 목표 35,000\n\n고급 티어 승급티켓🎫\n보유 501 / 목표 600"));
 assert(out.includes("세금 🅟3,610,628,700 (1.5%)"));assert(out.includes("티켓 구매비\n🅟244,319,208,700"));
 assert(!out.includes("적용 중")&&!out.includes("9,999개")&&!out.includes("\\n"));
 assert.strictEqual((out.match(/<ALLSEE>/g)||[]).length,1);
 assert(out.indexOf("🅟244,319,208,700")<out.indexOf("<ALLSEE>"));assert(out.indexOf("次")===-1);
 assert(out.indexOf("🎁 다음 티어 혜택")>out.indexOf("<ALLSEE>"));
 if(failure){assert.strictEqual(lines[0],"❌ [💛합성 남] 님");assert.strictEqual(lines[1],"승급 재료가 부족해요");assert(out.includes("차감된 포인트·아이템은 없습니다."));}
 else assert(!out.includes("차감된 포인트·아이템"));
}
console.log("PASS tier view/apply failure: numbers, discounts, folding, line breaks, immutable plans");
const max=plan();Object.assign(max,{isMaxTier:true,currentTierName:"호월신",targetTierName:"호월신",quote:null,combineCount:0});
for(const failure of [false,true]){const out=c.buildTierProgressMessage(max,failure);assert(out.includes("55% 적용"));assert(!out.includes("다음 티어 혜택"));assert(!out.includes("목표 👑"));}
for(const field of["canPromote","craftReady"]){const p=plan();p[field]=true;const out=c.buildTierProgressMessage(p,false);assert(out.includes(field==="canPromote"?"승급 준비 완료":"재료 준비 완료"));}
const missing=plan();missing.quote={available:false};assert(c.buildTierProgressMessage(missing,false).includes("현재 확인할 수 없어요"));assert(!c.buildTierProgressMessage(missing,false).includes("세금 포함"));
const bonus=plan();bonus.tierTicketPurchaseBonus=100;assert(c.buildTierProgressMessage(bonus,false).includes("→ 총 49,326장 획득"));
const promoted=c.buildTierPromotionSuccessMessage({}, "합성 남", {newTierName:"보라하트",bonus:10000});assert(promoted.includes("21% 적용"));assert(!promoted.includes("21% → 22%"));assert(promoted.includes("🎯 다음 목표"));
assert(!c.buildTierPromotionSuccessMessage({}, "합성 남", {newTierName:"호월신",bonus:0}).includes("인형 성공확률 보너스 55% →"));
console.log("PASS highest, ready/craft, missing quote, bonus tickets, promotion success, shared doll probability");
