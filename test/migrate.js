'use strict';
// 舊存檔轉換：冠軍／亞軍 → Battle 冠軍／排舞賽冠軍
const fs = require('fs'), os = require('os'), path = require('path');
const { Store } = require('../store');
const { defaultState } = require('../default-state');
let fails = 0;
const check = (n, ok, info) => { if (!ok) fails++; console.log((ok ? '  ✔ ' : '  ✘ ') + n + (info ? '  — ' + info : '')); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-mig-'));
const old = defaultState();
old.schema = 2;
delete old.judges;
Object.assign(old.layouts.champ.text, { lc: 'THE CHAMPION IS...', lcz: '冠軍是', tc: 'CHAMPION', cz: '冠軍', lr: 'THE RUNNER-UP IS...', lrz: '亞軍是', trr: 'RUNNER-UP', rz: 'MY OWN TEXT' });
Object.assign(old.layouts.champ.v, { cw: 560, rw: 440, cTs: 40, cNs: 50, rTs: 30, rNs: 38 });
const cc = old.cues.find(c => c.type === 'champ');
cc.name = '冠亞軍公布'; cc.runner = { source: 'loser', battle: 'final' };
old.results.top4 = ['t1', 't7', 't2', 't4'];
fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ rev: 7, state: old }));

const st = new Store(dir).state;
const L = st.layouts.champ;
check('schema 升級到 3', st.schema === 3);
check('預設懸念文字換成 Battle／排舞賽', L.text.lc === 'THE BATTLE CHAMPION IS...' && L.text.lr === 'THE SHOWCASE CHAMPION IS...' && L.text.trr === 'SHOWCASE CHAMPION');
check('自己改過的文字保留', L.text.rz === 'MY OWN TEXT');
check('同框兩隊改成一樣大', L.v.cw === L.v.rw && L.v.cNs === L.v.rNs, L.v.cw + ' / ' + L.v.rw);
const c2 = st.cues.find(c => c.type === 'champ');
check('排舞賽冠軍改成演出時選', c2.runner.source === 'team' && c2.runner.team === null && c2.name === '冠軍公布');
check('四強結果不變', st.results.top4.join() === 't1,t7,t2,t4');
check('補上評審資料', Array.isArray(st.judges) && st.judges.length === 3);
console.log(fails ? '\n失敗 ' + fails + ' 項' : '\n全部通過');
process.exit(fails ? 1 : 0);
