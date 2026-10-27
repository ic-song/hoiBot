// 합성 데이터로 샵오픈의 추첨·출력·소모·저장 예외를 검증하며 성능은 측정하지 않는다.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const root = path.resolve(__dirname, '..'), baseline = '7bbdddf3d89722d98f15aa48497685cf193bd6c3';
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const before = cp.execFileSync('git', ['show', baseline + ':main.js'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const harness = fs.readFileSync(path.join(__dirname, 'test_member_display_search_auth.js'), 'utf8');
function fixture(source) {
    const { c, fixture: f, block } = new Function('require', '__dirname', harness.slice(0, harness.indexOf('\npass("')) + '\nreturn {c,fixture,block};')(require, __dirname);
    c.homeInfoFile = '/sdcard/호이랜드/shopInfo.json';
    c.homeDataFile = prodRoot + homeName;
    let directFailure = null;
    c.FileStream.write = (p, text) => {
        if (p === directFailure) { directFailure = null; throw Error('synthetic direct write failure'); }
        f.put(p, JSON.parse(text)); f.traces().push({ type: 'save', path: p, data: JSON.parse(text) });
    };
    f.failDirectPath = p => { directFailure = p; };
    c.isHoiPassPremiumActive = (data, user) => !!data.member[user].premium;
    for (const name of ['buildGradeRates', 'pickGrade', 'buildFurnitureGradePools', 'getRandomFurnitureByGrade', 'createCuId', 'initSweetHomeUser', 'buildPlacedFurnitureSummary', 'sortFurnitureList', 'getFurnitureBagLimit', 'getFurnitureDisplay'])
        if (source.includes('function ' + name + '(')) vm.runInContext(block(source, 'function ' + name + '('), c);
    vm.runInContext('function shopBranch(){' + block(source, 'if (msg === "/샵오픈" ||') + '}', c);
    function prepare(tickets = 20, bagCount = 0, premium = false) {
        f.reset(); directFailure = null;
        for (const dev of [false, true]) {
            const d = f.read(dev); d.member.a.bag = { [ticket]: tickets, untouched: 9 }; d.member.a.premium = premium; f.write(d, dev);
            const p = dev ? devRoot : prodRoot;
            f.put(p + homeName, { a: { floor: 10, exp: 20, placedFurnitureSummary: { count: 0 }, furnitureBag: Array.from({ length: bagCount }, (_, i) => ({ id: 'old' + i, name: '기존 가구', exp: i, grade: '일반' })) }, other: { untouched: true } });
            f.put(p + 'shopInfo.json', { furniture: catalog });
        }
    }
    function run(msg, dev = false) {
        f.clear(); const ctx = c.createCommandContext(dev, 'test'), previous = c.enterCommandContext(ctx);
        c.msg = msg; c.sender = 'a'; c.guildData = {}; c.petData = {};
        c.data = c.loadJsonFile(c.filePath); c.beginDataSaveTransaction();
        vm.runInContext('var seed=12345,randomCalls=0;Math.random=function(){randomCalls++;seed=(seed*48271)%2147483647;return seed/2147483647;};', c);
        try { c.shopBranch(); }
        catch (e) { c.rollbackDataSaveTransaction(); throw e; }
        finally { c.endDataSaveTransaction(); c.exitCommandContext(previous); }
        return { reply: f.replies(), notices: f.traces().filter(t => t.type === 'notice'), saves: f.traces().filter(t => t.type === 'save'), randomCalls: c.randomCalls,
            member: f.read(dev), home: f.get((dev ? devRoot : prodRoot) + homeName) };
    }
    return { c, f, prepare, run };
}
const prodRoot = '/sdcard/호이랜드/', devRoot = '/sdcard/호이랜드_dev/', ticket = '펫스윗홈인테리어샵🖼️(/샵오픈)';
const homeName = 'petSweetHomeData.json';
const catalog = [
    { name: '의자', exp: 10, grade: '일반', rate: 70 }, { name: '탁자', exp: '20', grade: '일반', rate: 70 },
    { name: '왕실소파', exp: 500, grade: '로열 루미에르', rate: 20 }, { name: '왕실조명', exp: 500, grade: '로열 루미에르', rate: 20 },
    { name: '마법침대', exp: 1000, grade: '아르카나 루미에르', rate: 10 }
];
function functions(source) {
    // 기존 테스트의 소스 추출기만 재사용한다.
    const { block } = require('./test_pet_skill_preflight');
    return ['buildGradeRates', 'pickGrade', 'buildFurnitureGradePools', 'getRandomFurnitureByGrade', 'createCuId']
        .filter(n => source.includes('function ' + n + '(')).map(n => block(source, 'function ' + n + '(')).join('\n');
}
const scenarios = `
var groups=0;
function check(v,s){if(!v)throw Error(s);}
function same(a,b,s){check(JSON.stringify(a)===JSON.stringify(b),s);}
function test(name,fn){fn();groups++;print('PASS SHOP DRAW '+groups+' '+name);}
// 기존의 2단계 추첨을 그대로 남겨 확률 경계와 난수 소비를 검증한다.
function legacyDraw(list,rates){var grade=pickGrade(rates),candidates=[];for(var i=0;i<list.length;i++)if(list[i].grade===grade)candidates.push(list[i]);var pool=candidates.length?candidates:list;return pool[Math.floor(Math.random()*pool.length)];}
function replay(list,rates,stream){var pools=buildFurnitureGradePools(list,rates),pos=0;Math.random=function(){return stream[pos++];};var expected=legacyDraw(list,rates),oldPos=pos;pos=0;var actual=getRandomFurnitureByGrade(list,rates,pools);check(actual===expected,'same source reference');check(pos===oldPos,'same random count');}
test('grade and item boundaries, original candidate order',function(){var a=[{grade:'A',rate:20},{grade:'B',rate:80},{grade:'A',rate:20},{grade:'B',rate:80}],r=buildGradeRates(a),values=[0,0.199999999,0.2,0.200000001,0.999999999];for(var i=0;i<values.length;i++)for(var j=0;j<values.length;j++)replay(a,r,[values[i],values[j]]);same(buildFurnitureGradePools(a,r),[[a[0],a[2]],[a[1],a[3]]],'ordered candidates');});
test('zero, duplicate, string and negative rates retain existing behavior',function(){var cases=[[{grade:'A',rate:0},{grade:'A',rate:0},{grade:'B',rate:1}],[{grade:'A',rate:'20'},{grade:'A',rate:99},{grade:'B',rate:'80'}],[{grade:'A',rate:-1},{grade:'B',rate:2}]];for(var i=0;i<cases.length;i++){var r=buildGradeRates(cases[i]);replay(cases[i],r,[0,0]);replay(cases[i],r,[0.9,0.9]);}});
test('strict grade types and prototype-like names do not collide',function(){var shared={},a=[{grade:1,rate:1},{grade:'1',rate:1},{grade:'__proto__',rate:1},{grade:'constructor',rate:1},{grade:shared,rate:1},{grade:NaN,rate:1}],r=[{grade:1,rate:1},{grade:'1',rate:1},{grade:'__proto__',rate:1},{grade:'constructor',rate:1},{grade:shared,rate:1},{grade:NaN,rate:1}];for(var i=0;i<r.length;i++)replay(a,r,[(i+0.5)/r.length,0.9]);});
test('missing grade falls back to the full list without extra random calls',function(){replay([{name:'fallback',grade:'A'}],[{grade:'missing',rate:1}],[0.5,0.5]);});
test('next command observes changed definitions and pools share only item references',function(){var a=[{name:'old',grade:'A',rate:1}],r=buildGradeRates(a),p=buildFurnitureGradePools(a,r);check(p[0][0]===a[0],'reference');a[0]={name:'new',grade:'A',rate:1};var q=buildFurnitureGradePools(a,r);check(p!==q&&p[0]!==q[0]&&q[0][0].name==='new','fresh command pools');});
test('empty table and malformed rows retain errors',function(){var failed=false;try{getRandomFurnitureByGrade([],[],buildFurnitureGradePools([],[]));}catch(e){failed=true;}check(failed,'empty rates error');failed=false;try{buildGradeRates([null]);}catch(e){failed=true;}check(failed,'malformed definition error');});
test('5000 sequential draws and IDs preserve the complete random stream',function(){var a=[{grade:'A',rate:30},{grade:'B',rate:70},{grade:'A',rate:30}],r=buildGradeRates(a),p=buildFurnitureGradePools(a,r);function batch(old){var seed=321,n=0;Math.random=function(){n++;seed=(seed*48271)%2147483647;return seed/2147483647;};var out=[];for(var i=0;i<5000;i++)out.push([a.indexOf(old?legacyDraw(a,r):getRandomFurnitureByGrade(a,r,p)),createCuId()]);return {rows:out,calls:n};}same(batch(true),batch(false),'draw and ID stream');});
`;
function runTests() {
    let groups = 0;
    function test(name, fn) { fn(); console.log('PASS SHOP COMMAND ' + (++groups) + ' ' + name); }
    const old = fixture(before), updated = fixture(main);
    for (const [command, tickets, bag, premium, dev] of [
        ['/샵오픈', 20, 0, false, false], ['/샵오픈 0', 20, 0, false, false], ['/샵오픈 8', 20, 2, false, false],
        ['/샵오픈 5000', 5000, 0, false, false], ['/샵오픈 5001', 6000, 0, false, false],
        ['/샵오픈 5', 4, 0, false, false], ['/샵오픈', 20, 10, false, false],
        ['/샵오픈', 20, 14, true, false], ['/샵오픈', 20, 15, true, false],
        ['/샵오픈 3', 20, 9, false, false], ['/샵오픈 8', 20, 0, false, true],
        ['/샵오픈 1 해봐', 20, 0, false, false], ['/샵오픈 -1', 20, 0, false, false], ['/샵오픈 1.5', 20, 0, false, false], ['/샵오픈박스오픈', 20, 0, false, false]
    ]) test(command + ' tickets=' + tickets + ' bag=' + bag + ' premium=' + premium + ' dev=' + dev, () => {
        old.prepare(tickets, bag, premium); updated.prepare(tickets, bag, premium);
        const prodMember = updated.f.raw(prodRoot + 'member.json'), prodHome = updated.f.raw(prodRoot + homeName);
        const a = old.run(command, dev), b = updated.run(command, dev); assert.deepStrictEqual(b, a);
        assert.strictEqual(JSON.stringify(b.home.other), '{"untouched":true}');
        if (dev) { assert.strictEqual(updated.f.raw(prodRoot + 'member.json'), prodMember); assert.strictEqual(updated.f.raw(prodRoot + homeName), prodHome); }
        if (command === '/샵오픈 8' && !dev) { assert(b.reply[0].includes('<ALLSEE>')); assert.strictEqual(b.randomCalls, 64); }
        if (command === '/샵오픈 5000') { assert.strictEqual(b.home.a.furnitureBag.length, 5000); assert.strictEqual(b.member.member.a.bag[ticket], undefined); }
    });
    for (const file of [homeName, 'member.json']) test(file + ' save failure preserves the existing error and persistence boundaries', () => {
        const rows = [];
        for (const x of [old, updated]) {
            x.prepare(); const home = x.f.raw(prodRoot + homeName), member = x.f.raw(prodRoot + 'member.json');
            if (file === homeName) x.f.failDirectPath(prodRoot + file); else x.f.failPath(prodRoot + file);
            assert.throws(() => x.run('/샵오픈 8')); assert.strictEqual(x.f.raw(prodRoot + 'member.json'), member);
            if (file === homeName) assert.strictEqual(x.f.raw(prodRoot + homeName), home);
            // 홈 저장 후 회원 저장이 실패하면 홈은 남는 기존 한계를 숨기거나 변경하지 않는다.
            else assert.strictEqual(x.f.get(prodRoot + homeName).a.furnitureBag.length, 8);
            assert.strictEqual(x.f.replies().length, 0);
            rows.push([x.f.get(prodRoot + homeName), x.f.read(), x.f.traces()]);
        }
        assert.deepStrictEqual(rows[1], rows[0]);
    });
    for (const mode of ['missing', 'corrupt', 'empty']) test(mode + ' catalog does not consume tickets or create furniture', () => {
        updated.prepare(); const home = updated.f.raw(prodRoot + homeName), member = updated.f.raw(prodRoot + 'member.json');
        if (mode === 'missing') updated.f.remove(updated.c.homeInfoFile);
        if (mode === 'corrupt') updated.f.corrupt(updated.c.homeInfoFile);
        if (mode === 'empty') updated.f.put(updated.c.homeInfoFile, { furniture: [] });
        assert.throws(() => updated.run('/샵오픈')); assert.strictEqual(updated.f.raw(prodRoot + homeName), home); assert.strictEqual(updated.f.raw(prodRoot + 'member.json'), member);
    });
    test('later command loads replaced definitions without retaining prior pools', () => {
        updated.prepare(); updated.run('/샵오픈');
        updated.f.put(updated.c.homeInfoFile, { furniture: [{ name: '새 가구', exp: 9999, grade: '신규', rate: 100 }] });
        assert(updated.run('/샵오픈').reply[0].includes('새 가구')); assert.strictEqual(updated.f.get(prodRoot + homeName).a.furnitureBag.length, 2);
    });
    vm.runInNewContext(functions(main) + scenarios, { print: console.log });
    console.log('PASS shop command safety ' + groups + ' groups; no performance measurements');
}
module.exports = { main, functions, scenarios, fixture };
if (require.main === module) runTests();
