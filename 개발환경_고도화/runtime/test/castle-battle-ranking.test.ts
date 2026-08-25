import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CastleBattleRankingRepository } from "../src/castle/castle-battle-ranking-repository.js";
import { CastleBattleRankingService, isCastleBattleRankingCommand } from "../src/castle/castle-battle-ranking-service.js";

describe("castle battle ranking", () => {
  it("accepts only the exact command and preserves deterministic legacy ranking output", async () => {
    assert.equal(isCastleBattleRankingCommand("/캐슬대전순위"), true);
    assert.equal(isCastleBattleRankingCommand("/캐슬대전순위 1"), false);
    const repository: CastleBattleRankingRepository = {
      read: async (_command, render) => ({
        status: "completed", seasonKey: "S1", snapshotVersion: "7", outboxId: "1",
        data: render({ seasonKey: "S1", sourceVersion: "fixture", snapshotVersion: "7", entries: [
          { rank: 1, displayName: "첫째", tier: "황제", score: 300n },
          { rank: 2, displayName: "둘째", tier: "왕", score: 200n },
          { rank: 3, displayName: "셋째", tier: "기사", score: 100n },
          { rank: 4, displayName: "넷째", tier: "병사", score: 10n }
        ] })
      })
    };
    const result = await new CastleBattleRankingService(repository).handle({
      externalUserId: "user", channelId: "room", eventId: "event", message: "/캐슬대전순위"
    });
    assert.match(result.data, /🥇 첫째 \| 황제 \| 300pt/);
    assert.match(result.data, /\[4\] 넷째 \| 병사 \| 10pt/);
    assert.ok(result.data.includes("​".repeat(500)));
  });
});
