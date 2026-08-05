# Iris Event Capability Matrix

Updated: 2026-08-05

This document records event-detection evidence for the selected redroid + KakaoTalk + Iris environment. It does not store message bodies, room names, sender names, chat IDs, user IDs, authentication values, or media URLs.

This is the validation/evidence record. `KAKAOTALK_DB_SCHEMA_INVENTORY.md` defines the `chat_logs` metadata, `IRIS_KAKAOTALK_USABLE_DATA_CLASSIFICATION.md` separates observable data from approved server use, and `IRIS_SERVER_EVENT_MAPPING.json` is the machine-readable server-normalizer contract. Update evidence here before promoting a mapping status.

## Status Definitions

| Status | Meaning |
| --- | --- |
| `LIVE_CONFIRMED` | Received by the running hoiBot Lite Server from Iris |
| `DB_CONFIRMED` | Found in redroid `chat_logs` and covered by the Iris forwarding path |
| `UPSTREAM_CONFIRMED` | Explicitly classified or parsed by the inspected Iris client/source |
| `UNVERIFIED` | Plausible shape requiring a dedicated live test |
| `NOT_DIRECT` | Requires a table observer or snapshot diff outside new `chat_logs` rows |

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
| Reply | `LIVE_CONFIRMED` | `type=26`; `src_logId`, `src_userId`, `src_type`, `src_message`, optional `src_linkId`/`src_spoilers` | Correlate to provider log ID; treat embedded source text as sensitive |
| Thread reply | `UPSTREAM_CONFIRMED` | Upstream handling uses thread metadata and `src_isThread=true`; no current post-switch row | Keep separate from ordinary reply until live-confirmed |
| `@mention` | `LIVE_CONFIRMED` for bot mention | Prior live payload contained `mentions[].at`, `len`, `user_id`, and bot-command metadata | Normalize mention ranges and target IDs; test another-member mention separately |
| Message edit | `DB_CONFIRMED` | Current `type=0`, `origin=SYNCMODMSG` row exposed `logId`, `feedType`, `hidden`, `targetRevision` field names | Correlate by target log ID; live edited-content behavior still required |
| Message delete | `DB_CONFIRMED` | Pre-switch history contained `type=0`, `origin=SYNCDLMSG` with target-log metadata | Keep raw-delete mapping until a post-switch live test passes |
| Rewrite sync | `DB_CONFIRMED` | Pre-switch history contained `type=0`, `origin=SYNCREWR` | Preserve as raw rewrite until dedicated live correlation |
| Member join | `UPSTREAM_CONFIRMED` + `DB_CONFIRMED` | Pre-switch rows contained `type=0`, `origin=NEWMEM`; upstream event is `new_member` | Normalize as membership join |
| Member leave | `UPSTREAM_CONFIRMED` + `DB_CONFIRMED` | Pre-switch rows contained `type=0`, `origin=DELMEM`; upstream event is `del_member` | Normalize as generic departure |
| Member kick | `UNVERIFIED` | No separate high-level event; may share `DELMEM` | Compare voluntary leave and kick payloads before classification |
| Nickname/profile change | `NOT_DIRECT` | State is stored in profile/member tables and Iris name cache; no guaranteed new log row | Use a separate snapshot-diff adapter if required |
| Room rename | `NOT_DIRECT` or `UNVERIFIED` | Relevant state can live outside `chat_logs`; no dedicated confirmed origin | Poll room state or confirm a system-feed row |
| Reaction/like | `NOT_DIRECT` or `UNVERIFIED` | Separate reaction tables exist; no confirmed forwarded origin | Inspect the reaction table and run a dedicated test |
| Read state | `NOT_DIRECT` | Read-state changes do not require a new `chat_logs` row | Requires a separate observer |
| Single image | `LIVE_CONFIRMED` | `type=2`; attachment field names include URL, thumbnail, dimensions, size, MIME/media and expiry metadata | Treat URLs as transient; enforce host, MIME, timeout, and byte limits |
| Multiple images | `UPSTREAM_CONFIRMED` + `DB_CONFIRMED` | Pre-switch `type=27`; upstream parser expects `imageUrls` | Keep disabled until a live payload test confirms all URLs and limits |
| Emoticon/sticker | `DB_CONFIRMED` | Current `type=12`; attachment keys include `path`, `kid`, `alt`, `name`, `emoticonItemPath` | Keep as candidate until a live event is isolated |
| File | `DB_CONFIRMED` | Pre-switch `type=20`; no current post-switch row | Keep disabled until filename, size, URL, expiry, and MIME are live-confirmed |
| Opaque media type `3` | `UNVERIFIED` | Current attachment exposes abbreviated media fields including URL, dimensions, duration-like and thumbnail-like keys | Do not assign production behavior |
| Opaque media type `71` | `UNVERIFIED` | Current attachment contains opaque `C`, `K`, `P` keys | Do not assign production behavior |
| Unknown type `72` | `DB_CONFIRMED` | Present in pre-switch history; exact semantics unknown | Route to `iris.unknown` |

