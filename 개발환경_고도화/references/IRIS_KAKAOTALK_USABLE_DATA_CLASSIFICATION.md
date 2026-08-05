# Iris and KakaoTalk Usable Data Classification

Updated: 2026-08-05

## Purpose

This document separates data that is merely observable from data that the hoiBot Server may safely use. It is based on the current redroid + KakaoTalk + Iris live environment and the non-production `/info` diagnostic.

No real message body, name, room ID, user ID, profile URL, or authentication value is stored here.

## Trust Classes

| Class | Meaning | Allowed server use |
| --- | --- | --- |
| `IDENTITY_KEY` | Stable provider identifier candidate | Identity lookup, deduplication, membership context; never display-name matching alone |
| `EVENT_SIGNAL` | Confirmed event classification or direction input | Command dispatch, loop prevention, event routing |
| `CORRELATION` | Ordering or reference metadata | Reply/edit/delete correlation after event-specific validation |
| `DISPLAY_ONLY` | Mutable human-readable metadata | Replies and UI only; never account merge, login, role, or ownership decisions |
| `ENRICHMENT` | Current DB state available only in some room types | Optional display enrichment with explicit fallback |
| `DIAGNOSTIC_ONLY` | Observable but unverified, encrypted, oversized, or privacy-sensitive | Non-production diagnostics; do not persist by default |
| `UNAVAILABLE` | Not present or not queryable in the current environment | Must not be assumed or used |

## Iris HTTP Event Data

| Field | Class | Current availability | Approved use | Limits |
| --- | --- | --- | --- | --- |
| `json.id` | `IDENTITY_KEY` | Live confirmed | Provider event deduplication and correlation | Preserve as a string; local DB reset does not define its lifecycle |
| `json.chat_id` | `IDENTITY_KEY` | Live confirmed | Destination room, membership scope, room-specific identity context | Sensitive external ID; preserve as a string |
| `json.user_id` | `IDENTITY_KEY` | Live confirmed | Kakao external identity lookup candidate | Never replace with `sender`; random/open profiles still require room/link evidence |
| top-level `msg` | `EVENT_SIGNAL` | Live confirmed | Exact command matching and message processing | Message content; do not retain in reference docs or broad logs |
| `json.type` | `EVENT_SIGNAL` | Live confirmed | First event-family discriminator | Never classify by type alone |
| parsed `json.v.origin` | `EVENT_SIGNAL` | Live confirmed | Distinguish `MSG`, `WRITE`, sync/system origins | Parse the JSON string once; unknown values remain unclassified |
| parsed `json.v.isMine` | `EVENT_SIGNAL` | Live confirmed | Incoming/outgoing direction and response-loop prevention | Do not infer direction from names |
| top-level `sender` | `DISPLAY_ONLY` | Live confirmed | Fallback reply label and operator diagnostics | Mutable; can be stale or cache-derived; never authentication or ownership evidence |
| top-level `room` | `DISPLAY_ONLY` | Live confirmed | Operator-readable room label | Mutable; use `chat_id` for routing |
| `json.created_at` | `CORRELATION` | Live confirmed | Provider-time ordering after timestamp adapter validation | Preserve raw; timezone/unit assumptions require validation |
| `json.prev_id` | `CORRELATION` | Live confirmed | Previous-log chain hint | Not a standalone event identity |
| `json.referer` | `CORRELATION` | Live observed | Reply/reference candidate | Confirm semantics by event type before use |
| `json.client_message_id` | `CORRELATION` | Live confirmed | Outgoing-send correlation candidate | Do not treat as globally unique without validation |
| `json.attachment` | Event-specific | Live confirmed | Reply, mention, image and other type-specific adapters | Parse once and validate keys against `type + origin`; URLs are transient |
| `json.deleted_at` | `DIAGNOSTIC_ONLY` | Live observed | Investigation only | Not sufficient to classify a deletion |
| `json.scope` | `DIAGNOSTIC_ONLY` | Live observed | Preserve for future analysis | Semantics unverified |
| `json.thread_id` | `DIAGNOSTIC_ONLY` | Usually null | Future thread correlation | No dedicated live contract yet |
| `json.supplement` | `DIAGNOSTIC_ONLY` | Usually null | Future type-specific analysis | Parse only when non-empty |

## KakaoTalk Database Data Through Iris `/query`

