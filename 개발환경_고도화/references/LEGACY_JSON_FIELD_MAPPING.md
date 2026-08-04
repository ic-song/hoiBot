# Legacy JSON Field Mapping

Updated: 2026-08-04

## Import Safety Contract

- Source files are read-only and checksummed before conversion.
- Numbers are parsed losslessly and written to MariaDB as strings/DECIMAL or bounded BIGINT values.
- A canonical field wins only when every simultaneously present alias has the same value.
- A conflicting canonical/alias pair, multiple aliases, invalid number/date, or unknown relationship is written to `legacy_import_anomalies`; no default value is invented.
- A legacy nickname creates an internal player and unresolved `legacy_identity_map`, but never an approved Kakao link.

## First Profile Projection

| Source | Legacy field | Target |
| --- | --- | --- |
| `member.json` | object key | `player_profiles.current_display_name`, `legacy_identity_map.legacy_key` |
| `member.json` | `join` | `player_profiles.joined_at` after explicit date conversion |
| `member.json` | `lv`, `lv0`, `exp` | level, accumulated offset and experience |
| `member.json` | `rebirthcnt` | `player_profiles.rebirth_count` |
| `member.json` | `server` | approved `game_servers` catalog and profile FK |
| `member.json` | `agree`, `firstSponsor` | profile flags |
| `member.json` | `point`, `diamond` | `currency_accounts` using `DECIMAL(30,3)` |
| `member.json` | `cnt`, `like`, `like0`, `carrotGiven`, `thermoPoints`, `homeLikeCnt` | approved `player_counters` codes |
| `member_title.json` | title list/current number | title definition/ownership/equipped state |
| `member_pet.json` | pet and mini-pet values | player pet and owned mini-pet read model |
| `pet_title.json` | pet title list/current number | pet title ownership/equipped state |
| `guildData.json` | guild/member relations | `guilds`, single-source `guild_members` |
| home JSON | name, likes, floor, furniture | player home, owned furniture and placements |
| ranking inputs | home likes, carrot, temperature, special badges | leaderboard entries and badge assignments |

## Approved Aliases

| Canonical | Alias | Rule |
| --- | --- | --- |
| `point` | `points` | Alias only when canonical is absent |
| `boostercnt` | `bostercnt` | Alias only when canonical is absent |
| `rebirthcnt` | `rebirthnt` | Alias only when canonical is absent |
| `towerCnt` | `towerrCnt` | Alias only when canonical is absent |
| `title` | `ttle` | Alias only when canonical is absent |

Voice, notice, contribution and other unconfirmed misspellings are never merged automatically.

## Non-authoritative Inputs

- `errorLog.json`: excluded from game-state import.
- `currencyLog.json` and `memberBagCheck.json`: reconciliation evidence only.
- Runtime files missing from the repository: no physical columns are finalized until a sanitized structure sample is captured.
