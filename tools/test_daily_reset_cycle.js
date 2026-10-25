// 실제 /리셋 분기·저장 함수와 합성 자료로 모든 일일 횟수의 공통 회차를 검증한다.
const assert = require('assert'), vm = require('vm'), h = require('./test_mini_games');
const base = '/sdcard/호이랜드/', devBase = '/sdcard/호이랜드_dev/';
const helperNames = ['getDailyResetCycle', 'resetAttendance', 'getAttendanceKstDateKey', 'getCurrentDate',
    'getDiamondTycoonDailyData', 'getGuildMarbleDailyCount', 'awardDailyChatExperience',
    'buildDailyChatExperienceStatusMessage', 'createPetHomeSocialUser', 'getPetHomeSocialUser',
    'getPetHomeHeartUsageStatus', 'hasUnlimitedPetHomeHeartUsage', 'recordLightAttendanceOnly',
    'migrateLightAttendanceToMember', 'hasAttendedToday'];

function fixture() {
    const f = h.fixture(); f.seed(); const c = f.c;
    for (const name of helperNames) vm.runInContext(h.block(h.main, 'function ' + name + '('), c);
    c.carrotBoardPath = base + 'carrotBoard.json'; c.roomToServer = {};
    c.stopAllIntervals = () => {};
    c.runHoiPassPremiumAutoAttendance = () => ({ message: 'auto attendance checked', noticeMessage: '' });
    c.getPetHomeTodayText = () => { const d = c.getAttendanceKstDateKey(); return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6); };
    c.getActivePetHomeMutualCount = () => 0; c.getPetSkillHeartBonus = () => 0;
    c.processAdventureLevelUps = () => []; c.formatDateTime = () => 'synthetic';
    c.migrateLightSearchAuthenticationToMember = () => false;
    vm.runInContext('function executeDailyReset(){' + h.block(h.main, 'if (msg === "/리셋" && (sender == "오픈채팅봇"') + '}', c);
    const d = f.read(); d.attend_list = [];
    for (const m of Object.values(d.member)) { m.battle = { ticket: 1, count: 3 }; m.today = 1; }
    d.member.a.exp = 0; d.member.a.boostercnt = 0;
    d.member.a.diamondTycoon = { lastUsedDate: '20261024', usedCount: 10, lastResult: 'fail' };
    d.member.a.chatExperienceDaily = { date: '20261024', experience: 1000, notified: true };
    f.write(d); f.write(d, true);
    for (const root of [base, devBase]) {
        f.disk()[root + c.GLOBAL_CONFIG.guildMarble.fileName] = JSON.stringify({ usage: { day: '20261024', count: 7 }, current: { id: 'keep-game', state: 'PLAYING', rolls: [6, 3] } });
        const social = c.createPetHomeSocialUser(); social.heartUsage = { date: '2026-10-24', count: 16 };
        f.disk()[root + 'petHomeActivityData.json'] = JSON.stringify({ petHomeSocial: { a: social }, alerts: { a: ['keep-alert'] } });
        f.disk()[root + 'attendanceLight.json'] = JSON.stringify({ users: { light: { cnt: 4, recent: '20261024', today: 1 } } });
    }
    f.resetCommand = (msg = '/리셋', sender = '호이 남', dev = false) => {
        const ctx = c.createCommandContext(dev, 'test'), previous = c.enterCommandContext(ctx), oldReplier = c.replier;
        c.beginDataSaveTransaction();
        try {
            c.ctx = ctx; c.msg = msg; c.sender = sender; c.data = c.loadJsonFile(c.filePath);
            c.petData = c.loadJsonFile(c.memberPetPath); c.petSkillData = c.loadJsonFile(c.petSkillDataPath); c.guildData = c.loadJsonFile(c.guildPath);
            c.replier = c.createContextReplier(oldReplier, ctx); c.runMiniGameEntry('recover', { ctx, allowRecoveryReview: true }); c.executeDailyReset();
        } catch (e) { c.rollbackDataSaveTransaction(); throw e; }
        finally { c.endDataSaveTransaction(); c.exitCommandContext(previous); c.replier = oldReplier; }
        f.clock(f.now() + 1);
    };
    f.usage = (dev = false, consume = false) => {
        const root = dev ? devBase : base, d = f.read(dev), cycle = c.getDailyResetCycle(d);
        const marble = JSON.parse(f.disk()[root + c.GLOBAL_CONFIG.guildMarble.fileName]);
        const activity = JSON.parse(f.disk()[root + 'petHomeActivityData.json']);
        const light = JSON.parse(f.disk()[root + 'attendanceLight.json']);
        const result = { cycle, diamond: c.getDiamondTycoonDailyData(d, 'a').usedCount,
            marble: c.getGuildMarbleDailyCount(marble, cycle), heart: c.getPetHomeHeartUsageStatus(d, {}, activity, {}, 'a').used,
            lightAlready: c.recordLightAttendanceOnly(light, 'light', 'test', d).already,
            chat: c.awardDailyChatExperience(d, 'a').total };
        if (consume) {
            d.member.a.diamondTycoon.usedCount = 10; d.member.a.chatExperienceDaily.experience = 1000;
            marble.usage.dailyResetCycle = cycle; marble.usage.count = 7;
            activity.petHomeSocial.a.heartUsage.count = 16;
            f.write(d, dev);
            f.disk()[root + c.GLOBAL_CONFIG.guildMarble.fileName] = JSON.stringify(marble);
            f.disk()[root + 'petHomeActivityData.json'] = JSON.stringify(activity);
            f.disk()[root + 'attendanceLight.json'] = JSON.stringify(light);
        }
        return result;
    };
    return f;
}

