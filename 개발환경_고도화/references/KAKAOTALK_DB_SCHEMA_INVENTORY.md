# KakaoTalk DB Schema Inventory

Snapshot date: 2026-08-04

This document records a read-only metadata inventory from the current redroid KakaoTalk databases exposed through Iris `/query`. It intentionally excludes message bodies, room names, nicknames, phone numbers, URLs, account identifiers, chat IDs, user IDs, profile values, authentication values, and database file paths.

KakaoTalk application data was reset for an account switch on 2026-08-04. The current counts therefore describe the new post-switch database and supersede the previous-account row counts. Counts are point-in-time observations, not stable limits.

## Access Model

```text
hoiBot Server host
-> Iris HTTP POST /query
-> attached redroid KakaoTalk SQLite databases
```

Iris exposes an empty in-memory `main` database plus three attached databases named `db1`, `db2`, and `db3`. The attached file paths are deliberately not recorded.

## Database Roles

| Database | Working role | Main contents |
| --- | --- | --- |
| `db1` | Core chat data | Message logs, rooms, threads, sending state, room metadata |
| `db2` | Feature and open-chat data | Open-chat members/profiles/links, URL previews, emoticons, reactions, files, calls |
| `db3` | Profile extensions | Multi-profile definitions and user-to-profile assignments |

## Current Table Counts

### `db1` Core Chat Tables

| Table | Rows | Data categories |
| --- | ---: | --- |
| `chat_logs` | 124 | Message/event rows and correlation metadata |
| `chat_rooms` | 5 | Room membership and latest-message state |
| `room_master_table` | 1 | Schema/version metadata |
| `android_metadata` | 1 | Android database locale metadata |
| `chat_threads` | 0 | Thread state |
| `chat_sending_logs` | 0 | Pending/sending state |
| `warehouse_info` | 0 | Warehouse/chat-space state |
| `public_key_info` | 0 | Public-key metadata |
| `secret_key_info` | 0 | Secret-key metadata |

### `db2` Feature and Open-Chat Tables

| Table | Rows | Data categories |
| --- | ---: | --- |
| `emoticon_keyword_dictionary` | 4,214 | Emoticon keyword dictionary |
| `item_resource` | 310 | Emoticon/item resource metadata |
| `recommended_friends` | 8 | Sensitive identity/profile metadata |
| `item` | 6 | Emoticon/item metadata |
| `url_log` | 3 | URL-preview metadata |
| `geo_location_log` | 1 | Location-message metadata |
| `open_chat_member` | 1 | Open-chat member/profile state |
| `open_link` | 1 | Open-chat link state |
| `room_master_table` | 1 | Schema/version metadata |
| `android_metadata` | 1 | Android database locale metadata |

All other currently discovered `db2` tables were empty in this snapshot. An empty table does not prove that its feature is unsupported.

### `db3` Profile-Extension Tables

| Table | Rows | Data categories |
| --- | ---: | --- |
| `multi_profiles` | 1 | Multi-profile metadata |
| `room_master_table` | 1 | Schema/version metadata |
| `android_metadata` | 1 | Android database locale metadata |
| `multi_profile_designated` | 0 | User-to-profile assignments |
| `ddays` | 0 | D-day metadata |

## `db1.chat_logs` Column Metadata

Identifiers and timestamps can exceed assumptions made by JavaScript `number`. The server must preserve provider identifiers as strings at the adapter boundary.

