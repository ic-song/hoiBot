const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

// 현재 소스의 함수와 지급 분기를 합성 파일시스템에서 실행한다.
function fn(name) {
    const start = source.indexOf("function " + name + "(");
    assert(start >= 0, name);
    let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw Error(name);
}
const commandAt = source.indexOf('if ((msg === "/미니펫추가"');
const commandEnd = source.indexOf('if (/^\\/알림', commandAt);
assert(commandAt >= 0 && commandEnd > commandAt);
const command = "(function () {" + source.slice(commandAt, commandEnd) + "})()";
const root = "/sdcard/호이랜드/", devRoot = "/sdcard/호이랜드_dev/";
const target = "합성 대상", petFile = root + "member_pet.json", devFile = devRoot + "member_pet.json";
const input = "/미니펫추가 " + target + " 아르케 🌌 엘리트 100000000000 12000000";
let disk, failure, events, replies, lastReadFile;

// Java 파일 호출만 메모리로 대체하며 실제 저장·교체·롤백 함수를 사용한다.
function fail(stage, file) {
    if (failure && failure.stage === stage && failure.file === file) {
        failure = null;
        throw Error("injected " + stage);
    }
}
function FakeFile(file) { this.path = String(file); }
FakeFile.prototype.exists = function () { return Object.hasOwn(disk, this.path); };
FakeFile.prototype.getPath = function () { return this.path; };
FakeFile.prototype.delete = function () { delete disk[this.path]; return true; };
FakeFile.prototype.renameTo = function (to) {
    const stage = this.path.endsWith(".tmp") ? "replace" : "backup";
    if (failure && failure.stage === stage && failure.file === to.path.replace(/\.rollback$/, "")) {
        failure = null; return false;
    }
    if (!this.exists()) return false;
    disk[to.path] = disk[this.path]; delete disk[this.path];
    if (stage === "replace" && (to.path === petFile || to.path === devFile)) events.push("saved:" + to.path);
    return true;
};
const noopLock = { lock() {}, unlock() {} };
function threadLocal() {
    return { value: null, get() { return this.value; }, set(v) { this.value = v; }, remove() { this.value = null; } };
}
const c = {
    sender: "호이 남", memberPetPath: petFile, guildData: {}, allsee: "<ALLSEE>",
    DATA_ROOT_PATH: root, DEV_DATA_ROOT_PATH: devRoot, COMMON_DATA_FILE_MAP: {},
    commandContextThreadLocal: threadLocal(), dataSaveTransactionThreadLocal: threadLocal(),
    dataTransactionLock: noopLock, protectedJsonSaveLocks: {},
    GLOBAL_CONFIG: { supportPass: { premium: { miniPetBagBaseCount: 10, miniPetBagBonusCount: 5 } } },
    miniPetData: { gradeTable: [{ grade: "일반" }, { grade: "엘리트" }] },
    getAutoDailyBatchContext: () => null, ensureParentFolder() {}, debuggerLog() {},
    getManagedJsonBackupPath: p => p + ".bak", getManagedJsonSecondaryBackupPath: () => null,
    isProtectedManagedJsonPath: p => p === petFile || p === devFile,
    getProtectedJsonSaveLock: () => noopLock,
    parseManagedJsonContent(text, file) { if (lastReadFile === file + ".tmp") fail("verify", file); return JSON.parse(text); },
    parseJsonContent: text => JSON.parse(text), formatDateTime: () => "synthetic", testRoom: "synthetic",
    restoreManagedJsonFromBackup: () => null,
    checkRank: (_d, _p, _g, user) => user,
    isHoiPassPremiumActive: () => c.premium,
    getHoiPassPremiumHeader: () => "", getMiniPetCollectionData: () => null,
    getMiniPetCollectionRanking: () => [], getMiniPetUpgradeDisplay: () => "",
    numberWithCommas: n => Number(n).toLocaleString("en-US"),
    replier: { reply(message) { events.push("reply"); replies.push(message); } },
    FileStream: {
        read(file) { assert(Object.hasOwn(disk, file), "missing synthetic file"); lastReadFile = file; return disk[file]; },
        write() { throw Error("Unexpected direct write"); }
    },
    java: { io: {
        File: FakeFile,
        FileOutputStream: function (file) {
            this.path = file.path; disk[this.path] = "";
            this.getFD = () => ({ sync: () => fail("sync", this.path.replace(/\.tmp$/, "")) });
            this.close = () => {};
        },
        OutputStreamWriter: function (stream) {
            this.write = text => { fail("write", stream.path.replace(/\.tmp$/, "")); disk[stream.path] = text; };
            this.flush = () => {}; this.close = () => {};
        }
    } }
};
vm.createContext(c);
for (const name of ["isDevCommandMessage", "stripDevCommandPrefix", "createCommandContext", "getCurrentContext", "enterCommandContext", "exitCommandContext", "getDataFileName", "resolveActiveDataPath",
    "getDataSaveTransaction", "beginDataSaveTransaction", "endDataSaveTransaction", "prepareManagedJsonTransactionEntry", "rollbackDataSaveTransaction", "writeVerifiedJsonFile", "saveJsonFile", "loadJsonFile",
    "addMiniPetToUserBag", "getMiniPetBagLimit", "sortMiniPetBag", "refreshMiniPetSortIndex", "buildMiniPetBagRenewedMessage"])
    vm.runInContext(fn(name), c);

