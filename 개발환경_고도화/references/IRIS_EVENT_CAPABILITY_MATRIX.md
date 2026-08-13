# Iris Event Capability Matrix

Updated: 2026-08-06

This document records event-detection evidence for the selected redroid + KakaoTalk + Iris environment. It does not store message bodies, room names, sender names, chat IDs, user IDs, authentication values, or media URLs.

This is the validation/evidence record. `KAKAOTALK_IRIS_QUERY_ERD.md` defines the queryable schema and `chat_logs` adapter contract, `IRIS_TECHNICAL_REFERENCE.md` defines approved data use, and `IRIS_SERVER_EVENT_MAPPING.json` is the machine-readable server-normalizer contract. Update evidence here before promoting a mapping status.

## Status Definitions

| Status | Meaning |
| --- | --- |
| `LIVE_CONFIRMED` | Received by the running hoiBot Lite Server from Iris |
| `DB_CONFIRMED` | Found in redroid `chat_logs` and covered by the Iris forwarding path |
| `UPSTREAM_CONFIRMED` | Explicitly classified or parsed by the inspected Iris client/source |
| `UNVERIFIED` | Plausible shape requiring a dedicated live test |
| `NOT_DIRECT` | Requires a table observer or snapshot diff outside new `chat_logs` rows |

## Normalization Engine

The server classifier is an ordered rule registry rather than a single type switch. Every normalized event carries a rule ID and one of `live_confirmed`, `upstream_confirmed`, `db_confirmed`, `candidate`, or `unknown`. Candidate and unknown events may be shown in non-production monitoring with field names only, but they do not run domain behavior or activity aggregation.

The current expansion adds a separate upstream-confirmed thread-reply code, candidate fallbacks for incomplete reply/image/video/multi-image/animated-sticker/rich-card shapes, and a DB-confirmed static-sticker candidate. Reply correlation now preserves `attachment.src_logId` as a string-safe target ID.

Before normalization results reach persistence or commands, channel access uses two filters:

1. verify open-chat evidence from `chat_rooms` and an active, unexpired `open_link`;
2. require the room ID in the configured designated open-chat list.

A configured non-production monitor room is diagnostic-only. Denied events receive HTTP `202` but are not retained in the recent raw-event buffer and do not create identity, activity, incident, command, or outbox rows.

## Detection and Forwarding Pipeline

```text
KakaoTalk writes chat_logs
-> Iris polls rows after its local cursor
-> Iris skips configured suppressed origins
-> Iris decrypts message/attachment metadata
-> Iris resolves mutable room/sender labels
-> Iris broadcasts the raw row over WebSocket
-> Iris POSTs the raw row to the configured HTTP endpoint
-> hoiBot Server parses nested JSON strings
-> hoiBot Server normalizes or quarantines the event
```

The inspected Iris observer suppresses `SYNCMSG` and `MCHATLOGS`. Other origins are forwarded even when the high-level Iris client classifies them as `unknown`.

The upstream high-level event classification is limited to:

| Parsed `v.origin` | Upstream event |
| --- | --- |
| `MSG` | `message` |
| `NEWMEM` | `new_member` |
| `DELMEM` | `del_member` |
| Any other forwarded origin | `unknown` |

The hoiBot Server therefore needs its own raw-event normalizer for edits, deletions, rewrites, replies, mentions, media, and system events.

## Raw Payload Parsing Contract

- `msg`, `room`, and `sender` are top-level Iris fields.
- `json` contains the source `chat_logs` row.
- IDs, timestamps, and type codes may arrive as strings and must remain string-safe.
- `json.v`, `json.attachment`, and `json.supplement` are JSON-encoded strings when present.
- `json.message` can contain JSON for `type=0` system events.
- `json.v.origin` and similar paths in this document refer to post-parse adapter paths.
- A nested-JSON parse failure must route to `iris.unknown`; it must not stop ingestion.

## Event Matrix