| Column | SQLite type | Metadata role | Server handling |
| --- | --- | --- | --- |
| `_id` | `INTEGER` primary key | Local SQLite row/cursor ID | Use only as a local ingestion cursor; it resets when KakaoTalk data is reset |
| `id` | `INTEGER NOT NULL` | Provider message/log ID | Preserve as a decimal string; primary message correlation candidate |
| `type` | `INTEGER` | Kakao message/event type code | Combine with parsed `v.origin`; never classify by `type` alone |
| `chat_id` | `INTEGER NOT NULL` | Room/conversation identifier | Preserve as a string; sensitive; use as room-scoped identity context |
| `thread_id` | `INTEGER` | Thread identifier when present | Nullable; preserve as a string and correlate only after live validation |
| `scope` | `INTEGER` | Kakao delivery/scope metadata | Preserve raw; semantics remain unverified |
| `user_id` | `INTEGER` | Sender/provider user identifier | Preserve as a string; do not use `sender` display text as identity |
| `message` | `TEXT` | Encrypted-at-rest message or system-event JSON | Use Iris-decrypted output; parse as JSON only for event shapes known to contain JSON |
| `attachment` | `TEXT` | Encrypted-at-rest type-specific JSON | Parse once after Iris decryption; validate by message type |
| `created_at` | `INTEGER` | Provider creation timestamp | Preserve raw and normalize in a separate timestamp adapter |
| `deleted_at` | `INTEGER` | Deletion timestamp/state candidate | Nullable/zero-aware; do not use as the sole deletion-event signal |
| `client_message_id` | `INTEGER` | Client-side send correlation ID | Preserve as a string; candidate for outgoing send correlation |
| `prev_id` | `INTEGER` | Previous-log chain reference | Preserve as a string; optional ordering/correlation hint |
| `referer` | `INTEGER` | Referenced-log pointer candidate | Preserve as a string; current snapshot has two nonzero rows |
| `supplement` | `TEXT` | Optional type/thread extension JSON | Parse only when non-empty; absent in the current snapshot |
| `v` | `TEXT` | JSON transport metadata | Parse once and retain only approved normalized fields |

### Current Field Presence

| Field condition | Rows |
| --- | ---: |
| Total rows | 124 |
| Non-empty `message` | 123 |
| Non-empty `attachment` | 81 |
| Nonzero `referer` | 2 |
| Nonzero `deleted_at` | 1 |
| Non-null `thread_id` | 0 |
| Non-empty `supplement` | 0 |

Absence in this small post-switch snapshot does not mean a field is unsupported.

## Raw-to-Adapter Serialization Rules

The Iris HTTP/WebSocket payload wraps one `chat_logs` row as follows:

```text
top-level msg     -> decrypted message text
top-level room    -> mutable display label
top-level sender  -> mutable display label from Iris name resolution
top-level json    -> chat_logs row
```

In the raw Iris payload:

- identifiers, timestamps, and type codes may arrive as decimal strings;
- `json.v`, `json.attachment`, and `json.supplement` are JSON-encoded strings when present;
- `json.message` can itself contain JSON for raw/system events;
- parsing failure must leave the field as unclassified raw metadata rather than crashing ingestion;
- message bodies and identity values must not be written to diagnostic/reference documents.

The adapter notation `json.v.origin` means “parse `json.v` once, then read `origin`.” It is not guaranteed to be a directly nested property in the raw HTTP body.

## Current `type` and `origin` Metadata

### Message-Type Counts

| Type | Rows | Current working classification |
| ---: | ---: | --- |
| `1` | 106 | Text/standard message family |
| `26` | 5 | Reply family |
| `2` | 5 | Single-image family |
| `0` | 3 | Raw/system event container |
| `71` | 2 | Opaque media/gift-style candidate |
| `3` | 2 | Opaque media candidate; exact type unverified |
| `12` | 1 | Emoticon/sticker candidate |

### Origin Counts

| Parsed `v.origin` | Rows | Observer behavior |
| --- | ---: | --- |
| `MSG` | 76 | Forwarded standard incoming event flow |
| `MCHATLOGS` | 34 | Historical/multi-chat-log flow suppressed by the current Iris observer |
| `WRITE` | 13 | Forwarded local/outgoing flow |
| `SYNCMODMSG` | 1 | Forwarded raw modification-sync event |

### Direction Counts

