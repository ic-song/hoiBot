const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

// Execute the actual narrow Rhino command branches against synthetic in-memory state.
const source = fs.readFileSync(require("node:path").join(__dirname, "..", "main.js"), "utf8");
const command = source.slice(source.indexOf('if (msg == "/집짓기")'), source.indexOf('if (msg == "/집뚝딱"'));
const writer = source.slice(source.indexOf('if (msg == "/집뚝딱"'), source.indexOf('if (msg == "/생각해본다"'));
const helper = source.slice(source.indexOf("function validateCanonicalHomeRecipeContract"), source.indexOf("function initSweetHomeUser"));
const transportHelper = source.slice(source.indexOf("function requestCanonicalHomeRecipeNext"), source.indexOf("function initSweetHomeUser"));
assert.ok(command.includes("requestCanonicalHomeRecipeNext") && writer.includes("homeUpgrade"));
const recipe = { name: "서울역 4번출구", emoji: "🚉", display: "서울역 4번출구🚉", floor: "1", exp: 100,
    required: [{ item: "땅문서📜", count: 1 }, { item: "돌멩이🪨", count: 3 }] };
const oldPending = { floor: "99", houseName: "old", exp: 999, required: [{ item: "old", count: 1 }] };
const plain = (value) => JSON.parse(JSON.stringify(value));

function scenario(options) {
    options = options || {};
    const messages = [], saves = [];
    const state = { u: { homeUpgrade: oldPending } };
    const bag = { "땅문서📜": 3, "돌멩이🪨": 9 };
    if (options.insufficient) bag["돌멩이🪨"] = 0;
    const home = { u: { floor: options.floor === undefined ? 0 : options.floor, houseName: "old", exp: 0 } };
    const pets = { u: { petname: "pet", petexp: 0 } };
    const context = {
        msg: "/집짓기", sender: "u", userState: state, data: { member: { u: { bag } } }, petData: pets,
        guildData: {}, homeInfoFile: "info", homeDataFile: "home", filePath: "member",
        GLOBAL_CONFIG: { homeRecipeCanonical: { enabled: options.canonical !== false } },
        replier: { reply: (message) => { if (options.replyThrows) throw new Error("reply failed"); messages.push(message); } },
        loadJsonFile: (path) => path === "info" ? { homeInfo: [recipe] } : home,
        checkRank: () => "테스트", initSweetHomeUser: (value) => value,
        getNextHomeInfoByFloor: (info, floor) => info.homeInfo.find((row) => Number(row.floor) === Number(floor) + 1) || null,
        getItemCount: (data, user, item) => data.member[user].bag[item] || 0,
        hasItem: (data, user, item, count) => (data.member[user].bag[item] || 0) >= count,
        numberWithCommas: (value) => Number(value).toLocaleString("en-US"),
        removeItem: (data, user, item, count) => { data.member[user].bag[item] -= count; },
        recordAdventureQuestAction: () => {}, saveJsonFile: (_, path) => saves.push(path),
        isFinite, Math, Number, String, Object, Array, Error
    };
    vm.createContext(context);
    vm.runInContext(helper, context);
    context.requestCanonicalHomeRecipeNext = (floor) => {
        if (options.readError) throw options.readError;
        if (options.result === null) return null;
        const selected = options.result || recipe;
        return context.validateCanonicalHomeRecipeContract(selected, Number(floor) + 1);
    };
    const run = (branch, message) => { context.msg = message; return vm.runInContext(`(function(){${branch}})()`, context); };
    return { run, state, bag, home, pets, messages, saves };
}

test("canonical success matches legacy message and homeUpgrade, then unchanged 집뚝딱 consumes it", () => {
    const canonical = scenario(), legacy = scenario({ canonical: false });
    canonical.run(command, "/집짓기");
    legacy.run(command, "/집짓기");
    assert.deepEqual(plain(canonical.state.u.homeUpgrade), plain(legacy.state.u.homeUpgrade));
    assert.deepEqual(canonical.messages, legacy.messages);
    assert.deepEqual(plain(canonical.state.u.homeUpgrade), { floor: "1", houseName: recipe.display, exp: 100, required: recipe.required });
    canonical.run(writer, "집뚝딱");
    assert.equal(canonical.state.u.homeUpgrade, undefined);
    assert.equal(canonical.home.u.floor, "1");
    assert.equal(canonical.bag["땅문서📜"], 2);
    assert.deepEqual(canonical.saves, ["home", "member"]);
});

