# Risky Command Guards

Broad prefix checks can accidentally execute commands when users or GMs explain usage in chat.

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