| Origin/direction | Rows |
| --- | ---: |
| `MSG / incoming` | 76 |
| `WRITE / outgoing` | 13 |
| `MCHATLOGS / incoming` | 29 |
| `MCHATLOGS / outgoing` | 5 |
| `SYNCMODMSG / incoming` | 1 |

Direction is derived from parsed `v.isMine`, not from sender-name comparison.

## Parsed Metadata Keys Observed After Iris Decryption

Only field names are recorded below. Values, message bodies, URLs, and identifiers are excluded.

| Type | Observed attachment keys | Working use |
| ---: | --- | --- |
| `1` | `urls`, `f` | URL/extra metadata candidates; dedicated validation required |
| `2` | `url`, `thumbnailUrl`, `w`, `h`, `s`, `mt`, `expire`, `thumbnailWidth`, `thumbnailHeight`, `cs`, `k`, optional `f` | Single-image metadata |
| `3` | `url`, `urlh`, `w`, `h`, `s`, `cs`, `csh`, `d`, `dh`, `hh`, `sh`, `wh`, `tk`, `tkh`, `expire` | Opaque media metadata; do not assign production behavior yet |
| `12` | `path`, `kid`, `alt`, `name`, `emoticonItemPath` | Emoticon/sticker metadata candidate |
| `26` | `src_logId`, `src_userId`, `src_type`, `src_message`, optional `src_linkId`, `src_spoilers` | Reply-source correlation |
| `71` | `C`, `K`, `P` | Opaque nested metadata; exact meaning unverified |

Parsed `v` keys observed in the current snapshot were `origin`, `isMine`, `enc`, `c`, `modifyRevision`, `notDecoded`, `isSingleDefaultEmoticon`, `defaultEmoticonsCount`, optional local-thumbnail fields, and optional `modifyLog`.

For the current `type=0 / SYNCMODMSG` row, the decrypted JSON message exposed only the field names `logId`, `feedType`, `hidden`, and `targetRevision`. This remains database-confirmed rather than live-confirmed.

## Identity and Display-Name Metadata

- Stable server identity must use provider identifiers with room context, normally `(chat_id, user_id)`.
- Top-level `sender` is mutable display metadata supplied by Iris.
- Iris keeps a separate name cache outside KakaoTalk application data. After an account switch, cached display names can temporarily disagree with the current account's labels.
- Persist the latest display label as replaceable metadata; never merge users solely by nickname.
- Open-chat identities may require link/profile context in addition to room and user IDs; this remains subject to dedicated live tests.

## Room-Type Counts

| Room type | Rows |
| --- | ---: |
| `PlusChat` | 2 |
| `OM` | 1 |
| `MultiChat` | 1 |
| `DirectChat` | 1 |

Exact semantics for abbreviated room types require upstream-code or live validation before normalization.

## Server-Relevant Conclusions

1. Normalize new events from `db1.chat_logs` using the pair `type + parsed v.origin`.
2. Parse identifiers as strings and keep local `_id` separate from provider `id`.
3. Parse `v`, `attachment`, `supplement`, and system-event `message` defensively and only once.
4. Treat `MCHATLOGS` and `SYNCMSG` as observer-suppressed origins unless the Iris implementation changes.
5. Treat `sender` and `room` as mutable display labels, not identifiers.
6. Use `chat_rooms` and selected `db2`/`db3` tables only for enrichment or separate snapshot-diff observers.
7. Reaction, nickname/profile, and read-state changes are not guaranteed to create a new `chat_logs` row.
8. The current validation proves read-only query connectivity through Iris; it does not make KakaoTalk DB the hoiBot Server database.

## Validation Method

Only read-only operations were used:

- `PRAGMA database_list`
- `PRAGMA <db>.table_info(<table>)`
- `sqlite_master` table listing
- `SELECT COUNT(*)`
- grouped counts by `type`, parsed `v.origin`, and parsed `v.isMine`
- field-presence aggregates
- Iris-decrypted result parsing that retained field names only

No `INSERT`, `UPDATE`, `DELETE`, schema change, database-file operation, message-body export, or identity-value export was performed.
