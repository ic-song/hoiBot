# Validation Checklist

## JavaScript Syntax

Run:

```bash
node --check main.js
node --check Info.js
```

Run only the files affected by the change when the task is narrow.

## Runtime Limits

Some command flows need Android MessengerBot APIs and cannot be fully tested in Node.

Report unverified runtime areas clearly.

## Review Points

- no modern runtime assumptions
- no unintended save-flow changes
- no unrelated formatting churn
- user-facing output formatting preserved
