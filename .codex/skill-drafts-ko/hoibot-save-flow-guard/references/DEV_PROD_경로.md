# DEV/PROD 경로

Production data path:

```text
/sdcard/호이랜드/
```

DEV/test data path:

```text
/sdcard/호이랜드_dev/
```

## 규칙

- DEV와 PROD 흐름을 합치지 않는다.
- path routing을 건드리면 `isDevCommandMessage`, `stripDevCommandPrefix`, command context helper를 확인한다.
- local test로 Android filesystem behavior를 덮지 못하면 미검증 영역으로 보고한다.