| Event | Status | Current evidence | Normalizer requirement |
| --- | --- | --- | --- |
| Plain text | `LIVE_CONFIRMED` | `type=1`, `origin=MSG`; exact `/ping` repeatedly received | Normalize as `message.created/text` |
| Outgoing text | `LIVE_CONFIRMED` | `type=1`, `origin=WRITE`, parsed `isMine=true`; pong response re-observed | Normalize direction as outgoing and prevent response loops |
| Reply | `LIVE_CONFIRMED` | `type=26`; `src_logId`, `src_userId`, `src_type`, `src_message`, optional `src_linkId`/`src_spoilers` | Correlate to provider log ID; under DEC-052 only designated operational rooms may retain the reply and embedded source text for seven days |
| Thread reply | `UPSTREAM_CONFIRMED` | Upstream handling uses thread metadata and `src_isThread=true`; no current post-switch row | Keep separate from ordinary reply until live-confirmed |
| `@mention` | `LIVE_CONFIRMED` for bot mention | Prior live payload contained `mentions[].at`, `len`, `user_id`, and bot-command metadata | Normalize mention ranges and target IDs; test another-member mention separately |
| Message edit | `LIVE_CONFIRMED` for detection and one-step before/after recovery | Controlled 2026-08-07 test produced `type=0`, `origin=SYNCMODMSG`, `feedType=25`, `logId`, and `targetRevision=1`. The target row held the current body plus `v.modifyLog`, whose prior revision stored encrypted content with its `enc` value; Iris `/decrypt` recovered the immediately previous body. | Correlate by string-safe target log ID. Show current body as “after” and decrypt the most recent `modifyLog` entry as “before”; multi-revision history still needs a dedicated test. |
| Message delete | `LIVE_CONFIRMED` for detection, target correlation, and text recovery | Controlled 2026-08-06 polling test observed the plaintext row first, then `SYNCDLMSG`; two exact target rows remained as `type=16385`, and Iris `/query` returned the original plaintext when the full decryption-context projection was selected. The server now announces a metadata-only `#incident` and resolves the body only for exact `/열람 #number`. | Preserve IDs as strings and query by indexed `(chat_id,id)` with `id,chat_id,user_id,type,created_at,message,v`; resolve names from `open_chat_member` and `open_link`, never Iris label caches; media and retention duration remain unverified |
| Host-hidden message | `LIVE_CONFIRMED` | Controlled event used `type=0`, `origin=SYNCREWR`, `feedType=26`, `coverType=openchat_blind`; after migration 021, an actual failed event was reprocessed and its incident plus recovered-original monitor outbox were sent once. A bot-message blind targeted an intermediate `type=0 / WRITE / feedType=13` row whose `prev_id` resolved to the body. A received-message blind rewrote the target row in place and retained the encrypted body in `v.previous_message` with `v.previous_enc`; rebuilding the Iris decrypt projection recovered the verified plaintext | Normalize as `message.hidden_by_host`; preserve target ID and `chatLogInfos[].type`, allow the incident type in MariaDB, follow the verified feedType-13 `prev_id` hop, or rebuild an in-place rewritten row from previous-message metadata |
| Other rewrite sync | `DB_CONFIRMED` | Pre-switch history contained other `type=0`, `origin=SYNCREWR` candidates | Preserve unmatched shapes as raw rewrite until separately correlated |
| Member join | `UPSTREAM_CONFIRMED` + `DB_CONFIRMED` | 2026-08-07 read-only inspection found 44 recent `type=0`, `origin=NEWMEM`, `feedType=4` rows. Every row contained exactly one `members[0].userId/nickName`, and the embedded user ID matched the top-level user ID. | Normalize the embedded ID string-safely as a room-scoped membership join and retain the feed nickname as a verified observation |
| Member leave | `UPSTREAM_CONFIRMED` + `DB_CONFIRMED` | 2026-08-07 read-only inspection found 45 recent `type=0`, `origin=DELMEM`, `feedType=2` rows. Every row contained exactly one `member.userId/nickName`, and the embedded user ID matched the top-level user ID. | Normalize the embedded ID string-safely as a generic departure; keep voluntary leave versus kick unresolved |
| Member kick | `UNVERIFIED` | No separate high-level event; may share `DELMEM` | Compare voluntary leave and kick payloads before classification |
| Nickname/profile change | `NOT_DIRECT` | State is stored in profile/member tables and Iris name cache; no guaranteed new log row | Use a separate snapshot-diff adapter if required |
| Room rename | `NOT_DIRECT` or `UNVERIFIED` | Relevant state can live outside `chat_logs`; no dedicated confirmed origin | Poll room state or confirm a system-feed row |
| Reaction/like | `NOT_DIRECT` or `UNVERIFIED` | Separate reaction tables exist; no confirmed forwarded origin | Inspect the reaction table and run a dedicated test |
| Read state | `NOT_DIRECT` | Read-state changes do not require a new `chat_logs` row | Requires a separate observer |
| Single image | `LIVE_CONFIRMED` | `type=2`; attachment field names include URL, thumbnail, dimensions, size, MIME/media and expiry metadata | DEC-052 permits seven-day private retention only in designated operational rooms; enforce Kakao HTTPS host, MIME, timeout and byte limits |
| Multiple images | `LIVE_CONFIRMED` | TEST monitor received one `type=27`; attachment exposed image, thumbnail, dimension, size and expiry lists | Apply the same DEC-052 boundary to at most ten images per event; observation-only rooms remain metadata-only |
| Emoticon/sticker | `DB_CONFIRMED` | Current `type=12`; attachment keys include `path`, `kid`, `alt`, `name`, `emoticonItemPath` | Keep as candidate until a live event is isolated |
| Animated sticker | `LIVE_CONFIRMED` | TEST monitor received one `type=20`; attachment `type=animated-sticker/digital-item` with path, name, sound, dimensions, alternate text and welcome flag | Normalize as animated sticker; retain only a directly verified Kakao HTTPS asset path under DEC-052 and never reuse `type=20` as a generic file mapping |
| Video | `LIVE_CONFIRMED` | TEST monitor received two `type=3` events; attachment exposed URL, size, duration, width, height, checksum/token and expiry fields | Normalize as video while retaining unknown fallback for incompatible shapes |
| Search/link rich-content card | `LIVE_CONFIRMED` | TEST monitor received `type=71`; a controlled Kakao `#search` action produced `P.TP=Feed`, link/service metadata and a finance search-result host | Normalize generically as a rich-content card; do not assume every `type=71` is exclusively `#search` |
| Unknown type `72` | `DB_CONFIRMED` | Present in pre-switch history; exact semantics unknown | Route to `iris.unknown` |