test("success followed by success replaces pending state with the same validated contract", () => {
    const context = scenario();
    context.run(command, "/집짓기");
    const first = context.state.u.homeUpgrade;
    context.run(command, "/집짓기");
    assert.notEqual(context.state.u.homeUpgrade, first);
    assert.deepEqual(plain(context.state.u.homeUpgrade), plain(first));
});

for (const [name, options] of [
    ["Recipe absent", { result: null }],
    ["DB error", { readError: new Error("DB down") }],
    ["hoi_world connection failure", { readError: new Error("connection refused") }],
    ["material identity missing", { readError: new Error("HOME_RECIPE_INPUT_COUNT_DRIFT") }],
    ["materials insufficient", { insufficient: true }],
    ["malformed canonical response", { result: { ...recipe, required: [{ item: "", count: 1 }] } }]
]) {
    test(`success then ${name} cannot reuse the prior homeUpgrade`, () => {
        const runtime = {};
        const context = scenario(runtime);
        context.run(command, "/집짓기");
        assert.equal(context.state.u.homeUpgrade.floor, "1");
        Object.assign(runtime, options);
        if (options.insufficient) context.bag["돌멩이🪨"] = 0;
        context.run(command, "/집짓기");
        assert.equal(context.state.u.homeUpgrade, undefined);
        context.run(writer, "집뚝딱");
        assert.match(context.messages.at(-1), /진행 중인 집 업그레이드가 없습니다/);
        assert.deepEqual(context.saves, []);
    });
}

test("reply failure clears the newly committed transient state", () => {
    const context = scenario({ replyThrows: true });
    assert.throws(() => context.run(command, "/집짓기"), /reply failed/);
    assert.equal(context.state.u.homeUpgrade, undefined);
});

test("duplicate floor and nonexistent floor preserve first-row/null selection", () => {
    const duplicate = scenario({ floor: 262, result: { ...recipe, floor: "263" } });
    duplicate.run(command, "/집짓기");
    assert.equal(duplicate.state.u.homeUpgrade.floor, "263");
    const missing = scenario({ floor: 300, result: null });
    missing.run(command, "/집짓기");
    assert.equal(missing.state.u.homeUpgrade, undefined);
});

test("Rhino HTTP helper sends the scoped token, validates the DTO and closes the connection", () => {
    const observed = { closed: false, disconnected: false, headers: {} };
    const connection = {
        setConnectTimeout: (value) => { observed.connectTimeout = value; },
        setReadTimeout: (value) => { observed.readTimeout = value; },
        setRequestProperty: (key, value) => { observed.headers[key] = value; },
        getResponseCode: () => 200,
        getInputStream: () => JSON.stringify({ ok: true, recipe }) + "\n",
        disconnect: () => { observed.disconnected = true; }
    };
    function URL(value) { observed.url = value; this.openConnection = () => connection; }
    function InputStreamReader(value) { this.value = value; }
    function BufferedReader(reader) {
        const lines = reader.value.split("\n");
        this.readLine = () => lines.shift() || null;
        this.close = () => { observed.closed = true; };
    }
    const context = { GLOBAL_CONFIG: { homeRecipeCanonical: { configPath: "synthetic", timeoutMs: 1500 } },
        FileStream: { read: () => JSON.stringify({ url: "http://127.0.0.1:3002/api/v1/internal/home/recipe/next", token: "synthetic" }) },
        java: { net: { URL }, io: { InputStreamReader, BufferedReader } },
        JSON, parseInt, isFinite, Math, String, Number, Object, Array, Error, encodeURIComponent };
    vm.createContext(context);
    vm.runInContext(transportHelper, context);
    assert.deepEqual(plain(context.requestCanonicalHomeRecipeNext(0)), recipe);
    assert.match(observed.url, /currentFloor=0$/);
    assert.equal(observed.headers["x-home-recipe-token"], "synthetic");
    assert.equal(observed.connectTimeout, 1500);
    assert.equal(observed.readTimeout, 1500);
    assert.equal(observed.closed, true);
    assert.equal(observed.disconnected, true);
});
