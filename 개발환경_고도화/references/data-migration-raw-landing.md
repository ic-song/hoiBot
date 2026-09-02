# RAW Landing 계약

`07`로 봉인된 운영 snapshot을 해시명 private bundle로 복제한 뒤 격리 MariaDB에 원문 bytes 그대로 저장한다. 카탈로그 또는 도메인 의미는 이 단계에서 해석하지 않는다.

- `snapshotManifestSha256`: 입력 snapshot 불변 식별자
- `bundleSha256`: 정렬된 path/content/size/storage 계약 식별자
- `run_key`: 동일 bundle 멱등 실행 키
- `LOADING`: 부분 실패 후 같은 입력으로 재개 가능
- `COMPLETE`: 모든 파일 count/bytes/bundle hash parity 완료
- rollback: run 삭제 시 file payload cascade 삭제
