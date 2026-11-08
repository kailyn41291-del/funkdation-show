'use strict';
// 手機版總控：總控密碼登入、切換 Cue（按兩下）、GO、播出中 Cue 的操作、權限與換密碼
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const SHOTS = path.resolve(process.argv[2] || os.tmpdir());
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 3221;
const LAN_IP = Object.values(os.networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal);
if (!LAN_IP) { console.log('沒有網路介面，略過'); process.exit(0); }
const LOCAL = `http://127.0.0.1:${PORT}`, LAN = `http://${LAN_IP.address}:${PORT}`;
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-master-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (info ? '  — ' + info : '')); };
const json = (url, body, tok) => fetch(url, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, loc: r.headers.get('location'), body: await r.json().catch(() => null) }));
const state = async () => (await json(LOCAL + '/api/state')).body.state;
function wsTry(token) {
  return new Promise(res => {
    const w = new WebSocket(`ws://${LAN_IP.address}:${PORT}/ws?kind=test` + (token ? '&token=' + token : ''));
    w.on('message', d => {
      const m = JSON.parse(d);
      if (m.type === 'hello') w.send(JSON.stringify({ type: 'ops', id: 'x1', ops: [{ op: 'set', path: ['event', 'subtitle'], value: 'by-' + (token ? token.slice(0, 4) : 'none') }] }));
      if (m.type === 'ack' || m.type === 'nack') { w.close(); res(m.type); }
    });
    w.on('error', () => res('error'));
  });
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { FD_DATA: DATA, FD_PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'inherit'] });
  process.on('exit', () => srv.kill('SIGKILL'));
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('已啟動')) r(); }));
  await json(LOCAL + '/api/ops', { ops: [{ op: 'set', path: ['results', 'top4'], value: ['t1', 't7', 't2', 't4'] }] });

  console.log('總控密碼設定');
  check('總控密碼至少 6 個字', (await json(LOCAL + '/api/remote/config', { enabled: true, password: 'score1', masterPassword: 'ab12' })).status === 400);
  check('總控密碼不能和其他密碼一樣', (await json(LOCAL + '/api/remote/config', { enabled: true, password: 'score1', masterPassword: 'score1' })).status === 400);
  await json(LOCAL + '/api/remote/config', { enabled: true, password: 'score1', timerPassword: 'tick99', masterPassword: 'boss2026' });
  const cfg = (await json(LOCAL + '/api/remote/config')).body;
  check('設定頁有手機版總控 QR Code 網址', cfg.urls.some(u => u.masterUrl === LAN + '/master'));

  console.log('權限');
  let r = await json(LAN + '/master');
  check('/master 轉到總控登入', r.status === 302 && r.loc === '/remote/?master=1');
  check('一般控制台網址仍轉到遙控網頁', (await json(LAN + '/control/')).loc === '/remote/');
  check('手機版控台網頁可以開', (await fetch(LAN + '/control/?mini=1&phone=1')).status === 200 && (await fetch(LAN + '/control/control.js')).status === 200);
  check('設定、匯出等 API 仍然擋住', (await json(LAN + '/api/state')).status === 403 && (await json(LAN + '/api/export')).status === 403 && (await json(LAN + '/api/remote/config')).status === 403);
  const master = (await json(LAN + '/api/remote/login', { password: 'boss2026' })).body;
  const full = (await json(LAN + '/api/remote/login', { password: 'score1' })).body;
  check('總控密碼登入', master.role === 'master');
  check('總控連線可以操作', await wsTry(master.token) === 'ack' && (await state()).event.subtitle === 'by-' + master.token.slice(0, 4));
  check('完整遙控密碼的連線不能直接操作', await wsTry(full.token) === 'nack');
  check('沒有登入的連線不能操作', await wsTry(null) === 'nack');
  check('總控也能用遙控指令加分', (await json(LAN + '/api/remote/score', { battle: 'semi1', side: 'l', delta: 1 }, master.token)).status === 200);

  console.log('手機畫面');
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const ph = await ctx.newPage();
  ph.on('pageerror', e => errors.push(e.message));
  // 沒登入直接開控台 → 回登入頁
  await ph.goto(LAN + '/control/?mini=1&phone=1');
  await ph.waitForURL(/\/remote\/\?master=1/, { timeout: 8000 }).catch(() => {});
  check('沒登入開手機版控台會回到登入頁', ph.url().endsWith('/remote/?master=1'), ph.url());
  await ph.waitForSelector('input[type=password]');
  check('總控登入畫面', (await ph.textContent('h1')) === '手機版總控');
  await ph.fill('input[type=password]', 'score1');
  await ph.click('button[type=submit]');
  await sleep(600);
  check('用完整遙控密碼不能進總控', (await ph.textContent('.err')).includes('不是總控密碼'));
  await ph.fill('input[type=password]', '');
  await ph.tap('input[type=password]');
  await ph.keyboard.type('boss2026', { delay: 30 });
  await ph.click('button[type=submit]');
  await ph.waitForSelector('.go', { timeout: 10000 });
  await sleep(1200);
  check('登入後進入手機版控台', ph.url().includes('/control/?mini=1&phone=1'));
  check('有 GO、黑畫面、回主視覺', await ph.locator('.go').isVisible() && await ph.getByRole('button', { name: '黑畫面' }).count() === 1);
  check('有全部 Cue 列表與 ▶ 播', await ph.locator('.cuelist .cue').count() > 10 && await ph.locator('.cue .jump').count() > 10);
  check('沒有編排用的按鈕（移動、刪除、新增）', await ph.locator('.cue .del').count() === 0 && !(await ph.locator('.addbar').isVisible().catch(() => false)));
  const ov = await ph.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  check('手機寬度不用左右捲動', !ov);
  await ph.screenshot({ path: path.join(SHOTS, 'master-1-top.png') });

  // 按兩下 ▶ 播 才切換
  const row = ph.locator('.cue[data-id="c-semi1"]');
  await row.scrollIntoViewIfNeeded();
  await row.locator('.jump').tap();
  await sleep(400);
  check('按一下只會變成「確定播？」', (await row.locator('.jump').textContent()) === '確定播？' && (await state()).show.cueId !== 'c-semi1');
  await row.locator('.jump').tap();
  await sleep(800);
  check('再按一下切到四強對戰 1', (await state()).show.cueId === 'c-semi1');
  await ph.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  check('操作區自動換成對戰的按鈕', await ph.locator('.sc').count() === 2);
  check('上方「播出中」立刻更新', (await ph.locator('#nowline').textContent()).includes('四強對戰 1'), await ph.locator('#nowline').textContent());
  await ph.locator('.sc').nth(1).getByRole('button', { name: '+1' }).tap();
  await sleep(500);
  check('手機版控台加分', (await state()).results.battles.semi1.r === 1);
  await ph.screenshot({ path: path.join(SHOTS, 'master-2-battle.png') });
  const before = (await state()).show.cueId;
  await ph.locator('.go').tap();
  await sleep(800);
  check('GO 播下一個', (await state()).show.cueId !== before, before + ' → ' + (await state()).show.cueId);
  await ph.getByRole('button', { name: '黑畫面' }).tap();
  await sleep(500);
  check('黑畫面', (await state()).show.blackout === true);
  await ph.getByRole('button', { name: '取消黑畫面' }).tap();
  await sleep(400);
  // 跳到頒獎
  const champ = ph.locator('.cue[data-id="c-champ"]');
  await champ.scrollIntoViewIfNeeded();
  await champ.locator('.jump').tap(); await sleep(200); await champ.locator('.jump').tap();
  await sleep(800);
  await ph.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  check('切到頒獎：出現揭曉按鈕', await ph.getByRole('button', { name: '1. 排舞賽冠軍揭曉' }).count() === 1);
  await ph.screenshot({ path: path.join(SHOTS, 'master-3-champ.png') });

  // 控制台設定頁顯示總控
  const ctrl = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  ctrl.on('pageerror', e => errors.push('control: ' + e.message));
  await ctrl.goto(LOCAL + '/control/');
  await ctrl.waitForSelector('.brand');
  await ctrl.getByRole('button', { name: '設定', exact: true }).click();
  await ctrl.waitForSelector('.remote .qr svg');
  await sleep(600);
  const caps = await ctrl.locator('.remote .qcap').allTextContents();
  check('設定頁有手機版總控的 QR Code', caps.includes('手機版總控'), caps.join(' / '));
  check('設定頁顯示總控登入數', (await ctrl.locator('.remote').textContent()).includes('總控 '));
  check('目前開著的畫面列出手機版總控', (await ctrl.locator('.clients').textContent()).includes('手機版總控'));

  console.log('換總控密碼');
  await json(LOCAL + '/api/remote/config', { enabled: true, password: 'score1', timerPassword: 'tick99', masterPassword: 'boss9999' });
  await sleep(800);
  check('舊的總控連線立刻不能操作', await wsTry(master.token) === 'nack');
  check('完整遙控不受影響', (await json(LAN + '/api/remote/score', { battle: 'semi2', side: 'l', delta: 1 }, full.token)).status === 200);
  await ph.reload();
  await ph.waitForURL(/\/remote\/\?master=1/, { timeout: 8000 }).catch(() => {});
  check('手機重新整理後回到總控登入頁', ph.url().endsWith('/remote/?master=1'), ph.url());

  check('沒有錯誤訊息', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? '\n失敗 ' + fails + ' 項' : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
