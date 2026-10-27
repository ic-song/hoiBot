const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const script = fs.readFileSync(path.join(__dirname, 'test_member_storage_split.js'), 'utf8');
const h = new Function('require', '__dirname', script.slice(0, script.indexOf('\ngroup("')) + '\nreturn {c,fixture,main,block,root,devRoot,load,save,raw,native,setup,migrate,store};')(require, __dirname);
for (const name of ['buildMemberSplitPublicationRecovery', 'recoverMemberSplitPublication']) vm.runInContext(h.block(h.main, 'function '+name+'('), h.c);
const clone = v => JSON.parse(JSON.stringify(v));
const key = h.c.MEMBER_STORAGE_SPLIT_CONFIG.key;
let groups = 0;
function setup(dev = false) {
    h.setup();
    const data = h.raw(dev);
    data.serverRaid.history = [{ id:'past', state:'DONE', accounts:{synthetic:{paid:true,rankReward:123}} }];
    data.serverRaid.outbox = [{ generation:data.serverRaid.generation, text:'synthetic past result', deliveries:[{room:'room8',sent:false}] }];
    h.fixture.write(data,dev); h.migrate(dev);
    const data1 = h.load('raid',dev); data1.serverRaid.outbox[0].text += ' confirmed'; h.save(data1,dev);
    const root = dev ? h.devRoot : h.root;
    h.fixture.disk()[root+'member_back.json'] = h.fixture.disk()[root+'member.json'];
    h.fixture.disk()[root+'serverRaidData_back.json'] = JSON.stringify(h.store('raid',dev));
    const thin = h.raw(dev); thin.migrations[key].raidRevision = 2; h.fixture.write(thin,dev);
    return root;
}
function recover(dev = false) {
    const previous = h.c.enterCommandContext(h.c.createCommandContext(dev,dev?'test':'room8'));
    try { return h.c.recoverMemberSplitPublication(); } finally { h.c.exitCommandContext(previous); }
}
function group(name,fn) { fn(); console.log('PASS '+(++groups)+': '+name); }
group('Synthetic missing publication repaired without changing accounts, receipts, history or rewards',()=>{
    setup(); const before=h.raw();
    const prior=JSON.parse(h.fixture.disk()[h.root+'serverRaidData_next.json']);
    assert.throws(()=>h.load('raid'),/버전이 일치하지 않습니다/);
    assert.equal(recover(),true); const after=h.load('raid');
    assert.deepStrictEqual(clone(after.member),before.member);
    for (const key of ['history','eventReceipts','wins','current']) assert.deepStrictEqual(clone(after.serverRaid[key]),prior.data[key]);
    assert.equal(after.serverRaid.outbox[0].deliveries[0].cancelled,true);
    assert.equal(h.raw().migrations[key].raidRevision,2);
    assert.equal(h.c.serverRaidHasWork(after.serverRaid),false);
    assert(Object.keys(h.fixture.disk()).some(p=>p.includes('publication_recovery_')));
    const stable=clone(h.fixture.disk()); assert.equal(recover(),false); assert.deepStrictEqual(clone(h.fixture.disk()),stable);
    h.save(h.load()); h.save(h.load('raid'));
});
group('Different point balance refuses recovery and preserves every file',()=>{
    setup(); const thin=h.raw(); thin.member.a.point++; h.fixture.write(thin); const before=clone(h.fixture.disk());
    assert.throws(()=>recover(),/기록 차이/); assert.deepStrictEqual(clone(h.fixture.disk()),before);
});
group('Unpaid round refuses recovery rather than paying rewards',()=>{
    setup(); const p=h.root+'serverRaidData_next.json', r=JSON.parse(h.fixture.disk()[p]); r.data.history[0].accounts.synthetic.paid=false;
    h.fixture.disk()[p]=JSON.stringify(r); const before=clone(h.fixture.disk());
    assert.throws(()=>recover(),/미지급/); assert.deepStrictEqual(clone(h.fixture.disk()),before);
});
group('Active round refuses recovery',()=>{
    setup(); const p=h.root+'serverRaidData_next.json', r=JSON.parse(h.fixture.disk()[p]);
    r.data.current={id:'active',state:'ACTIVE',prepareUntil:1,autoEndAt:2}; h.fixture.disk()[p]=JSON.stringify(r);
    assert.throws(()=>recover());
});
group('Missing and malformed slots are not normalized to defaults',()=>{
    for (const value of [null,'{bad']) {setup();const p=h.root+'serverRaidData.json';if(value===null)delete h.fixture.disk()[p];else h.fixture.disk()[p]=value;assert.throws(()=>recover());}
});
group('Different storage id and revision gap are refused',()=>{
    setup();let thin=h.raw();thin.migrations[key].id='foreign';h.fixture.write(thin);assert.throws(()=>recover());
    setup();thin=h.raw();thin.migrations[key].raidRevision=4;h.fixture.write(thin);assert.throws(()=>recover());
});
group('Recovery member write failure restores original member and target slot',()=>{
    setup();const before=clone(h.fixture.disk());h.fixture.fail((_d,p)=>p===h.root+'member.json');assert.throws(()=>recover());
    for(const p of Object.keys(before))assert.equal(h.fixture.disk()[p],before[p]);assert.throws(()=>h.load('raid'));
    h.fixture.fail(()=>false);assert.equal(recover(),true);
});
group('Archive write failure changes no existing files',()=>{
    setup();const before=clone(h.fixture.disk());h.fixture.fail((_d,p)=>p.includes('publication_recovery_'));assert.throws(()=>recover());
    for(const p of Object.keys(before))assert.equal(h.fixture.disk()[p],before[p]);
});
group('Restart after publishing raid alone is consistent and does not resend old notices',()=>{
    setup(); const member=h.raw(),backup=JSON.parse(h.fixture.disk()[h.root+'member_back.json']);
    const plan=h.c.buildMemberSplitPublicationRecovery(h.native(member),h.native(backup),h.native(JSON.parse(h.fixture.disk()[h.root+'serverRaidData_next.json'])),h.native(JSON.parse(h.fixture.disk()[h.root+'memberOperationLogs.json'])));
    h.fixture.disk()[h.root+'serverRaidData.json']=JSON.stringify(plan.raid);
    assert.equal(recover(),false);assert.equal(h.c.serverRaidHasWork(h.load('raid').serverRaid),false);
    h.save(h.load('raid'));assert.equal(h.raw().serverRaid.hasPendingNotices,false);
});
group('DEV recovery leaves every PROD file intact',()=>{
    setup(true);const before=clone(h.fixture.disk());assert.equal(recover(true),true);
    for(const p of Object.keys(before))if(p.startsWith(h.root))assert.equal(h.fixture.disk()[p],before[p]);
});
group('Post-publication cleanup and transport failure cannot orphan member revision',()=>{
    h.setup();h.migrate();const data=h.load('raid');data.serverRaid.sequence++;
    const oldDelete=h.c.java.io.File.prototype.delete,oldLog=h.c.debuggerLog;
    h.c.java.io.File.prototype.delete=function(){if(this.path===h.root+'member.json.rollback')return false;return oldDelete.call(this);};
    h.c.debuggerLog=()=>{throw Error('no session');};
    try {assert.doesNotThrow(()=>h.save(data));assert.equal(h.load('raid').serverRaid.sequence,data.serverRaid.sequence);}
    finally {h.c.java.io.File.prototype.delete=oldDelete;h.c.debuggerLog=oldLog;}
});
group('Logging failure does not skip transaction rollback after publication failure',()=>{
    h.setup();h.migrate();const before=h.raw(),data=h.load('raid');data.serverRaid.sequence++;
    const oldLog=h.c.debuggerLog;h.c.debuggerLog=()=>{throw Error('no session');};h.fixture.fail((_d,p)=>p===h.root+'member.json');
    try {assert.throws(()=>h.save(data));assert.deepStrictEqual(h.raw(),before);assert.deepStrictEqual(clone(h.load('raid').serverRaid),h.store('raid').data);}
    finally {h.c.debuggerLog=oldLog;}
});
console.log('PASS: '+groups+' member publication recovery groups (synthetic data only)');
