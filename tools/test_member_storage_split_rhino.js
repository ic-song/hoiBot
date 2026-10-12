const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const child = require("child_process");
const jar = process.argv[2];
assert(jar && fs.existsSync(jar), "Usage: node tools/test_member_storage_split_rhino.js <Rhino jar>");
const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
function block(marker) {
    const start = source.indexOf(marker); assert(start >= 0, marker); let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw Error(marker);
}
// Rhino 자체의 비열거 속성·배열·JSON·Java UTF-8 동작을 실제 분리 헬퍼로 검증한다.
const names = ["getMemberSplitMarker", "getMemberSplitStorePath", "getMemberSplitBackupPath", "requireMemberSplitStore",
    "buildMemberSplitRaidSummary", "attachMemberSplitStores", "prepareMemberSplitResidualLogRecovery", "buildMemberSplitSavePlan", "getMemberSplitByteLength",
    "createMemberSplitMigrationStores", "verifyMemberSplitMigrationSource", "completeMemberSplitMigration", "createServerRaidState",
    "appendPetMusouAutomationLog", "appendGuildTerritoryAutomationDataLog", "appendTerritoryPassAuditLog", "appendTerritoryPassPayoutLogs"];
const testSource = block("const MEMBER_STORAGE_SPLIT_CONFIG = {") + "\n" + names.map(n => block("function " + n + "(")).join("\n") + `
function resolveActiveDataPath(path) { return path; }
var assertions = 0;
function check(value, label) { if (!value) throw new Error(label); assertions++; }
var original = {member:{synthetic:{point:1000000000,bag:{item:7}}},serverRaid:createServerRaidState("old")};
original.serverRaid.history.push({id:"past",accounts:{synthetic:{attacks:[{R:100,D:170,P:3}]}}});
for (var i=0;i<MEMBER_STORAGE_SPLIT_CONFIG.logKeys.length;i++) original[MEMBER_STORAGE_SPLIT_CONFIG.logKeys[i]]=[{user:"synthetic",result:"OK"}];
var copying = JSON.parse(JSON.stringify(original));
copying.migrations = {};
copying.migrations[MEMBER_STORAGE_SPLIT_CONFIG.key]={version:1,id:"synthetic-id",phase:"COPYING"};
verifyMemberSplitMigrationSource(copying,original);
var stores = createMemberSplitMigrationStores(copying, getMemberSplitMarker(copying));
var complete = completeMemberSplitMigration(copying,stores,"2026-10-12");
check(complete.serverRaid.storageSummary === true, "thin raid");
check(!complete.serverRaid.history, "no history in member");
check(JSON.stringify(complete.member) === JSON.stringify(original.member), "member preserved");
var thinText = JSON.stringify(complete);
attachMemberSplitStores(complete,getMemberSplitMarker(complete),stores.logs,stores.raid);
check(complete.petMusouAutomationLogs instanceof Array,"native Rhino Array");
check(Object.keys(complete).indexOf("petMusouAutomationLogs") === -1,"nonenumerable logs");
check(JSON.stringify(complete).indexOf("petMusouAutomationLogs") === -1,"JSON excludes logs");
check(JSON.stringify(complete).indexOf("__memberSplitContext") === -1,"JSON excludes context");
var unchanged = buildMemberSplitSavePlan(complete);
check(unchanged.writes.length === 0,"unchanged no slot writes");
check(JSON.stringify(unchanged.member) === thinText,"round trip summary");
complete.petMusouAutomationLogs.push({user:"synthetic",result:"ON"});
complete.serverRaid.sequence++;
var changed = buildMemberSplitSavePlan(complete);
check(changed.writes.length === 2,"two changed stores");
check(changed.marker.raidRevision === 1 && changed.marker.logsRevision === 1,"new revisions");
check(getMemberSplitMarker(complete).raidRevision === 0,"unpublished source retained");
check(changed.member.serverRaid.storageSummary === true,"only summary published");
check(changed.writes[0].path.indexOf("_next.json") !== -1,"alternating slots");
check(getMemberSplitByteLength({text:"한글✨"}) === new java.lang.String(JSON.stringify({text:"한글✨"})).getBytes("UTF-8").length,"Java UTF-8 bytes");
var cx=Packages.org.mozilla.javascript.Context.getCurrentContext();
var foreignScope=cx.initStandardObjects();
var foreignLogs=cx.evaluateString(foreignScope,'({supportPassPayoutLogs:[{existing:true}],guildTerritoryAutomationLogs:[{existing:true}],territoryPassAuditLogs:[{existing:true}],petMusouAutomationLogs:[{existing:true}]})','foreign-log-scope',1,null);
check(!(foreignLogs.petMusouAutomationLogs instanceof Array),"distinct Rhino array prototype reproduced");
check(Array.isArray(foreignLogs.petMusouAutomationLogs),"cross-scope native array");
var foreignStore={version:1,id:"synthetic-id",revision:0,data:foreignLogs};
requireMemberSplitStore(foreignStore,"logs");
var scoped=JSON.parse(thinText);
attachMemberSplitStores(scoped,getMemberSplitMarker(scoped),foreignStore,null);
var GLOBAL_CONFIG={petMusou:{automationLogMax:100},guildTerritory:{automation:{logMax:100}},supportPass:{territoryAuditLogMax:100,territoryPayoutLogMax:500}};
function formatDateTime(date){return "2026-10-12 12:30";}
function getTodaySupportPassDateValue(){return "2026-10-12";}
appendPetMusouAutomationLog(scoped,{added:true});
appendGuildTerritoryAutomationDataLog(scoped,{added:true});
appendTerritoryPassAuditLog(scoped,"master","synthetic","ADD",null,{permanent:true});
appendTerritoryPassPayoutLogs(scoped,{grantedUsers:["synthetic"],skippedUsers:[]},"master");
for(var k=0;k<MEMBER_STORAGE_SPLIT_CONFIG.logKeys.length;k++){
 var rows=scoped[MEMBER_STORAGE_SPLIT_CONFIG.logKeys[k]];
 check(rows.length===2 && rows[0].existing===true,"preserved foreign log "+k);
}
var scopedPlan=buildMemberSplitSavePlan(scoped);
check(scopedPlan.writes.length===1,"foreign log save plan");
requireMemberSplitStore(JSON.parse(scopedPlan.writes[0].text),"logs");
var residualMember=JSON.parse(thinText);
residualMember.petMusouAutomationLogs=[];
for(var residualIndex=0;residualIndex<9;residualIndex++) residualMember.petMusouAutomationLogs.push({index:residualIndex});
var recovery=prepareMemberSplitResidualLogRecovery(residualMember,foreignStore);
check(recovery.fields===1,"residual fields");
check(recovery.count===9,"residual count");
check(recovery.logs.petMusouAutomationLogs.length===11,"existing two plus all nine preserved");
check(foreignStore.data.petMusouAutomationLogs.length===2,"external input unchanged");
check(!Object.prototype.hasOwnProperty.call(recovery.member,"petMusouAutomationLogs"),"thin member prepared");
attachMemberSplitStores(recovery.member,getMemberSplitMarker(recovery.member),foreignStore,null);
for(var recoveryKey=0;recoveryKey<MEMBER_STORAGE_SPLIT_CONFIG.logKeys.length;recoveryKey++){
 var field=MEMBER_STORAGE_SPLIT_CONFIG.logKeys[recoveryKey];recovery.member[field]=recovery.logs[field];
}
check(buildMemberSplitSavePlan(recovery.member).writes.length===1,"only external logs change");
residualMember.petMusouAutomationLogs={length:9};
var corruptRejected=false;
try{prepareMemberSplitResidualLogRecovery(residualMember,foreignStore);}catch(corruptError){corruptRejected=String(corruptError).indexOf("petMusouAutomationLogs")!==-1;}
check(corruptRejected,"corrupt residue never normalized");
print("PASS: " + assertions + " Rhino member storage assertions");
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hoibot-split-rhino-"));
const file = path.join(dir, "member-split-test.js");
try {
    fs.writeFileSync(file, testSource, "utf8");
    const result = child.spawnSync("java", ["-cp", path.resolve(jar), "org.mozilla.javascript.tools.shell.Main", "-opt", "-1", "-version", "200", "-f", file], { encoding: "utf8" });
    process.stdout.write(result.stdout || ""); process.stderr.write(result.stderr || "");
    assert.equal(result.status, 0, result.error?.message || "Rhino assertions failed");
} finally { fs.rmSync(file, { force: true }); fs.rmdirSync(dir); }
