# Rhino Compatibility

Review JavaScript with conservative syntax choices.

## Prefer

- existing local patterns
- `var` when surrounding code uses it
- plain functions when compatibility is uncertain
- existing helper APIs
- Android/MessengerBot APIs already used in the repo

## Be Careful With

- arrow functions in old sections
- `let` and `const` if surrounding code is older style
- template literals in fragile areas
- `Array.prototype` methods if compatibility is uncertain
- regex features that may not be supported by older engines

Do not refactor syntax style just for modernity.
