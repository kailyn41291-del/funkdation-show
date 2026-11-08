/* FUNKDATION 遙控網頁：輸入密碼後加減比分、選四強
 * 畫面資料透過 WebSocket 即時同步（唯讀）；修改只走 /api/remote/score、/api/remote/top4，由伺服器檢查後套用 */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var S = null, status = 'connecting', fd = null;
  var KEY = 'fd-remote-token';
  var ui = { tab: 'score', battle: null, follow: true };
  var token = load(KEY);
  // Timer 專用：網址 /timer（= /remote/?timer=1），或用 Timer 專用密碼登入
  var TIMER_URL = /[?&]timer=1/.test(location.search);
  var role = load('fd-remote-role') || 'full';
  function timerOnly() { return TIMER_URL || role === 'timer'; }
  if (TIMER_URL) document.title = 'FUNKDATION Timer';
  try { Object.assign(ui, JSON.parse(load('fd-remote-ui') || '{}')); } catch (e) { /* 忽略 */ }

  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* 私密瀏覽模式 */ } }
  function saveUi() { save('fd-remote-ui', JSON.stringify({ tab: ui.tab, battle: ui.battle, follow: ui.follow })); }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }

  var toastT = null;
  function toast(msg, bad) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast' + (bad ? ' bad' : ''); }, bad ? 3200 : 1600);
  }

  function api(path, body) {
    return fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && path !== '/api/remote/login') { logout(j.error || '請重新輸入密碼'); throw new Error(''); }
        if (!r.ok || j.ok === false) throw new Error(j.error || ('連線失敗（' + r.status + '）'));
        return j;
      });
    });
  }

  // ---------- 登入 ----------
  function loginView(msg) {
    var input = h('input', { type: 'password', inputmode: 'text', autocomplete: 'current-password', placeholder: '輸入密碼', 'aria-label': '密碼', required: true });
    var err = h('div', { class: 'err', role: 'alert', text: msg || '' });
    var btn = h('button', { class: 'primary', type: 'submit', text: '進入遙控' });
    var form = h('form', { onsubmit: function (e) {
      e.preventDefault();
      btn.disabled = true; err.textContent = '';
      api('/api/remote/login', { password: input.value }).then(function (j) {
        token = j.token; save(KEY, token);
        role = j.role || 'full'; save('fd-remote-role', role);
        start();
      }).catch(function (e2) { err.textContent = e2.message; btn.disabled = false; input.select(); });
    } },
      h('div', { class: 'brand', text: 'FUNKDATION' }, h('small', { text: TIMER_URL ? 'Timer' : '遙控' })),
      h('h1', { text: TIMER_URL ? 'Timer 控制' : '比分遙控' }),
      h('p', { text: (TIMER_URL ? '輸入「Timer 專用密碼」或完整遙控密碼。' : '輸入控制台「設定 → 遙控網頁」顯示的密碼。') + '手機要和播出電腦連同一個 Wi-Fi。' }),
      input, btn, err);
    app.replaceChildren(h('div', { class: 'login' }, form));
    setTimeout(function () { input.focus(); }, 50);
  }
  function logout(msg) {
    token = null; save(KEY, null);
    role = 'full'; save('fd-remote-role', null);
    if (fd && fd.close) fd.close();
    fd = null; S = null;
    loginView(msg);
  }

  // ---------- 主畫面 ----------
  function battles() {
    var seen = {}, out = [];
    (S.cues || []).forEach(function (c) {
      if (c.type !== 'battle' || seen[c.battle] || !S.results.battles[c.battle]) return;
      seen[c.battle] = true;
      out.push(c);
    });
    return out;
  }
  function liveBattle() {
    var c = (S.cues || []).find(function (x) { return x.id === S.show.cueId; });
    return c && c.type === 'battle' ? c.battle : null;
  }
  function currentCue(list) {
    var live = liveBattle();
    if (ui.follow && live) ui.battle = live;
    var c = list.find(function (x) { return x.battle === ui.battle; }) || list[0];
    if (c) ui.battle = c.battle;
    return c;
  }

  function render() {
    if (!S) { app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'empty-state', text: '連線中…' }))); return; }
    var st = h('span', { class: 'status ' + status }, h('i'), status === 'online' ? '已連線' : status === 'offline' ? '連線中斷，重新連線中…' : '連線中…');
    var top = h('div', { class: 'top' },
      h('div', { class: 'row' }, h('span', { class: 'brand', text: 'FUNKDATION' }, h('small', { text: '遙控' })), h('span', { class: 'grow' }), st,
        h('button', { class: 'ghost', text: '登出', onclick: function () { logout(''); } })),
      h('div', { class: 'tabs', role: 'tablist' },
        [['score', '比分'], ['top4', '四強']].map(function (t) {
          return h('button', { class: ui.tab === t[0] ? 'on' : '', role: 'tab', 'aria-selected': ui.tab === t[0] ? 'true' : 'false', text: t[1], onclick: function () { ui.tab = t[0]; saveUi(); render(); } });
        })));
    var main = h('main');
    if (timerOnly()) {
      // Timer 專用：沒有比分、四強分頁
      top.querySelector('.tabs').remove();
      top.querySelector('.brand small').textContent = 'Timer';
      main.className = 'tonly';
      timerOnlyView(main);
      document.body.classList.add('tmode');
    } else if (ui.tab === 'top4') top4View(main); else scoreView(main);
    app.replaceChildren(top, main);
  }

  var busy = {};
  function scoreView(main) {
    var list = battles();
    if (!list.length) { add(main, h('div', { class: 'empty-state', text: '流程裡還沒有對戰 Cue。' })); return; }
    var c = currentCue(list), live = liveBattle(), b = S.results.battles[c.battle];
    add(main, h('div', { class: 'chips' }, list.map(function (x) {
      return h('button', { class: 'chip' + (x.battle === c.battle ? ' on' : ''), onclick: function () {
        ui.battle = x.battle; ui.follow = x.battle === live; saveUi(); render();
      } }, x.battle === live ? h('span', { class: 'live', title: '播出中' }) : null, x.name || FDM.BATTLES[x.battle]);
    })));
    add(main, h('label', { class: 'follow' },
      h('input', { type: 'checkbox', checked: ui.follow, onchange: function (e) { ui.follow = e.target.checked; saveUi(); render(); } }),
      '跟著播出畫面自動切換場次'));
    add(main, h('div', { class: 'meta' },
      h('h2', { text: c.name || FDM.BATTLES[c.battle] }),
      h('span', { class: 'rnd' }, '第 ', h('b', { text: String(b.round || 1) }), ' / ' + (c.rounds || 1) + ' 回合')));
    var board = h('div', { class: 'board' });
    [['l', c.left, '左方'], ['r', c.right, '右方']].forEach(function (s) {
      var t = FDM.resolve(S, s[1]);
      var k = c.battle + s[0];
      function hit(d) {
        if (busy[k]) return;
        busy[k] = true;
        if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) { /* 不支援 */ }
        api('/api/remote/score', { battle: c.battle, side: s[0], delta: d })
          .catch(function (e) { if (e.message) toast(e.message, true); })
          .then(function () { busy[k] = false; });
      }
      add(board, h('div', { class: 'side' + (b.winner === s[0] ? ' win' : '') },
        h('div', { class: 'lab', text: s[2] }),
        h('div', { class: 'name', text: t ? t.en : FDM.sourceLabel(s[1]) + '（未決定）' }),
        h('div', { class: 'num', 'aria-label': (t ? t.en : s[2]) + ' 比分', text: String(b[s[0]] || 0) }),
        h('div', { class: 'wtag', text: b.winner === s[0] ? (c.battle === 'exhibition' ? '勝方' : '已晉級') : '' }),
        h('button', { class: 'plus', 'aria-label': (t ? t.en : s[2]) + ' 加 1 分', text: '+1', onclick: function () { hit(1); } }),
        h('div', { class: 'row2' },
          h('button', { 'aria-label': '加 2 分', text: '+2', onclick: function () { hit(2); } }),
          h('button', { 'aria-label': '減 1 分', text: '−1', onclick: function () { hit(-1); } }))));
    });
    add(main, board);
    add(main, timerCard());
    add(main, h('div', { class: 'note', text: '比分與 Timer 會立即出現在輸出畫面。回合、印章與晉級請在控制台操作。' }));
  }

  // ---------- Timer ----------
  function timerLeft() {
    var t = S.show.timer || {};
    if (t.endsAt) return Math.max(0, (t.endsAt - fd.now()) / 1000);
    return t.pausedLeft != null ? t.pausedLeft : (t.duration || 0);
  }
  function fmt(sec) {
    var s2 = Math.ceil(sec - 0.001);
    return Math.floor(s2 / 60) + ':' + String(s2 % 60).padStart(2, '0');
  }
  var timerEls = null;
  function timerAct(body) {
    if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) { /* 不支援 */ }
    return api('/api/remote/timer', body).catch(function (e) { if (e.message) toast(e.message, true); });
  }
  function timerCard() {
    var num = h('div', { class: 'tnum', 'aria-live': 'off' });
    var st = h('div', { class: 'tstate' });
    var go = h('button', { class: 'tgo', onclick: function () { timerAct({ action: 'toggle' }); } });
    timerEls = { num: num, st: st, go: go };
    tick();
    return h('div', { class: 'timer' },
      h('div', { class: 'thead' }, h('span', { class: 'lab', text: '倒數計時' }), st),
      num, go,
      h('div', { class: 'trow' },
        h('button', { text: '重置', onclick: function () { timerAct({ action: 'reset' }); } }),
        [30, 45, 60].map(function (sec) {
          return h('button', { class: (S.show.timer && S.show.timer.duration === sec) ? 'on' : '', text: sec + ' 秒', onclick: function () { timerAct({ action: 'set', seconds: sec }); } });
        })));
  }
  // 每 0.2 秒只更新數字，不重畫整個畫面
  function tick() {
    if (!timerEls || !S || !document.body.contains(timerEls.num)) return;
    var t = S.show.timer || {}, left = timerLeft(), running = !!t.endsAt && left > 0;
    var warn = (S.layouts && S.layouts.battle && S.layouts.battle.timer && S.layouts.battle.timer.warn) || 10;
    timerEls.num.textContent = fmt(left);
    timerEls.num.className = 'tnum' + (running && left <= warn ? ' warn' : '') + (left <= 0 ? ' over' : '');
    timerEls.st.textContent = left <= 0 ? '時間到' : running ? '倒數中' : (left < (t.duration || 0) ? '暫停中' : '待命');
    timerEls.go.textContent = running ? '暫停' : (left <= 0 ? '重新開始' : '開始');
    timerEls.go.className = 'tgo' + (running ? ' pause' : '');
  }
  setInterval(tick, 200);

  function timerOnlyView(main) {
    var c = (S.cues || []).find(function (x) { return x.id === S.show.cueId; });
    var info = '尚未開始播出';
    if (c) {
      info = FDM.cueTitle(S, c);
      if (c.type === 'battle' && S.results.battles[c.battle]) info += '　第 ' + (S.results.battles[c.battle].round || 1) + ' / ' + (c.rounds || 1) + ' 回合';
    }
    var custom = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: 3600, placeholder: '秒數', 'aria-label': '自訂秒數' });
    add(main, [
      h('div', { class: 'tinfo' }, h('span', { class: 'lab', text: '播出中' }), h('b', { text: info })),
      timerCard(),
      h('form', { class: 'tcustom', onsubmit: function (e) {
        e.preventDefault();
        var v = Number(custom.value);
        if (!Number.isInteger(v) || v < 1 || v > 3600) { toast('請輸入 1–3600 的整數秒數', true); return; }
        timerAct({ action: 'set', seconds: v }).then(function () { custom.value = ''; custom.blur(); });
      } }, custom, h('button', { type: 'submit', text: '設定秒數' })),
      h('div', { class: 'note', text: role === 'timer' ? '這組密碼只能控制 Timer。' : 'Timer 專用畫面。比分、四強請開完整遙控網頁。' })
    ]);
  }

  function top4View(main) {
    var teams = (S.teams || []).filter(function (t) { return !t.guest; });
    var cur = (S.results.top4 || []).slice(0, 4);
    function pick(i) {
      var v = cur[i] || '';
      var s = h('select', { class: v ? '' : 'empty', 'aria-label': '晉級第 ' + FDM.TOP4_RANK[i] + ' 名', onchange: function (e) {
        var val = e.target.value || null;
        api('/api/remote/top4', { index: i, team: val }).then(function () { toast('已更新四強'); })
          .catch(function (er) { if (er.message) toast(er.message, true); render(); });
      } },
        h('option', { value: '', text: '（未選）' }),
        teams.map(function (t, n) {
          var taken = cur.indexOf(t.id) >= 0 && cur[i] !== t.id;
          return h('option', { value: t.id, selected: t.id === v, disabled: taken, text: (n + 1) + '. ' + t.en + (taken ? '（已選）' : '') });
        }));
      return h('div', null, h('div', { class: 'rank' }, h('b', { text: '第 ' + FDM.TOP4_RANK[i] + ' 名' }), ' 晉級'), s);
    }
    function match(n, a, b2) {
      return h('div', { class: 'match' },
        h('div', { class: 'mtitle', text: '四強對戰 ' + n + '　第 ' + FDM.TOP4_RANK[a] + ' 名 vs 第 ' + FDM.TOP4_RANK[b2] + ' 名' }),
        h('div', { class: 'mrow' }, pick(a), h('div', { class: 'mvs', text: 'VS' }), pick(b2)));
    }
    add(main, [match(1, 0, 1), match(2, 2, 3),
      h('div', { class: 'note', text: '依晉級名次填入，四強對戰 Cue 會自動帶入。揭曉動畫請在控制台播放。' })]);
  }

  // ---------- 啟動 ----------
  function start() {
    render();
    if (fd) return;
    var me = FD.connect({
      kind: timerOnly() ? 'timer' : 'remote',
      // 登出後舊連線的通知（例如關閉時的 offline）一律忽略，不要蓋掉登入畫面
      onState: function (state) { if (fd !== me) return; S = state; renderSoon(); },
      onStatus: function (s) { if (fd !== me) return; status = s; renderSoon(); }
    });
    fd = me;
  }
  // 選單打開時不要重畫（避免手機下拉選單被關掉）
  var pending = false;
  function renderSoon() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      if (!token) return;
      var a = document.activeElement;
      if (a && a.tagName === 'SELECT') { a.addEventListener('blur', renderSoon, { once: true }); return; }
      render();
    });
  }

  if (!token) loginView('');
  else api('/api/remote/me').then(function (j) { role = j.role || 'full'; save('fd-remote-role', role); start(); })
    .catch(function (e) { if (e.message) loginView(e.message); });
})();
