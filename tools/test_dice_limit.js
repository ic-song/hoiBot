// 기존 횟수·진행을 보존한 4판 한도와 다섯 번째 차단·리셋을 검증한다.
const assert=require('assert'),h=require('./test_mini_games');
function ok(r){assert(!r.error,r.error);return r.text;}
for(const dev of [false,true]){
 const f=h.fixture();f.seed(dev);const base=dev?'/sdcard/호이랜드_dev/':'/sdcard/호이랜드/';
 const run=msg=>{f.clock(f.now()+1);return ok(f.run(msg,'a',dev));};
 for(let i=0;i<2;i++){run('/호월주사위');run('ㅎㅈ');}
 const old=f.state(dev).dice.users['$'+f.id('a',dev)],points=f.read(dev).member.a.point;
 assert.equal(old.used,2);assert.equal(old.game.phase,'DONE');
 const text=run('/호월주사위');assert(text.includes('하루 4판'));assert(text.includes('매일 자정'));assert(!text.includes('/리셋'));
 const first=f.state(dev).dice.users['$'+f.id('a',dev)].game;run('ㅎㅈ');
 assert.deepEqual(f.state(dev).dice.users['$'+f.id('a',dev)].game.rolls.slice(0,2),first.rolls);run('ㅎㅈ');run('/호월주사위');
 const s=f.state(dev);assert.equal(s.dice.users['$'+f.id('a',dev)].used,4);assert(f.read(dev).member.a.point>points);
 const member=f.disk()[base+'member.json'];assert(run('ㅎㅈ').includes('모두 사용'));assert.equal(f.state(dev).dice.users['$'+f.id('a',dev)].used,4);assert.equal(f.disk()[base+'member.json'],member);
 f.clock(f.now()+86400000);assert(run('ㅎㅈ').includes('모두 사용'));f.dailyReset(dev);run('ㅎㅈ');assert.equal(f.state(dev).dice.users['$'+f.id('a',dev)].used,1);
 console.log('PASS DICE LIMIT '+(dev?'DEV':'PROD')+' existing 2 -> extra 2 / fifth blocked / only reset restores');
}
