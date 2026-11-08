'use strict';
// 回合稱號（先鋒、策應、中樞、副將、主將）與出賽名單：舊存檔升級成 5 回合、輸出依回合切換、
// 有填名字才顯示、控制台名單輸入（打字中被其他裝置更新也不會掉字）、編排分頁
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { defaultState } = require('../default-state');

const SHOTS = path.resolve(process.argv[2] || os.tmpdir());
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 3223, BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (info ? '  — ' + info : '')); };
const ops = list => fetch(BASE + '/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: list }) });
const state = async () => (await (await fetch(BASE + '/api/state')).json()).state;

(async () => {
  // 舊存檔（schema 5）：四強 4 回合、沒有回合稱號
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-rounds-'));
  const old = defaultState();
  old.schema = 5;
  old.cues.forEach(c => { if (c.battle === 'semi1' || c.battle === 'semi2' || c.battle === 'exhibition') c.rounds = 4; delete c.noTitles; });
  delete old.layouts.battle.rt;
  Object.values(old.results.battles).forEach(b => { delete b.names; });
  old.cues.forEach(c => { delete c.lineup; });
  old.results.battles.semi1.names = { l: ['舊名單'], r: [] }; // v1.0.23 存在 results，要搬到 Cue 上
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ rev: 1, state: old }));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { FD_DATA: dir, FD_PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'inherit'] });
  process.on('exit', () => srv.kill('SIGKILL'));
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('已啟動')) r(); }));
  let s = await state();
  const rounds = s.cues.filter(c => c.type === 'battle').map(c => c.battle + ':' + c.rounds).join(' ');
  check('舊存檔：四強、決賽都是 5 回合', ['semi1', 'semi2', 'final'].every(b => s.cues.find(c => c.battle === b).rounds === 5), rounds);
  const ex = s.cues.find(c => c.battle === 'exhibition');
  check('表演賽改成 3 回合、不顯示稱號', ex.rounds === 3 && ex.noTitles === true, rounds);
  const c1 = s.cues.find(c => c.id === 'c-semi1');
  check('舊名單搬到 Cue 上', c1.lineup && c1.lineup.l[0] === '舊名單' && !s.results.battles.semi1.names, JSON.stringify(c1.lineup));
  check('預設模式：稱號放在照片框裡', s.layouts.battle.rt.mode === 'photo');
  check('舊存檔補上預設稱號', s.layouts.battle.rt.titles.join() === '先鋒,策應,中樞,副將,主將');
  check('預設用內建書法 PNG', s.layouts.battle.rt.images.length === 5 && s.layouts.battle.rt.images[0] === 'builtin/round-1.png');
  check('內建 PNG 可以讀到', (await fetch(BASE + '/builtin/round-5.png')).status === 200);

  await ops([{ op: 'set', path: ['layouts', 'battle', 'rt', 'mode'], value: 'side' }, { op: 'set', path: ['results', 'top4'], value: ['t1', 't7', 't2', 't4'] }, { op: 'set', path: ['show', 'cueId'], value: 'c-semi1' }, { op: 'set', path: ['show', 'seq'], value: 2 },
    { op: 'set', path: ['cues', s.cues.findIndex(c => c.id === 'c-semi1'), 'lineup'], value: { l: ['小明'], r: ['阿華'] } }]);

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const out = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  out.on('pageerror', e => errors.push('output: ' + e.message));
  await out.goto(BASE + '/output/');
  await sleep(4000);
  // 每一側：圖片（src 檔名）或直式文字，以及中心 x
  const read = () => out.evaluate(() => {
    const sc = document.querySelector('.scene:last-child');
    const shown = el => el && getComputedStyle(el.parentNode).display !== 'none' && +getComputedStyle(el).opacity > 0.5;
    const imgs = [...sc.querySelectorAll('.rimg')], tts = [...sc.querySelectorAll('.rtitle')], n = [...sc.querySelectorAll('.rname')];
    const side = i => {
      const el = shown(imgs[i]) ? imgs[i] : shown(tts[i]) && tts[i].textContent ? tts[i] : null;
      if (!el) return { v: '' };
      const r = el.getBoundingClientRect();
      return { v: el.tagName === 'IMG' ? 'img:' + el.getAttribute('src').split('/').pop() : 'txt:' + el.textContent, cx: r.left + r.width / 2, h: r.height, w: r.width, vert: getComputedStyle(el).writingMode };
    };
    return { L: side(0), R: side(1), names: n.map(x => shown(x) && x.textContent ? x.textContent : ''), nameBox: n.map(x => x.getBoundingClientRect()), loaded: document.fonts.check('400 64px "FD Potta One"', '先鋒') };
  });
  let r = await read();
  check('第 1 回合：左右各一張「先鋒」圖', r.L.v === 'img:round-1.png' && r.R.v === 'img:round-1.png', r.L.v + ' / ' + r.R.v);
  check('稱號在兩隊外側', Math.abs(r.L.cx - 150) < 15 && Math.abs(r.R.cx - 1770) < 15, Math.round(r.L.cx) + ' / ' + Math.round(r.R.cx));
  check('圖片比例正確、不超出設定大小', r.L.h <= 401 && r.L.w <= 271 && r.L.h > 300, Math.round(r.L.w) + 'x' + Math.round(r.L.h));
  check('有填名字：顯示兩方舞者', r.names.join() === '小明,阿華', r.names.join());
  check('名字在稱號下方', r.nameBox[0].top > 440 + r.L.h / 2 && Math.abs(r.nameBox[0].left + r.nameBox[0].width / 2 - 150) < 15);
  await out.screenshot({ path: path.join(SHOTS, 'rounds-r1.png') });

  const titles = ['先鋒', '策應', '中樞', '副將', '主將'];
  for (let i = 2; i <= 5; i++) {
    await out.evaluate(i => window.fd.cmd([{ op: 'set', path: ['results', 'battles', 'semi1', 'round'], value: i }], { name: 'round', battle: 'semi1', round: i }), i);
    await sleep(1800);
    r = await read();
    check('第 ' + i + ' 回合：' + titles[i - 1] + ' 圖（沒填名字只有稱號）', r.L.v === 'img:round-' + i + '.png' && r.R.v === r.L.v && r.names.join('') === '', r.L.v + ' / ' + r.names.join());
  }
  await out.screenshot({ path: path.join(SHOTS, 'rounds-r5.png') });

  // 控制台：演出面板的出賽名單
  const ctrl = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  ctrl.on('pageerror', e => errors.push('control: ' + e.message));
  await ctrl.goto(BASE + '/control/');
  await ctrl.waitForSelector('.brand');
  await ctrl.getByRole('button', { name: '演出', exact: true }).click();
  await sleep(600);
  check('演出面板有 5 回合名單', await ctrl.locator('.insp .lineup .lrow:not(.lhead)').count() === 5);
  check('目前回合（主將）標示', (await ctrl.locator('.insp .lineup .lrow.cur b').textContent()) === '主將');
  const inL5 = ctrl.locator('.insp .lineup .lrow:not(.lhead)').nth(4).locator('input').first();
  await inL5.click();
  await ctrl.keyboard.type('KEN', { delay: 40 });
  // 打字途中其他裝置（例如手機）改了比分：面板重畫，焦點與游標要留著
  await ops([{ op: 'set', path: ['results', 'battles', 'semi1', 'l'], value: 3 }]);
  await sleep(300);
  await ctrl.keyboard.type('JI', { delay: 40 });
  await ctrl.keyboard.press('Tab');
  await ctrl.keyboard.type('阿傑');
  await sleep(500);
  s = await state();
  const nm = s.cues.find(c => c.id === 'c-semi1').lineup;
  check('打字中被其他裝置更新也不會掉字', nm.l[4] === 'KENJI', JSON.stringify(nm.l));
  check('Tab 跳到右方繼續輸入', nm.r[4] === '阿傑', JSON.stringify(nm.r));
  check('舊的名字保留', nm.l[0] === '小明' && nm.r[0] === '阿華');
  await sleep(800);
  r = await read();
  check('輸出畫面即時顯示這回合的名字', r.names.join() === 'KENJI,阿傑', r.names.join());
  // 沒有圖的回合改用直式書法字
  await out.evaluate(() => window.fd.cmd([{ op: 'set', path: ['layouts', 'battle', 'rt', 'images', 4], value: null }], { name: 'round', battle: 'semi1', round: 5 }));
  await sleep(1500);
  r = await read();
  check('沒有圖：左右直式文字「主將」', r.L.v === 'txt:主將' && r.R.v === 'txt:主將' && r.L.vert === 'vertical-rl' && r.L.h > r.L.w, r.L.v + ' ' + r.L.vert);
  check('書法字型已載入', r.loaded);
  await out.screenshot({ path: path.join(SHOTS, 'rounds-text.png') });
  await out.screenshot({ path: path.join(SHOTS, 'rounds-names.png') });
  await ctrl.screenshot({ path: path.join(SHOTS, 'rounds-ctrl.png') });

  // 演出小面板也能填
  const mini = await browser.newPage();
  await mini.setViewportSize({ width: 420, height: 780 });
  mini.on('pageerror', e => errors.push('mini: ' + e.message));
  await mini.goto(BASE + '/control/?mini=1');
  await mini.waitForSelector('.go');
  await sleep(500);
  check('演出小面板也有出賽名單', await mini.locator('.lineup .lrow:not(.lhead)').count() === 5);
  await mini.screenshot({ path: path.join(SHOTS, 'rounds-mini.png'), fullPage: true });

  // 編排：名單、回合稱號分頁
  await ctrl.getByRole('button', { name: '編排', exact: true }).click();
  await sleep(400);
  await ctrl.locator('.cue[data-id="c-final"]').click();
  await sleep(300);
  for (const tab of ['回合稱號', '動畫', '基本']) { await ctrl.locator('.tabs button', { hasText: tab }).click(); await sleep(250); }
  check('編排「基本」分頁就有出賽名單', await ctrl.locator('.insp .lineup .lrow:not(.lhead)').count() === 5);
  const fin = ctrl.locator('.insp .lineup .lrow:not(.lhead)').nth(0).locator('input').first();
  await fin.fill('決賽先鋒A');
  await sleep(400);
  check('決賽名單存在決賽 Cue', (await state()).cues.find(c => c.id === 'c-final').lineup.l[0] === '決賽先鋒A');
  await ctrl.screenshot({ path: path.join(SHOTS, 'rounds-basic.png') });
  // 清除比賽結果不會清掉名單
  await ctrl.locator('.tabs button', { hasText: '回合稱號' }).click();
  await sleep(250);
  await ctrl.screenshot({ path: path.join(SHOTS, 'rounds-edit.png') });
  const t4 = ctrl.locator('.insp input[data-keep="rtitle3"]');
  await t4.fill('副將！');
  await ctrl.locator('.insp .fld:has(> label:text-is("書法字型")) select').selectOption('FD Yuji Boku');
  check('回合稱號分頁有 5 個上傳按鈕', await ctrl.locator('.insp .rtrow').count() === 5);
  await sleep(500);
  s = await state();
  check('可以改稱號', s.layouts.battle.rt.titles[3] === '副將！');
  check('可以換書法字型', s.layouts.battle.rt.font === 'FD Yuji Boku');
  // 名字字型、顏色獨立設定
  await ctrl.locator('.insp .fld:has(> label:text-is("名字字型")) select').selectOption('FD Reggae One');
  await sleep(400);
  s = await state();
  check('名字字型可以獨立選', s.layouts.battle.rt.nameFont === 'FD Reggae One' && s.layouts.battle.rt.font === 'FD Yuji Boku', s.layouts.battle.rt.nameFont);
  await ops([{ op: 'set', path: ['layouts', 'battle', 'rt', 'nameColor'], value: '#ffffff' }]);
  await sleep(800);
  const nfStyle = await out.evaluate(() => { const n = document.querySelector('.scene:last-child .rname'); const cs = getComputedStyle(n); return cs.fontFamily + '|' + cs.color; });
  check('輸出：名字用自己的字型與顏色', nfStyle.includes('FD Reggae One') && nfStyle.includes('255, 255, 255'), nfStyle);
  // 調整位置與大小（滑桿的數字框）
  const slider = label => ctrl.getByLabel(label + '數值', { exact: true });
  for (const [label, val] of [['大小（高度）', '300'], ['左右位置', '700'], ['上下位置', '500']]) { await slider(label).fill(val); await slider(label).press('Enter'); await sleep(200); }
  await sleep(300);
  s = await state();
  check('可以調大小與位置', s.layouts.battle.v.rh === 300 && s.layouts.battle.v.rx === 700 && s.layouts.battle.v.ry === 500, JSON.stringify([s.layouts.battle.v.rh, s.layouts.battle.v.rx, s.layouts.battle.v.ry]));
  await out.evaluate(() => window.fd.cmd([{ op: 'set', path: ['results', 'battles', 'semi1', 'round'], value: 1 }], { name: 'round', battle: 'semi1', round: 1 }));
  await sleep(1500);
  r = await read();
  check('輸出跟著改：高 300、在中心 ±700', Math.abs(r.L.h - 300) < 2 && Math.abs(r.L.cx - 260) < 15 && Math.abs(r.R.cx - 1660) < 15, Math.round(r.L.h) + ' ' + Math.round(r.L.cx) + ' ' + Math.round(r.R.cx));
  await ctrl.locator('.insp h3', { hasText: '稱號位置與大小' }).scrollIntoViewIfNeeded();
  await ctrl.screenshot({ path: path.join(SHOTS, 'rounds-edit2.png') });
  // 照片框模式：稱號取代團隊照片，放在框正中央
  await ops([{ op: 'set', path: ['layouts', 'battle', 'v'], value: Object.assign({}, s.layouts.battle.v, { rh: 400, rx: 810, ry: 440 }) }]);
  await out.evaluate(() => window.fd.cmd([{ op: 'set', path: ['layouts', 'battle', 'rt', 'mode'], value: 'photo' }, { op: 'set', path: ['results', 'battles', 'semi1', 'round'], value: 3 }], { name: 'round', battle: 'semi1', round: 3 }));
  await sleep(1500);
  r = await read();
  const pm = await out.evaluate(() => { const sc = document.querySelector('.scene:last-child'); const b = sc.querySelector('.pbox').getBoundingClientRect(); return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, h: b.height, photo: [...sc.querySelectorAll('.pbox .ph img, .pbox .fr')].map(i => getComputedStyle(i).visibility).join() }; });
  const ib = await out.evaluate(() => { const r = document.querySelector('.scene:last-child .rimg').getBoundingClientRect(); return { cy: r.top + r.height / 2 }; });
  check('照片框模式：「中樞」圖在左框正中央', r.L.v === 'img:round-3.png' && Math.abs(r.L.cx - pm.cx) < 3 && Math.abs(ib.cy - (pm.cy - 15)) < 3 && Math.abs(r.L.h - pm.h * 1.1) < 3, Math.round(r.L.cx) + ',' + Math.round(ib.cy) + ' vs ' + Math.round(pm.cx) + ',' + Math.round(pm.cy));
  check('照片框模式：團隊照片與外框都隱藏', pm.photo === 'hidden,hidden,hidden,hidden', pm.photo);
  await out.screenshot({ path: path.join(SHOTS, 'rounds-photo.png') });
  // 表演賽：不顯示稱號，照片照常
  await ops([{ op: 'set', path: ['show', 'cueId'], value: 'c-exhib' }]);
  await sleep(3500);
  r = await read();
  const exPhoto = await out.evaluate(() => [...document.querySelectorAll('.scene:last-child .pbox .ph img')].map(i => getComputedStyle(i).visibility).join());
  check('表演賽：沒有稱號、Logo 照常顯示', r.L.v === '' && r.R.v === '' && exPhoto === 'visible,visible', exPhoto);
  await ops([{ op: 'set', path: ['show', 'cueId'], value: 'c-semi1' }, { op: 'set', path: ['layouts', 'battle', 'rt', 'on'], value: false }]);
  await sleep(3500);
  r = await read();
  check('關閉稱號：輸出不顯示', r.L.v === '' && r.R.v === '' && r.names.join('') === '');

  check('沒有 JS 錯誤', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
