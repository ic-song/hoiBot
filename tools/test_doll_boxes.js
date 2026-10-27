const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const base = fs.readFileSync(path.join(__dirname, "test_doll_content.js"), "utf8");
const { c, fixture, block, input, draw, install, run, cat, root, devRoot } = new Function("require", "__dirname", base + "\nreturn {c,fixture,block,input,draw,install,run,cat,root,devRoot};")(require, __dirname);
for (const name of ["applyDollBoxOpen", "buildDollBoxErrorMessage", "buildDollBoxMessages"])
    vm.runInContext(block(main, "function " + name + "("), c);
const cfg = c.GLOBAL_CONFIG.doll.boxes;
c.allsee = "\u200b".repeat(500); // 실제 MessengerBot 전체보기 길이로 분할을 검증한다.
const box = grade => cfg.itemNames[grade];
const clone = value => JSON.parse(JSON.stringify(value));
let groups = 0;
function test(name, fn) { fixture.reset(); fn(); console.log("PASS BOX " + (++groups) + ": " + name); }
function stocked(grade = 0, count = 3) { const x = input(5); x.d.member.u.bag[box(grade)] = count; x.d.member.u.bag["인형뽑기확률UP🧸(50%)"] = 2; return x; }
function open(x, grade = 0, count = 1, random = () => 0) { return c.applyDollBoxOpen(x.d, x.p, cat, x.s, x.idx, "u", "stable-id", "2026.10.19", { grade, count }, random); }
function prepare(grade = 0, count = 3, dev = false) { install(dev); const d = fixture.read(dev); d.member.u.bag[box(grade)] = count; d.member.u.bag["인형뽑기확률UP🧸(50%)"] = 2; fixture.write(d, dev); }

test("수량 생략 1개·100개 경계·전체 입력 검증·10등급", () => {
    for (const grade of cfg.grades) assert.strictEqual(c.getDollRequest("/인형상자오픈 " + grade).count, 1);
    assert.strictEqual(c.getDollRequest("/인형상자오픈 일반 100").count, 100);
    for (const suffix of ["0", "101", "-1", "1.5", "NaN", "1e2", "9007199254740992", "1 해봐"])
        assert(c.getDollRequest("/인형상자오픈 일반 " + suffix).error, suffix);
    assert(c.getDollRequest("/인형상자오픈").error);
    assert(c.getDollRequest("/인형상자오픈 모름 1").error);
    assert.strictEqual(c.getDollRequest("/인형상자오픈설명"), null);
    assert.strictEqual(new Set(cfg.itemNames).size, 10);
});

test("실제 9등급 목록만 추첨·처음/마지막 종류·기존 뽑기 보상 동일", () => {
    for (let grade = 0, threshold = 0; grade < 9; threshold += c.GLOBAL_CONFIG.doll.weights[grade++]) {
        for (const edge of [0, 0.999999]) {
            const x = stocked(grade), r = open(x, grade, 1, () => edge);
            const pool = cat.dolls.filter(d => d.grade === grade);
            assert.strictEqual(r.results[0].doll.id, pool[edge === 0 ? 0 : pool.length - 1].id);
            assert.strictEqual(r.results[0].doll.grade, grade);
        }
        const x = stocked(grade), y = input(5);
        const actual = open(x, grade).results[0], expected = draw(y, [0, threshold / 1000, 0, 0, 0]);
        for (const key of ["length", "fresh", "charm", "sale"]) assert.strictEqual(actual[key], expected[key], key + ":" + grade);
        assert.deepStrictEqual(clone(actual.experience), clone(expected.experience));
        assert.strictEqual(x.d.member.u.bag[c.GLOBAL_CONFIG.doll.ticketName], 5);
        assert.strictEqual(x.d.member.u.bag["인형뽑기확률UP🧸(50%)"], 2);
        assert.strictEqual(x.d.member.u.passDollDrawCnt, undefined);
    }
});