Automated verification after the registry, numbered incident read, and room-scoped membership-log refactor: 73 tests, typecheck, and build passed on 2026-08-07. Live readiness remains a separate final gate.

## Message-Type Reference

| Type | Working classification | Status basis |
| ---: | --- | --- |
| `0` | Raw/system event container; classify by origin and decoded message shape | DB/upstream evidence |
| `1` | Text/standard message family | Live evidence |
| `2` | Single image | Live evidence |
| `3` | Video | Live TEST monitor and controlled user action |
| `12` | Emoticon/sticker candidate | Current DB field-name evidence only |
| `20` | Animated sticker/digital item | Live TEST monitor and explicit attachment type |
| `26` | Reply | Live evidence |
| `27` | Multiple images | Live TEST monitor evidence |
| `71` | Search/link rich-content card family | Live TEST monitor plus controlled `#search` correlation |
| `72` | Unknown | Historical DB evidence only |

## Current Post-Switch Snapshot

KakaoTalk application data was reset for an account switch on 2026-08-04. The same post-switch database contained 608 `chat_logs` rows at the 2026-08-06 validation point. Counts are point-in-time observations from a live database.

| Type | Rows | Current working family |
| ---: | ---: | --- |
| `1` | 501 | Text/standard message |
| `26` | 34 | Reply |
| `2` | 24 | Single image |
| `0` | 16 | Raw/system event container |
| `71` | 13 | Search/link rich-content card |
| `16385` | 11 | Deleted text row observed as `1 + 16384` |
| `3` | 4 | Video |
| `27` | 2 | Multiple images |
| `20` | 1 | Animated sticker/digital item |
| `12` | 1 | Emoticon/sticker candidate |
| `16386` | 1 | Deleted single-image candidate observed as `2 + 16384` |

Direction from parsed `v.isMine`:

