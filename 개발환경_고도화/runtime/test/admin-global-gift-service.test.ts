import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe,it } from "node:test";
import { ADMIN_GLOBAL_GIFT_COMMAND,ADMIN_GLOBAL_GIFT_ITEM_NAME,ADMIN_GLOBAL_GIFT_MESSAGE,ADMIN_GLOBAL_GIFT_SOURCE_OBJECT_KEY,isAdminGlobalGiftCommand,normalizeAdminGlobalGiftDispatchMessage } from "../src/admin/admin-global-gift-service.js";

const migration=readFileSync(new URL("../migrations/479_admin_global_gift_object_db.sql",import.meta.url),"utf8");
const rollback=readFileSync(new URL("../migrations/rollback/479_admin_global_gift_object_db.rollback.sql",import.meta.url),"utf8");
const app=readFileSync(new URL("../src/app.ts",import.meta.url),"utf8");
const service=readFileSync(new URL("../src/admin/admin-global-gift-service.ts",import.meta.url),"utf8");
const legacy=readFileSync(new URL("../../../main.js",import.meta.url),"utf8");

describe("admin global gift canonical reintegration",()=>{
  it("accepts only the exact legacy command",()=>{
    assert.equal(ADMIN_GLOBAL_GIFT_COMMAND,"/선물전달");
    assert.equal(isAdminGlobalGiftCommand("/선물전달"),true);
    for(const value of ["/선물전달 "," /선물전달","/선물전달 1","/선물전달\n"])assert.equal(isAdminGlobalGiftCommand(value),false);
    assert.equal(normalizeAdminGlobalGiftDispatchMessage("/선물전달"),"/선물전달");
  });
  it("freezes exact item source and announcement payload from legacy",()=>{
    assert.equal(ADMIN_GLOBAL_GIFT_ITEM_NAME,"호이응원패키지(무료)🐹[2]");
    assert.equal(ADMIN_GLOBAL_GIFT_SOURCE_OBJECT_KEY,"item.direct_bag.8349df1a3be0b247");
    assert.match(legacy,/if \(msg === "\/선물전달" && sender == "호이 남"\)/);
    assert.equal(ADMIN_GLOBAL_GIFT_MESSAGE,"호이응원패키지(무료)🐹[2] 1개가 지급되었습니다.\n가방에 3개 소지시 잠수계정으로 인지하여 계정이 삭제 될수 있으니 오픈하여주세요!\n\n 사용 방법:\n1. /패키지가방\n/패키지사용 [가방번호] [오픈갯수]");
    for(const room of ["room1","room2","room3","room5","room6","room7","room10","room11","room12","room13","room90"])assert.match(legacy,new RegExp(`Api\\.replyRoom\\(${room}, message\\)`));
  });
  it("uses canonical CUID ownership, snapshot receipts and no operational room seed",()=>{
    assert.match(migration,/canonical_owned_item_stacks/);
    assert.match(migration,/quantity_after=quantity_before\+1/);
    assert.match(migration,/channel_count=11/);
    assert.match(migration,/game\.inventory\.global_gift/);
    assert.doesNotMatch(migration,/INSERT INTO canonical_admin_global_gift_channel_configs/);
    assert.doesNotMatch(service,/ITEM-FREE-HOI-SUPPORT-02/);
    assert.match(service,/sourceChannelId:input\.channelId/);
    assert.match(service,/ADMIN_GLOBAL_GIFT_MEMBER_IMPORT_INCOMPLETE/);
    assert.match(service,/readVerifiedTerminal\(this\.database,requestKey,false\)/);
    assert.match(migration,/SELECT 'j7uyw6vc'.*호이응원패키지/s);
    assert.match(migration,/SELECT 'phk8c656','j7uyw6vc','LEGACY_JS'/);
    assert.doesNotMatch(migration,/ON DUPLICATE KEY UPDATE item_id/);
    assert.doesNotMatch(migration,/outbox_message_id/);
    assert.match(migration,/FOREIGN KEY \(operation_key\) REFERENCES operations\(operation_key\)/);
    assert.match(rollback,/ADMIN_GLOBAL_GIFT_RECEIPT_EXISTS/);
    assert.match(app,/dispatchAdminGlobalGiftCommand\(\{database:database!,isOperationalChannel/);
    assert.match(app,/partialDispatchCandidate[\s\S]*\|\| isAdminGlobalGiftCommand\(normalizedEvent\.message\)/);
  });
});