test("같은 인형은 첫 신규 이후 중복·획득 크기별 판매·최고 크기 유지", () => {
    const x = stocked(), values = [0, .999999, .999999, 0, 0, 0, 0, 0, 0]; let i = 0;
    const r = open(x, 0, 3, () => values[i++]);
    assert.strictEqual(r.freshCount, 1); assert.strictEqual(r.duplicateCount, 2);
    assert.strictEqual(r.sale, 2000000); assert.strictEqual(r.charm, 2550);
    assert.strictEqual(x.s.users.u.catches.D0001.count, 3);
    assert.strictEqual(x.s.users.u.catches.D0001.max, 1000);
    assert.strictEqual(r.remainingBox, 0);
});

test("가호 중도 소진·레벨업·합계는 개별 처리와 일치", () => {
    const x = stocked(4, 3); x.d.member.u.boostercnt = 10; x.d.member.u.exp = 999;
    const r = open(x, 4, 3), exp = r.results.map(row => row.experience);
    assert.strictEqual(r.experience.boosterResult.usedBooster, 10);
    assert.strictEqual(x.d.member.u.boostercnt, 0);
    for (const key of ["base", "bonus", "total"]) assert.strictEqual(r.experience[key], exp.reduce((sum, item) => sum + item[key], 0));
    assert(r.experience.levelUps.length > 0);
    assert(r.results.slice(1).every(row => row.experience.boosterResult.usedBooster === 0));
});

test("엘리트·빈 목록·부족 재고·오입력은 무변경·단일/다중 UI", () => {
    for (const [grade, count] of [[9, 1], [0, 4], [0, 0], [0, 101]]) {
        const x = stocked(grade), before = JSON.stringify(x), r = open(x, grade, count);
        assert(!r.ok); assert.strictEqual(JSON.stringify(x), before);
        const text = c.buildDollBoxMessages(x.d, x.p, {}, cat, "u", r).join("\n");
        assert(text.length > 0);
        if (grade === 9) assert(text.includes("차감하지 않았어요"));
    }
    const x = stocked(), r = open(x), before = JSON.stringify(x);
    const text = c.buildDollBoxMessages(x.d, x.p, {}, cat, "u", r).join("\n");
    assert.strictEqual(JSON.stringify(x), before); assert(text.includes("인형상자 개봉"));
    assert(text.includes("1개 사용 · 잔여 2개")); assert(!text.includes("이용권 1개 사용")); assert(!text.includes("성공률"));
});

test("100개·신규/중복 합계·전체 목록·분할 길이·재실행", () => {
    const x = stocked(3, 100), r = open(x, 3, 100);
    const messages = c.buildDollBoxMessages(x.d, x.p, {}, cat, "u", r), text = messages.join("\n");
    assert.strictEqual(r.results.length, 100); assert.strictEqual(r.freshCount + r.duplicateCount, 100);
    assert(messages.length > 1); assert(messages.every(message => message.length <= cfg.messageMaxLength));
    for (let i = 1; i <= 100; i++) assert(text.includes("\n" + i + ". "));
    const before = JSON.stringify(x); assert(!open(x, 3).ok); assert.strictEqual(JSON.stringify(x), before);
});

test("실제 명령·기본 1개·재고 동기화·엘리트/오입력 무저장·DEV 분리", () => {
    prepare(); const original = c.Math.random; c.Math.random = () => 0;
    try {
        const text = run("/인형상자오픈 일반"); assert(text.includes("1개 사용"));
        assert.strictEqual(fixture.read().member.u.bag[box(0)], 2);
        assert.strictEqual(fixture.read().member.u.bag[c.GLOBAL_CONFIG.doll.ticketName], 1);
        assert.strictEqual(fixture.read().member.u.passDollDrawCnt, undefined);
        prepare(9); const before = clone(fixture.read());
        assert(run("/인형상자오픈 엘리트 1").includes("준비되지 않았어요"));
        assert.deepStrictEqual(fixture.read(), before); assert(!fixture.traces().some(t => t.type === "save"));
        for (const command of ["/인형상자오픈 일반 101", "/인형상자오픈 일반 1 해봐"]) {
            run(command); assert.deepStrictEqual(fixture.read(), before); assert(!fixture.traces().some(t => t.type === "save"));
        }
        prepare(); prepare(0, 3, true); const prod = clone(fixture.read());
        run("/인형상자오픈 일반 2", true);
        assert.strictEqual(fixture.read(true).member.u.bag[box(0)], 1); assert.deepStrictEqual(fixture.read(), prod);
    } finally { c.Math.random = original; }
});

