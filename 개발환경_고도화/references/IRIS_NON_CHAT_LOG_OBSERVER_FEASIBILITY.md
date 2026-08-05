# Iris Non-`chat_logs` Observer Feasibility

Last verified: 2026-08-05

## Scope

This document records whether the current Iris deployment can be extended to detect KakaoTalk database changes that do not create a new `chat_logs` row. It is a technical feasibility record, not an implementation decision.

## Verified Runtime and Source

- The redroid device is running the official Iris `v0.32` artifact.
- The MD5 of `/data/local/tmp/Iris.apk` matched the official `v0.32` release checksum.
- Iris is open source at <https://github.com/dolidolih/Iris>.
- The inspected source revision was tag `v0.32`, commit `ee1dc978ec465df11642596e40f74caff497301d`.
- The active configuration polls the KakaoTalk database every `100 ms`.

## Current Observer Behavior

Iris does not use a SQLite trigger or Android `ContentObserver` for KakaoTalk messages. `DBObserver` schedules a fixed-delay polling task, and `ObserverHelper` performs the following query pattern:

```sql
SELECT *
FROM chat_logs
WHERE _id > ?
ORDER BY _id ASC
```

On the first poll, Iris stores the current latest `_id` as its baseline. Later rows are decrypted and emitted to HTTP and WebSocket consumers. Rows whose `v.origin` is `SYNCMSG` or `MCHATLOGS` are deliberately skipped by the current observer.

KakaoTalk writes its own local databases independently of Iris. Iris configuration determines what Iris observes and forwards; it does not determine what KakaoTalk stores in `chat_logs`.

## Extension Feasibility

The existing `KakaoDB` connection attaches all three current KakaoTalk databases:

- `db1`: `KakaoTalk.db`
- `db2`: `KakaoTalk2.db`
- `db3`: `multi_profile_database.db`

The same connection already exposes read-only query results through Iris `/query`. A custom Iris build can therefore add a second snapshot-difference observer without changing KakaoTalk data.

| Change candidate | Candidate source | Feasibility | Constraint |
| --- | --- | --- | --- |
| Room membership set | `db1.chat_rooms.members`, `active_member_ids` | High | Must distinguish ordinary room refreshes from a set change |
| Room title or image metadata | `db1.chat_rooms.meta`, `private_meta`; `db2.open_link` | High | Nested metadata must be compared by relevant fields, not raw row timestamps |
| Open-chat member nickname/profile | `db2.open_chat_member` | Conditional | The table may contain no row for the current room/profile |
| Current open profile | `db2.open_profile` | Conditional | Detects only profiles represented in the local database |
| Own multi-profile | `db3.multi_profiles` | High | Primarily represents profiles owned by the logged-in account |
| Multi-profile assignment | `db3.multi_profile_designated` | High | A row change proves assignment-state change, not necessarily its remote cause |
| General group-chat participant nickname | `db2.friends` | Unavailable in the current account | The current database has no `friends` table |
| State not persisted in any local table | None | Impossible | There is no local evidence to compare |

`recently_reactions` is a local recently-used reaction list, not proof that another participant reacted to a specific message. It must not be mapped to a chat reaction event without live evidence.

## Recommended Custom Observer

Keep the current `chat_logs` path unchanged and add a separate `TableChangeObserver`:

1. Establish an initial baseline without emitting events.
2. Detect database-level changes cheaply, for example with SQLite `data_version` where reliable.
3. Query only approved columns from approved tables.
4. Compare rows by stable keys and normalized field hashes.
5. Emit a typed internal event only when a relevant field changes.
6. Persist a minimal snapshot if changes during an Iris restart must be detected.
7. Never write to KakaoTalk databases.

Example event envelope:

```json
{
  "source": "kakao_table_change",
  "event": "profile.nickname.changed",
  "channelId": "provider channel identifier",
  "userId": "provider user identifier",
  "detectedAt": "UTC timestamp"
}
```

To minimize personal-data processing, the default event should contain stable identifiers, event type, and detection time. Mutable names, profile image URLs, and raw database rows should be omitted unless a specific verified service requires them.

## Operational Constraints

- This remains polling, not a true real-time SQLite trigger. Detection latency follows the polling interval.
- `chat_rooms.last_updated_at`, `last_log_id`, unread state, and watermarks change during normal messaging. Watching whole rows would generate excessive false events.
- A custom build must be maintained when KakaoTalk changes its database schema.
- Replacing `/data/local/tmp/Iris.apk` requires stopping and restarting the Iris `app_process` process.
- The custom build should be pinned to an upstream tag and kept separate from the official artifact so rollback remains immediate.
- The compiled Iris application is subject to GPLv3 terms because it includes the GPL-derived notification component described by the upstream project.

## Recommendation

Technical extension is feasible. Start with room membership and room metadata because their local evidence is present and comparatively stable. Add profile observers only after a live test proves that the target room type populates the corresponding local table. Do not treat this feasibility result as approval to replace the official Iris build.

## Evidence

- Upstream observer scheduler: <https://github.com/dolidolih/Iris/blob/v0.32/app/src/main/java/party/qwer/iris/DBObserver.kt>
- Upstream `chat_logs` polling and forwarding: <https://github.com/dolidolih/Iris/blob/v0.32/app/src/main/java/party/qwer/iris/ObserverHelper.kt>
- Attached database connection and query support: <https://github.com/dolidolih/Iris/blob/v0.32/app/src/main/java/party/qwer/iris/KakaoDB.kt>
- Upstream release: <https://github.com/dolidolih/Iris/releases/tag/v0.32>
