# Iris Event Capability Matrix

This document records event-detection evidence for the selected redroid + KakaoTalk + Iris environment. It does not store message bodies, room names, sender names, chat IDs, user IDs, or authentication values.

This document is the validation/evidence record. The machine-readable reference for implementing the hoiBot Server normalizer is `IRIS_SERVER_EVENT_MAPPING.json`. Update evidence here first, then update only the affected mapping entries.

## Status Definitions

| Status | Meaning |
| --- | --- |
| `LIVE_CONFIRMED` | Received by the running hoiBot Lite Server from Iris |
| `DB_CONFIRMED` | Found in the current redroid KakaoTalk `chat_logs` history and covered by the Iris forwarding path |
| `UPSTREAM_CONFIRMED` | Explicitly classified by the upstream Iris client |
| `UNVERIFIED` | Plausible metadata or behavior, but a dedicated live test is still required |
| `NOT_DIRECT` | The current Iris observer does not watch the table required for this change |

## How Iris Detects Events

The inspected Iris implementation polls new rows from KakaoTalk's `chat_logs` table. Every new row is broadcast to WebSocket clients and sent to the configured HTTP endpoint except rows whose `v.origin` is `SYNCMSG` or `MCHATLOGS`.

The upstream `irispy-client` exposes only these high-level classifications:

| `v.origin` | High-level event |
| --- | --- |
| `MSG` | `message` |
| `NEWMEM` | `new_member` |
| `DELMEM` | `del_member` |
| Any other value | `unknown` |

The hoiBot Server therefore needs its own raw-event normalizer for edit, delete, rewrite, mention, and other system events.

## Requested Event Matrix

| Event | Detection status | Current evidence | Server handling requirement |
| --- | --- | --- | --- |
| Plain text | `LIVE_CONFIRMED` | `type=1`, `origin=MSG`; current post-restart server sample received this shape | Normalize as a standard message |
| Reply | `LIVE_CONFIRMED` | A current post-move server event observed `type=26`, `isMine=false`, and source fields `src_linkId`, `src_logId`, `src_message`, `src_type`, and `src_userId`; `src_isThread=false` | Link to the source log using attachment metadata |
| Thread reply | `UPSTREAM_CONFIRMED` | Iris adds `src_logId` and `src_isThread=true` to `type=1` when `thread_id` or `supplement.threadId` is present | Normalize separately from a normal reply |
| `@mention` | `LIVE_CONFIRMED` for bot mention | `type=1`, `origin=MSG`; live payload contained `attachment.mentions[].at`, `len`, and `user_id`, plus `attachment.bot_command` metadata | Normalize mentions from `attachment.mentions[]`; test another-member mention separately |
| Message edit | `DB_CONFIRMED` | `type=0`, `origin=SYNCMODMSG`; 15 rows in the latest 10,000-log sample | Treat as a raw update event; confirm target log ID and edited text in a live test |
| Message delete | `DB_CONFIRMED` | `type=0`, `origin=SYNCDLMSG`; 7 rows in the latest 10,000-log sample; one historical shape exposed `logId`, `feedType`, `hidden`, and `byHost` | Treat as a raw deletion event and correlate by target log ID |
| Nickname change | `NOT_DIRECT` | Iris polls `chat_logs`, while current nickname data is queried from tables such as `open_chat_member`, `open_profile`, or `friends` | Add a separate snapshot/polling adapter if this feature is required |
| Member join | `UPSTREAM_CONFIRMED` + `DB_CONFIRMED` | `type=0`, `origin=NEWMEM`; 45 rows in the latest 10,000-log sample; upstream event is `new_member` | Normalize as member join |
| Member leave | `UPSTREAM_CONFIRMED` + `DB_CONFIRMED` | `type=0`, `origin=DELMEM`; 42 rows in the latest 10,000-log sample; upstream event is `del_member` | Normalize as member departure |
| Member kick | `UNVERIFIED` | No separate high-level kick event exists; it may share `DELMEM` with voluntary departure | Run separate voluntary-leave and kick tests and compare raw payloads |
| Room/profile rename | `NOT_DIRECT` or `UNVERIFIED` | No dedicated origin was identified; relevant state can live outside `chat_logs` | Poll relevant room/profile tables or confirm that KakaoTalk emits a system feed row |
| Reaction/like | `NOT_DIRECT` or `UNVERIFIED` | No reaction origin appeared in the inspected sample and reactions may use a separate table | Inspect schema and run a dedicated reaction test |
| Read status | `NOT_DIRECT` | The current observer forwards new `chat_logs` rows, not read-state changes | Requires a separate read-state observer if needed |
| Single image | `LIVE_CONFIRMED` | `type=2`, `origin=MSG`, `isMine=false`; attachment contained the original/thumbnail URLs, dimensions, size, media type, and expiry metadata; a ranged GET returned `image/png` bytes | Treat the Kakao CDN URL as transient input; enforce host, MIME, timeout, and byte limits before forwarding |

