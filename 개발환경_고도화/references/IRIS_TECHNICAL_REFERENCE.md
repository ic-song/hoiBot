# Iris Technical Reference

Updated: 2026-08-06

This is the canonical project reference for Iris runtime behavior, interfaces, trust boundaries, connectivity, and extension feasibility. Event-by-event live evidence remains in `IRIS_EVENT_CAPABILITY_MATRIX.md`; KakaoTalk table inventory remains in `KAKAOTALK_IRIS_QUERY_ERD.md`; executable diagnosis procedures remain in the `hoibot-iris-diagnostics` skill.

It does not override `../DECISIONS.md` or `../MEMORY.md`.

## Selected runtime

```text
Windows -> Hyper-V Ubuntu/Linux -> Docker -> redroid
redroid -> KakaoTalk + Iris v0.32
Iris HTTP/WS -> hoiBot Server (TypeScript + Node.js 24 + Fastify 5)
hoiBot Server -> MariaDB
```

Verified local endpoints use Iris port `3000` on redroid and hoiBot API port `3002` on the PC. KakaoTalk application-data replacement requires an Iris process restart so Iris reopens the current database files.

## Responsibilities

- KakaoTalk writes its own redroid-local databases independently of Iris.
- Iris reads new KakaoTalk rows, decrypts supported fields, forwards events, executes read-only queries, and sends replies.
- hoiBot Server normalizes and deduplicates events, applies identity and channel policy, runs application services, persists hoiBot state, and creates replies/outbox records.
- MariaDB is the hoiBot game and operation database. KakaoTalk SQLite is never used as hoiBot domain storage.

## Official interfaces

| Interface | Purpose |
| --- | --- |
| `POST /reply` | Send a KakaoTalk reply |
| `POST /query` | Execute a parameterized query against attached KakaoTalk databases |
| `POST /decrypt` | Decrypt supported ciphertext using `enc`, ciphertext, and `user_id` |
| `GET /config` | Read Iris configuration |
| `/config/endpoint` | Configure the outbound event endpoint |
| `/config/dbrate` | Configure database polling interval |
| `/config/sendrate` | Configure minimum send interval |
| `/config/botport` | Configure Iris HTTP port |
| `GET /ws` | Receive events over WebSocket |

All provider IDs are handled as strings. JavaScript JSON number parsing is not allowed for 64-bit KakaoTalk IDs.

## Observer model

The verified Iris `v0.32` build polls `db1.chat_logs` by increasing `_id`; it does not use a SQLite trigger or Android `ContentObserver`. The current configured interval is `100 ms`. The first poll establishes a baseline, and later rows are decrypted and emitted. Some origins are deliberately skipped by upstream Iris.

Iris attaches `KakaoTalk.db`, `KakaoTalk2.db`, and `multi_profile_database.db` as `db1`, `db2`, and `db3`. `/query` can read these databases, but it cannot read Iris's separate `/data/local/tmp/names.db` cache.

## Approved data use

| Data | Trust/use | Prohibited interpretation |
| --- | --- | --- |
| `json.id` | Provider event key and correlation; string-safe | Numeric conversion |
| `json.chat_id` | Channel routing and room-scoped query; string-safe | Mutable room name as routing key |
| `json.user_id` | Kakao external identity candidate; string-safe | Nickname-based account ownership |
| `json.type` + parsed `v.origin` | Event-family classification | Classification by `type` alone |
| parsed `v.isMine` | Direction and response-loop prevention | Direction inferred from names |
| `prev_id`, `referer`, event-specific `logId` | Correlation after event validation | Standalone identity proof |
| room-scoped `open_chat_member.nickname` | Mutable display enrichment | Authentication, authorization, or account merge |
| Iris top-level `sender` and `room` | Untrusted display diagnostics | Canonical name, identity, or routing authority |
| message/media content | Explicit command handling or short-lived diagnostics only | Broad operational persistence |

Current normal `MultiChat` participants have no queryable current nickname when `db2.friends` is absent and no room-scoped open-member row exists. In that case the server uses the linked system-account name or an unresolved label; it never promotes Iris `sender` to a trusted name.

