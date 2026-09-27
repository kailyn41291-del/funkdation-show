'use strict';
// 四強版面檢查：框不重疊、VS 出現時位置不跑掉
// 執行：node test/top4.js <截圖資料夾>
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHOTS = path.resolve(process.argv[2] || os.tmpdir());
const PORT = 3197, BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-top4-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (info ? '  — ' + info : '')); };
async function ops(list) { await fetch(BASE + '/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: list }) }); }

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { FD_DATA: DATA, FD_PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'inherit'] });
  process.on('exit', () => srv.kill('SIGKILL'));
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('已啟動')) r(); }));
  await ops([
    { op: 'set', path: ['results', 'top4'], value: ['t1', 't7', 't2', 't4'] },
    { op: 'set', path: ['layouts', 'top4', 'v', 'close'], value: 0 },
    { op: 'set', path: ['show', 'cueId'], value: 'c-top4' },
    { op: 'set', path: ['show', 'top4Shown'], value: 0 },
    { op: 'set', path: ['layouts', 'top4', 'vsFx'], value: process.env.VSFX || 'slam' }
  ]);
  const browser = await chromium.launch({ executablePath: CHROME });
  const out = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await out.goto(BASE + '/output/');
  await sleep(1500);
  // 揭曉前兩隊（尚未拉開）
  const send = ev => out.evaluate(ev => { window.__c = window.__c || FD.connect({}); return window.__c.cmd([], { event: ev }); }, ev);
  await out.evaluate(() => { window.__c = FD.connect({}); });
  await sleep(500);
  await send({ name: 'top4next', index: 0 });
  await sleep(200);
  await send({ name: 'top4next', index: 1 });
  await sleep(1300);
  const frames = await out.evaluate(() => [...document.querySelectorAll('.scene:last-child .slot')].slice(0, 2).map(s => { const r = s.getBoundingClientRect(); return [r.left, r.right]; }));
  await out.screenshot({ path: path.join(SHOTS, 'closed.png') });
  const gap = frames[1][0] - frames[0][1];
  check('併排時兩個框不重疊、留有間距', gap >= 12, '間距 ' + gap.toFixed(1) + 'px');
  // VS 出現過程中中心點位置
  const samples = await out.evaluate(async () => {
    const vs = [...document.querySelectorAll('.scene:last-child .vs')][0];
    const ref = document.getElementById('shake');  // 扣掉整個畫面的重擊震動
    const res = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 2500) {
      await new Promise(r => requestAnimationFrame(r));
      if (getComputedStyle(vs).opacity > 0.05) { const r = vs.getBoundingClientRect(), q = ref.getBoundingClientRect(); res.push([(r.left + r.right) / 2 - q.left, (r.top + r.bottom) / 2 - q.top]); }
    }
    return res;
  });
  await out.screenshot({ path: path.join(SHOTS, 'open.png') });
  const last = samples[samples.length - 1] || [0, 0];
  const drift = Math.max(0, ...samples.map(s => Math.hypot(s[0] - last[0], s[1] - last[1])));
  check('VS 出現時中心不跑位', samples.length > 3 && drift < 3, '最大偏移 ' + drift.toFixed(1) + 'px（' + samples.length + ' 格）');
  const f2 = await out.evaluate(() => [...document.querySelectorAll('.scene:last-child .slot')].slice(0, 2).map(s => { const r = s.getBoundingClientRect(); return [r.left, r.right]; }));
  const sh = await out.evaluate(() => document.getElementById('shake').getBoundingClientRect().left);
  const mid = (f2[0][1] + f2[1][0]) / 2 - sh;
  check('VS 在兩隊正中間', Math.abs(mid - last[0]) < 2, 'VS ' + last[0].toFixed(1) + ' / 中間 ' + mid.toFixed(1));
  await browser.close();
  console.log(fails ? '\n失敗 ' + fails + ' 項' : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