## Observed Message Types

The current redroid sample and prior Lite Server evidence contained the following message types. Names marked as candidates still require a dedicated live payload test.

| Type | Observed evidence | Working classification |
| --- | --- | --- |
| `0` | Origins include `NEWMEM`, `DELMEM`, `SYNCMODMSG`, `SYNCDLMSG`, `SYNCREWR`, and a system-like `MSG` payload | System/raw event container |
| `1` | Dominant `MSG` and `WRITE` rows | Plain text or thread text |
| `2` | Live server payload contained a downloadable Kakao CDN URL plus image metadata | Single image |
| `12` | Live pre-restart payload contained emoticon-related attachment keys | Emoticon/sticker candidate |
| `20` | Present in redroid history | File candidate; live payload test required |
| `26` | Current live payload contained source-message fields and `src_isThread=false` | Reply |
| `27` | Present in redroid history; upstream model reads `imageUrls` | Multiple-image candidate |
| `71` | Upstream model reads nested image thumbnails | Media/gift-style payload; exact classification required |
| `72` | Present in redroid history | Unknown; dedicated payload test required |

## Current Redroid Evidence

The latest 1,000-row aggregate contained:

| Type/origin | Count |
| --- | ---: |
| `1 / MSG` | 955 |
| `1 / WRITE` | 17 |
| `2 / MSG` | 10 |
| `26 / MSG` | 5 |
| `20 / MSG` | 3 |
| `0 / NEWMEM` | 2 |
| `0 / DELMEM` | 2 |
| `0 / SYNCMODMSG` | 2 |
| `12 / MSG` | 2 |
| `27 / MSG` | 1 |
| `72 / MSG` | 1 |

The latest 10,000-row nonstandard-origin aggregate contained:

| Type/origin | Count |
| --- | ---: |
| `0 / NEWMEM` | 45 |
| `0 / DELMEM` | 42 |
| `0 / SYNCMODMSG` | 15 |
| `0 / SYNCDLMSG` | 7 |
| `0 / SYNCREWR` | 2 |

These are historical database observations, not a guarantee that every field is stable across KakaoTalk or Iris versions.

## Dedicated Test Checklist

Use a separate KakaoTalk test room and capture one event at a time:

1. Plain text and exact `/ping`.
2. Reply to a text message.
3. Thread reply where supported.
4. `@mention` of another member; bot mention is already live-confirmed.
5. Edit a previously sent message.
6. Delete a previously sent message.
7. Join with a test account.
8. Voluntary leave with a test account.
9. Rejoin and kick the same test account.
10. Change an open-chat nickname.
11. Send multiple images, a file, and an emoticon; one image is already live-confirmed.
12. Add/remove a reaction if the current KakaoTalk room supports it.

For each test, record only the type, origin, field names, correlation behavior, and pass/fail result. Do not store message text or identity values.

## Sources

- [Iris `ObserverHelper.kt`](https://github.com/dolidolih/Iris/blob/main/app/src/main/java/party/qwer/iris/ObserverHelper.kt)
- [Iris `KakaoDB.kt`](https://github.com/dolidolih/Iris/blob/main/app/src/main/java/party/qwer/iris/KakaoDB.kt)
- [irispy-client event classification](https://github.com/dolidolih/irispy-client/blob/main/iris/bot/__init__.py)
- [KBotDocs Iris WebSocket payload](https://kbotdocs.dev/reference/iris/Endpoint/ws)