test("전체 저장 단계 실패·재시도·재시작 복구·전송 실패 시 지급 보존", () => {
    const original = c.Math.random; c.Math.random = () => 0;
    try {
        for (const file of ["dollPending.json", "dollRecords_" + c.getDollShard("u") + ".json", "dollIndex.json", "member_pet.json", "member.json"]) {
            prepare(); const names = ["member.json", "member_pet.json", "dollIndex.json", "dollRecords_" + c.getDollShard("u") + ".json"];
            const before = names.map(name => fixture.raw(root + name));
            fixture.failPath(root + file); assert.throws(() => run("/인형상자오픈 일반 3"));
            assert.deepStrictEqual(names.map(name => fixture.raw(root + name)), before);
            run("/인형상자오픈 일반 3"); assert.strictEqual(fixture.get(root + "member_pet.json").u.dollCharm, 2550);
        }
        prepare(); fixture.failNth(root + "dollPending.json", 2); const before = clone(fixture.read());
        assert.throws(() => run("/인형상자오픈 일반 3")); assert.deepStrictEqual(fixture.read(), before);
        prepare(); const names = ["member.json", "member_pet.json", "dollIndex.json", "dollRecords_" + c.getDollShard("u") + ".json"];
        const pending = names.map(name => ({ name, text: fixture.raw(root + name) }));
        fixture.put(root + "dollPending.json", { pending }); const broken = fixture.read(); broken.member.u.bag[box(0)] = 0; fixture.write(broken);
        run("/인형상자오픈 일반 3"); assert.strictEqual(fixture.get(root + "member_pet.json").u.dollCharm, 2550);
        prepare(); fixture.replyFail(true); run("/인형상자오픈 일반 3");
        assert.strictEqual(fixture.get(root + "member_pet.json").u.dollCharm, 2550); assert.strictEqual(fixture.get(root + "dollPending.json").pending, null);
    } finally { fixture.replyFail(false); c.Math.random = original; }
});

test("전체알림 등급·대전 차단·빈 데이터/손상 파일 무차감", () => {
    const random = c.Math.random, notice = c.noticeMsg; c.Math.random = () => 0;
    try {
        for (const grade of [4, 5, 6, 7, 8]) {
            prepare(grade, 2); let notices = 0; c.noticeMsg = () => notices++;
            run("/인형상자오픈 " + cfg.grades[grade] + " 2"); assert.strictEqual(notices, grade >= 6 ? 2 : 0);
        }
        prepare(); const before = clone(fixture.read());
        fixture.corrupt(root + "dollCatalog.json"); assert.throws(() => run("/인형상자오픈 일반 2")); assert.deepStrictEqual(fixture.read(), before);
        prepare(); const originalPool = cat.dolls, x = stocked(), snapshot = JSON.stringify(x);
        cat.dolls = originalPool.filter(doll => doll.grade !== 0);
        try { assert.strictEqual(open(x).reason, "unavailable"); assert.strictEqual(JSON.stringify(x), snapshot); } finally { cat.dolls = originalPool; }
        prepare(); const context = c.createCommandContext(false, "test"), previous = c.enterCommandContext(context);
        try {
            c.ctx = context; c.data = c.loadJsonFile(c.filePath); c.petData = c.loadJsonFile(c.memberPetPath); c.sender = "u"; c.guildData = {};
            c.petMusou = { active: true }; c.msg = "/인형상자오픈 일반 2"; fixture.clear(); c.runDollBranch();
            assert(fixture.replies().join("").includes("진행 중")); assert(!fixture.traces().some(t => t.type === "save"));
        } finally { c.exitCommandContext(previous); c.petMusou = { active: false }; }
    } finally { c.Math.random = random; c.noticeMsg = notice; }
});

test("MAIN/Info 가방에서 10종 모두 동일한 아이템명·연속 번호", () => {
    const info = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");
    vm.runInContext(block(main, "function normalizeItemName("), c);
    for (const source of [main, info]) {
        vm.runInContext(block(source, "function generateBagOutput("), c);
        const bag = {}; cfg.itemNames.forEach((name, i) => { bag[name] = i + 1; });
        const result = c.generateBagOutput(bag);
        cfg.itemNames.forEach(name => assert(result.bagOutput.includes(name), name));
        assert.strictEqual(result.sortedItemList.length, 10);
    }
});

