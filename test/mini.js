'use strict';
// 演出小面板（/control/?mini=1）與底圖切換不閃
// 執行：node test/mini.js <截圖資料夾>
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHOTS = path.resolve(process.argv[2] || os.tmpdir());
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 3211, BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-mini-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (info ? '  — ' + info : '')); };
const ops = list => fetch(BASE + '/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: list }) });
const state = async () => (await (await fetch(BASE + '/api/state')).json()).state;

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { FD_DATA: DATA, FD_PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'inherit'] });
  process.on('exit', () => srv.kill('SIGKILL'));
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('已啟動')) r(); }));
  await ops([{ op: 'set', path: ['results', 'top4'], value: ['t1', 't7', 't2', 't4'] }]);

  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext();
  const errors = [];
  // 主控制台停在「隊伍」頁、編排模式
  const main = await ctx.newPage();
  await main.setViewportSize({ width: 1400, height: 900 });
  main.on('pageerror', e => errors.push('main: ' + e.message));
  await main.goto(BASE + '/control/');
  await main.waitForSelector('.brand');
  await main.getByRole('button', { name: '隊伍', exact: true }).click();
  await sleep(300);

  console.log('演出小面板');
  const mini = await ctx.newPage();
  await mini.setViewportSize({ width: 420, height: 780 });
  mini.on('pageerror', e => errors.push('mini: ' + e.message));
  await mini.goto(BASE + '/control/?mini=1');
  await mini.waitForSelector('.go');
  check('小面板直接是演出模式，有 GO', await mini.locator('.go').isVisible());
  check('沒有監看畫面（不佔資源）', await mini.locator('iframe').count() === 0);
  check('沒有頁面選單', !(await mini.locator('header nav').isVisible()));
  // 播到四強對戰 1
  await ops([{ op: 'set', path: ['show', 'cueId'], value: 'c-semi1' }, { op: 'set', path: ['show', 'seq'], value: 3 }]);
  await sleep(600);
  check('顯示播出中的 Cue', (await mini.locator('.nowline').textContent()).includes('四強對戰 1'), await mini.locator('.nowline').textContent());
  await mini.locator('.sc').nth(0).getByRole('button', { name: '+1' }).click();
  await sleep(300);
  check('小面板加分', (await state()).results.battles.semi1.l === 1);
  await mini.screenshot({ path: path.join(SHOTS, 'mini-battle.png'), fullPage: false });
  const overflow = await mini.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('420px 寬的小視窗不需要左右捲動', !overflow);
  await mini.keyboard.press('t');
  await sleep(300);
  check('快捷鍵 T 開始 Timer', !!(await state()).show.timer.endsAt);
  await mini.keyboard.press('ArrowLeft');
  await sleep(300);
  check('快捷鍵 ← 左方勝印章', (await state()).results.battles.semi1.seal === 'l');
  const before = (await state()).show.cueId;
  await mini.keyboard.press('Space');
  await sleep(500);
  check('空白鍵 GO 播下一個', (await state()).show.cueId !== before, before + ' → ' + (await state()).show.cueId);

  // 主控制台不受影響
  await main.reload();
  await main.waitForSelector('.brand');
  await sleep(300);
  check('主控制台仍停在原本的頁面', await main.locator('header nav button.on').textContent() === '隊伍');

  console.log('底圖切換不閃');
  // 底圖兩層的覆蓋率：切換過程中每一格都要完全蓋住（不會透出黑底）
  const out = await ctx.newPage();
  await out.setViewportSize({ width: 960, height: 540 });
  out.on('pageerror', e => errors.push('output: ' + e.message));
  await ops([{ op: 'set', path: ['layouts', 'idle', 'bg'], value: { mode: 'color', color: '#3a6ea5', texture: false } }, { op: 'set', path: ['show', 'cueId'], value: 'c-team1' }]);
  await out.goto(BASE + '/output/');
  await sleep(1500);
  const m2 = await Promise.all([
    out.evaluate(async () => {
      const L = [document.getElementById('bgA'), document.getElementById('bgB')];
      let min = 1;
      const t0 = performance.now();
      while (performance.now() - t0 < 1500) {
        await new Promise(r => requestAnimationFrame(r));
        const o = L.map(e => Number(getComputedStyle(e).opacity));
        min = Math.min(min, 1 - (1 - o[0]) * (1 - o[1]));
      }
      return min;
    }),
    sleep(200).then(() => ops([{ op: 'set', path: ['show', 'cueId'], value: 'c-open' }, { op: 'set', path: ['show', 'seq'], value: 20 }]))
  ]);
  check('切換過程每一格底圖覆蓋 100%', m2[0] > 0.999, 'min ' + m2[0].toFixed(3));
  await sleep(800);
  const bg = await out.evaluate(() => { const on = [...document.querySelectorAll('.bg.on')]; return on.map(e => getComputedStyle(e).backgroundColor); });
  check('切換完成後只剩新底圖', bg.length === 1 && bg[0] === 'rgb(58, 110, 165)', bg.join(', '));
  check('沒有錯誤訊息', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? '\n失敗 ' + fails + ' 項' : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
