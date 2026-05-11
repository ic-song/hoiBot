# DEV/PROD Paths

Production data path:

```text
/sdcard/호이랜드/
```

DEV/test data path:

```text
/sdcard/호이랜드_dev/
```

## Rules

- Do not collapse DEV and PROD flows.
- Verify `isDevCommandMessage`, `stripDevCommandPrefix`, and command context helpers if path routing is touched.
- Report unverified Android filesystem behavior when local testing cannot cover it.
