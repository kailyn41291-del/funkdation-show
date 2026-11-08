'use strict';
// 四強公布：上面一組、下面一組，上方 TOP 4 標題
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHOTS = path.resolve(process.argv[2] || os.tmpdir());
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 3226, BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (info ? '  — ' + info : '')); };
const ops = list => fetch(BASE + '/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: list }) });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-t4s-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { FD_DATA: dir, FD_PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'inherit'] });
  process.on('exit', () => srv.kill('SIGKILL'));
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('已啟動')) r(); }));
  await ops([{ op: 'set', path: ['results', 'top4'], value: ['t1', 't7', 't2', 't4'] }, { op: 'set', path: ['show', 'cueId'], value: 'c-top4' }, { op: 'set', path: ['show', 'top4Shown'], value: 0 }, { op: 'set', path: ['show', 'seq'], value: 2 }]);
  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const out = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  out.on('pageerror', e => errors.push(e.message));
  await out.goto(BASE + '/output/');
  await sleep(2000);
  const sender = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await sender.goto(BASE + '/output/');
  await sleep(1200);
  const head = () => out.evaluate(() => { const e = document.querySelector('.scene:last-child .ls-h1'); return e ? e.textContent + '|' + getComputedStyle(e.parentNode).opacity : ''; });
  check('一開始就有 TOP 4 標題', (await head()) === 'TOP 4|1', await head());
  for (let i = 0; i < 4; i++) {
    await sender.evaluate(i => window.fd.cmd([{ op: 'set', path: ['show', 'top4Shown'], value: i + 1 }], { event: { name: 'top4next', index: i } }), i);
    await sleep(i % 2 ? 4200 : 2500);
  }
  const boxes = await out.evaluate(() => [...document.querySelectorAll('.scene:last-child .slot')].map(s => { const r = s.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), o: +getComputedStyle(s.querySelector('.fr')).opacity }; }));
  check('四隊都揭曉', boxes.every(b => b.o > 0.9), JSON.stringify(boxes));
  check('上面一組、下面一組', boxes[0].y === boxes[1].y && boxes[2].y === boxes[3].y && boxes[2].y > boxes[0].y + 300, boxes.map(b => b.y).join());
  check('照片比較大（450）且每組左右置中', boxes[0].w === 450 && Math.abs((boxes[0].x + boxes[1].x + 450) / 2 - 960) < 2 && Math.abs((boxes[2].x + boxes[3].x + 450) / 2 - 960) < 2, JSON.stringify(boxes[0]));
  const vs = await out.evaluate(() => [...document.querySelectorAll('.scene:last-child .vs')].map(e => { const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2) + ':' + getComputedStyle(e).opacity; }));
  check('兩個 VS 分別在上下兩組中間', vs.length === 2 && vs.every(x => x.endsWith(':1')) && Math.abs(+vs[0].split(':')[0] - 350) < 30 && Math.abs(+vs[1].split(':')[0] - 780) < 30, vs.join());
  await out.screenshot({ path: path.join(SHOTS, 'top4-stack.png') });
  // 改回左右並排
  await ops([{ op: 'set', path: ['layouts', 'top4', 'arrange'], value: 'line' }, { op: 'set', path: ['layouts', 'top4', 'head', 'en'], value: '' }]);
  await sleep(800);
  const ys = await out.evaluate(() => [...document.querySelectorAll('.scene:last-child .slot')].map(s => Math.round(s.getBoundingClientRect().top)));
  check('可以改回兩組左右並排', new Set(ys).size === 1, ys.join());
  const hd = await out.evaluate(() => getComputedStyle(document.querySelector('.scene:last-child .ls-h1').parentNode.parentNode).display);
  check('標題留空就不顯示', hd === 'none', hd);
  check('沒有 JS 錯誤', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
