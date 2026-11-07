'use strict';
// 遙控網頁實測：同網路裝置的權限、密碼登入、加減分、選四強、手機畫面
// 執行：node test/remote.js <截圖資料夾>
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const SHOTS = path.resolve(process.argv[2] || os.tmpdir());
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 3207;
const LAN_IP = Object.values(os.networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal);
if (!LAN_IP) { console.log('沒有網路介面，略過'); process.exit(0); }
const LOCAL = `http://127.0.0.1:${PORT}`, LAN = `http://${LAN_IP.address}:${PORT}`;
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-remote-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (info ? '  — ' + info : '')); };
const json = (url, body, tok, method) => fetch(url, {
  method: method || (body ? 'POST' : 'GET'), redirect: 'manual',
  headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}),
  body: body ? JSON.stringify(body) : undefined
}).then(async r => ({ status: r.status, loc: r.headers.get('location'), body: await r.json().catch(() => null) }));
const state = async () => (await json(LOCAL + '/api/state')).body.state;

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { FD_DATA: DATA, FD_PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'inherit'] });
  process.on('exit', () => srv.kill('SIGKILL'));
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('已啟動')) r(); }));

  console.log('同網路裝置的權限');
  let r = await json(LAN + '/control/');
  check('控制台轉到遙控網頁', r.status === 302 && r.loc === '/remote/', r.status + ' ' + r.loc);
  check('讀不到完整資料 API', (await json(LAN + '/api/state')).status === 403);
  check('不能直接修改', (await json(LAN + '/api/ops', { ops: [{ op: 'set', path: ['event', 'title'], value: 'x' }] })).status === 403);
  check('不能上傳、匯出、還原', (await json(LAN + '/api/upload', {})).status === 403 && (await json(LAN + '/api/export')).status === 403 && (await json(LAN + '/api/backups/restore', { name: 'x' })).status === 403);
  check('不能讀遙控密碼設定', (await json(LAN + '/api/remote/config')).status === 403);
  check('輸出畫面可以開（唯讀）', (await fetch(LAN + '/output/')).status === 200);
  check('這台電腦本身不受影響', (await json(LOCAL + '/api/state')).status === 200);

  console.log('密碼');
  r = await json(LAN + '/api/remote/login', { password: '1234' });
  check('預設關閉：無法登入', r.status === 403, r.body && r.body.error);
  check('密碼太短不能開啟', (await json(LOCAL + '/api/remote/config', { enabled: true, password: '12' })).status === 400);
  await json(LOCAL + '/api/remote/config', { enabled: true, password: 'funk2026' });
  check('密碼沒放進賽事狀態（不會同步給其他裝置）', !JSON.stringify(await state()).includes('funk2026'));
  check('密碼錯誤', (await json(LAN + '/api/remote/login', { password: 'nope' })).status === 401);
  r = await json(LAN + '/api/remote/login', { password: 'funk2026' });
  const tok = r.body && r.body.token;
  check('密碼正確可以登入', r.status === 200 && !!tok);
  check('沒登入不能加分', (await json(LAN + '/api/remote/score', { battle: 'semi1', side: 'l', delta: 1 })).status === 401);

  console.log('加減分');
  const events = [];
  const watcher = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  watcher.on('message', d => { const m = JSON.parse(d); if (m.type === 'event') events.push(m.event); });
  await new Promise(res => watcher.on('open', res));
  await json(LAN + '/api/remote/score', { battle: 'semi1', side: 'l', delta: 1 }, tok);
  await json(LAN + '/api/remote/score', { battle: 'semi1', side: 'l', delta: 2 }, tok);
  await json(LAN + '/api/remote/score', { battle: 'semi1', side: 'r', delta: 1 }, tok);
  await json(LAN + '/api/remote/score', { battle: 'semi1', side: 'l', delta: -1 }, tok);
  let s = await state();
  check('+1、+2、−1 正確', s.results.battles.semi1.l === 2 && s.results.battles.semi1.r === 1, s.results.battles.semi1.l + ' : ' + s.results.battles.semi1.r);
  check('控制台可以復原遙控的加分', s.results.battles.semi1.hist.length === 4);
  await sleep(200);
  check('輸出畫面收到比分動畫事件', events.filter(e => e.name === 'score' && e.battle === 'semi1').length === 4, events.length + ' 個事件');
  await json(LAN + '/api/remote/score', { battle: 'semi2', side: 'r', delta: -1 }, tok);
  check('不會低於 0', (await state()).results.battles.semi2.r === 0);
  check('不接受其他分數（例如 +10）', (await json(LAN + '/api/remote/score', { battle: 'semi1', side: 'l', delta: 10 }, tok)).status === 400);
  check('不接受不存在的場次', (await json(LAN + '/api/remote/score', { battle: 'hack', side: 'l', delta: 1 }, tok)).status === 400);
  const ro = new WebSocket(`ws://${LAN_IP.address}:${PORT}/ws`);
  const nack = await new Promise(res => {
    ro.on('message', d => { const m = JSON.parse(d); if (m.type === 'hello') ro.send(JSON.stringify({ type: 'ops', id: 'x', ops: [{ op: 'set', path: ['event', 'title'], value: 'hacked' }] })); if (m.type === 'nack') res(m); });
  });
  check('同網路的 WebSocket 只能讀取', nack && (await state()).event.title !== 'hacked', nack.error);
  ro.close();

  console.log('四強');
  check('選四強', (await json(LAN + '/api/remote/top4', { index: 0, team: 't1' }, tok)).status === 200 && (await state()).results.top4[0] === 't1');
  check('同一隊不能選兩次', (await json(LAN + '/api/remote/top4', { index: 1, team: 't1' }, tok)).status === 400);
  check('表演賽隊伍不能選為四強', (await json(LAN + '/api/remote/top4', { index: 1, team: 'g1' }, tok)).status === 400);

  console.log('手機畫面');
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const errors = [];
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  phone.on('pageerror', e => errors.push(e.message));
  await phone.goto(LAN + '/control/');
  check('手機開控制台網址會自動到遙控網頁', phone.url().endsWith('/remote/'), phone.url());
  await phone.waitForSelector('input[type=password]');
  await phone.screenshot({ path: path.join(SHOTS, 'remote-1-login.png') });
  await phone.fill('input[type=password]', 'wrong');
  await phone.click('button[type=submit]');
  await sleep(500);
  check('手機上密碼錯誤有提示', (await phone.textContent('.err')).includes('密碼不正確'));
  await phone.fill('input[type=password]', '');
  await phone.tap('input[type=password]');
  await phone.keyboard.type('funk2026', { delay: 40 });   // 用鍵盤一個字一個字打，跟真人一樣
  check('手機密碼欄可以打字', (await phone.inputValue('input[type=password]')) === 'funk2026');
  await phone.click('button[type=submit]');
  await phone.waitForSelector('.side .plus');
  await sleep(500);
  // 播出到四強對戰 1 → 遙控自動跟著切換
  await json(LOCAL + '/api/ops', { ops: [{ op: 'set', path: ['results', 'top4'], value: ['t1', 't7', 't2', 't4'] }, { op: 'set', path: ['show', 'cueId'], value: 'c-semi1' }] });
  await sleep(600);
  await phone.locator('.side').nth(0).locator('.plus').tap();
  await sleep(500);
  s = await state();
  check('手機按 +1 加到左方', s.results.battles.semi1.l === 3, String(s.results.battles.semi1.l));
  check('手機上的比分即時更新', (await phone.locator('.side .num').first().textContent()) === '3');
  const names = await phone.locator('.side .name').allTextContents();
  check('顯示對戰兩隊隊名', names[0] === s.teams.find(t => t.id === 't1').en && names[1] === s.teams.find(t => t.id === 't7').en, names.join(' vs '));
  await phone.screenshot({ path: path.join(SHOTS, 'remote-2-score.png') });
  await json(LOCAL + '/api/ops', { ops: [{ op: 'set', path: ['show', 'cueId'], value: 'c-final' }] });
  await sleep(600);
  check('播出換到決賽，遙控自動跟著切換', (await phone.locator('.meta h2').textContent()).includes('決賽'));
  await phone.locator('.tabs button', { hasText: '四強' }).tap();
  await sleep(300);
  await phone.locator('.match select').nth(3).selectOption('t9');
  await sleep(600);
  check('手機選四強', (await state()).results.top4[3] === 't9');
  const opts = await phone.locator('.match select').nth(2).locator('option').allTextContents();
  check('四強選單不含表演賽隊伍、已選的隊伍標示', !opts.some(o => /三十聯軍|華岡藝校/.test(o)) && opts.some(o => o.includes('（已選）')));
  await phone.screenshot({ path: path.join(SHOTS, 'remote-3-top4.png') });

  // 控制台設定頁（這台電腦）
  const ctrl = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  ctrl.on('pageerror', e => errors.push('control: ' + e.message));
  await ctrl.goto(LOCAL + '/control/');
  await ctrl.waitForSelector('.brand');
  await ctrl.getByRole('button', { name: '設定', exact: true }).click();
  await ctrl.waitForSelector('.remote .qr svg');
  const shown = await ctrl.locator('.remote code').allTextContents();
  check('設定頁顯示遙控網址與 QR Code', shown.some(u => u === LAN + '/remote/'), shown.join(' '));
  check('設定頁顯示已登入裝置數', (await ctrl.locator('.remote').textContent()).includes('已登入的裝置：2 台'));
  await ctrl.locator('.remote').scrollIntoViewIfNeeded();
  await ctrl.locator('.remote').screenshot({ path: path.join(SHOTS, 'remote-4-settings.png') });
  // 在設定頁打密碼時，手機同時在加分（整頁會重畫）：打的字不能被清掉
  const pwBox = ctrl.locator('.remote input[type=text]');
  await pwBox.fill('');
  await pwBox.click();
  let n = 0;
  const busyT = setInterval(() => { json(LAN + '/api/remote/score', { battle: 'semi2', side: 'l', delta: (n++ % 2) ? 1 : -1 }, tok); }, 150);
  await ctrl.keyboard.type('typed5678', { delay: 90 });
  clearInterval(busyT);
  await sleep(300);
  check('設定頁打密碼時有其他更新，字不會被清掉', (await ctrl.locator('.remote input[type=text]').inputValue()) === 'typed5678', await ctrl.locator('.remote input[type=text]').inputValue());
  check('打字時游標一直在密碼欄', await ctrl.evaluate(() => document.activeElement && document.activeElement.closest('.remote') !== null));
  await ctrl.getByRole('button', { name: '儲存密碼' }).click();
  await sleep(600);
  check('用設定頁的按鈕儲存密碼', (await json(LOCAL + '/api/remote/config')).body.password === 'typed5678');

  console.log('換密碼與暴力嘗試');
  await json(LOCAL + '/api/remote/config', { enabled: true, password: 'newpass99' });
  check('換密碼後舊的登入失效', (await json(LAN + '/api/remote/score', { battle: 'semi1', side: 'l', delta: 1 }, tok)).status === 401);
  await phone.locator('.tabs button', { hasText: '比分' }).tap();
  await sleep(300);
  await phone.locator('.side .plus').first().tap();
  await sleep(800);
  check('手機自動回到輸入密碼畫面', await phone.locator('input[type=password]').count() === 1);
  let last = 0;
  for (let i = 0; i < 9; i++) last = (await json(LAN + '/api/remote/login', { password: 'guess' + i })).status;
  check('連續猜錯密碼會暫時鎖住', last === 429, String(last));

  check('沒有錯誤訊息', errors.length === 0, errors.join(' | '));
  watcher.close();
  await browser.close();
  console.log(fails ? '\n失敗 ' + fails + ' 項' : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
