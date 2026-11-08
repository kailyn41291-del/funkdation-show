'use strict';
// 「評審討論」時先選四強：舊存檔自動開啟、演出面板與小面板都能選、輸出畫面不變
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { defaultState } = require('../default-state');

const SHOTS = path.resolve(process.argv[2] || os.tmpdir());
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 3212, BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (info ? '  — ' + info : '')); };
const ops = list => fetch(BASE + '/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: list }) });
const state = async () => (await (await fetch(BASE + '/api/state')).json()).state;

(async () => {
  // 舊存檔（schema 4）：評審討論沒有 pickTop4
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-pick-'));
  const old = defaultState();
  old.schema = 4;
  old.cues.forEach(c => { delete c.pickTop4; });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ rev: 1, state: old }));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { FD_DATA: dir, FD_PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'inherit'] });
  process.on('exit', () => srv.kill('SIGKILL'));
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('已啟動')) r(); }));
  let s = await state();
  check('舊存檔：「評審討論」自動開啟四強選隊', s.cues.find(c => c.id === 'c-judge').pickTop4 === true);
  check('其他待機 Cue 不會打開', !s.cues.find(c => c.id === 'c-open').pickTop4);

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const out = await browser.newPage({ viewport: { width: 960, height: 540 } });
  out.on('pageerror', e => errors.push('output: ' + e.message));
  await ops([{ op: 'set', path: ['show', 'cueId'], value: 'c-judge' }, { op: 'set', path: ['show', 'seq'], value: 2 }]);
  await out.goto(BASE + '/output/');
  await sleep(1200);
  const sceneBefore = await out.evaluate(() => document.querySelectorAll('.scene').length + '|' + document.querySelector('.scene:last-child').innerHTML.length);

  const ctrl = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  ctrl.on('pageerror', e => errors.push('control: ' + e.message));
  await ctrl.goto(BASE + '/control/');
  await ctrl.waitForSelector('.brand');
  await ctrl.getByRole('button', { name: '演出', exact: true }).click();
  await sleep(600);
  check('評審討論播出中：演出面板有四強選隊', await ctrl.locator('.insp .match').count() === 2);
  check('沒有揭曉按鈕（揭曉在四強公布）', await ctrl.getByRole('button', { name: '揭曉下一隊' }).count() === 0);
  const pickIds = ['t1', 't7', 't2', 't4'];
  for (let i = 0; i < 4; i++) { await ctrl.locator('.insp .match select').nth(i).selectOption(pickIds[i]); await sleep(250); }
  await sleep(400);
  s = await state();
  check('選好四強', s.results.top4.join() === pickIds.join(), s.results.top4.join());
  check('顯示已選好', (await ctrl.locator('.insp .hint.ok').textContent()).includes('四強已選好'));
  await ctrl.screenshot({ path: path.join(SHOTS, 'pick-judge.png') });
  const sceneAfter = await out.evaluate(() => document.querySelectorAll('.scene').length + '|' + document.querySelector('.scene:last-child').innerHTML.length);
  check('選隊時輸出畫面沒有變化', sceneBefore === sceneAfter, sceneBefore + ' / ' + sceneAfter);
  check('四強揭曉數仍是 0', (s.show.top4Shown || 0) === 0);

  // 小面板也有
  const mini = await browser.newPage();
  await mini.setViewportSize({ width: 420, height: 780 });
  mini.on('pageerror', e => errors.push('mini: ' + e.message));
  await mini.goto(BASE + '/control/?mini=1');
  await mini.waitForSelector('.go');
  await sleep(500);
  check('演出小面板也能選四強', await mini.locator('.match select').count() === 4 && (await mini.locator('.match select').nth(1).inputValue()) === 't7');
  await mini.screenshot({ path: path.join(SHOTS, 'pick-mini.png') });

  // GO 到四強公布：已經選好，直接揭曉
  await ops([{ op: 'set', path: ['show', 'cueId'], value: 'c-top4' }, { op: 'set', path: ['show', 'seq'], value: 3 }]);
  await sleep(600);
  const vals = [];
  for (let i = 0; i < 4; i++) vals.push(await ctrl.locator('.insp .match select').nth(i).inputValue());
  check('四強公布帶入評審討論時選的隊伍', vals.join() === pickIds.join(), vals.join());
  await ctrl.getByRole('button', { name: '揭曉下一隊' }).click();
  await sleep(300);
  check('可以直接揭曉', (await state()).show.top4Shown === 1);

  // 編排：每個待機 Cue 都可以開關
  await ctrl.getByRole('button', { name: '編排', exact: true }).click();
  await sleep(300);
  await ctrl.locator('.cue[data-id="c-open"]').click();
  await sleep(300);
  check('待機 Cue 設定有「四強選隊」開關', await ctrl.getByText('演出時在這個 Cue 顯示四強選隊（評審討論用）').count() === 1);
  check('沒有錯誤訊息', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? '\n失敗 ' + fails + ' 項' : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
