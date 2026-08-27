import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {isCommentPinCommandCandidate,parseCommentPinCommand} from "../src/home/comment-pin-command.js";
import {CommentPinService,type CommentPinRepository} from "../src/home/comment-pin-service.js";

const target=(id:string,pinned=false)=>({commentId:id,authorName:"작성자",body:`${id} 본문`,createdAt:new Date(0),pinned});
const snapshot=(overrides={})=>({homeVersion:2n,homeOwnerName:"집주인",hasPet:true,hasActivePass:true,activePinCount:0,comments:[target("C3"),target("C2"),target("C1")],...overrides});

describe("comment pin command",()=>{
  it("accepts only exact guide and full positive integers",()=>{
    for(const message of ["/댓글핀","/댓글핀 1","/댓글핀 999"]) assert.equal(isCommentPinCommandCandidate(message),true);
    for(const message of ["/댓글핀 안내","/댓글핀 0","/댓글핀 -1","/댓글핀 1.5","/댓글핀 1 안내","/댓글핀삭제 1"]) assert.equal(isCommentPinCommandCandidate(message),false,message);
  });
  it("returns the legacy guide without repository access",async()=>{
    const result=await new CommentPinService({} as CommentPinRepository).execute({command:{kind:"GUIDE"},requestKey:"guide",playerId:"1"});
    assert.equal(result.message,"사용법: /댓글핀 [댓글번호]\n예시: /댓글핀 3");
  });
  it("maps newest-first number to a stable comment ID",async()=>{
    let selected="";
    const repository:CommentPinRepository={findReplay:async()=>undefined,readSnapshot:async()=>snapshot(),add:async request=>{selected=request.target.commentId;return{replayed:false,pinId:"P1",commentId:selected,displayOrder:1,message:"ok"};}};
    const command=parseCommentPinCommand("/댓글핀 2");assert.ok(command);
    await new CommentPinService(repository).execute({command,requestKey:"event",playerId:"1"});
    assert.equal(selected,"C2");
  });
  it("rejects missing home, pass, pet, range, duplicate and full pins before mutation",async()=>{
    const states=[undefined,snapshot({hasActivePass:false}),snapshot({hasPet:false}),snapshot({comments:[]}),snapshot({comments:[target("C1",true)]}),snapshot({activePinCount:3})];
    for(let index=0;index<states.length;index+=1){
      const repository:CommentPinRepository={findReplay:async()=>undefined,readSnapshot:async()=>states[index],add:async()=>{throw new Error("must not mutate");}};
      await assert.rejects(()=>new CommentPinService(repository).execute({command:{kind:"PIN",listNumber:1},requestKey:`e${index}`,playerId:"1"}));
    }
  });
  it("replays before reading a changed comment list",async()=>{
    const repository:CommentPinRepository={findReplay:async()=>({replayed:true,pinId:"P9",commentId:"C9",displayOrder:2,message:"saved"}),readSnapshot:async()=>{throw new Error("must not read");},add:async()=>{throw new Error("must not mutate");}};
    const result=await new CommentPinService(repository).execute({command:{kind:"PIN",listNumber:999},requestKey:"event",playerId:"1"});
    assert.equal(result.replayed,true);assert.equal(result.pinId,"P9");
  });
});
