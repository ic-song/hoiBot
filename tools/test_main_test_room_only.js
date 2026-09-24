const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const configStart = main.indexOf("    maintenance: {");
const configEnd = main.indexOf("    miniPetCollection: {", configStart);
const responseStart = main.indexOf("function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {");
const lockStart = main.indexOf("    var responseDataLock = ", responseStart);
assert(configStart >= 0 && configEnd > configStart && responseStart >= 0 && lockStart > responseStart);
const guard = main.slice(main.indexOf("{", responseStart) + 1, lockStart);
assert(guard.includes("room !== testRoom"));
const context = { testRoom: "팻 테스트방" };
vm.createContext(context);
vm.runInContext("this.maintenance = ({" + main.slice(configStart, configEnd) + "}).maintenance;", context);
assert.strictEqual(context.maintenance.testRoomOnly, true);
context.GLOBAL_CONFIG = { maintenance: context.maintenance };
vm.runInContext("function acceptsMainRoom(room) {" + guard + "return true; }", context);
assert.strictEqual(context.acceptsMainRoom("팻 테스트방"), true);
assert.strictEqual(context.acceptsMainRoom("서버관리자"), undefined);
assert.strictEqual(context.acceptsMainRoom("일반방"), undefined);
assert(lockStart < main.indexOf("dataTransactionLock.tryLock()", responseStart), "차단 후 잠금·데이터 작업 시작");

console.log("MAIN 테스트방 전용 입구 제한 테스트 통과");
