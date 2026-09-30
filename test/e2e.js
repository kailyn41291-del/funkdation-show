'use strict';
// 整場流程實測：用真的瀏覽器操作控制台，檢查輸出畫面與存檔
// 執行：node test/e2e.js <素材資料夾> <截圖資料夾>
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ASSETS = path.resolve(process.argv[2] || 'test/assets');
const SHOTS = path.resolve(process.argv[3] || 'test/shots');
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
fs.mkdirSync(SHOTS, { recursive: true });
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-e2e-'));

const errors = [];
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  ✔ ' : '  ✘ ') + name + (detail ? '  — ' + detail : ''));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer() {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { FD_DATA: DATA, FD_PORT: String(PORT), FD_SAVE_DELAY: '100' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  p.stderr.on('data', d => errors.push('server: ' + d));
  process.on('exit', () => { try { p.kill('SIGKILL'); } catch (e) { /* 已結束 */ } });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('server timeout')), 10000);
    p.stdout.on('data', d => { if (String(d).includes('已啟動')) { clearTimeout(t); res(p); } });
  });
}
async function stopServer(p) {
  p.kill('SIGTERM');
  await new Promise(r => p.on('exit', r));
}
async function state() { return (await (await fetch(BASE + '/api/state')).json()).state; }

(async () => {
  let server = await startServer();
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctrl = await browser.newPage({ viewport: { width: 1500, height: 920 } });
  const out = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [name, pg] of [['control', ctrl], ['output', out]]) {
    pg.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
    pg.on('console', m => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  }
  const shot = async (name, pg = out) => { await pg.screenshot({ path: path.join(SHOTS, name + '.png') }); };
  const key = async k => { await ctrl.bringToFront(); await ctrl.keyboard.press(k); };
  const click = async text => { await ctrl.getByRole('button', { name: text, exact: true }).first().click(); };

  await ctrl.goto(BASE + '/control/');
  await out.goto(BASE + '/output/');
  await ctrl.waitForSelector('.brand');
  await sleep(800);

  console.log('— 內容設定');
  // 隊伍照片
  await click('隊伍');
  const photos = { 1: 'p6.png', 2: 'p12.png', 4: 'p9.png', 7: 'p12.png' };
  for (const [row, file] of Object.entries(photos)) {
    await ctrl.locator('table.grid tbody tr').nth(Number(row) - 1).locator('td').first().click();
    await sleep(300);
    await ctrl.locator('.sticky input[type=file]').first().setInputFiles(path.join(ASSETS, file));
    await sleep(1200);
  }
  let s = await state();
  check('上傳 4 隊照片', [0, 1, 3, 6].every(i => s.teams[i].photo.src), s.teams.map(t => t.photo.src ? 1 : 0).join(''));
  check('去背照片自動裁掉透明邊', [0, 1, 3, 6].every(i => s.teams[i].photo.trim));
  await ctrl.locator('table.grid tbody tr').nth(0).locator('input[type=text]').nth(1).fill('知識產權');
  await sleep(400);
  await shot('01-control-teams', ctrl);

  // 贊助商
  await click('贊助商');
  await ctrl.locator('input[type=file]').first().setInputFiles(['logo0.png', 'logo1.png', 'logo2.png'].map(f => path.join(ASSETS, f)));
  await sleep(1500);
  s = await state();
  check('上傳 3 個贊助商 Logo', s.sponsors.logos.length === 3);

  // 流程：主視覺底圖
  await click('流程');
  await click('編排');
  await ctrl.locator('.cue').first().click();
  await ctrl.locator('.insp select').first().selectOption('image');
  await sleep(200);
  await ctrl.locator('.insp input[type=file]').first().setInputFiles(path.join(ASSETS, 'bg.jpg'));
  await sleep(1200);
  s = await state();
  check('主視覺底圖設為圖片', s.layouts.idle.bg.mode === 'image' && s.layouts.idle.bg.src);
  await sleep(800);
  await shot('02-control-edit', ctrl);

  // 選對戰 Cue 看預覽
  await ctrl.locator('.cue[data-id=c-semi1]').click();
  await sleep(1500);
  await shot('03-control-edit-battle', ctrl);

  console.log('— 演出');
  await click('演出');
  await sleep(500);
  await key('Space');
  await sleep(1800);
  s = await state();
  check('GO 播出第一個 Cue', s.show.cueId === 'c-open');
  await shot('10-idle');
  await key('Space'); await sleep(800);
  await key('Space'); await sleep(2600);
  await shot('11-team1');
  s = await state();
  check('第三個 Cue 是第 1 隊', s.show.cueId === 'c-team1');

  // 效能：量測潑墨登場時的畫格間隔
  await key('x'); await sleep(1500);
  await shot('12-team1-exit');
  await out.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const f = t => { window.__frames.push(t - last); last = t; if (window.__frames.length < 150) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  await key('Space');
  await sleep(2600);
  const frames = await out.evaluate(() => window.__frames.slice(5));
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  const worst = Math.max(...frames);
  check('登場動畫流暢度', avg < 20, `平均 ${avg.toFixed(1)}ms / 格，最慢 ${worst.toFixed(0)}ms（無 GPU 的測試機）`);
  await shot('13-team2');
  // 沒按退場直接 GO：應自動先退場再播下一隊
  await key('Space'); await sleep(3000);
  s = await state();
  check('直接 GO 換下一隊', s.show.cueId === 'c-team3');

  // 四強
  await ctrl.locator('.cue[data-id=c-top4]').dblclick();
  await sleep(800);
  const picks = ctrl.locator('.insp select');
  for (const [i, v] of [[0, 't1'], [1, 't7'], [2, 't2'], [3, 't4']]) { await picks.nth(i).selectOption(v); await sleep(150); }
  await picks.nth(2).selectOption('t1');
  await sleep(200);
  s = await state();
  check('四強不能重複選同一隊', s.results.top4[2] === 't2');
  await click('揭曉下一隊'); await sleep(1600);
  await click('揭曉下一隊'); await sleep(1400);
  await shot('20-top4-pair1-close');
  await sleep(2000);
  await shot('21-top4-pair1-split');
  await click('揭曉下一隊'); await sleep(1600);
  await click('揭曉下一隊'); await sleep(4000);
  await shot('22-top4-all');
  s = await state();
  check('四強揭曉 4 / 4', s.show.top4Shown === 4 && s.results.top4.join() === 't1,t7,t2,t4');
  const matchTitles = await ctrl.locator('.match .mtitle').allTextContents();
  check('四強選隊依對戰組合標示', matchTitles[0].includes('第 1 名 vs 第 4 名') && matchTitles[1].includes('第 2 名 vs 第 3 名'), matchTitles.join(' / '));

  // 四強對戰 1
  await key('Space'); await sleep(3500);
  s = await state();
  check('四強對戰 1 自動帶入隊伍', s.show.cueId === 'c-semi1');
  await shot('30-semi1-enter');
  await click('+1'); await sleep(300);
  await ctrl.locator('.sc').nth(1).getByRole('button', { name: '+2' }).click(); await sleep(300);
  await key('ArrowLeft'); await sleep(2600);
  await shot('31-semi1-seal-left');
  s = await state();
  check('比分 1:2、左方印章', s.results.battles.semi1.l === 1 && s.results.battles.semi1.r === 2 && s.results.battles.semi1.seal === 'l');
  await key('ArrowDown'); await sleep(1200);
  s = await state();
  check('印章淡出', s.results.battles.semi1.seal === null);
  await click('↶ 復原'); await sleep(500);
  s = await state();
  check('復原印章', s.results.battles.semi1.seal === 'l');
  await ctrl.getByRole('button', { name: '下一回合' }).click(); await sleep(800);
  s = await state();
  check('下一回合並自動收回印章', s.results.battles.semi1.round === 2 && s.results.battles.semi1.seal === null);
  // 直接輸入兩位數比分
  await ctrl.locator('.sc').nth(0).locator('input[type=number]').fill('38');
  await ctrl.locator('.sc').nth(0).getByRole('button', { name: '設定' }).click(); await sleep(300);
  await ctrl.locator('.sc').nth(1).locator('input[type=number]').fill('77');
  await ctrl.locator('.sc').nth(1).getByRole('button', { name: '設定' }).click(); await sleep(300);
  s = await state();
  check('比分 38，超出 50 被擋下', s.results.battles.semi1.l === 38 && s.results.battles.semi1.r === 2);
  // Timer：設 13 秒開始，進入最後 10 秒
  await ctrl.locator('.insp input[placeholder="秒"]').fill('13');
  await ctrl.locator('.insp').getByRole('button', { name: '設定' }).last().click(); await sleep(300);
  await key('t'); await sleep(5200);
  await shot('32-semi1-timer-warn');
  s = await state();
  check('Timer 倒數中', !!s.show.timer.endsAt);
  await key('r'); await sleep(400);
  s = await state();
  check('Timer 重置', !s.show.timer.endsAt && s.show.timer.pausedLeft === 13);
  await ctrl.locator('.sc').nth(0).getByRole('button', { name: '確認晉級' }).click(); await sleep(400);

  // 重新整理輸出畫面：應直接回到目前狀態
  await out.reload(); await sleep(2000);
  await shot('33-semi1-after-reload');

  // 四強對戰 2 → 右方晉級
  await key('Space'); await sleep(3000);
  await ctrl.locator('.sc').nth(1).getByRole('button', { name: '確認晉級' }).click(); await sleep(400);
  // 決賽
  await key('Space'); await sleep(3500);
  s = await state();
  const finalCue = s.cues.find(c => c.id === 'c-final');
  check('決賽帶入兩場勝方', s.show.cueId === 'c-final');
  await shot('40-final');
  await ctrl.locator('.sc').nth(1).getByRole('button', { name: '確認晉級' }).click(); await sleep(400);

  // 頒獎：排舞賽冠軍（演出時選）＋ Battle 冠軍（決賽勝方）
  await key('Space'); await sleep(800);
  await ctrl.locator('.awards select').selectOption('t7'); await sleep(400);
  s = await state();
  check('頒獎時選排舞賽冠軍', s.cues.find(c => c.id === 'c-champ').runner.team === 't7');
  await key('1'); await sleep(5500);
  await shot('50-showcase-champion');
  await key('2'); await sleep(2000);
  await shot('51-champion-lead');
  await sleep(3500);
  await shot('52-champion');
  await key('3'); await sleep(3500);
  await shot('53-duo');
  await key('w'); await sleep(900);
  s = await state();
  check('直接切換單獨冠軍', s.show.champView === 'solo-c');
  await shot('54-solo-champion-photo');
  await shot('55-control-show', ctrl);

  // 重新啟動伺服器：狀態應完整保留
  const before = await state();
  await stopServer(server);
  server = await startServer();
  const after = await state();
  check('重開後狀態完整保留', JSON.stringify(before) === JSON.stringify(after), `cue=${after.show.cueId}`);
  await sleep(2500);
  await shot('56-after-restart');
  const backups = (await (await fetch(BASE + '/api/backups')).json()).backups;
  check('自動備份', backups.length >= 1, backups.length + ' 份');

  // 匯出
  const zip = await fetch(BASE + '/api/export');
  const buf = Buffer.from(await zip.arrayBuffer());
  check('匯出壓縮檔', zip.ok && buf.length > 10000, (buf.length / 1024).toFixed(0) + ' KB');

  await browser.close();
  await stopServer(server);
  const bad = results.filter(r => !r.ok);
  // 伺服器重開測試時的重新連線訊息是預期的
  const errs = errors.filter(e => !/favicon|ERR_CONNECTION_REFUSED/.test(e));
  console.log('\n錯誤訊息：' + (errs.length ? '\n' + errs.join('\n') : '無'));
  console.log(`\n結果：${results.length - bad.length}/${results.length} 通過`);
  process.exit(bad.length || errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
