import { hasDatabaseTransactionCapabilities, type DatabaseClient } from "../database.js";
import { MariaCanonicalPetSkillReadProvider, type CanonicalPetSkillReadDefinition } from "./canonical-pet-skill-read-provider.js";

const ALL_SEE = "\u200b".repeat(500);
const GRADE_ORDER = ["SS", "S", "A", "B", "C", "D"] as const;

export function isPetSkillProbabilityCommand(message: string | undefined): boolean {
  return message === "/펫스킬확률";
}

function normalizeLegacyPetSkillName(name: string): string {
  const stripped = name.replace(/^\[펫스킬북\]/, "").replace(/📙/g, "").replace(/✨/g, "").trim();
  const aliases: Readonly<Record<string, string>> = {
    "하느님위에갓물주": "하느님 위에 갓물주", "야수의본능": "야수의 본능", "종의본능": "종의 본능",
    "펫스킬학개론": "펫스킬 학개론", "호이행복재단회원권": "호이행복재단 회원권", "로열하우스": "로열 하우스",
    "길드의심장": "길드의 심장", "전투형지휘관": "전투형 지휘관", "기사단증원": "기사단 증원",
    "타고난장사꾼": "타고난 장사꾼", "티어상승론": "티어 상승론", "망한건맞아": "망한건 맞아",
    "광산 탐험가": "광산탐험가", "던전 탐험가": "던전탐험가"
  };
  return aliases[stripped] ?? stripped;
}

export function formatLegacyPetSkillProbability(definitions: readonly CanonicalPetSkillReadDefinition[]): string {
  let reply = `📙 펫스킬북 확률표 📙\n\n${ALL_SEE}\n`;
  let total = 0;
  for (const grade of GRADE_ORDER) {
    reply += `━━━${grade} 등급━━━\n`;
    for (const definition of definitions) {
      if (definition.grade !== grade) continue;
      total += definition.actualRate;
      reply += `${normalizeLegacyPetSkillName(definition.name)}📙 (확률: ${definition.actualRate.toFixed(1)}%)\n`;
    }
    reply += "\n";
  }
  reply += `━━━━━━━━━━━━━━━\n총 확률: ${total.toFixed(1)}%`;
  return reply.trim();
}

export class PetSkillProbabilityService {
  public constructor(private readonly database: DatabaseClient) {}

  public async read(input: { externalUserId: string; displayName: string | undefined }): Promise<{ reply: string } | null> {
    if (input.displayName === undefined || (input.displayName.length > 4 && input.displayName !== "오픈채팅봇")) return null;
    if (!hasDatabaseTransactionCapabilities(this.database)) {
      throw new Error("PET_SKILL_PROBABILITY_SNAPSHOT_CAPABILITY_REQUIRED");
    }
    const provider = new MariaCanonicalPetSkillReadProvider(this.database);
    return this.database.withReadOnlySnapshot(async (transaction) => {
      const actors = await transaction.query<Array<{ player_status: string }>>(
        `SELECT player.status player_status
           FROM external_identities identity
           JOIN players player ON player.id=identity.player_id AND player.deleted_at IS NULL
          WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
          ORDER BY identity.id LIMIT 2`,
        [input.externalUserId]
      );
      if (actors.length > 1) throw new Error("PET_SKILL_PROBABILITY_IDENTITY_DUPLICATE");
      if (actors.length === 0) return null;
      if (actors[0]!.player_status === "suspended") {
        return { reply: "계정정지 상태입니다 호월고객센터로 문의해주세요" };
      }
      if (actors[0]!.player_status !== "active") return null;
      const catalog = await provider.readCatalogInSnapshot(transaction);
      return { reply: formatLegacyPetSkillProbability(catalog.definitions) };
    });
  }
}
