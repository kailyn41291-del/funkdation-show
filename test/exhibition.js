'use strict';
// 表演賽：特邀隊伍（Logo）、對戰計分、不列入九隊總覽／四強／頒獎，舊存檔自動加入
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../store');
const { defaultState } = require('../default-state');

const SHOTS = path.resolve(process.argv[2] || os.tmpdir());
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 3206, BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (info ? '  — ' + info : '')); };
async function state() { return (await (await fetch(BASE + '/api/state')).json()).state; }
async function ops(list) { await fetch(BASE + '/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: list }) }); }

(async () => {
  // 舊存檔（schema 3）：自動加入兩支特邀隊伍與表演賽 Cue（放在評審討論之後）
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-ex-'));
  const old = defaultState();
  old.schema = 3;
  old.teams = old.teams.filter(t => !t.guest);
  old.cues = old.cues.filter(c => c.battle !== 'exhibition');
  delete old.results.battles.exhibition;
  old.teams[0].en = 'MY RENAMED TEAM';
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ rev: 3, state: old }));
  const st = new Store(dir).state;
  const g = st.teams.filter(t => t.guest).map(t => t.en);
  check('舊存檔自動加入特邀隊伍', g.join() === '三十聯軍,華岡藝校', g.join());
  const ix = st.cues.findIndex(c => c.battle === 'exhibition');
  check('表演賽 Cue 放在「評審討論」之後', ix > 0 && st.cues[ix - 1].id === 'c-judge', ix + '');
  check('表演賽比分欄位', !!st.results.battles.exhibition);
  check('原本的隊伍資料不變', st.teams[0].en === 'MY RENAMED TEAM' && st.teams.filter(t => !t.guest).length === 9);

  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { FD_DATA: dir, FD_PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'inherit'] });
  process.on('exit', () => srv.kill('SIGKILL'));
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('已啟動')) r(); }));
  const logo = await fetch(BASE + '/builtin/guest-sanshi.png');
  check('內建 Logo 檔可以讀取', logo.ok && logo.headers.get('content-type') === 'image/png');

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const out = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  out.on('pageerror', e => errors.push(e.message));
  const exId = st.cues[ix].id;
  await ops([{ op: 'set', path: ['show', 'cueId'], value: exId }, { op: 'set', path: ['show', 'seq'], value: 2 }]);
  await out.goto(BASE + '/output/');
  await sleep(2500);
  const info = await out.evaluate(() => {
    const sc = [...document.querySelectorAll('.scene')].pop();
    const imgs = [...sc.querySelectorAll('.pbox .ph img')].map(i => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 }));
    const frames = [...sc.querySelectorAll('.pbox .fr')].map(f => getComputedStyle(f).display);
    const title = sc.querySelector('.txt .t').textContent;
    const names = [...sc.querySelectorAll('.txt.en .t')].map(t => t.textContent).filter(Boolean);
    return { imgs, frames, title, names };
  });
  await out.screenshot({ path: path.join(SHOTS, 'exhibition.png') });
  check('兩隊顯示 Logo', info.imgs.length === 2 && info.imgs.every(i => i.ok && /builtin\/guest-/.test(i.src)), info.imgs.map(i => i.src).join(', '));
  check('Logo 模式不顯示外框', info.frames.every(d => d === 'none'));
  check('標題 EXHIBITION／表演賽', /EXHIBITION/.test(info.title) && /表演賽/.test(info.title), info.title);
  check('Logo 已含隊名，對戰畫面不重複顯示隊名', !info.names.some(n => n === '三十聯軍' || n === '華岡藝校'), info.names.join(' / '));

  // 控制台：計分、勝方
  const ctrl = await browser.newPage({ viewport: { width: 1500, height: 920 } });
  ctrl.on('pageerror', e => errors.push('control: ' + e.message));
  await ctrl.goto(BASE + '/control/');
  await ctrl.waitForSelector('.brand');
  await ctrl.getByRole('button', { name: '演出', exact: true }).click();
  await sleep(800);
  await ctrl.locator('.sc').nth(0).getByRole('button', { name: '+1' }).click(); await sleep(200);
  await ctrl.locator('.sc').nth(0).getByRole('button', { name: '+1' }).click(); await sleep(200);
  await ctrl.locator('.sc').nth(1).getByRole('button', { name: '+1' }).click(); await sleep(200);
  await ctrl.locator('.sc').nth(0).getByRole('button', { name: '確認勝方' }).click(); await sleep(400);
  let s = await state();
  const b = s.results.battles.exhibition;
  check('表演賽計分與勝方', b.l === 2 && b.r === 1 && b.winner === 'l', JSON.stringify({ l: b.l, r: b.r, w: b.winner }));
  check('其他場次比分不受影響', s.results.battles.semi1.l === 0 && s.results.battles.semi1.r === 0);
  await ctrl.screenshot({ path: path.join(SHOTS, 'exhibition-control.png') });

  // 四強與頒獎選單不列出特邀隊伍
  await ops([{ op: 'set', path: ['show', 'cueId'], value: 'c-top4' }]);
  await sleep(800);
  const t4opts = await ctrl.locator('.match select').first().locator('option').allTextContents();
  check('四強選單不列出表演賽隊伍', t4opts.length === 10 && !t4opts.some(o => /三十聯軍|華岡藝校/.test(o)), t4opts.length + ' 個選項');
  await ops([{ op: 'set', path: ['show', 'cueId'], value: 'c-champ' }]);
  await sleep(800);
  const chOpts = await ctrl.locator('.awards select').locator('option').allTextContents();
  check('排舞賽冠軍選單不列出表演賽隊伍', !chOpts.some(o => /三十聯軍|華岡藝校/.test(o)));

  // 九隊總覽只排 9 隊
  await ops([{ op: 'set', path: ['show', 'cueId'], value: 'c-all' }, { op: 'set', path: ['show', 'seq'], value: 5 }]);
  await sleep(2500);
  const n = await out.evaluate(() => [...document.querySelectorAll('.scene')].pop().querySelectorAll('.slot').length);
  check('九隊總覽不含表演賽隊伍', n === 9, n + ' 隊');

  // 隊伍頁：表演賽欄位與 Logo 模式
  await ctrl.getByRole('button', { name: '隊伍', exact: true }).click();
  await sleep(600);
  await ctrl.locator('table.grid tbody tr').nth(9).locator('td').first().click();
  await sleep(600);
  check('隊伍頁有 Logo 模式與不顯示隊名選項', await ctrl.getByText('Logo 模式').count() > 0 && await ctrl.getByText('對戰畫面不顯示隊名（Logo 已含隊名）').count() > 0);
  await ctrl.screenshot({ path: path.join(SHOTS, 'exhibition-teams.png') });
  check('沒有錯誤訊息', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? '\n失敗 ' + fails + ' 項' : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