## Message-Type Reference

| Type | Working classification | Status basis |
| ---: | --- | --- |
| `0` | Raw/system event container; classify by origin and decoded message shape | DB/upstream evidence |
| `1` | Text/standard message family | Live evidence |
| `2` | Single image | Live evidence |
| `3` | Opaque media candidate | Current DB field-name evidence only |
| `12` | Emoticon/sticker candidate | Current DB field-name evidence only |
| `20` | File candidate | Historical DB evidence only |
| `26` | Reply | Live evidence |
| `27` | Multiple-image candidate | Historical DB + upstream evidence |
| `71` | Opaque media/gift-style candidate | Current DB field-name evidence only |
| `72` | Unknown | Historical DB evidence only |

## Current Post-Switch Snapshot

KakaoTalk application data was reset for an account switch on 2026-08-04. The new database contained 124 `chat_logs` rows at validation time.

| Type/origin | Rows | Observer treatment |
| --- | ---: | --- |
| `1 / MSG` | 68 | Forwarded |
| `1 / MCHATLOGS` | 25 | Suppressed |
| `1 / WRITE` | 13 | Forwarded |
| `2 / MSG` | 3 | Forwarded |
| `26 / MSG` | 3 | Forwarded |
| `0 / MCHATLOGS` | 2 | Suppressed |
| `2 / MCHATLOGS` | 2 | Suppressed |
| `3 / MCHATLOGS` | 2 | Suppressed |
| `26 / MCHATLOGS` | 2 | Suppressed |
| `0 / SYNCMODMSG` | 1 | Forwarded as raw/unknown upstream |
| `12 / MSG` | 1 | Forwarded |
| `71 / MSG` | 1 | Forwarded as unknown upstream |
| `71 / MCHATLOGS` | 1 | Suppressed |

Direction from parsed `v.isMine`:

| Origin/direction | Rows |
| --- | ---: |
| `MSG / incoming` | 76 |
| `WRITE / outgoing` | 13 |
| `MCHATLOGS / incoming` | 29 |
| `MCHATLOGS / outgoing` | 5 |
| `SYNCMODMSG / incoming` | 1 |

## Historical Pre-Switch Evidence

The prior account database supplied broader event coverage before application-data reset:

- latest 10,000-row sample: `NEWMEM` 45, `DELMEM` 42, `SYNCMODMSG` 15, `SYNCDLMSG` 7, `SYNCREWR` 2;
- live server evidence: plain text, exact `/ping`, reply, bot mention, single image, and outgoing pong;
- historical type coverage: `20`, `27`, `72`, `16385`, and `16386` in addition to current types.

Historical evidence remains useful for capability planning but is not presented as the current account's row count.

## Sender Identity and Name-Cache Limitation

- The server now queries the room-scoped KakaoTalk identity row for exact `/ping`. It prioritizes one `db2.open_chat_member.nickname` row, then one `db2.friends.name` row when that table exists, and falls back to the Iris `sender` when neither is available.
- Iris keeps a separate display-name cache at `/data/local/tmp/names.db`; clearing KakaoTalk application data does not clear it.
- After the account switch, the same message `user_id` was initially emitted with a previous-account display label and later emitted with the current display label after notification polling refreshed the cache.
- The cache schema is `names(sender_id TEXT PRIMARY KEY, sender_name TEXT, room_name TEXT)`. Iris computes `sender_id` as SHA-256 of `person_${chatId}:${userId}` and uses this row only when direct Kakao DB name resolution is empty.
- For open chat, Iris directly reads `db2.open_chat_member.nickname` by `user_id`. A live random-profile test showed that this nickname, the stale cache label, and the intended system name can all differ; the profile also had a separate `profile_link_id`.
- A live `/info` in the designated test room confirmed `chat_rooms.type=MultiChat`, `link_id=null`, zero matching `open_chat_member` rows, and no `db2.friends` table. In that room KakaoTalk DB has no participant-name row, so Iris `sender` is the only available display-name fallback.
- Non-production exact `/info` prints all received Iris fields and related KakaoTalk rows in chunks. Large integers embedded in JSON are displayed string-safe; this diagnostic is disabled in production because it exposes operational identity and room metadata.
- Therefore server identity must use stable provider IDs with room context, normally `(chat_id, user_id)`.
- `sender` is replaceable display metadata and must never be the sole user key.
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
