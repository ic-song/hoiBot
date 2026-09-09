import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isLosslessNumber, parse } from "lossless-json";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PASS_CODE_POLICY_VERSION, resolvePassCode } from "../src/pass/pass-code-resolver.js";

interface Anomaly {
  sourceFile: string;
  sourcePath: string;
  fieldName?: string;
  reasonCode: string;
  detail?: Record<string, unknown>;
}

interface LegacySources {
  memberRoot: Record<string, unknown>;
  pets: Record<string, unknown>;
  memberTitles: Record<string, unknown>;
  petTitles: Record<string, unknown>;
  homes: Record<string, unknown>;
  guilds: Record<string, unknown>;
}

const argumentsList = process.argv.slice(2);
const apply = argumentsList.includes("--apply");
const sourceFlag = argumentsList.indexOf("--source");
const sourceDirectory = sourceFlag >= 0 ? argumentsList[sourceFlag + 1] : undefined;
if (sourceDirectory === undefined) {
  throw new Error("Usage: import-legacy-json --source <directory> [--apply]");
}

// 파일 전체의 안정적인 SHA-256 checksum을 계산합니다.
function checksum(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// 변경 가능한 표시명과 분리된 안정적인 legacy catalog code를 생성합니다.
function stableLegacyCode(prefix: string, value: string): string {
  return `${prefix}_${checksum(value).slice(0, 16)}`;
}

// lossless 숫자를 SQL 문자열로 유지합니다.
function numericString(value: unknown): string | undefined {
  if (isLosslessNumber(value)) return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return value.trim();
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function integerString(value: unknown): string | undefined {
  const numeric = numericString(value);
  return numeric !== undefined && /^-?\d+$/.test(numeric) ? numeric : undefined;
}

function sumIntegers(left: unknown, right: unknown): string | undefined {
  const leftValue = integerString(left);
  const rightValue = integerString(right);
  return leftValue === undefined && rightValue === undefined
    ? undefined
    : (BigInt(leftValue ?? "0") + BigInt(rightValue ?? "0")).toString();
}

// timezone 없는 legacy 날짜는 Kakao 운영 기준 KST로만 해석합니다.
function legacyDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const raw = value.trim();
  const normalized = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00+09:00`
    : /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00+09:00`
    : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(raw) ? `${raw.replace(" ", "T")}+09:00`
      : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function supportPassEndDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(value.trim());
  return match === null ? undefined : new Date(`20${match[1]}-${match[2]}-${match[3]}T23:59:59+09:00`);
}

// 가방 키에 인코딩된 레거시 펫 친밀도 상태를 정규화된 DB 값으로 분리합니다.
function parseLegacyPetIntimacy(itemName: string): { level: string; progress: string; fullnessExp: string } | undefined {
  const match = /^펫 친밀도🐾\s*\[Lv\.(\d+)\]\((\d+)\/1000\)\+(\d+)💕$/.exec(itemName);
  if (match === null || BigInt(match[2]!) > 999n) return undefined;
  return { level: match[1]!, progress: match[2]!, fullnessExp: match[3]! };
}

// 기존 checkRank의 길드 순위 이모지를 동일하게 반환합니다.
function guildRankEmoji(rank: unknown): string {
  const emojis = ["☬", "♔", "♛", "♕", "⚝", "❁", "⌺", "⍌", "⍫", "⚔︎", "⚚", "✥", "❖", "◈", "◉", "◍", "◌", "△", "◇", "◻︎"];
  const index = Number(integerString(rank) ?? "0") - 1;
  return index >= 0 && index < emojis.length ? emojis[index]! : "";
}

// 기존 checkRank의 우선순위와 길드 접미사를 보존한 표시 문자열을 만듭니다.
function legacyRankDisplay(legacyKey: string, member: Record<string, unknown>, sources: LegacySources): string {
  const memberGuildId = typeof asRecord(member.guild)?.id === "string" ? String(asRecord(member.guild)?.id) : undefined;
  const lordKey = typeof asRecord(sources.memberRoot.HoiCastle)?.lord === "string"
    ? String(asRecord(sources.memberRoot.HoiCastle)?.lord)
    : undefined;
  const lord = lordKey === undefined ? undefined : asRecord(asRecord(sources.memberRoot.member)?.[lordKey]);
  const lordGuildId = typeof asRecord(lord?.guild)?.id === "string" ? String(asRecord(lord?.guild)?.id) : undefined;
  let prefix = "";
  if (memberGuildId !== undefined && memberGuildId === lordGuildId) prefix = "🏰";
  else if (legacyKey === sources.memberRoot.star) prefix = "💞";
  else if (legacyKey === sources.memberRoot.topCarrotGive) prefix = "🥕";
  else if (legacyKey === sources.memberRoot.topThermo) prefix = "🌡";
  else if (legacyKey === sources.memberRoot.miniPetTop) prefix = "✨";
  else if (legacyKey === sources.memberRoot.toplv) prefix = "🌟";
  else if (legacyKey === sources.memberRoot.mc) prefix = "💬";
  else if (legacyKey === sources.memberRoot.intimacyTop) prefix = "🍼";
  else {
    const rankEmoji = asRecord(member.rank)?.emoji;
    if (typeof rankEmoji === "string") prefix = rankEmoji;
  }
  const guild = memberGuildId === undefined ? undefined : asRecord(sources.guilds[memberGuildId]);
  const suffix = guildRankEmoji(guild?.rank);
  return `${prefix}${legacyKey}${suffix === "" ? "" : `_${suffix}`}`;
}

// canonical 값이 없을 때만 승인된 alias를 사용하고 충돌은 격리합니다.
function canonicalValue(
  record: Record<string, unknown>,
  canonical: string,
  aliases: string[],
  sourceFile: string,
  sourcePath: string,
  anomalies: Anomaly[]
): unknown {
  const presentAliases = aliases.filter((alias) => record[alias] !== undefined);
  if (record[canonical] !== undefined) {
    for (const alias of presentAliases) {
      if (String(record[alias]) !== String(record[canonical])) {
        anomalies.push({ sourceFile, sourcePath, fieldName: canonical, reasonCode: "canonical_alias_conflict", detail: { canonical, alias } });
        return undefined;
      }
    }
    return record[canonical];
  }
  if (presentAliases.length === 1) return record[presentAliases[0]!];
  if (presentAliases.length > 1) {
    anomalies.push({ sourceFile, sourcePath, fieldName: canonical, reasonCode: "multiple_aliases", detail: { aliases: presentAliases } });
  }
  return undefined;
}

const absoluteSource = path.resolve(sourceDirectory);
const fileNames = (await readdir(absoluteSource, { recursive: true }))
  .filter((name) => name.toLowerCase().endsWith(".json"))
  .sort();
const parsedFiles: Array<{ name: string; checksum: string; value: unknown }> = [];
const anomalies: Anomaly[] = [];
for (const name of fileNames) {
  const content = await readFile(path.join(absoluteSource, name), "utf8");
  parsedFiles.push({ name: name.replaceAll("\\", "/"), checksum: checksum(content), value: parse(content) });
}
const rootHash = checksum(parsedFiles.map((file) => `${file.name}:${file.checksum}`).join("\n"));

const memberFile = parsedFiles.find((file) => file.name.endsWith("member.json"));
const memberRoot = asRecord(memberFile?.value) ?? {};
const members = asRecord(memberRoot.member) ?? {};
const readRootRecords = (suffix: string, nestedKey?: string): Record<string, unknown> => {
  const root = asRecord(parsedFiles.find((file) => file.name.endsWith(suffix))?.value) ?? {};
  return nestedKey === undefined ? root : asRecord(root[nestedKey]) ?? {};
};
const legacySources: LegacySources = {
  memberRoot,
  pets: readRootRecords("member_pet.json"),
  memberTitles: readRootRecords("member_title.json", "member"),
  petTitles: readRootRecords("pet_title.json", "member"),
  homes: readRootRecords("petSweetHomeData.json"),
  guilds: readRootRecords("guildData.json", "guilds")
};
for (const [legacyKey, rawMember] of Object.entries(members)) {
  if (typeof rawMember !== "object" || rawMember === null || Array.isArray(rawMember)) {
    anomalies.push({ sourceFile: memberFile?.name ?? "member.json", sourcePath: `member.${legacyKey}`, reasonCode: "invalid_member_record" });
    continue;
  }
  const record = rawMember as Record<string, unknown>;
  for (const [canonical, aliases] of Object.entries({
    point: ["points"], boostercnt: ["bostercnt"], rebirthcnt: ["rebirthnt"], towerCnt: ["towerrCnt"], title: ["ttle"]
  })) {
    canonicalValue(record, canonical, aliases, memberFile?.name ?? "member.json", `member.${legacyKey}`, anomalies);
  }
  if (record.join !== undefined && legacyDate(record.join) === undefined) {
    anomalies.push({ sourceFile: memberFile?.name ?? "member.json", sourcePath: `member.${legacyKey}`, fieldName: "join", reasonCode: "invalid_date" });
  }
  const bag = asRecord(record.bag) ?? {};
  for (const [itemName, quantity] of Object.entries(bag)) {
    const parsedQuantity = integerString(quantity);
    if (parsedQuantity === undefined || BigInt(parsedQuantity) < 0n) {
      anomalies.push({ sourceFile: memberFile?.name ?? "member.json", sourcePath: `member.${legacyKey}.bag`, fieldName: itemName, reasonCode: "invalid_inventory_quantity" });
    }
  }
}

const bagEntryCount = Object.values(members).reduce((total, rawMember) => {
  const member = asRecord(rawMember);
  return total + Object.keys(asRecord(member?.bag) ?? {}).length;
}, 0);

if (!apply) {
  process.stdout.write(JSON.stringify({ mode: "dry-run", fileCount: parsedFiles.length, memberCount: Object.keys(members).length, bagEntryCount, anomalyCount: anomalies.length, rootHash }, null, 2) + "\n");
  process.exit(0);
}

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true with --apply.");
const database = createDatabaseClient(config.database);
try {
  const completed = await database.query<Array<{ id: bigint }>>(
    "SELECT id FROM legacy_import_runs WHERE source_root_hash = ? AND mode = 'apply' AND status = 'completed' ORDER BY id DESC LIMIT 1",
    [rootHash]
  );
  if (completed[0] !== undefined) {
    process.stdout.write(JSON.stringify({ mode: "apply", alreadyApplied: true, importRunId: completed[0].id.toString(), rootHash }) + "\n");
    process.exit(0);
  }
  const runId = await database.withTransaction(async (transaction) => {
    const run = await transaction.execute(
      "INSERT INTO legacy_import_runs (run_key, source_root_hash, mode, status, started_at) VALUES (?, ?, 'apply', 'running', UTC_TIMESTAMP(3))",
      [randomUUID(), rootHash]
    );
    for (const file of parsedFiles) {
      await transaction.execute(
        "INSERT INTO legacy_import_files (import_run_id, source_file, checksum, parse_status) VALUES (?, ?, ?, 'parsed')",
        [run.insertId, file.name, file.checksum]
      );
    }
    for (const anomaly of anomalies) {
      await transaction.execute(
        `INSERT INTO legacy_import_anomalies
          (import_run_id, source_file, source_path, field_name, reason_code, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
        [run.insertId, anomaly.sourceFile, anomaly.sourcePath, anomaly.fieldName ?? null,
          anomaly.reasonCode, anomaly.detail === undefined ? null : JSON.stringify(anomaly.detail)]
      );
    }
    return run.insertId;
  });
  const playerIds = await importMembers(database, runId, memberFile?.name ?? "member.json", members, legacySources);
  await importLeaderboards(database, members, legacySources.homes, playerIds);
  await database.execute("UPDATE legacy_import_runs SET status = 'completed', completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [runId]);
  process.stdout.write(JSON.stringify({ mode: "apply", fileCount: parsedFiles.length, memberCount: Object.keys(members).length, anomalyCount: anomalies.length, rootHash }) + "\n");
} finally {
  await database.close();
}

// 첫 수직 기능에 필요한 회원·프로필·재화 값을 한 회원 단위 트랜잭션으로 적재합니다.
async function importMembers(
  database: DatabaseClient,
  runId: bigint,
  sourceFile: string,
  members: Record<string, unknown>,
  sources: LegacySources
): Promise<Map<string, bigint>> {
  const playerIds = new Map<string, bigint>();
  for (const [legacyKey, raw] of Object.entries(members)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const member = raw as Record<string, unknown>;
    const point = numericString(canonicalValue(member, "point", ["points"], sourceFile, `member.${legacyKey}`, []));
    const diamond = numericString(member.diamond);
    const accumulatedLevelOffset = integerString(member.lv0);
    const rebirth = numericString(canonicalValue(member, "rebirthcnt", ["rebirthnt"], sourceFile, `member.${legacyKey}`, []));
    await database.withTransaction(async (transaction) => {
      let gameServerId: bigint | null = null;
      if (typeof member.server === "string" && member.server.trim() !== "") {
        const serverCode = stableLegacyCode("server", member.server.trim());
        await transaction.execute(
          `INSERT INTO game_servers (code, display_name, active, version, created_at, updated_at)
           VALUES (?, ?, TRUE, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), updated_at = VALUES(updated_at)`,
          [serverCode, member.server.trim()]
        );
        const servers = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM game_servers WHERE code = ?", [serverCode]);
        gameServerId = servers[0]?.id ?? null;
      }
      const player = await transaction.execute("INSERT INTO players (status, version, created_at, updated_at) VALUES ('active', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))");
      playerIds.set(legacyKey, player.insertId);
      await transaction.execute(
        `INSERT INTO player_profiles
          (player_id, current_display_name, joined_at, level, accumulated_level_offset, experience,
           rebirth_count, game_server_id, tier_code, terms_agreed, first_sponsor, version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, UTC_TIMESTAMP(3))`,
        [player.insertId, legacyKey, legacyDate(member.join) ?? null, integerString(member.lv) ?? 0,
          accumulatedLevelOffset ?? 0, integerString(member.exp) ?? 0, integerString(rebirth) ?? 0,
          gameServerId, typeof (member.rank as Record<string, unknown> | undefined)?.tier === "string"
            ? stableLegacyCode("tier", String((member.rank as Record<string, unknown>).tier)) : null,
          member.agree === true, member.firstSponsor === true]
      );
      await transaction.execute(
        `INSERT INTO legacy_identity_map
          (import_run_id, source_file, legacy_key, player_id, resolution_status)
         VALUES (?, ?, ?, ?, 'unresolved')`,
        [runId, sourceFile, legacyKey, player.insertId]
      );
      if (point !== undefined) await transaction.execute("INSERT INTO currency_accounts (player_id, currency_code, balance) VALUES (?, 'point', ?)", [player.insertId, point]);
      if (diamond !== undefined) await transaction.execute("INSERT INTO currency_accounts (player_id, currency_code, balance) VALUES (?, 'diamond', ?)", [player.insertId, diamond]);
      const bag = asRecord(member.bag) ?? {};
      let importedIntimacy: { level: string; progress: string; fullnessExp: string } | undefined;
      for (const [itemName, rawQuantity] of Object.entries(bag)) {
        const quantity = integerString(rawQuantity);
        if (quantity === undefined || BigInt(quantity) < 0n) continue;
        const intimacy = parseLegacyPetIntimacy(itemName);
        if (intimacy !== undefined) {
          if (importedIntimacy === undefined) importedIntimacy = intimacy;
          continue;
        }
        const itemCode = stableLegacyCode("bag", itemName);
        await transaction.execute(
          `INSERT INTO item_definitions (code, display_name, asset_type_code, stackable, metadata_json, active, version)
           VALUES (?, ?, 'legacy_bag_item', TRUE, JSON_OBJECT('legacyImported', TRUE), TRUE, 1)
           ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = TRUE`,
          [itemCode, itemName]
        );
        const itemRows = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code = ?", [itemCode]);
        if (itemRows[0] !== undefined) {
          await transaction.execute(
            "INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, ?, 1)",
            [player.insertId, itemRows[0].id, quantity]
          );
        }
      }
      const counterValues: Array<[string, string, string | undefined]> = [
        ["attendance", "lifetime", integerString(member.cnt)],
        ["like", "current", integerString(member.like)],
        ["like", "lifetime", sumIntegers(member.like, member.like0)],
        ["cntlike", new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()), integerString(member.cntlike)],
        ["carrot", "lifetime", integerString(member.carrotGiven)],
        ["thermo", "lifetime", integerString(member.thermoPoints)],
        ["home_like", "lifetime", integerString(member.homeLikeCnt)]
      ];
      for (const [counterCode, periodKey, value] of counterValues) {
        if (value !== undefined) {
          await transaction.execute(
            "INSERT INTO player_counters (player_id, counter_code, period_key, value, updated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))",
            [player.insertId, counterCode, periodKey, value]
          );
        }
      }

      const passes = asRecord(member.pass) ?? {};
      for (const [passCode, passRaw] of Object.entries(passes)) {
        const pass = asRecord(passRaw);
        if (pass === undefined) continue;
        const compatibilityPassCode = resolvePassCode({
          code: passCode,
          sourceScope: "SEMANTIC",
          targetScope: "COMPATIBILITY",
          policyVersion: PASS_CODE_POLICY_VERSION
        });
        await transaction.execute(
          `INSERT INTO player_passes
            (player_id, pass_code, enabled, permanent, starts_at, ends_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [player.insertId, compatibilityPassCode, pass.enabled === true, pass.permanent === true,
            legacyDate(pass.startDate) ?? null, supportPassEndDate(pass.endDate) ?? null]
        );
      }

      const pet = asRecord(sources.pets[legacyKey]);
      let playerPetId: bigint | undefined;
      if (pet !== undefined && (typeof pet.petname === "string" || typeof pet.petimg === "string" || typeof pet.newimg === "string")
        && integerString(pet.petexp) !== undefined) {
        const insertedPet = await transaction.execute(
          `INSERT INTO player_pets
            (player_id, display_name, pet_type_code, image_value, experience, enhancement_level, version)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
          [player.insertId, typeof pet.petname === "string" ? pet.petname : null,
            typeof pet.pettype === "string" ? stableLegacyCode("pet_type", pet.pettype) : null,
            typeof pet.newimg === "string" && pet.newimg.trim() !== "" ? pet.newimg : typeof pet.petimg === "string" ? pet.petimg : null,
            integerString(pet.petexp) ?? 0, integerString(pet.upgrade) ?? 0]
        );
        playerPetId = insertedPet.insertId;
        if (importedIntimacy !== undefined) {
          await transaction.execute(
            "INSERT INTO player_pet_intimacy(player_pet_id,intimacy_level,progress,charm,version,updated_at) VALUES (?,?,?,?,1,UTC_TIMESTAMP(3))",
            [playerPetId, importedIntimacy.level, importedIntimacy.progress, importedIntimacy.fullnessExp]
          );
        }
        const miniPet = asRecord(pet.miniPet);
        if (miniPet !== undefined && typeof miniPet.name === "string" && miniPet.name.trim() !== "") {
          const definitionCode = stableLegacyCode("mini_pet", `${miniPet.name}|${String(miniPet.grade ?? "")}|${String(miniPet.emoji ?? "")}`);
          await transaction.execute(
            `INSERT INTO mini_pet_definitions (code, display_name, grade_code, grade_display_name, emoji_value, active)
             VALUES (?, ?, ?, ?, ?, TRUE) ON DUPLICATE KEY UPDATE display_name = VALUES(display_name),
               grade_display_name = VALUES(grade_display_name), emoji_value = VALUES(emoji_value)`,
            [definitionCode, miniPet.name, typeof miniPet.grade === "string" ? stableLegacyCode("grade", miniPet.grade) : null,
              typeof miniPet.grade === "string" ? miniPet.grade : null, typeof miniPet.emoji === "string" ? miniPet.emoji : null]
          );
          const definitions = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM mini_pet_definitions WHERE code = ?", [definitionCode]);
          if (definitions[0] !== undefined) {
            await transaction.execute(
              `INSERT INTO owned_mini_pets
                (player_id, mini_pet_definition_id, custom_name, progress, battle_experience, castle_experience, raid_experience, equipped)
               VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
              [player.insertId, definitions[0].id, miniPet.name, integerString(miniPet.upgrade) ?? 0,
                integerString(miniPet.battleExp) ?? 0, integerString(miniPet.castleExp) ?? 0, integerString(miniPet.raidExp) ?? 0]
            );
          }
        }
      }

      await importTitles(transaction, player.insertId, undefined, sources.memberTitles[legacyKey], "player");
      if (playerPetId !== undefined) await importTitles(transaction, player.insertId, playerPetId, sources.petTitles[legacyKey], "pet");

      const home = asRecord(sources.homes[legacyKey]) ?? {
        floor: 0, houseName: "서울역 4번출구🚉", exp: 0, likeCnt: 0, placedFurniture: []
      };
      {
        await transaction.execute(
          `INSERT INTO player_homes (player_id, display_name, base_experience, like_count, floor_area, version)
           VALUES (?, ?, ?, ?, ?, 1)`,
          [player.insertId, typeof home.houseName === "string" ? home.houseName : null,
            integerString(home.exp) ?? 0, integerString(home.likeCnt) ?? 0, integerString(home.floor) ?? 0]
        );
        const placements = asArray(home.placedFurniture);
        for (let index = 0; index < placements.length; index += 1) {
          const furniture = asRecord(placements[index]);
          if (furniture === undefined || typeof furniture.name !== "string") continue;
          const definitionCode = stableLegacyCode("furniture", `${furniture.name}|${String(furniture.grade ?? "")}`);
          await transaction.execute(
            `INSERT INTO furniture_definitions (code, display_name, charm_value, active)
             VALUES (?, ?, ?, TRUE) ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), charm_value = VALUES(charm_value)`,
            [definitionCode, furniture.name, integerString(furniture.exp) ?? 0]
          );
          const definitions = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM furniture_definitions WHERE code = ?", [definitionCode]);
          if (definitions[0] === undefined) continue;
          await transaction.execute(
            `INSERT INTO owned_furniture (player_id, furniture_definition_id, quantity)
             VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE quantity = quantity + 1`,
            [player.insertId, definitions[0].id]
          );
          const owned = await transaction.query<Array<{ id: bigint }>>(
            "SELECT id FROM owned_furniture WHERE player_id = ? AND furniture_definition_id = ?",
            [player.insertId, definitions[0].id]
          );
          if (owned[0] !== undefined) {
            await transaction.execute(
              "INSERT INTO furniture_placements (player_id, owned_furniture_id, placement_key) VALUES (?, ?, ?)",
              [player.insertId, owned[0].id, `${String(furniture.id ?? "legacy")}:${index}`]
            );
          }
        }
      }

      const memberGuild = asRecord(member.guild);
      const guildLegacyId = typeof memberGuild?.id === "string" ? memberGuild.id : undefined;
      const guild = guildLegacyId === undefined ? undefined : asRecord(sources.guilds[guildLegacyId]);
      if (guildLegacyId !== undefined && guild !== undefined && typeof guild.name === "string") {
        await transaction.execute(
          `INSERT INTO guilds (code, display_name, mark, status, version)
           VALUES (?, ?, ?, 'active', 1)
           ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), mark = VALUES(mark)`,
          [guildLegacyId, guild.name, typeof guild.mark === "string" ? guild.mark : null]
        );
        const guildRows = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM guilds WHERE code = ?", [guildLegacyId]);
        if (guildRows[0] !== undefined) {
          await transaction.execute(
            "INSERT INTO guild_members (guild_id, player_id, role_code, joined_at) VALUES (?, ?, ?, ?)",
            [guildRows[0].id, player.insertId,
              stableLegacyCode("guild_role", String(memberGuild?.role ?? "member")),
              legacyDate(asRecord(asRecord(guild.members)?.[legacyKey])?.joinedAt) ?? null]
          );
        }
      }

      const rankDisplay = legacyRankDisplay(legacyKey, member, sources);
      await transaction.execute(
        "INSERT INTO player_badge_assignments (player_id, badge_code, display_value, priority) VALUES (?, ?, ?, 100)",
        [player.insertId, stableLegacyCode("badge", rankDisplay), rankDisplay]
      );
      const rankEmoji = asRecord(member.rank)?.emoji;
      await transaction.execute(
        "INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (?,?,?)",
        [player.insertId, typeof rankEmoji === "string" ? rankEmoji : "", player.insertId]
      );
      if (legacyKey === sources.memberRoot.intimacyTop) {
        await transaction.execute(
          "INSERT INTO pet_intimacy_ranking_state(state_key,top_player_id,version,updated_at) VALUES ('current',?,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE top_player_id=VALUES(top_player_id),version=version+1,updated_at=VALUES(updated_at)",
          [player.insertId]
        );
      }
    });
  }
  return playerIds;
}

