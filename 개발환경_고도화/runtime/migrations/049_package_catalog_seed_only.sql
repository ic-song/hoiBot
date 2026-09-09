START TRANSACTION;

-- 레거시 개별 개봉 명령은 출처 메타데이터로만 보존하고 실행 alias로 생성하지 않는다.
DELETE FROM package_command_aliases
WHERE package_id IN (
    'PKG-078', 'PKG-088', 'PKG-093', 'PKG-097', 'PKG-098',
    'PKG-100', 'PKG-103', 'PKG-105', 'PKG-156', 'PKG-157',
    'PKG-158', 'PKG-159', 'PKG-160', 'PKG-161', 'PKG-162',
    'PKG-165', 'PKG-166', 'PKG-186', 'PKG-188', 'PKG-201',
    'PKG-203', 'PKG-204', 'PKG-206', 'PKG-207', 'PKG-208',
    'PKG-209', 'PKG-210', 'PKG-211', 'PKG-212'
);

COMMIT;
