import assert from "node:assert/strict";
import { describe,it } from "node:test";
import type { DatabaseTransactionCapabilities, ReadOnlySnapshotTransaction } from "../src/database.js";
import { CANONICAL_OBJECT_SHADOW_DOMAINS, CanonicalObjectShadowReadProvider } from "../src/catalog/canonical-object-shadow-read-provider.js";

class ReadOnlyDatabase implements Pick<DatabaseTransactionCapabilities,"withReadOnlySnapshot"> {
  snapshots=0; queries:Array<{sql:string;values:readonly unknown[]}>=[];
  constructor(private readonly reverse=false) {}
  async withReadOnlySnapshot<T>(work:(transaction:ReadOnlySnapshotTransaction)=>Promise<T>):Promise<T>{
    this.snapshots+=1;
    const transaction:ReadOnlySnapshotTransaction={
      query:async <R>(sql:string,values:readonly unknown[]=[])=>{this.queries.push({sql,values});return this.rows(sql) as R;},
    };
    assert.equal("execute" in transaction,false);
    return work(transaction);
  }
  private rows(sql:string):Record<string,unknown>[] {
    if(sql.includes("canonical_owned_item_stacks")){
      const rows=[
        {owned_item_stack_id:"bbbbbbb2",item_id:"itemaaaa",quantity:9007199254740993n},
        {owned_item_stack_id:"aaaaaaa1",item_id:"itemaaaa",quantity:2n},
      ]; return this.reverse?[...rows].reverse():rows;
    }
    if(sql.includes("FROM canonical_item_definitions")) return [{item_id:"itemaaaa",item_name:"상자",item_description:null,item_kind:"box",item_grade:null,price_amount:"12.500",price_currency_source_identifier:null,stackable_flag:1,active_flag:true,definition_options:'{"z":2,"a":{"n":9007199254740993}}'}];
    if(sql.includes("canonical_owned_item_instances")) return [{owned_item_id:"ccccccc3",item_id:"itemaaaa",ownership_status:"owned",instance_options:{z:2,a:1n}}];
    return [];
  }
}

describe("canonical object shadow read provider",()=>{
  it("returns every canonical domain from one read transaction with stable normalized ordering and fingerprint",async()=>{
    const firstDb=new ReadOnlyDatabase(false),secondDb=new ReadOnlyDatabase(true);
    const first=await new CanonicalObjectShadowReadProvider(firstDb).readPlayerSnapshot("playeraa");
    const second=await new CanonicalObjectShadowReadProvider(secondDb).readPlayerSnapshot("playeraa");
    assert.deepEqual(Object.keys(first.domains),[...CANONICAL_OBJECT_SHADOW_DOMAINS]);
    assert.equal(firstDb.snapshots,1);
    assert.ok(firstDb.queries.length>=CANONICAL_OBJECT_SHADOW_DOMAINS.length);
    assert.ok(firstDb.queries.every(({sql})=>/^SELECT /.test(sql)&&!/[;]|\b(?:INSERT|UPDATE|DELETE|REPLACE|CALL)\b/i.test(sql)));
    for (const {values} of firstDb.queries.filter(({values})=>values.length>0)) assert.deepEqual(values,["playeraa"]);
    assert.deepEqual(first.domains.items.owned.map(({recordId})=>recordId),["ccccccc3","aaaaaaa1","bbbbbbb2"]);
    const large=first.domains.items.owned.find(({recordId})=>recordId==="bbbbbbb2")!;
    assert.equal(large.attributes.quantity,"9007199254740993");
    const options=first.domains.items.owned.find(({recordId})=>recordId==="ccccccc3")!.attributes.instance_options;
    assert.deepEqual(options,{a:"1",z:"2"});
    assert.deepEqual(first.domains.items.catalog[0]!.attributes.definition_options,{a:{n:"9007199254740993"},z:"2"});
    assert.equal(first.domains.items.catalog[0]!.attributes.stackable_flag,true);
    assert.deepEqual(first,second);
    assert.match(first.payloadFingerprint,/^[0-9a-f]{64}$/);
  });

  it("fails closed for invalid player and canonical identifiers",async()=>{
    const database=new ReadOnlyDatabase();
    await assert.rejects(()=>new CanonicalObjectShadowReadProvider(database).readPlayerSnapshot("1 OR 1=1"),/IDENTIFIER_INVALID/);
    assert.equal(database.snapshots,0);
    class InvalidRowDatabase extends ReadOnlyDatabase { override async withReadOnlySnapshot<T>(work:(transaction:ReadOnlySnapshotTransaction)=>Promise<T>):Promise<T>{return work({query:async<R>()=>[{owned_item_stack_id:"bad",item_id:"itemaaaa",quantity:1n}] as R});} }
    await assert.rejects(()=>new CanonicalObjectShadowReadProvider(new InvalidRowDatabase()).readPlayerSnapshot("playeraa"),/IDENTIFIER_INVALID/);
  });

  it("fails closed before reading when the read-only snapshot capability is absent",()=>{
    const unsupported={} as Pick<DatabaseTransactionCapabilities,"withReadOnlySnapshot">;
    assert.throws(()=>new CanonicalObjectShadowReadProvider(unsupported),/CANONICAL_SHADOW_READ_ONLY_CAPABILITY_REQUIRED/);
  });
});
