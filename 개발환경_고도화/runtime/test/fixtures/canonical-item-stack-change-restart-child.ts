import { MariaDatabaseClient } from "../../src/database.js";
import { CanonicalItemInventoryRepository } from "../../src/inventory/canonical-item-inventory-repository.js";
import { requireWbs790IsolatedMariaEnvironment } from "./wbs790-isolated-maria.js";

const config=requireWbs790IsolatedMariaEnvironment(process.env);
const database=new MariaDatabaseClient({enabled:true,...config,connectionLimit:2,connectTimeoutMs:5_000});
try{
  const result=await new CanonicalItemInventoryRepository(database).changeStackQuantity({actor:"wbs790-child",playerId:process.env.WBS790_PLAYER_ID!,itemId:process.env.WBS790_ITEM_ID!,requestKey:process.env.WBS790_REQUEST_KEY!,quantityDelta:BigInt(process.env.WBS790_DELTA!),reasonType:process.env.WBS790_REASON!});
  process.stdout.write(JSON.stringify({pid:process.pid,result:{quantity:result.quantity.toString(),replayed:result.replayed}}));
}finally{await database.close();}
