// 배포 전 원본에도 새 빌리지 정책을 적용해 기존 계산·예외·상태 보존을 비교한다.
const assert = require('assert'), vm = require('vm'), cp = require('child_process'), h = require('./test_castle_raid_common');
const baseline = '8f8ec7fb8554dffecde438271493c388f6f5d185';
for (const kind of ['main', 'info']) {
    let reference = cp.execFileSync('git', ['show', baseline + ':' + (kind === 'main' ? 'main.js' : 'Info.js')], { cwd: h.root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).replace(/\r\n/g, '\n');
    for (const marker of ['const GLOBAL_CONFIG = {', 'function getPetHomeVillageState(', 'function getPetHomeFurnitureCharm(']) {
        reference = reference.replace(h.block(reference, marker), h.block(h.current[kind], marker));
    }
    const scopes = [reference, h.current[kind]].map(source => {
        const c = vm.createContext({ optimized: true });
        vm.runInContext(h.runtime(source, kind) + h.scenarios, c);
        return c;
    });
    assert(JSON.stringify(scopes[0].outcomes) === JSON.stringify(scopes[1].outcomes), kind + ' new-policy arithmetic/error/state mismatch');
    console.log('PASS ' + kind + ' new village policy: ' + scopes[1].groups + ' shared/standalone arithmetic, rounding, exception and state groups');
}