// 합성 회원·펫 데이터만 만들고 운영 스냅샷은 읽거나 쓰지 않는다.
function reset(count = 14, premium = true) {
    const bag = Array.from({ length: count }, (_, i) => ({ name: "기존" + i, emoji: "🐹", grade: "일반", battleExp: i + 100, castleExp: i + 100, raidExp: i + 100 }));
    const state = { [target]: { miniPetBag: bag, miniPet: { name: "대표", battleExp: 42 }, miniPetSupport: { name: "보조", battleExp: 13 } } };
    disk = { [petFile]: JSON.stringify(state), [devFile]: JSON.stringify(state) };
    c.data = { member: { [target]: { point: 123, bag: { "합성아이템": 2 } } } };
    c.sender = "호이 남"; c.premium = premium;
    c.commandContextThreadLocal.remove(); c.dataSaveTransactionThreadLocal.remove();
    failure = null; events = []; replies = [];
}
// 실제 컨텍스트·로드·저장 흐름을 사용하고 외부 응답의 트랜잭션 종료를 재현한다.
function run(message = input) {
    events = []; replies = [];
    const isDev = c.isDevCommandMessage(message);
    const previous = c.enterCommandContext(c.createCommandContext(isDev));
    c.msg = isDev ? c.stripDevCommandPrefix(message) : message;
    c.beginDataSaveTransaction();
    try {
        c.petData = c.loadJsonFile(petFile);
        vm.runInContext(command, c);
    } catch (error) {
        c.rollbackDataSaveTransaction(); throw error;
    } finally {
        c.endDataSaveTransaction(); c.exitCommandContext(previous);
    }
    return replies.join("\n");
}
function read(file = petFile) { return JSON.parse(disk[file]); }
function bag(file = petFile) {
    c.petData = read(file);
    return c.buildMiniPetBagRenewedMessage(target, c.data, c.petData, {}, {}, c.miniPetData);
}

// 1. 정상 지급 후 실제 저장·재로드·가방 표시를 함께 확인한다.
reset(); const untouchedMember = JSON.stringify(c.data);
assert(run().includes("보유 수량: 15/15"));
assert(events.indexOf("saved:" + petFile) < events.indexOf("reply"));
let state = read()[target];
assert.strictEqual(state.miniPetBag.length, 15);
assert.deepStrictEqual(state.miniPetBag[14], { name: "아르케", emoji: "🌌", grade: "엘리트", price: 100000000000, battleExp: 12000000, castleExp: 12000000, raidExp: 12000000 });
assert.deepStrictEqual(state.miniPet, { name: "대표", battleExp: 42 });
assert.deepStrictEqual(state.miniPetSupport, { name: "보조", battleExp: 13 });
assert.strictEqual(JSON.stringify(c.data), untouchedMember);
assert(bag().includes("[15/15]") && bag().includes("아르케"));
assert.strictEqual(c.petData[target].miniPetBag[0].name, "아르케");
console.log("PASS 1: 정상 지급·저장 후 성공 안내·재로드·가방 표시·대표/보조/회원 유지");

// 2. 공백과 탭을 처리하고 공백이 있는 미니펫 이름도 유지한다.
for (const whitespace of [" ", "  ", "\t"]) {
    reset(0); run(["/미니펫추가", "합성", "대상", "합성", "미니펫", "🐹", "일반", "0", "0"].join(whitespace));
    assert.deepStrictEqual(Object.keys(read()), [target]);
    assert.strictEqual(read()[target].miniPetBag[0].name, "합성 미니펫");
    assert.strictEqual(read()[target].miniPetBag[0].price, 0);
}
console.log("PASS 2: 연속 공백·탭·다단어 미니펫 이름·0 값");

// 3. 미등록 대상에게 회원 외 펫 데이터를 생성하지 않는다.
reset(); let before = JSON.stringify(disk);
assert(run(input.replace(target, "미등록 대상")).includes("등록된 회원이 아닙니다"));
assert.strictEqual(JSON.stringify(disk), before);
assert(!c.petData["미등록 대상"]);
console.log("PASS 3: 미등록 대상 지급 차단·원본 유지");

// 4. 기존 전용 실행 권한을 확대하지 않는다.
for (const sender of ["합성 관리자", "호이 여", "일반 사용자"]) {
    reset(); c.sender = sender; before = JSON.stringify(disk); run();
    assert.strictEqual(JSON.stringify(disk), before); assert.deepStrictEqual(replies, []);
}
console.log("PASS 4: 기존 전용 실행 권한 유지");

