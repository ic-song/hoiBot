# Command Registry Rules

`COMMAND_REGISTRY.md` is a human-facing checklist.

## Rules

- The current code is the source of truth.
- The registry tracks command, source file, `미사용`, `삭제유무`, and `비고`.
- Unchecked `미사용` means the command is treated as in use by default.
- `미사용` does not approve deletion.
- Check `삭제유무` only after source-code removal is verified.
- Values connected by `||` in the same condition may be aliases of the same command.
- Do not treat broad outer gates as aliases.
- Do not group separate `else if` branches as the same command group.
- Put alias and trigger notes in `비고`.
- Do not add lifecycle states or verification levels.

## Removal

Remove command code only when the user explicitly asks for removal and the source impact has been re-verified.
