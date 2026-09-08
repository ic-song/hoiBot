import { MariaDatabaseClient } from "../../src/database.js";
import { MariaCanonicalMiniPetRepository } from "../../src/mini-pet/canonical-mini-pet-repository.js";
import { requireWbs788IsolatedMariaEnvironment } from "./wbs788-isolated-maria.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

const config = requireWbs788IsolatedMariaEnvironment(process.env);
const boundText = required("WBS788_BOUND");
if (boundText !== "true" && boundText !== "false") throw new Error("WBS788_BOUND_INVALID");
const database = new MariaDatabaseClient({ enabled: true, ...config, connectionLimit: 2, connectTimeoutMs: 5_000 });

try {
  const result = await new MariaCanonicalMiniPetRepository(database).acquire({
    actor: "wbs788-restart-child",
    playerId: required("WBS788_PLAYER_ID"),
    miniPetId: required("WBS788_MINI_PET_ID"),
    requestKey: required("WBS788_REQUEST_KEY"),
    bound: boundText === "true",
  });
  process.stdout.write(JSON.stringify({ pid: process.pid, result }));
} finally {
  await database.close();
}
