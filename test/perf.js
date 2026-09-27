'use strict';
// 切換 Cue 的卡頓量測：記錄控制台與輸出畫面超過 50ms 的長任務
// 執行：node test/perf.js <素材資料夾>
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ASSETS = path.resolve(process.argv[2] || 'test/assets');
const PORT = 3196, BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-perf-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function upload(file) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(path.join(ASSETS, file))]), file);
  return (await (await fetch(BASE + '/api/upload', { method: 'POST', body: fd })).json()).path;
}
async function ops(list) { await fetch(BASE + '/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: list }) }); }

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { FD_DATA: DATA, FD_PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'inherit'] });
  process.on('exit', () => srv.kill('SIGKILL'));
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('已啟動')) r(); }));

  const photos = ['p6.png', 'p12.png', 'p9.png'];
  const set = [];
  for (let i = 0; i < 9; i++) set.push({ op: 'set', path: ['teams', i, 'photo', 'src'], value: await upload(photos[i % 3]) });
  const bg = await upload('bg.jpg');
  for (const k of ['idle', 'team', 'top4', 'battle', 'champ']) set.push({ op: 'set', path: ['layouts', k, 'bg'], value: { mode: 'image', src: bg, color: '#8b2420', texture: true, sound: false } });
  set.push({ op: 'set', path: ['results', 'top4'], value: ['t1', 't7', 't2', 't4'] });
  await ops(set);

  const browser = await chromium.launch({ executablePath: CHROME });
  const ctrl = await browser.newPage({ viewport: { width: 1500, height: 920 } });
  const out = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const watch = () => {
    window.__long = [];
    window.__gaps = [];
    let last = 0;
    const f = t => { if (last && t - last > 40) window.__gaps.push(Math.round(t - last)); last = t; requestAnimationFrame(f); };
    requestAnimationFrame(f);
    new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: false });
  };
  await ctrl.addInitScript(watch);
  await out.addInitScript(watch);
  await ctrl.goto(BASE + '/control/');
  await out.goto(BASE + '/output/');
  await ctrl.waitForSelector('.brand');
  await ctrl.getByRole('button', { name: '演出', exact: true }).click();
  await sleep(2500);

  const rows = [];
  for (let i = 0; i < 16; i++) {
    await ctrl.evaluate(() => { window.__long = []; });
    await out.evaluate(() => { window.__long = []; window.__gaps = []; });
    await ctrl.bringToFront();
    const t0 = Date.now();
    await ctrl.keyboard.press('Space');
    await sleep(2200);
    const cue = (await (await fetch(BASE + '/api/state')).json()).state.show.cueId;
    const c = await ctrl.evaluate(() => window.__long);
    const o = await out.evaluate(() => window.__long);
    const g = await out.evaluate(() => window.__gaps);
    rows.push({ cue, control: c.join(',') || '-', output: o.join(',') || '-', 'output 掉格(ms)': g.join(',') || '-' });
  }
  console.table(rows);
  await browser.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
