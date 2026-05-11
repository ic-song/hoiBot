---
name: hoibot-rhino-js-review
description: Use for hoiBot Rhino JavaScript compatibility review, syntax checks, Android MessengerBot runtime constraints, and avoiding Node/browser-only APIs.
---

# hoiBot Rhino JS Review

Use this skill when reviewing or changing JavaScript that runs in the Android MessengerBot Rhino environment.

## Runtime Assumptions

- The runtime is Android MessengerBot Rhino JavaScript.
- It is not a modern Node.js or browser runtime.
- The main callback is `response(room, msg, sender, isGroupChat, replier, imageDB, packageName)`.

## Avoid

- ESM `import` / `export`
- `fs/promises`
- npm package runtime assumptions
- `fetch`-dependent runtime logic
- worker threads
- browser or React APIs
- modern-only syntax that Rhino may not support

## Validation

Run syntax checks when JavaScript changes:

```bash
node --check main.js
node --check Info.js
```

Node syntax checks do not prove Rhino runtime compatibility, but they catch syntax errors.

## References

- Read `references/rhino-compatibility.md` for compatibility review points.
- Read `references/validation-checklist.md` before final validation.