test("재고·포인트 손상/정수 범위와 필수 파일 오류는 실제 저장 무변경", () => {
    const names = ["member.json", "member_pet.json", "dollIndex.json", "dollRecords_" + c.getDollShard("u") + ".json", "dollPending.json"];
    const snapshot = () => names.map(name => fixture.raw(root + name));
    for (const value of [-1, 1.5, "3", null, Number.MAX_SAFE_INTEGER + 1]) {
        for (const field of ["box", "point"]) {
            prepare(); const d = fixture.read();
            if (field === "box") d.member.u.bag[box(0)] = value; else d.member.u.point = value;
            fixture.write(d); const before = snapshot();
            assert.throws(() => run("/인형상자오픈 일반 2")); assert.deepStrictEqual(snapshot(), before);
        }
    }
    for (const name of ["dollIndex.json", "dollRecords_" + c.getDollShard("u") + ".json", "dollCatalog.json", "member_pet.json"]) {
        fixture.reset(); prepare(); fixture.corrupt(root + name); const before = snapshot();
        assert.throws(() => run("/인형상자오픈 일반 2")); assert.deepStrictEqual(snapshot(), before);
        fixture.reset(); prepare(); fixture.remove(root + name); const missingBefore = snapshot();
        assert.throws(() => run("/인형상자오픈 일반 2")); assert.deepStrictEqual(snapshot(), missingBefore);
    }
});

test("2회차 포인트 넘침·중간 난수 오류는 이전 획득까지 저장하지 않음", () => {
    const original = c.Math.random;
    try {
        prepare(); const d = fixture.read(); d.member.u.point = Number.MAX_SAFE_INTEGER - 500000; fixture.write(d);
        const before = ["member.json", "member_pet.json", "dollIndex.json", "dollRecords_" + c.getDollShard("u") + ".json"].map(name => fixture.raw(root + name));
        c.Math.random = () => 0;
        assert.throws(() => run("/인형상자오픈 일반 3"), /포인트/);
        assert.deepStrictEqual(["member.json", "member_pet.json", "dollIndex.json", "dollRecords_" + c.getDollShard("u") + ".json"].map(name => fixture.raw(root + name)), before);
        assert.strictEqual(fixture.get(root + "dollPending.json").pending, null);
        prepare(); const memberBefore = clone(fixture.read()); let calls = 0;
        c.Math.random = () => { if (++calls === 7) throw Error("synthetic middle draw failure"); return 0; };
        assert.throws(() => run("/인형상자오픈 일반 3"), /middle draw/);
        assert.deepStrictEqual(fixture.read(), memberBefore); assert.strictEqual(Object.keys(fixture.get(root + "dollIndex.json").users).length, 0);
    } finally { c.Math.random = original; }
});

test("9등급의 실제 1000종을 모두 선택할 수 있고 목록 밖을 뽑지 않음", () => {
    let checked = 0;
    for (let grade = 0; grade < 9; grade++) {
        const pool = cat.dolls.filter(doll => doll.grade === grade);
        for (let at = 0; at < pool.length; at++) {
            const x = stocked(grade, 1); let calls = 0;
            const r = open(x, grade, 1, () => ++calls === 1 ? (at + 0.5) / pool.length : 0);
            assert.strictEqual(r.results[0].doll.id, pool[at].id); checked++;
        }
    }
    assert.strictEqual(checked, 1000);
});

test("100개 처리와 같은 난수의 1개씩 100회는 보상·도감·가호 최종 상태 동일", () => {
    const random = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (const grade of [0, 3, 8]) {
        const batch = stocked(grade, 100), singles = stocked(grade, 100);
        batch.d.member.u.boostercnt = singles.d.member.u.boostercnt = 100;
        const r = open(batch, grade, 100, random(1900 + grade));
        const stream = random(1900 + grade), rows = [];
        for (let i = 0; i < 100; i++) rows.push(open(singles, grade, 1, stream));
        assert.deepStrictEqual(clone(batch), clone(singles));
        for (const key of ["charm", "sale", "freshCount", "duplicateCount"]) assert.strictEqual(r[key], rows.reduce((sum, row) => sum + row[key], 0));
    }
});

