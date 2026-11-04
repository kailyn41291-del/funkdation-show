'use strict';
// 九隊總覽：上排 4 隊、下排 5 隊，置中、不重疊，依序登場
// 執行：node test/overview.js <素材資料夾> <截圖資料夾>
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ASSETS = path.resolve(process.argv[2] || 'test/assets');
const SHOTS = path.resolve(process.argv[3] || os.tmpdir());
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 3204, BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-ov-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (info ? '  — ' + info : '')); };
async function ops(list) { await fetch(BASE + '/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: list }) }); }
async function upload(file) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(path.join(ASSETS, file))]), file);
  return (await (await fetch(BASE + '/api/upload', { method: 'POST', body: fd })).json()).path;
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { FD_DATA: DATA, FD_PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'inherit'] });
  process.on('exit', () => srv.kill('SIGKILL'));
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('已啟動')) r(); }));
  const photos = ['p6.png', 'p12.png', 'p9.png'], set = [];
  for (let i = 0; i < 9; i++) set.push({ op: 'set', path: ['teams', i, 'photo', 'src'], value: await upload(photos[i % 3]) });
  set.push({ op: 'set', path: ['show', 'cueId'], value: 'c-all' }, { op: 'set', path: ['show', 'seq'], value: 3 });
  await ops(set);

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const out = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  out.on('pageerror', e => errors.push(e.message));
  await out.goto(BASE + '/output/');
  await sleep(600);
  // 重播登場，量測依序出現
  await out.evaluate(() => window.fd.cmd([], { event: { name: 'entrance' } }));
  await sleep(700);
  const mid = await out.evaluate(() => [...document.querySelectorAll('.scene:last-child .slot .ph')].map(e => +getComputedStyle(e).opacity));
  await sleep(4000);
  await out.screenshot({ path: path.join(SHOTS, 'overview.png') });
  const boxes = await out.evaluate(() => [...document.querySelectorAll('.scene:last-child .slot')].map(e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }));
  const names = await out.evaluate(() => [...document.querySelectorAll('.scene:last-child .slot .txt.en')].map(e => [e.textContent, parseFloat(e.style.fontSize)]));
  const vis = await out.evaluate(() => [...document.querySelectorAll('.scene:last-child .slot .ph, .scene:last-child .slot .t')].every(e => +getComputedStyle(e).opacity > 0.99));

  check('9 隊都排出來', boxes.length === 9);
  const rows = [...new Set(boxes.map(b => Math.round(b.y)))];
  const top = boxes.filter(b => Math.round(b.y) === rows[0]).length, bot = boxes.filter(b => Math.round(b.y) === rows[1]).length;
  check('上 4 下 5', rows.length === 2 && top === 4 && bot === 5, '上 ' + top + '／下 ' + bot);
  const cen = r => { const xs = boxes.filter(b => Math.round(b.y) === r); return (Math.min(...xs.map(b => b.x)) + Math.max(...xs.map(b => b.x + b.w))) / 2; };
  check('兩排都水平置中', Math.abs(cen(rows[0]) - 960) < 1 && Math.abs(cen(rows[1]) - 960) < 1, cen(rows[0]) + ' / ' + cen(rows[1]));
  const overlap = boxes.some((a, i) => boxes.some((b, j) => i !== j && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
  check('照片不重疊', !overlap);
  check('全部在畫面內', boxes.every(b => b.x >= 0 && b.x + b.w <= 1920 && b.y >= 0 && b.y + b.h <= 1080));
  check('九隊隊名同一個字級', new Set(names.map(n => n[1])).size === 1, names[0] && names[0][1] + 'px');
  check('依序登場（前面的隊先出現、後面的還沒出現）', mid[0] > mid[8] && mid[8] < 0.05, mid.map(x => x.toFixed(1)).join(' '));
  check('登場完成後全部顯示', vis);

  // 改成上 5 下 4
  await ops([{ op: 'set', path: ['layouts', 'overview', 'top'], value: 5 }]);
  await sleep(500);
  const b2 = await out.evaluate(() => [...document.querySelectorAll('.scene:last-child .slot')].map(e => Math.round(e.getBoundingClientRect().top)));
  check('可改成上 5 下 4', b2.filter(y => y === b2[0]).length === 5);
  // 關掉顯示隊伍：只剩底圖
  await ops([{ op: 'set', path: ['layouts', 'overview', 'teams'], value: false }]);
  await sleep(400);
  check('關掉「顯示隊伍」只剩底圖', await out.evaluate(() => document.querySelectorAll('.scene:last-child .slot').length) === 0);
  await ops([{ op: 'set', path: ['layouts', 'overview', 'teams'], value: true }, { op: 'set', path: ['layouts', 'overview', 'top'], value: 4 }]);

  // 控制台分頁
  const ctrl = await browser.newPage({ viewport: { width: 1500, height: 920 } });
  ctrl.on('pageerror', e => errors.push('control: ' + e.message));
  await ctrl.goto(BASE + '/control/');
  await ctrl.waitForSelector('.brand');
  await ctrl.getByRole('button', { name: '編排', exact: true }).click();
  await ctrl.locator('.cue[data-id="c-all"]').click();
  await sleep(400);
  for (const tab of ['基本', '標題', '版面', '動畫']) { await ctrl.locator('.tabs button', { hasText: tab }).click(); await sleep(250); }
  await ctrl.locator('.tabs button', { hasText: '基本' }).click();
  await sleep(1500);
  await ctrl.screenshot({ path: path.join(SHOTS, 'overview-editor.png') });
  check('九隊總覽的 4 個設定分頁都能開', true);
  check('沒有錯誤訊息', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? '\n失敗 ' + fails + ' 項' : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
