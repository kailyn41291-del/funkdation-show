'use strict';
// 評審表演實測：懸念文字 → 評審登場 → 退場，以及控制台評審頁、編排分頁
// 執行：node test/judge.js <素材資料夾> <截圖資料夾>
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ASSETS = path.resolve(process.argv[2] || 'test/assets');
const SHOTS = path.resolve(process.argv[3] || os.tmpdir());
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 3201, BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-judge-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (info ? '  — ' + info : '')); };
async function ops(list) { const r = await fetch(BASE + '/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: list }) }); return r.json(); }
async function state() { return (await (await fetch(BASE + '/api/state')).json()).state; }

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { FD_DATA: DATA, FD_PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'inherit'] });
  process.on('exit', () => srv.kill('SIGKILL'));
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('已啟動')) r(); }));
  let s = await state();
  check('預設有評審資料', Array.isArray(s.judges) && s.judges.length === 3, s.judges.map(j => j.en).join(', '));
  check('預設有評審版型', !!(s.layouts.judge && s.layouts.judge.text.lead === 'NEXT JUDGE IS...'));

  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(path.join(ASSETS, 'p6.png'))]), 'judge.png');
  const src = (await (await fetch(BASE + '/api/upload', { method: 'POST', body: fd })).json()).path;
  await ops([
    { op: 'set', path: ['judges', 0, 'en'], value: 'MR. WIGGLES' },
    { op: 'set', path: ['judges', 0, 'tag'], value: 'ROCK STEADY CREW' },
    { op: 'set', path: ['judges', 0, 'photo', 'src'], value: src },
    { op: 'set', path: ['layouts', 'judge', 'bg', 'mode'], value: 'image' },
    { op: 'set', path: ['cues'], value: s.cues.slice(0, 1).concat([{ id: 'c-j1', type: 'judge', judge: 'j1' }, { id: 'c-j2', type: 'judge', judge: 'j2' }]) }
  ]);
  const bgFd = new FormData();
  bgFd.append('file', new Blob([fs.readFileSync(path.join(ASSETS, 'bg.jpg'))]), 'bg.jpg');
  const bgSrc = (await (await fetch(BASE + '/api/upload', { method: 'POST', body: bgFd })).json()).path;
  await ops([{ op: 'set', path: ['layouts', 'judge', 'bg', 'src'], value: bgSrc }]);

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const out = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  out.on('pageerror', e => errors.push('output: ' + e.message));
  await out.goto(BASE + '/output/');
  await sleep(800);

  const vis = () => out.evaluate(() => {
    const sc = document.querySelectorAll('.scene');
    const root = sc[sc.length - 1];
    if (!root) return null;
    const op = el => el ? Number(getComputedStyle(el).opacity) : -1;
    const txt = [...root.querySelectorAll('.txt .t')];
    const find = s => txt.find(t => t.textContent === s);
    return { lead: op(find('NEXT JUDGE IS...')), leadZh: op(find('下一位評審')), name: op(find('MR. WIGGLES')), tag: op(find('ROCK STEADY CREW')), title: op(find('JUDGE')), photo: op(root.querySelector('.pbox .ph')) };
  });

  // GO 到評審 Cue
  await ops([{ op: 'set', path: ['show', 'cueId'], value: 'c-j1' }, { op: 'set', path: ['show', 'seq'], value: 5 }, { op: 'set', path: ['show', 'teamOut'], value: false }]);
  await sleep(1300);
  let v = await vis();
  await out.screenshot({ path: path.join(SHOTS, 'judge-1-lead.png') });
  check('先出現懸念文字 NEXT JUDGE IS...', v && v.lead > 0.9 && v.leadZh > 0.9, JSON.stringify(v));
  check('懸念時評審還沒出現', v && v.name < 0.05 && v.photo < 0.05);
  await sleep(3600);
  v = await vis();
  await out.screenshot({ path: path.join(SHOTS, 'judge-2-reveal.png') });
  check('懸念文字退場', v && v.lead < 0.05 && v.leadZh < 0.05, JSON.stringify(v));
  check('評審照片、名字、Crew、稱號都出現', v && v.photo > 0.9 && v.name > 0.9 && v.tag > 0.9 && v.title > 0.9);

  // 退場
  await ops([{ op: 'set', path: ['show', 'teamOut'], value: true }]);
  const c = await out.evaluate(() => 1);
  // 送出退場事件（與控制台按 X 相同）
  await out.evaluate(() => window.fd.cmd([], { event: { name: 'teamExit' } }));
  await sleep(2500);
  v = await vis();
  check('按退場後畫面回到乾淨底圖', v && v.photo < 0.05 && v.name < 0.05 && v.title < 0.05, JSON.stringify(v));

  // 直接顯示（跳過懸念）
  await ops([{ op: 'set', path: ['show', 'teamOut'], value: false }]);
  await out.evaluate(() => window.fd.cmd([], { event: { name: 'judgeDirect' } }));
  await sleep(600);
  v = await vis();
  check('「直接顯示」不出現懸念文字', v && v.lead < 0.05 && v.photo > 0.5, JSON.stringify(v));

  // 直式比例
  await ops([{ op: 'set', path: ['layouts', 'judge', 'ratio'], value: '4:5' }, { op: 'set', path: ['layouts', 'judge', 'v', 'pw'], value: 480 }, { op: 'set', path: ['layouts', 'judge', 'v', 'pt'], value: 170 }]);
  await sleep(500);
  const box = await out.evaluate(() => { const b = [...document.querySelectorAll('.scene')].pop().querySelector('.pbox'); return [b.offsetWidth, b.offsetHeight]; });
  await out.screenshot({ path: path.join(SHOTS, 'judge-3-portrait.png') });
  check('照片比例改成直式 4:5', box[0] === 480 && box[1] === 600, box.join('×'));
  await ops([{ op: 'set', path: ['layouts', 'judge', 'ratio'], value: '3:2' }, { op: 'set', path: ['layouts', 'judge', 'v', 'pw'], value: 760 }, { op: 'set', path: ['layouts', 'judge', 'v', 'pt'], value: 230 }]);

  // 控制台
  const ctrl = await browser.newPage({ viewport: { width: 1500, height: 920 } });
  ctrl.on('pageerror', e => errors.push('control: ' + e.message));
  ctrl.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION/.test(m.text())) errors.push('control console: ' + m.text()); });
  await ctrl.goto(BASE + '/control/');
  await ctrl.waitForSelector('.brand');
  await ctrl.getByRole('button', { name: '評審', exact: true }).click();
  await sleep(1200);
  await ctrl.screenshot({ path: path.join(SHOTS, 'judge-4-page.png') });
  check('評審頁列出 3 位評審', await ctrl.locator('table.grid tbody tr').count() === 3);
  await ctrl.getByRole('button', { name: '＋ 新增評審' }).click();
  await sleep(500);
  s = await state();
  check('新增評審', s.judges.length === 4);

  await ctrl.getByRole('button', { name: '流程', exact: true }).click();
  await ctrl.getByRole('button', { name: '編排', exact: true }).click();
  await sleep(500);
  await ctrl.locator('.cue[data-id="c-j1"]').click();
  await sleep(400);
  for (const tab of ['基本', '文字', '照片', '版面', '動畫']) {
    await ctrl.locator('.tabs button', { hasText: tab }).click();
    await sleep(300);
  }
  await ctrl.locator('.tabs button', { hasText: '基本' }).click();
  await sleep(1500);
  await ctrl.screenshot({ path: path.join(SHOTS, 'judge-5-editor.png') });
  check('評審 Cue 的 5 個設定分頁都能開', errors.length === 0, errors.join(' | '));

  // 產生評審 Cue
  const before = (await state()).cues.length;
  await ctrl.locator('.addbar select').first().selectOption('judge');
  await ctrl.getByRole('button', { name: '產生評審' }).click();
  await sleep(500);
  s = await state();
  check('「產生評審」一次加入全部評審', s.cues.length === before + 4 && s.cues.filter(c => c.type === 'judge').length === 6, s.cues.length + ' 個 Cue');

  // 演出模式按鈕
  await ctrl.getByRole('button', { name: '演出', exact: true }).click();
  await sleep(600);
  const btns = await ctrl.locator('.pane button').allTextContents();
  check('演出模式有重播／直接顯示／退場', ['重播（含懸念文字）', '直接顯示評審', '退場（X）'].every(b => btns.includes(b)), btns.join('、'));
  await ctrl.keyboard.press('x');
  await sleep(300);
  check('快捷鍵 X 退場', (await state()).show.teamOut === true);

  check('沒有錯誤訊息', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? '\n失敗 ' + fails + ' 項' : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