test("유사 입력 150여개는 소모하지 않고 수량 생략/탭/선행0은 정확히 분류", () => {
    const suffixes = ["-1", "+1", "0", "0.5", "1.0", "1e2", "0x10", "Infinity", "NaN", "１００", "101", "1 해봐", "1 2", "999999999999999999999"];
    for (const grade of cfg.grades) {
        for (const suffix of suffixes) assert(c.getDollBoxRequest("/인형상자오픈 " + grade + " " + suffix).error);
        assert.strictEqual(c.getDollBoxRequest("/인형상자오픈\t" + grade + "\t001").count, 1);
    }
    for (const command of ["/인형상자오픈방법", "/인형상자오픈!", "인형상자오픈 일반 1", "다른 /인형상자오픈 일반 1"]) assert.strictEqual(c.getDollBoxRequest(command), null);
});

test("특수 계정명·패스 일퀘 보존·초보티어·알림 예외는 지급 중복 없음", () => {
    for (const user of ["__proto__", "constructor", "toString"]) {
        const x = stocked(); Object.defineProperty(x.d.member, user, { value: x.d.member.u, enumerable: true }); Object.defineProperty(x.p, user, { value: { petexp: 1 }, enumerable: true });
        x.d.member[user].rank.tier = "새싹"; x.d.member[user].passDollDrawCnt = 1;
        const r = c.applyDollBoxOpen(x.d, x.p, cat, x.s, x.idx, user, "special-id", "2026.10.19", { grade: 0, count: 3 }, () => 0);
        assert(r.ok); assert.strictEqual(x.d.member[user].passDollDrawCnt, 1); assert(Object.prototype.hasOwnProperty.call(x.s.users, user));
        assert.strictEqual(x.s.users[user].catches.D0001.count, 3);
    }
    prepare(6, 2); const random = c.Math.random, notice = c.noticeMsg; c.Math.random = () => 0; c.noticeMsg = () => { throw Error("synthetic notice failure"); };
    try { run("/인형상자오픈 초월 2"); assert.strictEqual(fixture.read().member.u.bag[box(6)] || 0, 0); assert.strictEqual(fixture.get(root + "dollPending.json").pending, null); }
    finally { c.Math.random = random; c.noticeMsg = notice; }
});


test("붙여 쓴 10등급 명령과 안내·기존 공백 명령 호환·접미 문구 차단", () => {
    for (let grade = 0; grade < cfg.grades.length; grade++) {
        const name = cfg.grades[grade];
        for (const separator of ["", " ", "\t"]) {
            const command = "/인형상자오픈" + separator + name;
            assert.strictEqual(c.getDollRequest(command).count, 1);
            assert.strictEqual(c.getDollRequest(command + " 100").grade, grade);
            assert.strictEqual(c.getDollRequest(command + " 100").count, 100);
            for (const suffix of ["0", "101", "-1", "1.2", "NaN", "1 해봐", "1 2"])
                assert(c.getDollRequest(command + " " + suffix).error);
        }
        assert.strictEqual(c.getDollRequest("/인형상자오픈" + name + "설명"), null);
        assert(cfg.itemNames[grade].includes("/인형상자오픈" + name + " 숫자"));
    }
    const x = stocked(), text = c.buildDollBoxErrorMessage(x.d, x.p, {}, "u", { reason: "quantity" });
    assert(text.includes("/인형상자오픈고급 10")); assert(!text.includes("/인형상자오픈 고급"));
});

