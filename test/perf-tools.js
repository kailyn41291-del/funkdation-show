'use strict';
// 卡頓排查工具：跑馬燈改用合成器動畫、?fps=1 效能顯示、目前開著的畫面數量與建議、關閉監看畫面
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ASSETS = path.resolve(process.argv[2] || 'test/assets');
const PORT = 3219, BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-pt-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (info ? '  — ' + info : '')); };
const ops = list => fetch(BASE + '/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: list }) });
async function upload(f) { const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(path.join(ASSETS, f))]), f); return (await (await fetch(BASE + '/api/upload', { method: 'POST', body: fd })).json()).path; }

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { FD_DATA: DATA, FD_PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'inherit'] });
  process.on('exit', () => srv.kill('SIGKILL'));
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('已啟動')) r(); }));
  const logos = [];
  for (const f of ['logo0.png', 'logo1.png', 'logo2.png']) logos.push({ id: f, src: await upload(f), scale: 100 });
  await ops([{ op: 'set', path: ['sponsors', 'logos'], value: logos }, { op: 'set', path: ['sponsors', 'speed'], value: 120 }, { op: 'set', path: ['show', 'cueId'], value: 'c-open' }]);

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  console.log('跑馬燈');
  const out = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  out.on('pageerror', e => errors.push('output: ' + e.message));
  await out.goto(BASE + '/output/?fps=1');
  await sleep(2500);
  const m = await out.evaluate(async () => {
    const track = document.querySelector('#scenes .scene:last-child .track');
    const anims = track.getAnimations();
    const x = () => new DOMMatrix(getComputedStyle(track).transform).m41;
    const a = x(); await new Promise(r => setTimeout(r, 1000)); const b = x();
    const kf = anims[0].effect.getKeyframes().map(k => k.transform).join(' → ');
    return { n: anims.length, moved: a - b, kf, infinite: anims[0].effect.getTiming().iterations === Infinity };
  });
  check('跑馬燈改用合成器動畫（不靠每格程式）', m.n === 1);
  check('速度正確（每秒 120px、往左）', m.moved > 100 && m.moved < 140, Math.round(m.moved) + 'px／秒');
  check('一個無限循環的位移動畫（交給瀏覽器跑）', m.infinite && /translate3d/.test(m.kf), m.kf);
  await ops([{ op: 'set', path: ['sponsors', 'direction'], value: 1 }]);
  await sleep(300);
  const dirRight = await out.evaluate(async () => {
    const track = document.querySelector('#scenes .scene:last-child .track');
    const x = () => new DOMMatrix(getComputedStyle(track).transform).m41;
    const a = x(); await new Promise(r => setTimeout(r, 500)); return x() - a;
  });
  check('方向改成往右', dirRight > 30, Math.round(dirRight) + 'px');

  console.log('效能顯示（?fps=1）');
  const meter = await out.locator('.fpsmeter').textContent();
  check('左上角顯示 fps 與掉格', /\d+ fps　掉格 \d+/.test(meter) && meter.includes('1920×1080'), meter);
  const plain = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await plain.goto(BASE + '/output/');
  await sleep(800);
  check('平常不顯示', await plain.locator('.fpsmeter').count() === 0);

  console.log('目前開著的畫面');
  // 模擬 OBS 裡有兩個瀏覽器來源
  const obsPages = [];
  for (let i = 0; i < 2; i++) {
    const op = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await op.addInitScript(() => { window.obsstudio = { pluginVersion: 'test' }; });
    await op.goto(BASE + '/output/');
    obsPages.push(op);
  }
  const ctrl = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  ctrl.on('pageerror', e => errors.push('control: ' + e.message));
  await ctrl.goto(BASE + '/control/');
  await ctrl.waitForSelector('.brand');
  await ctrl.getByRole('button', { name: '演出', exact: true }).click();
  await sleep(1500);
  const c = (await (await fetch(BASE + '/api/clients')).json()).counts;
  check('伺服器分得出各種畫面', c.obs === 2 && c.monitor === 2 && c.browser === 2 && c.control === 1, JSON.stringify(c));
  await ctrl.getByRole('button', { name: '設定', exact: true }).click();
  await ctrl.waitForSelector('.clients .crow');
  await sleep(500);
  const txt = await ctrl.locator('.clients').textContent();
  check('設定頁列出 OBS 來源數量', txt.includes('OBS 瀏覽器來源') && txt.includes('2 個'));
  check('OBS 來源重複時提醒', txt.includes('OBS 裡有 2 個瀏覽器來源同時在跑'));
  await ctrl.locator('.clients').screenshot({ path: path.join(os.tmpdir(), 'clients.png') });

  console.log('關閉監看畫面');
  await ctrl.getByRole('button', { name: '流程', exact: true }).click();
  await sleep(600);
  check('演出模式有監看畫面', await ctrl.locator('iframe').count() === 2);
  await ctrl.getByRole('button', { name: '關閉監看畫面（省效能）' }).click();
  await sleep(1500);
  check('關閉後沒有監看畫面', await ctrl.locator('iframe').count() === 0);
  const c2 = (await (await fetch(BASE + '/api/clients')).json()).counts;
  check('伺服器那邊監看連線也結束', !c2.monitor, JSON.stringify(c2));
  check('GO 等操作仍在', await ctrl.locator('.go').isVisible());
  await ctrl.reload();
  await ctrl.waitForSelector('.brand');
  await sleep(600);
  check('重新開啟控制台仍記得關閉', await ctrl.locator('iframe').count() === 0);
  await ctrl.getByRole('button', { name: '開啟監看畫面' }).click();
  await sleep(600);
  check('可以再打開', await ctrl.locator('iframe').count() === 2);

  check('沒有錯誤訊息', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? '\n失敗 ' + fails + ' 項' : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
