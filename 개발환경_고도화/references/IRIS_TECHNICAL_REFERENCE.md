# Iris Technical Reference

This file stores informational material for agents. It is not the source of truth for decisions or current migration state.
Read `../DECISIONS.md` and then `../MEMORY.md` first.

## Selected Environment

```text
Windows PC
-> Hyper-V
-> Ubuntu/Linux VM
-> Docker
-> redroid
-> KakaoTalk + Iris
-> hoiBot Server over HTTP/WebSocket
-> PC-side DB/data
```

## Iris Responsibilities

- Observe KakaoTalk database changes on Android.
- Deliver message events to an HTTP endpoint or WebSocket client.
- Send replies through the Iris HTTP API.
- Expose configuration and query APIs.

The external hoiBot Server is responsible for command dispatch, game logic, persistence, logging, and adapters.

## Runtime Requirements

- Android environment with KakaoTalk installed.
- Root or equivalent access required by Iris for KakaoTalk data and services.
- ADB access for installation and diagnostics.
- Network connectivity between Iris and the external server.
- `scrcpy` for interactive redroid display access when needed.

## Main Iris Interfaces

| Interface | Purpose |
| --- | --- |
| `POST /reply` | Send a KakaoTalk text or image reply |
| `POST /query` | Execute a KakaoTalk database query |
| `POST /decrypt` | Decrypt supported KakaoTalk data |
| `GET /config` | Read Iris configuration |
| `/config/endpoint` | Configure the outbound message endpoint |
| `/config/dbrate` | Configure database polling interval |
| `/config/sendrate` | Configure minimum send interval |
| `/config/botport` | Configure the Iris HTTP port |
| `GET /ws` | Receive message events over WebSocket |

The dashboard is normally exposed in the following form:

```text
http://[ANDROID_IP]:3000/dashboard
```

## Event Shape

A typical event contains fields similar to:

```json
{
  "msg": "message text",
  "room": "room name",
  "sender": "sender name",
  "json": {
    "_id": "message id",
    "chat_id": "chat id",
    "user_id": "user id",
    "message": "message text",
    "attachment": "attachment payload"
  }
}
```

Candidate mapping to the legacy MessengerBot callback:

| MessengerBot value | Iris candidate |
| --- | --- |
| `msg` | `msg` |
| `room` | `room` or `json.chat_id` |
| `sender` | `sender` |
| `replier.reply(...)` | Iris `/reply` |
| `isGroupChat` | Requires separate derivation |
| `imageDB` | Requires an adapter |
| `packageName` | Requires an adapter or removal |

## hoiBot Migration Concerns

- The Rhino `response(...)` entry point needs an Iris event adapter.
- `replier.reply(...)` needs an Iris reply adapter.
- `FileStream`, `Api.replyRoom`, `Device`, `android.os.*`, and `java.io.*` dependencies need replacement or isolation.
- Android paths such as `/sdcard/호이랜드/` must not be assumed by the PC server.
- Mutable commands require explicit concurrency, transaction, backup, and recovery design.
- Room names and stable `chat_id` values need verified mapping.
- Multi-response formatting, `allsee`, images, and attachments need separate tests.

## Risks

- KakaoTalk database and encryption changes can break compatibility.
- Iris currently depends on privileged Android access.
- Network retries can create duplicate event delivery; server-side idempotency is required.
- KakaoTalk policy and account-security implications require operational review.
- HTTP, WebSocket, `/reply`, persistence, and restart behavior are not complete until recorded in `MEMORY.md` with current evidence.

## Sources

- Iris repository: https://github.com/dolidolih/Iris
- Iris releases: https://github.com/dolidolih/Iris/releases
- KBotDocs Iris: https://kbotdocs.dev/reference/iris
- KBotDocs getting started: https://kbotdocs.dev/reference/iris/get-started
- MessengerBot ADB reference: https://violetxf.gitbook.io/messengerbot/tips/adb