| Origin/direction | Rows |
| --- | ---: |
| `MSG / incoming` | 473 |
| `WRITE / outgoing` | 86 |
| `MCHATLOGS / incoming` | 29 |
| `SYNCDLMSG / outgoing` | 8 |
| `SYNCDLMSG / incoming` | 4 |
| `MCHATLOGS / outgoing` | 5 |
| `SYNCMODMSG / incoming` | 2 |
| `POST / outgoing` | 1 |

## TEST Room Monitor Analysis

The configured two-member `OM` TEST room contained 29 monitor summaries from 2026-08-05 17:55:28 through 2026-08-06 10:28:33 KST. They represented 29 unique provider event IDs from two source rooms, with no duplicate monitor event ID. All monitored source events were incoming.

| Type | Monitor rows | Validated interpretation |
| ---: | ---: | --- |
| `26` | 7 | Reply |
| `1` | 7 | Two mentions and five older plain-text summaries created before the current ordinary-text exclusion behavior |
| `2` | 5 | Single image |
| `71` | 3 | Rich-content card; one controlled `#search` result |
| `0` | 3 | Two delete candidates and one edit candidate |
| `3` | 2 | Video |
| `27` | 1 | Multiple images |
| `20` | 1 | Animated sticker/digital item |

The two video events had non-empty URL, byte-size, duration, width, height, checksum/token and expiry fields. The controlled animated-sticker event explicitly reported `animated-sticker/digital-item` and a 360-by-360 shape with optional sound metadata.

Thirteen `type=71` rows existed in the post-switch database at analysis time. Their `P.TP` values were `Feed` or `List`; link hosts included Daum search, finance and news results plus one external blog result. The controlled `#search` event immediately preceding the user confirmation produced a `Feed` card and a finance-result host. This confirms `#search` support but does not prove that every `type=71` row is exclusively a search action.

## Historical Pre-Switch Evidence

The prior account database supplied broader event coverage before application-data reset:

- latest 10,000-row sample: `NEWMEM` 45, `DELMEM` 42, `SYNCMODMSG` 15, `SYNCDLMSG` 7, `SYNCREWR` 2;
- live server evidence: plain text, exact `/ping`, reply, bot mention, single image, and outgoing pong;
- historical type coverage: `20`, `27`, `72`, `16385`, and `16386` in addition to current types.

Historical evidence remains useful for capability planning but is not presented as the current account's row count.

## Controlled deletion-content validation

On 2026-08-06, synthetic text messages were sent and deleted in the two-member monitoring `OM` room. Each action produced one `type=0 / SYNCDLMSG` event whose JSON `logId` matched the original row. The target rows remained present with the same room and sender IDs, while their type changed from text `1` to `16385` (`1 + 16384`).

A subsequent controlled `_id` polling test established the exact sequence: original row `_id=4967` arrived as plaintext, then deletion event `_id=4968` arrived about 2.8 seconds later. A second deletion used `_id=4970` and `_id=4971`. The first target recovered the exact marker `POLL-TEST-01`; the second target also returned non-encrypted plaintext.

The earlier apparent decryption failure was caused by an incomplete query projection, not by room-dependent encryption. Iris `/query` requires the row fields used by its decryptor. The verified lookup shape is:

```sql
SELECT _id, id, chat_id, user_id, type, created_at, message, v
FROM chat_logs
WHERE chat_id = ? AND id = ?
LIMIT 1;
```

Therefore:

- deletion detection, target-log correlation, and deleted-text recovery are live-confirmed for the two controlled rows;
- the `16384` bit is a verified deleted-row flag for the observed text rows;
- target IDs must be extracted without JavaScript number conversion;
- `(chat_id,id)` uses the existing unique index and no Kakao DB schema change is needed;
- image/media recovery, how long Kakao retains deleted rows, and behavior after database cleanup or app restart remain unverified;
- a server cache is not required for the confirmed immediate deleted-text lookup, though it would be a separate resilience option.

The non-production event monitor now performs this indexed lookup for `message.deleted` and `message.hidden_by_host`. It prints at most 1,000 characters of recovered text in the monitoring alert, distinguishes query failure from a missing target row, and does not persist the recovered body in hoiBot MariaDB or this evidence document.

## Controlled edit-content validation

On 2026-08-07, a text message was edited once in the monitoring room. Iris forwarded a separate `type=0 / SYNCMODMSG` row. Its decoded payload contained `feedType=25`, `hidden=true`, `logId` for the original row, and `targetRevision=1`.

