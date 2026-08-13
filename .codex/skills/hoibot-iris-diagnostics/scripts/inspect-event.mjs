#!/usr/bin/env node

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (!argument.startsWith("--")) continue;
  const next = process.argv[index + 1];
  if (next !== undefined && !next.startsWith("--")) {
    args.set(argument, next);
    index += 1;
  } else {
    args.set(argument, true);
  }
}

const irisUrl = String(args.get("--iris-url") ?? "").replace(/\/$/, "");
const chatId = String(args.get("--chat-id") ?? "");
const eventId = String(args.get("--event-id") ?? "");
const showContent = args.get("--show-content") === true;

if (irisUrl === "" || chatId === "" || eventId === "") {
  console.error("Usage: node inspect-event.mjs --iris-url URL --chat-id ID --event-id ID [--show-content]");
  process.exit(2);
}

function stringSafeJson(value) {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value.replace(
      /(^|[:,\[]\s*)(-?\d{16,})(?=\s*[,}\]])/g,
      (_match, prefix, integer) => `${prefix}"${integer}"`
    ));
  } catch {
    return undefined;
  }
}

async function query(sql, bind) {
  const response = await fetch(`${irisUrl}/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: sql, bind }),
    signal: AbortSignal.timeout(5_000)
  });
  const body = await response.json();
  if (!response.ok || body.success === false) throw new Error(`Iris /query failed: HTTP ${response.status}`);
  const candidate = body.data?.data ?? body.data;
  if (!Array.isArray(candidate)) throw new Error("Unexpected Iris /query response shape");
  return candidate;
}

async function decrypt(enc, ciphertext, userId) {
  const response = await fetch(`${irisUrl}/decrypt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enc, b64_ciphertext: ciphertext, user_id: userId }),
    signal: AbortSignal.timeout(5_000)
  });
  const body = await response.json();
  if (!response.ok || typeof body.plain_text !== "string") {
    throw new Error(`Iris /decrypt failed: HTTP ${response.status}`);
  }
  return body.plain_text;
}

const projection = `_id, id, type, chat_id, user_id, message, attachment, v,
  thread_id, scope, created_at, deleted_at, prev_id, referer, supplement`;
const eventRows = await query(
  `SELECT ${projection} FROM db1.chat_logs WHERE chat_id = ? AND id = ? LIMIT 2`,
  [chatId, eventId]
);
if (eventRows.length !== 1) throw new Error(`Expected one event row, received ${eventRows.length}`);

const eventRow = eventRows[0];
const eventVersion = stringSafeJson(eventRow.v) ?? {};
const eventMessage = stringSafeJson(eventRow.message) ?? {};
const targetId = String(args.get("--target-id") ?? eventMessage.logId ?? eventMessage.targetLogId ?? "");
let targetRow;
let resolution = "event-only";

if (targetId !== "") {
  const targetRows = await query(
    `SELECT ${projection} FROM db1.chat_logs WHERE chat_id = ? AND id = ? LIMIT 2`,
    [chatId, targetId]
  );
  targetRow = targetRows.length === 1 ? targetRows[0] : undefined;
  resolution = targetRow === undefined ? "target-not-found" : "target-row";
}

let originalMessage = typeof targetRow?.message === "string" ? targetRow.message : undefined;
const targetVersion = stringSafeJson(targetRow?.v) ?? {};
const targetMessage = stringSafeJson(targetRow?.message) ?? {};

if (targetRow !== undefined && String(targetRow.type) === "0" && targetMessage.feedType === 13
  && targetVersion.origin === "WRITE" && targetRow.prev_id !== undefined && targetRow.prev_id !== null) {
  const sourceRows = await query(
    `SELECT ${projection} FROM db1.chat_logs WHERE chat_id = ? AND id = ? LIMIT 2`,
    [chatId, String(targetRow.prev_id)]
  );
  if (sourceRows.length === 1) {
    targetRow = sourceRows[0];
    originalMessage = typeof targetRow.message === "string" ? targetRow.message : undefined;
    resolution = "feedType13-prev_id";
  }
} else if (targetRow !== undefined && String(targetRow.type) === "0" && targetMessage.feedType === 13
  && targetVersion.origin === "MSG" && typeof targetVersion.previous_message === "string"
  && (typeof targetVersion.previous_enc === "string" || typeof targetVersion.previous_enc === "number")) {
  originalMessage = await decrypt(targetVersion.previous_enc, targetVersion.previous_message, String(targetRow.user_id));
  resolution = "feedType13-previous_message";
}

const result = {
  event: {
    id: String(eventRow.id),
    type: String(eventRow.type),
    origin: eventVersion.origin ?? null,
    chatId: String(eventRow.chat_id),
    userId: String(eventRow.user_id)
  },
  targetId: targetId || null,
  resolution,
  original: originalMessage === undefined
    ? null
    : showContent ? { length: originalMessage.length, content: originalMessage }
      : { length: originalMessage.length, content: "[hidden; rerun with --show-content]" }
};

console.log(JSON.stringify(result, null, 2));