test("기존·새 상자 재고 합산·정확한 차감·잘못된 기존 재고 무변경", () => {
    for (let grade = 0; grade < 9; grade++) {
        const legacy = box(grade).replace("/인형상자오픈", "/인형상자오픈 ");
        for (const [oldCount, newCount, count] of [[3, 0, 2], [2, 3, 4], [3, 2, 1], [0, 3, 3]]) {
            const x = stocked(grade, newCount); x.d.member.u.bag[legacy] = oldCount;
            const r = open(x, grade, count);
            assert(r.ok); assert.strictEqual(r.remainingBox, oldCount + newCount - count);
            assert.strictEqual(x.d.member.u.bag[legacy] || 0, Math.max(0, oldCount - count));
            assert.strictEqual(x.d.member.u.bag[box(grade)] || 0, newCount - Math.max(0, count - oldCount));
            assert(!c.buildDollBoxMessages(x.d, x.p, {}, cat, "u", r).join("\n").includes("/인형상자오픈 "));
        }
        for (const value of [-1, 1.5, "3", null, Number.MAX_SAFE_INTEGER]) {
            const x = stocked(grade); x.d.member.u.bag[legacy] = value; const before = JSON.stringify(x);
            assert.throws(() => open(x, grade)); assert.strictEqual(JSON.stringify(x), before);
        }
        const x = stocked(grade, 1); x.d.member.u.bag[legacy] = 1; const before = JSON.stringify(x);
        assert.strictEqual(open(x, grade, 3).available, 2); assert.strictEqual(JSON.stringify(x), before);
    }
});

test("붙인 실제 명령의 기존 재고 저장·실패 원복·DEV 격리·엘리트 무차감", () => {
    const legacy = box(1).replace("/인형상자오픈", "/인형상자오픈 ");
    const random = c.Math.random; c.Math.random = () => 0;
    try {
        const setup = (dev = false) => { prepare(1, 1, dev); const d = fixture.read(dev); d.member.u.bag[legacy] = 2; fixture.write(d, dev); };
        setup(); assert(run("/인형상자오픈고급 2").includes("잔여 1개"));
        assert.strictEqual(fixture.read().member.u.bag[legacy], undefined); assert.strictEqual(fixture.read().member.u.bag[box(1)], 1);
        setup(); const before = clone(fixture.read()); fixture.failPath(root + "member.json");
        assert.throws(() => run("/인형상자오픈고급 3")); assert.deepStrictEqual(fixture.read(), before);
        run("/인형상자오픈고급 3"); assert.strictEqual(fixture.read().member.u.bag[legacy], undefined); assert.strictEqual(fixture.read().member.u.bag[box(1)], undefined);
        setup(); setup(true); const prod = clone(fixture.read()); run("/인형상자오픈고급", true);
        assert.deepStrictEqual(fixture.read(), prod); assert.strictEqual(fixture.read(true).member.u.bag[legacy], 1);
        prepare(9); const elite = fixture.read(), oldElite = box(9).replace("/인형상자오픈", "/인형상자오픈 "); elite.member.u.bag[oldElite] = 2; fixture.write(elite);
        const eliteBefore = clone(fixture.read()); assert(run("/인형상자오픈엘리트").includes("차감하지 않았어요")); assert.deepStrictEqual(fixture.read(), eliteBefore);
    } finally { c.Math.random = random; }
});

test("MAIN/Info 기존·새 이름 혼합 가방은 붙인 표기·원래 재고와 번호 보존", () => {
    const info = fs.readFileSync(path.join(__dirname, "..", "Info.js"), "utf8");
    for (const source of [main, info]) {
        vm.runInContext(block(source, "function generateBagOutput("), c);
        const bag = {};
        cfg.itemNames.forEach((name, i) => { bag[name] = i + 1; bag[name.replace("/인형상자오픈", "/인형상자오픈 ")] = i + 2; });
        const before = JSON.stringify(bag), result = c.generateBagOutput(bag);
        assert.strictEqual(JSON.stringify(bag), before); assert.strictEqual(result.sortedItemList.length, 20);
        assert.strictEqual(new Set(result.sortedItemList).size, 20); assert(!result.bagOutput.includes("/인형상자오픈 "));
        result.sortedItemList.forEach((key, i) => {
            const label = key.replace(/(\/인형상자오픈)\s+/, "$1");
            assert(result.bagOutput.includes((i + 1) + ". " + label + " x " + bag[key]));
        });
        const infoNames = vm.runInNewContext("(" + block(info, "const GLOBAL_CONFIG = {").replace("const GLOBAL_CONFIG = ", "") + ")").doll.boxes.itemNames;
        assert.deepStrictEqual(Array.from(infoNames), Array.from(cfg.itemNames));
    }
});

console.log("인형상자 " + groups + "개 그룹 통과");
