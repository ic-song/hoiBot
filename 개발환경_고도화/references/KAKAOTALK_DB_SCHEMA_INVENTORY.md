# KakaoTalk DB Schema Inventory

Snapshot date: 2026-08-03

This document records a read-only schema and row-count inventory from the current redroid KakaoTalk databases exposed through Iris `/query`. It intentionally excludes message bodies, room names, nicknames, phone numbers, URLs, account identifiers, chat IDs, user IDs, profile values, and database file paths.

Counts are a point-in-time observation and will change as KakaoTalk runs. Table purposes below are inferred from table and column names unless separately live-validated.

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
| `db1` | Core chat data | Message logs, rooms, threads, sending state, room/warehouse metadata |
| `db2` | Feature and open-chat data | Open-chat members/profiles/links, URL previews, emoticons, reactions, files, calls, media alarms, recommendations |
| `db3` | Profile extensions | Multi-profile definitions and user-to-profile assignments, D-day data |

## `db1` Core Chat Tables

| Table | Rows | Data categories |
| --- | ---: | --- |
| `chat_logs` | 92,110 | Message type, room/user references, encrypted message and attachment payloads, timestamps, deletion/reference/thread metadata, raw `v` metadata |
| `chat_rooms` | 142 | Room type, member references, last-message state, unread/read state, room metadata, open-link and moderation-related state |
| `chat_threads` | 1,101 | Thread identifiers, last/read/display log references, mention/new flags, participation and alarm state |
| `chat_sending_logs` | 0 | Pending or sending message state; empty in this snapshot |
| `warehouse_info` | 4 | Warehouse/chat-space metadata, permissions, staff/restrictions, backup state |
| `public_key_info` | 0 | Public-key metadata; empty |
| `secret_key_info` | 0 | Secret-key metadata; empty |
| `room_master_table` | 1 | Room database schema/version metadata |
| `android_metadata` | 1 | Android database locale metadata |

### `chat_logs` Key Columns

`_id`, `id`, `type`, `chat_id`, `thread_id`, `scope`, `user_id`, `message`, `attachment`, `created_at`, `deleted_at`, `client_message_id`, `prev_id`, `referer`, `supplement`, `v`.

### Observed Message-Type Counts

| Type | Rows | Current working interpretation |
| ---: | ---: | --- |
| `1` | 87,979 | Text/standard message family |
| `0` | 1,487 | System/raw event container |
| `2` | 801 | Single image |
| `71` | 473 | Media/gift-style candidate |
| `26` | 426 | Reply |
| `12` | 349 | Emoticon/sticker candidate |
| `20` | 276 | File candidate |
| `16385` | 103 | Unclassified; dedicated validation required |
| `27` | 87 | Multiple-image candidate |
| `72` | 32 | Unclassified media/message candidate |
| `16386` | 29 | Unclassified; dedicated validation required |

Other low-frequency types are present and must not be assigned production behavior without live validation.

### Observed Origin Counts

| Origin | Rows | Current working interpretation |
| --- | ---: | --- |
| `MSG` | 56,839 | Standard message |
| `MCHATLOGS` | 34,325 | Iris-suppressed historical/multi-chat-log flow |
| `DELMEM` | 383 | Member departure |
| `NEWMEM` | 377 | Member join |
| `SYNCDLMSG` | 72 | Message deletion sync |
| `SYNCMODMSG` | 57 | Message edit sync |
| `WRITE` | 35 | Local/write flow |
| `CHATINFO` | 15 | Chat information event candidate |
| `SYNCREWR` | 5 | Rewrite sync |
| `SYNCMSG` | 5 | Iris-suppressed sync flow |
| `POST` | 5 | Post event candidate |
| `FEED` | 1 | Feed event candidate |

### Room-Type Counts

| Room type | Rows |
| --- | ---: |
| `OD` | 57 |
| `MultiChat` | 26 |
| `OM` | 24 |
| `PlusChat` | 21 |
| `DirectChat` | 13 |
| `MemoChat` | 1 |

Exact semantics for abbreviated room types require upstream-code or live validation before server normalization.

## `db2` Feature and Open-Chat Tables

### Non-empty Tables

| Table | Rows | Data categories |
| --- | ---: | --- |
| `open_chat_member` | 1,464 | Open-chat member/profile types, encrypted nickname/profile URLs, privileges and room/link references |
| `item_resource` | 629 | Emoticon/item resource metadata |
| `url_log` | 646 | Link-preview metadata, room/user references, timestamps and suspected-link state |
| `emoticon_keyword_dictionary` | 4,214 | Emoticon keyword dictionary |
| `recommended_friends` | 80 | Recommended-contact metadata; contains sensitive identity/profile fields |
| `chat_log_meta` | 36 | Extra metadata associated with a chat log and link |
| `open_link` | 29 | Open-chat link name/URL/image, limits, activation/search state and metadata |
| `item` | 26 | Emoticon/item category and encrypted metadata |
| `open_profile` | 11 | Open-profile type, encrypted nickname/profile URLs and privileges |
| `favorite_emoticons` | 7 | Favorite emoticon references |
| `call_log` | 2 | Call type, direction and time summary |
| `friend_tab_post_viewable_event` | 1 | Friend-tab post visibility event state |
| `room_master_table` | 1 | Feature database schema/version metadata |
| `android_metadata` | 1 | Android database locale metadata |

### Empty Tables in This Snapshot

`chat_log_bookmarks`, `emoticon_instant_keyword`, `emoticon_tag_dictionary`, `expiring_media_alarm_log_chat_log_mapper`, `expiring_media_alarm_logs`, `file_path`, `geo_location_log`, `inapp_browser_url`, `music_history`, `music_playlist`, `music_recent_playlist`, `openchat_bot_command`, `plusfriend_add_info`, `recent_sent_file`, `recently_emoticons`, `recently_reactions`, `s2_events`, and `tch_chat_log_meta`.

An empty table means no current rows, not that the feature is unsupported.

## `db3` Profile-Extension Tables

| Table | Rows | Data categories |
| --- | ---: | --- |
| `multi_profile_designated` | 14 | User-to-multi-profile assignment references |
| `multi_profiles` | 3 | Multi-profile nickname, images, status, music and primary-profile state |
| `ddays` | 0 | D-day data; empty |
| `room_master_table` | 1 | Profile database schema/version metadata |
| `android_metadata` | 1 | Android database locale metadata |

## Server-Relevant Conclusions

1. Message/event normalization should primarily read `db1.chat_logs` and use `type`, `v.origin`, attachment metadata, references, and thread fields.
2. Room/member enrichment should use `db1.chat_rooms` and selected `db2` open-chat tables, without treating names as stable identifiers.
3. Nickname/profile changes are not guaranteed to create `chat_logs` rows; a separate snapshot-diff observer may be required for `open_chat_member`, `open_profile`, or multi-profile tables.
4. Reaction, file, media-expiry, call, URL-preview, and bookmark features have separate tables, but Iris currently forwards new `chat_logs` rows rather than changes to every table.
5. Sensitive columns must not be copied into diagnostic logs or reference documents. The server should use minimum required fields and redact identifiers.
6. The current validation proves read-only query connectivity through Iris. It does not establish a persistent PC-side hoiBot database connection.

## Validation Queries

Only read-only statements were used:

- `PRAGMA database_list`
- attached `sqlite_master` table listing
- `PRAGMA <db>.table_info(<table>)`
- `SELECT COUNT(*)`
- grouped counts by message type, raw origin, room type, and open-chat member type

No `INSERT`, `UPDATE`, `DELETE`, schema change, or database-file operation was performed.
