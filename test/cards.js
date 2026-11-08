'use strict';
// 成員字卡：隊伍頁一次上傳多張（檔名＝名字）→ 對戰出賽名單選人 → 輸出顯示字卡；
// 「不顯示」、手動輸入、整體關掉名字、四強換隊後舊隊伍的人不出現
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHOTS = path.resolve(process.argv[2] || os.tmpdir());
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 3225, BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (info ? '  — ' + info : '')); };
const ops = list => fetch(BASE + '/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: list }) });
const state = async () => (await (await fetch(BASE + '/api/state')).json()).state;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-cards-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { FD_DATA: dir, FD_PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'inherit'] });
  process.on('exit', () => srv.kill('SIGKILL'));
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('已啟動')) r(); }));
  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];

  // 產生字卡 PNG（透明背景、四周留白）
  const cardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-cardpng-'));
  // 直式字卡
  const mk = await browser.newPage({ viewport: { width: 300, height: 800 } });
  for (const name of ['小明', 'KENJI']) {
    await mk.setContent(`<body style="margin:0;background:transparent"><div style="width:300px;height:800px;display:flex;align-items:center;justify-content:center"><span style="font:900 110px serif;color:#111;writing-mode:vertical-rl;text-orientation:upright;padding:20px 0">${name}</span></div></body>`);
    fs.writeFileSync(path.join(cardDir, name + '.png'), await mk.screenshot({ omitBackground: true }));
  }
  await mk.close();

  let s = await state();
  const t1 = s.teams[0];
  await ops([{ op: 'set', path: ['results', 'top4'], value: [t1.id, 't7', 't2', 't4'] }, { op: 'set', path: ['show', 'cueId'], value: 'c-semi1' }, { op: 'set', path: ['show', 'seq'], value: 2 }]);

  const ctrl = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  ctrl.on('pageerror', e => errors.push('control: ' + e.message));
  await ctrl.goto(BASE + '/control/');
  await ctrl.waitForSelector('.brand');
  await ctrl.getByRole('button', { name: '隊伍', exact: true }).click();
  await sleep(500);
  // 用檔案內容傳（Playwright 直接給中文路徑時只會帶到一個檔案）
  await ctrl.locator('#memberEd input[type=file]').first().setInputFiles(['小明.png', 'KENJI.png'].map(n => ({ name: n, mimeType: 'image/png', buffer: fs.readFileSync(path.join(cardDir, n)) })));
  for (let k = 0; k < 40 && !((await state()).teams[0].members || []).length; k++) await sleep(250);
  await sleep(500);
  s = await state();
  const ms = s.teams[0].members || [];
  check('一次上傳兩張字卡，檔名變成名字', ms.map(m => m.name).join() === '小明,KENJI', ms.map(m => m.name).join());
  check('透明 PNG 自動裁邊', ms.every(m => m.card && m.card.trim), JSON.stringify(ms.map(m => m.card)));
  check('隊伍頁列出成員', await ctrl.locator('#memberEd .mrow').count() === 2);
  await ctrl.screenshot({ path: path.join(SHOTS, 'cards-team.png') });

  // 編排：四強對戰 1 的出賽名單選人
  await ctrl.getByRole('button', { name: '流程', exact: true }).click();
  await ctrl.getByRole('button', { name: '編排', exact: true }).click();
  await sleep(400);
  await ctrl.locator('.cue[data-id="c-semi1"]').click();
  await sleep(300);
  await ctrl.locator('.tabs button', { hasText: '基本' }).click();
  await sleep(300);
  const pick = ctrl.getByLabel('左方第 1 回合選人');
  check('左方（有成員）是選單，右方（沒成員）是文字欄', await pick.count() === 1 && await ctrl.getByLabel('右方第 1 回合舞者').count() === 1);
  await pick.selectOption({ label: '小明' });
  await sleep(300);
  await ctrl.getByLabel('左方第 2 回合選人').selectOption({ label: 'KENJI' });
  await sleep(300);
  await ctrl.getByLabel('右方第 1 回合舞者').fill('阿華');
  await sleep(400);
  s = await state();
  const lu = s.cues.find(c => c.id === 'c-semi1').lineup;
  check('名單存成員 id', lu.l[0] && lu.l[0].m === ms[0].id && lu.l[1].m === ms[1].id && lu.r[0] === '阿華', JSON.stringify(lu));
  await ctrl.screenshot({ path: path.join(SHOTS, 'cards-lineup.png') });

  const out = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  out.on('pageerror', e => errors.push('output: ' + e.message));
  await out.goto(BASE + '/output/');
  await sleep(4000);
  const read = () => out.evaluate(() => {
    const sc = document.querySelector('.scene:last-child');
    const vis = el => el && getComputedStyle(el.parentNode).display !== 'none' && +getComputedStyle(el).opacity > 0.5;
    const cards = [...sc.querySelectorAll('.rcard')], names = [...sc.querySelectorAll('.rname')];
    return [0, 1].map(i => {
      if (vis(cards[i]) && cards[i].getAttribute('src')) { const r = cards[i].getBoundingClientRect(); return 'card:' + cards[i].getAttribute('src').split('/').pop() + '@' + Math.round(r.left + r.width / 2) + 'h' + Math.round(r.height) + 'r' + Math.round(r.right); }
      return vis(names[i]) && names[i].textContent ? 'txt:' + names[i].textContent : '';
    });
  });
  let r = await read();
  const trimName = ms[0].card.trim.split('/').pop();
  const tb = await out.evaluate(() => { const r = document.querySelector('.scene:last-child .rimg:not(.rcard)').getBoundingClientRect(); return { l: r.left, cy: r.top + r.height / 2 }; });
  const cb = await out.evaluate(() => { const r = document.querySelector('.scene:last-child .rcard').getBoundingClientRect(); return { r: r.right, cy: r.top + r.height / 2, h: r.height }; });
  check('左方顯示小明的直式字卡：在稱號外側（左邊）、高度 260、和稱號垂直置中', r[0].startsWith('card:' + trimName) && Math.abs(cb.h - 260) < 2 && Math.abs(tb.l - 16 - cb.r) < 3 && Math.abs(cb.cy - tb.cy) < 3, r[0] + ' ' + JSON.stringify([tb, cb]));
  check('右方沒有字卡：顯示打的名字', r[1] === 'txt:阿華', r[1]);
  const vt = await out.evaluate(() => { const n = document.querySelectorAll('.scene:last-child .rname')[1]; const r = n.getBoundingClientRect(); return getComputedStyle(n).writingMode + ' ' + Math.round(r.left); });
  check('文字名字也直排、在右隊稱號外側（右邊）', vt.startsWith('vertical-rl') && +vt.split(' ')[1] > 1420 + 50, vt);
  await out.screenshot({ path: path.join(SHOTS, 'cards-r1.png') });
  // 改成內側
  await ops([{ op: 'set', path: ['layouts', 'battle', 'rt', 'namePos'], value: 'inner' }]);
  await sleep(1000);
  const cb2 = await out.evaluate(() => { const r = document.querySelector('.scene:last-child .rcard').getBoundingClientRect(); return r.left; });
  check('改成內側：字卡在左隊稱號右邊', cb2 > 500, String(Math.round(cb2)));
  await out.screenshot({ path: path.join(SHOTS, 'cards-inner.png') });
  await ops([{ op: 'set', path: ['layouts', 'battle', 'rt', 'namePos'], value: 'outer' }]);
  await sleep(800);

  await out.evaluate(() => window.fd.cmd([{ op: 'set', path: ['results', 'battles', 'semi1', 'round'], value: 2 }], { name: 'round', battle: 'semi1', round: 2 }));
  await sleep(1800);
  r = await read();
  check('第 2 回合換成 KENJI 的字卡、右方沒填', r[0].startsWith('card:') && !r[0].includes(trimName) && r[1] === '', r.join(' | '));

  // 選「不顯示」
  await ctrl.getByLabel('左方第 2 回合選人').selectOption('');
  await sleep(1000);
  r = await read();
  check('選「不顯示」：只剩稱號', r[0] === '' && r[1] === '', r.join(' | '));

  // 手動輸入
  await ctrl.getByLabel('左方第 2 回合選人').selectOption('__text');
  await sleep(400);
  await ctrl.getByLabel('左方第 2 回合舞者').fill('臨時換人');
  await sleep(1000);
  r = await read();
  check('手動輸入：顯示文字', r[0] === 'txt:臨時換人', r[0]);

  // 整體關掉名字
  await out.evaluate(() => window.fd.cmd([{ op: 'set', path: ['results', 'battles', 'semi1', 'round'], value: 1 }], { name: 'round', battle: 'semi1', round: 1 }));
  await ops([{ op: 'set', path: ['layouts', 'battle', 'rt', 'showNames'], value: false }]);
  await sleep(1500);
  r = await read();
  check('關掉「顯示出賽名字」：名字與字卡都不出現', r[0] === '' && r[1] === '', r.join(' | '));
  await ops([{ op: 'set', path: ['layouts', 'battle', 'rt', 'showNames'], value: true }]);
  await sleep(800);
  r = await read();
  check('再打開又出現', r[0].startsWith('card:'), r[0]);

  // 四強換隊：舊隊伍的人不出現
  await ops([{ op: 'set', path: ['results', 'top4', 0], value: 't3' }]);
  await sleep(1200);
  r = await read();
  check('四強換成別隊：不顯示原隊伍的字卡', r[0] === '', r[0]);

  // 演出面板也能選
  await ops([{ op: 'set', path: ['results', 'top4', 0], value: t1.id }]);
  await ctrl.getByRole('button', { name: '演出', exact: true }).click();
  await sleep(600);
  check('演出面板也有選人選單', await ctrl.getByLabel('左方第 3 回合選人').count() === 1);

  check('沒有 JS 錯誤', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