// 5. 잘못된 접미·숫자·인자 입력은 지급하지 않는다.
for (const message of [input + " 해봐", input + " 1", input.replace("12000000", "12000000x"), input.replace("12000000", "-1"), input.replace("12000000", "1.5"), input.replace("12000000", "1e6"), input.replace("12000000", "Infinity"), input.replace("100000000000", "-1"), "/미니펫추가방법", "/미니펫추가 " + target + " 아르케"]) {
    reset(); before = JSON.stringify(disk); run(message);
    assert.strictEqual(JSON.stringify(disk), before); assert(!replies.some(s => s.includes("추가되었습니다")));
}
reset(); assert(run("/미니펫추가").includes("사용법"));
console.log("PASS 5: 잘못된 접미·음수·소수·인자·유사 명령 미실행·사용법 안내");

// 6. JS에서 정확히 표현할 수 있는 정수 경계를 확인한다.
for (const value of ["9007199254740992", "9".repeat(400)]) for (const field of ["12000000", "100000000000"]) {
    reset(); before = JSON.stringify(disk); assert(run(input.replace(field, value)).includes("정수로 입력"));
    assert.strictEqual(JSON.stringify(disk), before);
}
reset(0); run(input.replace("12000000", "9007199254740991"));
assert.strictEqual(read()[target].miniPetBag[0].battleExp, 9007199254740991);
console.log("PASS 6: 정수 상한·무한대 변환 차단·상한값 지급");

// 7. 임시 파일 기록·동기화·검증·교체 실패 후 원본 유지와 재시도를 확인한다.
for (const stage of ["write", "sync", "verify", "backup", "replace"]) {
    reset(); const original = disk[petFile]; failure = { stage, file: petFile };
    assert.throws(() => run(), /injected|backup failed|replace failed/);
    assert.strictEqual(disk[petFile], original);
    assert(!replies.some(s => s.includes("추가되었습니다")));
    assert(replies.some(s => s.includes("지급이 완료되지 않았습니다")));
    assert(!Object.hasOwn(disk, petFile + ".tmp"));
    assert(!Object.hasOwn(disk, petFile + ".rollback"));
    assert(run().includes("보유 수량: 15/15"));
    assert.strictEqual(read()[target].miniPetBag.filter(p => p.name === "아르케").length, 1);
}
console.log("PASS 7: 저장 5단계 실패·거짓 성공 없음·원본 유지·재시도 1마리 지급");

// 8. 기존 관리자 초과 지급 정책과 등록 회원의 빈 가방 초기화를 유지한다.
for (const [count, premium] of [[10, false], [15, true]]) {
    reset(count, premium); run(); assert.strictEqual(read()[target].miniPetBag.length, count + 1);
}
for (const owner of [undefined, { miniPet: { name: "기존대표" } }]) {
    reset(0); disk[petFile] = JSON.stringify(owner ? { [target]: owner } : {}); run();
    assert.strictEqual(read()[target].miniPetBag.length, 1);
    if (owner) assert.deepStrictEqual(read()[target].miniPet, owner.miniPet);
}
console.log("PASS 8: 관리자 초과 지급 유지·등록 회원 신규 가방 생성");

// 9. ALLSEE 아래 목록도 표시하고 반복 조회와 재로드에서 수량을 유지한다.
reset(); run(input.replace("아르케", "합성저매력").replace("12000000", "1"));
const rendered = bag(); assert(rendered.indexOf("합성저매력") > rendered.indexOf("<ALLSEE>"));
for (let i = 0; i < 5; i++) { const result = bag(); assert(result.includes("[15/15]") && result.includes("합성저매력")); }
assert.strictEqual(read()[target].miniPetBag.length, 15);
console.log("PASS 9: ALLSEE 아래 전체 목록·조회 5회·재로드 수량 유지");

// 10. 실제 DEV 컨텍스트로 경로를 분리하고 운영 데이터가 유지되는지 확인한다.
for (const prefix of ["dev/미니펫추가", "dev//미니펫추가"]) {
    reset(); const prodBefore = disk[petFile]; run(input.replace("/미니펫추가", prefix));
    assert.strictEqual(disk[petFile], prodBefore); assert.strictEqual(read(devFile)[target].miniPetBag.length, 15);
    assert(events.includes("saved:" + devFile)); assert(!events.includes("saved:" + petFile));
}
console.log("PASS 10: 실제 DEV 접두사·컨텍스트·저장 경로 분리");

// 11. 잘못된 원본을 빈 가방으로 덮어쓰지 않고 기존 로드 오류를 유지한다.
reset(); disk[petFile] = "{invalid";
assert.throws(() => run(), /JSON|Unexpected|property/);
assert.strictEqual(disk[petFile], "{invalid"); assert.deepStrictEqual(replies, []);
console.log("PASS 11: JSON 로드 오류 전파·원본 미초기화·성공 안내 없음");
