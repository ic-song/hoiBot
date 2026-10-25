// 정적 원본 전문을 작은 문자열 조각으로 묶어 Main 단독 배포의 자료 누락을 복구한다.
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),target=path.join(root,'main.js');
const start='// BEGIN_MINI_GAME_CATALOG_BUNDLE',end='// END_MINI_GAME_CATALOG_BUNDLE';
const definitions=[['questions','balanceQuestions.json',1300],['dialogues','howoriDiceDialogues.json',200]];
let body=start+'\n// 배포 소스에 포함된 질문·멘트 전문을 누락 복구용으로만 반환하는 함수\nfunction getMiniGameBundledCatalog(kind) {\n    var parts;\n';
for(let i=0;i<definitions.length;i++){
    const [kind,file,count]=definitions[i],value=JSON.parse(fs.readFileSync(path.join(root,'data',file),'utf8')),rows=value[kind];
    assert.equal(value.schemaVersion,1);assert.equal(rows.length,count);assert.equal(new Set(rows.map(r=>r.id)).size,count);
    const text=JSON.stringify(value),chunks=[];
    for(let p=0;p<text.length;p+=6000)chunks.push(JSON.stringify(text.slice(p,p+6000)).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029'));
    body+='    '+(i?'else ':'')+'if (kind === '+JSON.stringify(kind)+') parts = [\n        '+chunks.join(',\n        ')+'\n    ];\n';
}
body+='    else throw new Error("알 수 없는 미니게임 자료");\n    return JSON.parse(parts.join(""));\n}\n'+end;
const source=fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n'),a=source.indexOf(start),b=source.indexOf(end,a);
assert(a>=0&&b>a,'bundle markers');
const expected=source.slice(0,a)+body+source.slice(b+end.length);
if(process.argv.includes('--check')){assert.equal(source,expected,'run node tools/build_mini_game_catalog_bundle.js');console.log('PASS complete minigame bundle matches static sources');}
else {fs.writeFileSync(target,expected.replace(/\n/g,'\r\n'),'utf8');console.log('Updated complete minigame catalog bundle');}