async function importTitles(
  transaction: DatabaseTransaction,
  playerId: bigint,
  playerPetId: bigint | undefined,
  rawOwner: unknown,
  scope: "player" | "pet"
): Promise<void> {
  const title = asRecord(asRecord(rawOwner)?.title);
  const list = asArray(title?.list);
  const equippedIndex = Number(integerString(title?.num) ?? "0") - 1;
  for (let index = 0; index < list.length; index += 1) {
    const item = asRecord(list[index]);
    if (item === undefined || typeof item.name !== "string") continue;
    const code = stableLegacyCode(`title_${scope}`, item.name);
    await transaction.execute(
      `INSERT INTO title_definitions (code, display_name, scope_code, active)
       VALUES (?, ?, ?, TRUE) ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
      [code, item.name, scope]
    );
    const definitions = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM title_definitions WHERE code = ?", [code]);
    if (definitions[0] === undefined) continue;
    if (scope === "player") {
      await transaction.execute(
        `INSERT INTO player_titles (player_id, title_id, acquired_at, equipped) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE acquired_at = COALESCE(acquired_at, VALUES(acquired_at)),
           equipped = equipped OR VALUES(equipped)`,
        [playerId, definitions[0].id, legacyDate(item.inDate) ?? null, index === equippedIndex]
      );
    } else if (playerPetId !== undefined) {
      await transaction.execute(
        `INSERT INTO pet_titles (player_pet_id, title_id, acquired_at, equipped) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE acquired_at = COALESCE(acquired_at, VALUES(acquired_at)),
           equipped = equipped OR VALUES(equipped)`,
        [playerPetId, definitions[0].id, legacyDate(item.inDate) ?? null, index === equippedIndex]
      );
      await transaction.execute(
        `INSERT INTO player_pet_title_instances
          (instance_key, player_id, title_key, display_name, price_digits, display_order, acquired_at, equipped, status, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'owned', 1)
         ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), price_digits = VALUES(price_digits),
           acquired_at = VALUES(acquired_at), equipped = VALUES(equipped), status = 'owned'`,
        [randomUUID(), playerId, code, item.name, integerString(item.price) ?? "0", index + 1,
          legacyDate(item.inDate) ?? new Date(0), index === equippedIndex]
      );
    }
  }
}

async function importLeaderboards(
  database: DatabaseClient,
  members: Record<string, unknown>,
  homes: Record<string, unknown>,
  playerIds: Map<string, bigint>
): Promise<void> {
  const definitions: Array<{ code: string; positiveOnly: boolean; score: (key: string, member: Record<string, unknown>) => string | undefined }> = [
    { code: "home_like", positiveOnly: false, score: (key) => integerString(asRecord(homes[key])?.likeCnt) ?? "0" },
    { code: "carrot", positiveOnly: true, score: (_key, member) => integerString(member.carrotGiven) },
    { code: "thermo", positiveOnly: true, score: (_key, member) => integerString(member.thermoPoints) }
  ];
  const collator = new Intl.Collator("ko-KR");
  for (const definition of definitions) {
    const entries = Object.entries(members).flatMap(([key, raw]) => {
      const member = asRecord(raw); const playerId = playerIds.get(key);
      if (member === undefined || playerId === undefined) return [];
      const score = definition.score(key, member);
      return score === undefined || (definition.positiveOnly && BigInt(score) <= 0n) ? [] : [{ key, playerId, score }];
    }).sort((left, right) => {
      const scoreOrder = BigInt(right.score) > BigInt(left.score) ? 1 : BigInt(right.score) < BigInt(left.score) ? -1 : 0;
      return scoreOrder !== 0 ? scoreOrder : collator.compare(left.key, right.key);
    });
    await database.withTransaction(async (transaction) => {
      const board = await transaction.execute(
        "INSERT INTO leaderboards (code, season_key, calculated_at) VALUES (?, 'lifetime', UTC_TIMESTAMP(3))",
        [definition.code]
      );
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]!;
        await transaction.execute(
          "INSERT INTO leaderboard_entries (leaderboard_id, player_id, rank_no, score, tie_break_key) VALUES (?, ?, ?, ?, ?)",
          [board.insertId, entry.playerId, index + 1, entry.score, entry.key]
        );
      }
    });
  }
}