The indexed target lookup found the same message row with the current body and `v.modifyRevision=1`. Its `v.modifyLog` contained one prior revision with an encrypted `message` and `enc` value. Calling Iris `/decrypt` with that encryption context and the target user ID returned the preceding body. This establishes the following verified one-edit model:

```text
SYNCMODMSG.logId -> target chat_logs row
target.message -> current (“after”) body
target.v.modifyLog[last] -> encrypted immediately previous (“before”) body
```

The result confirms that the administrator page can show a one-step before/after view through a real-time Kakao DB lookup. The current MariaDB incident model does not yet retain a separate edit-history snapshot, and the behavior for multiple successive edits, media edits, and Kakao DB retention after app cleanup remains unverified.

## Sender Identity and Name-Cache Limitation

- The server now resolves exact `/ping` labels from a linked system-account name first, then one room-scoped `db2.open_chat_member.nickname`, then one `db2.friends.name` row when available. It never uses Iris `sender` as the reply identity; an unresolved label produces `미확인 사용자 pong`.
- Iris keeps a separate display-name cache at `/data/local/tmp/names.db`; clearing KakaoTalk application data does not clear it.
- After the account switch, the same message `user_id` was initially emitted with a previous-account display label and later emitted with the current display label after notification polling refreshed the cache.
- The cache schema is `names(sender_id TEXT PRIMARY KEY, sender_name TEXT, room_name TEXT)`. Iris computes `sender_id` as SHA-256 of `person_${chatId}:${userId}` and uses this row only when direct Kakao DB name resolution is empty.
- For open chat, Iris directly reads `db2.open_chat_member.nickname` by `user_id`. A live random-profile test showed that this nickname, the stale cache label, and the intended system name can all differ; the profile also had a separate `profile_link_id`.
- A live `/info` in the designated test room confirmed `chat_rooms.type=MultiChat`, `link_id=null`, zero matching `open_chat_member` rows, and no `db2.friends` table. In that room KakaoTalk DB has no participant-name row, so no trusted provider display name is available.
- A later live single-image event showed a visible KakaoTalk sender that differed from the Iris top-level sender while `chat_logs.user_id` remained stable. The server therefore stores Iris sender only as `iris_cache/untrusted`, never as the canonical identity name.
- Non-production exact `/info` prints all received Iris fields and related KakaoTalk rows in chunks. Large integers embedded in JSON are displayed string-safe; this diagnostic is disabled in production because it exposes operational identity and room metadata.
- Therefore server identity must use stable provider IDs with room context, normally `(chat_id, user_id)`.
- `sender` is untrusted replaceable display metadata and must never update canonical names, authenticate users, authorize operations, or prove ownership.
- A manual targeted rebuild was verified by backing up `names.db`, deleting only the confirmed `(room,user)` hash row, restarting Iris, and waiting for a new message. Do not delete the whole cache or automate this in normal operation.

## Dedicated Test Checklist

Use a separate test room and isolate one action at a time:

1. Another-member mention.
2. Message edit and target-log correlation.
3. Message deletion and target-log correlation.
4. Member join.
5. Voluntary leave.
6. Rejoin and kick the same test account.
7. Open-chat nickname change.
8. Multiple images.
9. File.
10. Emoticon/sticker.
11. Reaction add/remove.
12. WebSocket `/ws` delivery for the same event IDs seen over HTTP.

For each test, record only type, origin, field names, correlation behavior, direction, and pass/fail status. Do not store content or identity values.

## Sources

- [Iris `ObserverHelper.kt`](https://github.com/dolidolih/Iris/blob/main/app/src/main/java/party/qwer/iris/ObserverHelper.kt)
- [Iris `KakaoDB.kt`](https://github.com/dolidolih/Iris/blob/main/app/src/main/java/party/qwer/iris/KakaoDB.kt)
- [irispy-client event classification](https://github.com/dolidolih/irispy-client/blob/main/iris/bot/__init__.py)
- [KBotDocs Iris WebSocket payload](https://kbotdocs.dev/reference/iris/Endpoint/ws)
- [KBotDocs Iris query endpoint](https://kbotdocs.dev/reference/iris/Endpoint/query)
