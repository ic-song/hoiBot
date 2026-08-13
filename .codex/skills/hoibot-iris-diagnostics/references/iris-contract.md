# Iris Diagnostic Contract

## Sources and Scope

Verified against the official KBotDocs Iris guide and the running hoiBot redroid/Iris environment on 2026-08-06.

- Iris overview: https://kbotdocs.dev/reference/iris
- `/query`: https://kbotdocs.dev/reference/iris/Endpoint/query
- `/decrypt`: https://kbotdocs.dev/reference/iris/Endpoint/decrypt
- `/reply`: https://kbotdocs.dev/reference/iris/Endpoint/reply
- `/config`: https://kbotdocs.dev/reference/iris/Endpoint/config
- `/ws`: https://kbotdocs.dev/reference/iris/Endpoint/ws

Keep official contracts separate from environment observations. Re-verify the running Iris version before relying on an observed response shape.

## Official Endpoint Contract

| Endpoint | Purpose | Critical rule |
| --- | --- | --- |
| `GET /config` | Read bot name, port, forward endpoint, polling/send rates, bot ID | Redact endpoint tokens and IDs in reports |
| `POST /query` | Execute KakaoTalk DB SQL with optional `bind` array | Use parameter binding; `message`/`attachment` require `user_id` and encryption context for automatic decryption |
| `POST /decrypt` | Decrypt one Base64 ciphertext | Body uses `enc`, `b64_ciphertext`, optional `user_id`; response contains `plain_text` |
| `POST /reply` | Send text or Base64 image data | Use the stable room ID, not the mutable room label |
| `/ws` | Stream detected messages | Payload includes decrypted `msg` plus raw `chat_logs` fields in `json` |

The official `/query` documentation shows a `QueryResult[]` response that can be nested. The current environment has also returned `{data: rows}`. Keep the response reader compatible with both and fail visibly on other shapes.

## ID Contract

All external identifiers are opaque strings:

- `chat_logs._id`: local polling cursor;
- `chat_logs.id`: provider event/message ID;
- `chat_logs.chat_id`: room ID;
- `chat_logs.user_id`: provider user ID;
- system `message.logId`: target message ID;
- `prev_id`: preceding or linked row, not automatically the target body.

Never use `Number`, arithmetic, or ordinary JSON parsing that converts 16+ digit integers. String-protect nested JSON integers before parsing.

## Baseline Read Query

Use the unique `(chat_id,id)` path and include enough row context:

```sql
SELECT _id, id, type, chat_id, user_id, message, attachment, v,
       thread_id, scope, created_at, deleted_at, prev_id, referer, supplement
FROM db1.chat_logs
WHERE chat_id = ? AND id = ?
LIMIT 2;
```

Do not modify KakaoTalk indexes or schema. The current DB already uses the unique `chat_logs_index1(chat_id,id)` for this lookup.

## Deletion

Observed sequence:

```text
original row id=B
new type=0 / SYNCDLMSG row id=A, message.logId=B
```

Required steps:

1. Parse the deletion row system message string-safe.
2. Preserve `logId=B` as a string.
3. Query `(chat_id,B)`, never `(chat_id,A)` for the original.
4. A deleted text row can remain as type `16385` (`1 + 16384`).
5. Let Iris decrypt the selected row with full context.

## Host Hide

Classification requires:

```text
origin=SYNCREWR
feedType=26
coverType=openchat_blind
```

### Shape A: Intermediate Feed Row

Observed for a bot-originated message:

```text
hide message.logId -> type=0 / origin=WRITE / message.feedType=13
feed row prev_id   -> actual type=1 message row
```

Follow exactly one `prev_id` hop only when every guard matches.

### Shape B: In-place Rewritten Row

Observed for an incoming user message:

```text
hide message.logId -> original row rewritten to type=0 / origin=MSG
message             -> {"feedType":13}
v.previous_message  -> Base64 encrypted original body
v.previous_enc      -> encryption type for the original body
chatLogInfos[0].type -> original message type
```

Preferred recovery:

```http
POST /decrypt
{
  "enc": PREVIOUS_ENC,
  "b64_ciphertext": PREVIOUS_MESSAGE,
  "user_id": TARGET_USER_ID
}
```

The current environment returned the correct plaintext for this exact method. A reconstructed `/query` projection also worked, but `/decrypt` is the clearer official API when ciphertext is already isolated.

## Failure Ladder

| Symptom | Check first |
| --- | --- |
| No event at all | New `chat_logs._id`, Iris process/config, forward endpoint |
| Event in recent-events but not MariaDB | transaction error, FK/CHECK/UNIQUE constraints |
| New deletion JSON shown | queried event `id` instead of target `message.logId` |
| Wrong or missing target | 64-bit ID rounding during nested JSON parse |
| Base64 shown | use `/decrypt` with correct `enc` and `user_id` |
| `{"feedType":13}` shown | distinguish intermediate-feed and in-place-rewrite shapes |
| MariaDB processed but no Kakao message | command execution, outbox status, delivery attempts, `/reply` response |
| Wrong person name | Iris sender/name cache is untrusted; resolve by stable `user_id` and verified provider data |

## Completion Evidence

A fix is complete only when all applicable items are verified:

- source row exists;
- Iris delivered the event;
- event ID and target ID are distinct and exact;
- normalizer code is correct;
- DB transaction is processed;
- incident type is accepted by schema;
- outbox is sent once;
- monitoring room shows the expected content;
- loop prevention excludes the bot's own monitor message;
- tests, typecheck, build, migration rerun, and readiness pass.