let groups = 0;
function test(name, fn) { fn(); console.log('PASS RESET CYCLE ' + (++groups) + ' ' + name); }
function used(f) { assert.deepEqual(f.usage(), { cycle: 0, diamond: 10, marble: 7, heart: 16, lightAlready: true, chat: 0 }); }

function checks() {
    test('legacy counts survive installation, midnight, multiple days and read-only status', () => {
        const f = fixture(); used(f); const before = { ...f.disk() };
        f.clock(Date.parse('2026-10-26T14:59:59Z')); used(f); f.clock(f.now() + 2000); used(f);
        f.clock(f.now() + 5 * 86400000); used(f);
        assert(f.c.buildDailyChatExperienceStatusMessage(f.read(), 'a').includes('획득: 1,000 / 1,000 EXP'));
        assert.deepEqual(f.disk(), before);
    });
    test('actual authorized /리셋 grants all new quotas without touching game/reward/activity originals', () => {
        const f = fixture(); assert(!f.run('/밸런스 1 이유').error); const points = f.read().member.a.point;
        const external = Object.fromEntries(Object.entries(f.disk()).filter(([p]) => /guildMarble|petHomeActivityData|attendanceLight/.test(p)));
        f.resetCommand(); assert.deepEqual(f.usage(), { cycle: 1, diamond: 0, marble: 0, heart: 0, lightAlready: false, chat: 1 });
        for (const p in external) assert.equal(f.disk()[p], external[p], p);
        assert.equal(f.read().member.a.point, points); assert.equal(f.read().member.a.today, 0);
        assert.equal(f.state().dailyReset.cycle, 1);
    });
    test('same-date repeat /리셋 grants exactly one fresh quota per invocation', () => {
        const f = fixture(); f.resetCommand(); f.usage(false, true); assert.equal(f.usage().chat, 0);
        f.resetCommand('/리셋', '오픈채팅봇'); assert.equal(f.usage().cycle, 2);
        assert.equal(f.usage().marble, 0); assert.equal(f.usage().heart, 0); assert.equal(f.usage().diamond, 0);
    });
    test('unauthorized and suffix reset commands cannot change any persisted quota', () => {
        const f = fixture(), before = { ...f.disk() };
        f.resetCommand('/리셋', 'a'); f.resetCommand('/리셋 해봐'); assert.deepEqual(f.disk(), before); used(f);
    });
    test('member/pet/game/archive failures restore the old common cycle and all quotas before retry', () => {
        for (const name of ['member.json', 'member_pet.json', 'miniGameState.json', 'miniGameArchive_2026-10.json']) {
            const f = fixture(); assert(!f.run('/밸런스 1 이유').error);
            const paths = ['member.json', 'member_pet.json', 'miniGameState.json', 'miniGameArchive_2026-10.json'];
            const before = Object.fromEntries(paths.map(p => [p, f.disk()[base + p]]));
            f.fail((_d, p) => p === base + name); assert.throws(() => f.resetCommand()); f.fail(() => false);
            for (const p of paths) assert.equal(f.disk()[base + p], before[p], name + ' rollback ' + p);
            used(f); f.resetCommand(); assert.equal(f.usage().cycle, 1); assert.equal(f.usage().marble, 0);
        }
    });
    test('serialized restart after spending quota preserves all used counts across later midnights', () => {
        const f = fixture(); f.resetCommand(); f.usage(false, true); const files = { ...f.disk() };
        const restarted = fixture(); for (const p of Object.keys(restarted.disk())) delete restarted.disk()[p]; Object.assign(restarted.disk(), files);
        restarted.clock(f.now() + 10 * 86400000);
        assert.deepEqual(restarted.usage(), { cycle: 1, diamond: 10, marble: 7, heart: 16, lightAlready: true, chat: 0 });
    });
    test('DEV reset does not change a single production original and normal reset leaves DEV alone', () => {
        const f = fixture(), prod = Object.fromEntries(Object.entries(f.disk()).filter(([p]) => p.startsWith(base)));
        f.resetCommand('/리셋', '호이 남', true); assert.equal(f.usage(true).cycle, 1); used(f);
        for (const p in prod) assert.equal(f.disk()[p], prod[p]);
        const dev = Object.fromEntries(Object.entries(f.disk()).filter(([p]) => p.startsWith(devBase)));
        f.resetCommand(); for (const p in dev) assert.equal(f.disk()[p], dev[p]);
    });
    test('light attendance migration follows reset cycle even when the calendar date differs', () => {
        const f = fixture(), c = f.c, d = f.read(), light = { users: { a: { cnt: 3, recent: '20260101', today: 1 } } };
        d.member.a.today = 0; c.migrateLightAttendanceToMember(d, light, 'a'); assert.equal(d.member.a.today, 1);
        const stale = { users: { a: { cnt: 1, recent: c.getAttendanceKstDateKey(), today: 1 } } };
        d.dailyResetCycle = 1; d.member.a.today = 0; c.migrateLightAttendanceToMember(d, stale, 'a'); assert.equal(d.member.a.today, 0);
    });
    test('invalid reset metadata and overflow cannot grant free quota or publish a partial reset', () => {
        for (const value of [-1, 0.5, '1', null, 9007199254740991]) {
            const f = fixture(), d = f.read(); d.dailyResetCycle = value; f.write(d); const before = f.disk()[base + 'member.json'];
            assert.throws(() => f.resetCommand(), /일일 리셋 회차/); assert.equal(f.disk()[base + 'member.json'], before);
        }
    });
    console.log('PASS daily reset cycle ' + groups + ' groups');
}
if (require.main === module) checks();
module.exports = { fixture, helperNames };
