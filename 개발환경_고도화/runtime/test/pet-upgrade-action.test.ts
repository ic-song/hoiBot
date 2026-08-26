import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {isPetUpgradeActionCommand,parsePetUpgradeCount,resolvePetUpgradeAttempt,resolvePetUpgradePolicy} from "../src/pet/pet-upgrade-action-service.js";

const policies=[
 {policy_code:"low",min_level:0n,max_level:99n,point_cost:"20000000.000",base_rate:"0.55",decrement_rate:"0.005"},
 {policy_code:"mid",min_level:100n,max_level:199n,point_cost:"50000000.000",base_rate:"0.05",decrement_rate:"0"},
 {policy_code:"high",min_level:200n,max_level:null,point_cost:"100000000.000",base_rate:"0.05",decrement_rate:"0"}
];

describe("pet upgrade action",()=>{
 it("accepts only exact and one unsigned decimal argument",()=>{for(const value of ["/펫강화","/펫강화 0","/펫강화   003","/펫강화 101"])assert.equal(isPetUpgradeActionCommand(value),true);for(const value of ["/펫강화 ","/펫강화 -1","/펫강화 1.5","/펫강화 1 해봐"])assert.equal(isPetUpgradeActionCommand(value),false);});
 it("keeps zero usage and caps attempts above one hundred",()=>{assert.deepEqual(parsePetUpgradeCount("/펫강화"),{count:1,capped:false});assert.deepEqual(parsePetUpgradeCount("/펫강화 0"),{count:0,capped:false});assert.deepEqual(parsePetUpgradeCount("/펫강화 101"),{count:100,capped:true});});
 it("preserves point and probability boundaries",()=>{assert.deepEqual(resolvePetUpgradePolicy(0n,policies),{pointCost:20000000n,baseRate:0.55});assert.deepEqual(resolvePetUpgradePolicy(99n,policies),{pointCost:20000000n,baseRate:0.05500000000000005});assert.deepEqual(resolvePetUpgradePolicy(100n,policies),{pointCost:50000000n,baseRate:0.05});assert.deepEqual(resolvePetUpgradePolicy(200n,policies),{pointCost:100000000n,baseRate:0.05});});
 it("applies the highest boost and smith bonus before the success boundary",()=>{const result=resolvePetUpgradeAttempt({level:5n,baseRate:0.55,smith:true,artisan:false,boostRate:0.4,random:()=>0.999});assert.equal(result.effectiveRate,1);assert.equal(result.success,true);assert.equal(result.level,6n);assert.equal(result.artisanRoll,null);});
 it("uses an artisan roll only after failure and preserves the stone below seven percent",()=>{const values=[0.9,0.069];const result=resolvePetUpgradeAttempt({level:5n,baseRate:0.55,smith:false,artisan:true,boostRate:0,random:()=>values.shift()!});assert.equal(result.success,false);assert.equal(result.level,5n);assert.equal(result.stonePreserved,true);assert.equal(result.artisanRoll,0.069);});
});