| Source | Class | Current availability | Approved use | Limits |
| --- | --- | --- | --- | --- |
| `chat_logs` matching `id + chat_id` | Event data / `CORRELATION` | Live confirmed | Compare Iris payload with the source row and inspect event metadata | Read-only; message content is diagnostic-sensitive |
| `chat_rooms.id` | `IDENTITY_KEY` | Live confirmed | Confirm the room row corresponding to `chat_id` | Preserve as a string |
| `chat_rooms.type` | `EVENT_SIGNAL` | Live confirmed | Distinguish `MultiChat`, open/direct room handling branches | Exact abbreviated types still need per-type evidence |
| `chat_rooms.link_id` | `CORRELATION` | Live confirmed | Connect an open room to `open_chat_member` and `open_link` | `null` in the confirmed `MultiChat` test room |
| `chat_rooms.members` / `active_member_ids` | `DIAGNOSTIC_ONLY` | Live confirmed | Membership investigation and future snapshot-diff design | Contains IDs but no trustworthy nickname mapping; do not use as an authorization list yet |
| `chat_rooms.unread_count`, watermarks and last-log fields | `DIAGNOSTIC_ONLY` | Live confirmed | Read-state and ordering research | Large integers must remain string-safe; semantics are not fully validated |
| `chat_rooms.last_message` and encrypted/private metadata | `DIAGNOSTIC_ONLY` | Live observed | None in domain logic | Can be encrypted or contain sensitive room/profile metadata |
| `db2.open_chat_member.nickname` scoped by room link and `user_id` | `ENRICHMENT` / `DISPLAY_ONLY` | Live confirmed in an open room | Preferred `/ping` display label when exactly one room-scoped row exists | Open chat only; nickname is mutable and not an account key |
| `db2.open_chat_member.link_id` | `CORRELATION` | Live confirmed in an open room | Prove that the member row belongs to the current open room | Must match `chat_rooms.link_id` |
| `db2.open_chat_member.profile_link_id` | `DIAGNOSTIC_ONLY` | Live observed | Random/open-profile investigation | Meaning and stability are not sufficient for account identity yet |
| `db2.friends.name` | `ENRICHMENT` / `DISPLAY_ONLY` | `UNAVAILABLE` in the current DB | Fallback display label only when the table exists and exactly one row matches | Iris upstream checks table existence; current account DB has no `friends` table |
| `db2.open_link` | `ENRICHMENT` | Available only when the room has `link_id` | Open-room display metadata | Zero rows for the confirmed `MultiChat` room |
| `db2.recommended_friends` and other profile-like tables | `DIAGNOSTIC_ONLY` | Table-dependent | None in identity or authorization | Not used by Iris name resolution and may be stale or unrelated |

## Iris Name Cache

| Source | Class | Availability to hoiBot Server | Approved use | Limits |
| --- | --- | --- | --- | --- |
| `/data/local/tmp/names.db` | `DISPLAY_ONLY` | Not available through Iris `/query` | Iris may use it internally to produce top-level `sender` when direct DB name lookup is empty | Separate from KakaoTalk DB; can survive app-data reset and become stale |
| `names.sender_name` | `DISPLAY_ONLY` | Indirectly visible as Iris `sender` | Last-resort reply label | Never an identity key or authentication proof |

## Server Decision Rules

1. Event deduplication uses the string-safe Iris provider event ID. A payload hash is only the fallback when no provider event ID exists.
2. Room routing uses `chat_id`, never the mutable room label.
3. Kakao identity lookup uses stable external IDs and stored approval state. A nickname alone never creates, merges, authorizes, or owns an account.
4. Event classification uses `type + parsed v.origin`; direction uses parsed `v.isMine`.
5. `/ping` display-name selection is:
   1. exactly one room-scoped `open_chat_member.nickname`;
   2. exactly one `friends.name` row when the table exists;
   3. Iris `sender` fallback.
6. A `MultiChat` room with `link_id=null`, no `friends` table, and no open-member row has no directly queryable KakaoTalk nickname. The server must use Iris `sender` for display and must not claim that it is DB-verified.
7. Verification codes and external provider IDs are authentication evidence. Display-name equality is a separate business rule and must report when the current room cannot provide a DB-verified name.
8. `/info` is a non-production diagnostic only. It must not become a public profile or administrator API response.

## Current Gaps

- No authoritative nickname row is queryable for participants in the confirmed `MultiChat` room.
- Iris `/query` cannot read its separate `names.db` cache.
- Nickname/profile changes do not guarantee a new `chat_logs` event.
- Voluntary leave versus kick, generic participant mention, reaction, file, and multi-image contracts still need dedicated live tests.
- `profile_link_id`, watermarks, `scope`, `thread_id`, and several room metadata values remain diagnostic-only.
