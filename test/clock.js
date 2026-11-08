'use strict';
// 倒數顯示頁（/clock）：同網路裝置不用密碼就能看、只能看、數字放到最大、最後 10 秒與時間到變色、斷線提示
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHOTS = path.resolve(process.argv[2] || os.tmpdir());
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 3213;
const LAN_IP = Object.values(os.networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal);
if (!LAN_IP) { console.log('沒有網路介面，略過'); process.exit(0); }
const LOCAL = `http://127.0.0.1:${PORT}`, LAN = `http://${LAN_IP.address}:${PORT}`;
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-clock-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (info ? '  — ' + info : '')); };
const ops = list => fetch(LOCAL + '/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: list }) });

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { FD_DATA: DATA, FD_PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'inherit'] });
  process.on('exit', () => { try { srv.kill('SIGKILL'); } catch (e) { /* 已結束 */ } });
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('已啟動')) r(); }));

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const errors = [];
  check('同網路裝置不用登入就能開（遙控網頁關閉時也可以）', (await fetch(LAN + '/clock/')).status === 200);
  const p = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(LAN + '/clock/');
  await sleep(1200);
  const txt = () => p.locator('#t').textContent();
  check('顯示目前 Timer（待命 1:00）', (await txt()) === '1:00' && (await p.locator('#t').getAttribute('class')) === 'idle', await txt());
  const only = await p.evaluate(() => [...document.body.children].filter(e => e.tagName !== 'SCRIPT' && getComputedStyle(e).display !== 'none').map(e => e.id));
  check('畫面上只有倒數數字', only.join() === 't', only.join());
  const box = await p.locator('#t').boundingBox();
  check('數字放很大（平板橫放佔寬度六成以上）', box.width > 1024 * 0.6, Math.round(box.width) + 'px');
  check('不能操作（沒有任何按鈕或輸入框）', await p.locator('button, input, select').count() === 0);

  // 開始倒數（例如控制台或遙控按開始）
  await ops([{ op: 'set', path: ['show', 'timer'], value: { duration: 12, endsAt: Date.now() + 12000, pausedLeft: 12 } }]);
  await sleep(700);
  check('開始倒數後即時更新', /^0:1[12]$/.test(await txt()) && (await p.locator('#t').getAttribute('class')) === '', await txt());
  await p.screenshot({ path: path.join(SHOTS, 'clock-1-running.png') });
  await sleep(2600);
  check('最後 10 秒變色', (await p.locator('#t').getAttribute('class')) === 'warn', await txt());
  await p.screenshot({ path: path.join(SHOTS, 'clock-2-warn.png') });
  await ops([{ op: 'set', path: ['show', 'timer'], value: { duration: 12, endsAt: Date.now() - 10, pausedLeft: 0 } }]);
  await sleep(400);
  check('時間到顯示 0:00 紅色', (await txt()) === '0:00' && (await p.locator('#t').getAttribute('class')) === 'over');

  // 手機直拿／橫拿都不會超出畫面
  for (const [w, h] of [[390, 844], [844, 390], [1920, 1080]]) {
    await p.setViewportSize({ width: w, height: h });
    await sleep(200);
    const b = await p.locator('#t').boundingBox();
    check(`${w}×${h} 數字完整在畫面內且夠大`, b.x >= 0 && b.x + b.width <= w + 1 && b.y >= 0 && b.y + b.height <= h + 1 && b.width > w * 0.55, Math.round(b.width) + '×' + Math.round(b.height));
    if (w === 390) await p.screenshot({ path: path.join(SHOTS, 'clock-3-phone.png') });
  }

  // 設定頁：遙控網頁關閉時也有倒數顯示的 QR Code
  const ctrl = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  ctrl.on('pageerror', e => errors.push('control: ' + e.message));
  await ctrl.goto(LOCAL + '/control/');
  await ctrl.waitForSelector('.brand');
  await ctrl.getByRole('button', { name: '設定', exact: true }).click();
  await ctrl.waitForSelector('.remote .qr svg');
  const caps = await ctrl.locator('.remote .qcap').allTextContents();
  check('設定頁有倒數顯示的 QR Code', caps.includes('倒數顯示（不用密碼）') && !caps.includes('完整遙控'), caps.join(' / '));
  check('網址正確', (await ctrl.locator('.remote code').allTextContents()).includes(LAN + '/clock/'));

  // 斷線提示
  srv.kill('SIGKILL');
  await sleep(2500);
  check('連線中斷時顯示提示', await p.locator('#off').isVisible());
  check('沒有錯誤訊息', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? '\n失敗 ' + fails + ' 項' : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