## Confirmed connectivity

- redroid ADB, KakaoTalk process, Iris `/config`, dashboard, server readiness, live HTTP event delivery, exact `/ping`, and Iris `/reply` were verified.
- The requested `/ping` threshold was reached; future repeated checks stop at ten distinct provider event IDs.
- Incoming `/ping` to outgoing pong was observed, including `isMine=true` on the response event.
- After a KakaoTalk account switch, Iris remained reachable but event delivery resumed only after restarting Iris.
- Image auto-forwarding is currently OFF. Image events may be classified, but media is not forwarded to the monitoring room.
- DEC-052 does not re-enable KakaoTalk forwarding. It separately allows confirmed replies, images and animated stickers from designated operational rooms to be retained for seven days for authenticated administrator web viewing. Observation-only rooms and ordinary text remain content-free.

## Deletion and host-hide correlation

- A deletion creates a new `SYNCDLMSG` event. Its own event ID is not the original message ID; the target is read from the event payload and queried with the same `chat_id`.
- A deleted text row can remain as `type=16385`. Successful decryption requires the full Iris projection, including `id`, `chat_id`, `user_id`, `type`, `created_at`, `message`, and `v`.
- Host hide is confirmed as `SYNCREWR + feedType=26 + coverType=openchat_blind`.
- A hidden bot message can target an intermediate `type=0/origin=WRITE/feedType=13` row; one verified `prev_id` hop resolves the body row.
- A hidden incoming message can be rewritten in place to `type=0/origin=MSG/feedType=13`; the prior ciphertext and encryption type remain in `v.previous_message` and `v.previous_enc`, while the original message type comes from `chatLogInfos[0].type`.
- Recovered text is limited to the development monitor response and is not stored in hoiBot MariaDB. Current output is capped at 1,000 characters.
- The planned administrator incident view follows the same non-persistence boundary: authorized `super_admin` and `manager` users request a live redroid lookup, and the access audit stores only actor, incident, time, and result.

## Non-`chat_logs` extension feasibility

A custom Iris build can add a read-only snapshot-difference observer because the attached databases are already queryable. This is feasible only for state that actually exists in a local table.

| Candidate | Feasibility | Constraint |
| --- | --- | --- |
| Room membership arrays | High | Compare normalized sets; ignore ordinary room refresh fields |
| Room title/image metadata | High | Compare selected nested fields, not whole rows |
| Open-chat member nickname/profile | Conditional | Target room/profile must populate `open_chat_member` or `open_profile` |
| Own multi-profile assignment | High | Represents local-account state, not arbitrary participant identity |
| Normal group-chat nickname | Unavailable in current DB | No `friends` table and no alternative authoritative row |
| State absent from all attached tables | Impossible | No local evidence exists to observe |

Any custom observer must establish a silent baseline, query approved columns only, compare stable keys and normalized hashes, emit minimal typed events, never write KakaoTalk databases, and remain separately deployable from the official Iris artifact for rollback.

## Privacy and operational rules

- Do not persist tokens, AOT values, encryption keys, phone numbers, profile/media URLs, browser/location history, raw database rows, or unrelated message bodies.
- Nickname observations include source and trust status; `iris_cache/untrusted` never updates canonical identity.
- Activity aggregates store counts and timestamps, not message bodies.
- Moderation records store identifiers, type, status, and correlation metadata; recovered content is not stored.
- Parameterize `/query`; never concatenate external IDs or content into SQL.
- Do not claim profile change, read receipt, voluntary-leave versus kick, or reaction semantics until a controlled live test proves both the table/event mutation and correlation key.

## Sources

- <https://kbotdocs.dev/reference/iris>
- <https://github.com/dolidolih/Iris/releases/tag/v0.32>
- <https://github.com/dolidolih/Iris/blob/v0.32/app/src/main/java/party/qwer/iris/DBObserver.kt>
- <https://github.com/dolidolih/Iris/blob/v0.32/app/src/main/java/party/qwer/iris/ObserverHelper.kt>
- <https://github.com/dolidolih/Iris/blob/v0.32/app/src/main/java/party/qwer/iris/KakaoDB.kt>
