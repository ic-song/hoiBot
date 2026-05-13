# Risky Command Guards

Broad prefix checks can accidentally execute commands when users or GMs explain usage in chat.
For new slash commands, define the exact accepted input shape first and make the guard match only that shape.

## High-Risk Patterns

```js
msg.startsWith("/명령어")
msg.indexOf("/명령어") === 0
```

These are risky when the command:

- consumes items
- spends points
- sells or removes inventory
- equips or unequips objects
- starts a confirmation flow
- mutates game data

Do not use broad prefix checks for mutation, purchase, sale, equip, open,
combine, cleanup, or inventory/point-changing commands unless the command
explicitly accepts free-form text after the command name.

## Safer Patterns

Exact command only:

```js
msg === "/명령어"
```

Exact command or numeric count:

```js
msg === "/명령어" || /^\/명령어\s+\d+$/.test(msg)
```

Numeric required:

```js
/^\/명령어\s+\d+$/.test(msg)
```

Two numeric arguments:

```js
/^\/명령어\s+\d+\s+\d+$/.test(msg)
```

## Validation Cases

When fixing guards, test examples like:

```text
/명령어방법
/명령어 1 해볼래
/명령어 10 알려줘
```

They should not execute mutation logic.

Also validate the positive cases so normal usage still works:

```text
/명령어
/명령어 1
/명령어 10
```

Free-form text commands must be explicit about where free-form text starts,
for example by requiring a space after the command name:

```js
msg.indexOf("/공지 ") === 0
```

Do not use the free-form style for numeric command variants.
