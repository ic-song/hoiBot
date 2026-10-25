// 같은 추첨 예외 검증을 Rhino에서 실행하고 전체 운영 스크립트를 컴파일한다.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const h = require('./test_shop_open'), jar = process.argv[2];
assert(jar && fs.existsSync(jar), 'Rhino jar required');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoibot-shop-open-'));
const info = fs.readFileSync(path.join(__dirname, '..', 'Info.js'), 'utf8');
const script = `var cx=org.mozilla.javascript.Context.getCurrentContext();
cx.compileString(${JSON.stringify(h.main)},'main.js',1,null);print('PASS complete Main compile');
cx.compileString(${JSON.stringify(info)},'Info.js',1,null);print('PASS complete Info compile');
${h.functions(h.main)}
${h.scenarios}
`;
const file = path.join(dir, 'verify.js'); fs.writeFileSync(file, script, 'utf8');
const result = cp.spawnSync('java', ['-Xmx512m', '-Dfile.encoding=UTF-8', '-cp', path.resolve(jar), 'org.mozilla.javascript.tools.shell.Main', '-opt', '-1', '-version', '200', '-encoding', 'UTF-8', '-f', file], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
assert.strictEqual(result.status, 0, result.stdout + result.stderr + '\n' + file);
process.stdout.write(result.stdout); console.log('Rhino evidence: ' + dir);
