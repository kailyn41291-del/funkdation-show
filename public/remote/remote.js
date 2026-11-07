/* FUNKDATION 遙控網頁：輸入密碼後加減比分、選四強
 * 畫面資料透過 WebSocket 即時同步（唯讀）；修改只走 /api/remote/score、/api/remote/top4，由伺服器檢查後套用 */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var S = null, status = 'connecting', fd = null;
  var KEY = 'fd-remote-token';
  var ui = { tab: 'score', battle: null, follow: true };
  var token = load(KEY);
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
        token = j.token; save(KEY, token); start();
      }).catch(function (e2) { err.textContent = e2.message; btn.disabled = false; input.select(); });
    } },
      h('div', { class: 'brand', text: 'FUNKDATION' }, h('small', { text: '遙控' })),
      h('h1', { text: '比分遙控' }),
      h('p', { text: '輸入控制台「設定 → 遙控網頁」顯示的密碼。手機要和播出電腦連同一個 Wi-Fi。' }),
      input, btn, err);
    app.replaceChildren(h('div', { class: 'login' }, form));
    setTimeout(function () { input.focus(); }, 50);
  }
  function logout(msg) {
    token = null; save(KEY, null);
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
    if (ui.tab === 'top4') top4View(main); else scoreView(main);
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
    add(main, h('div', { class: 'note', text: '比分會立即出現在輸出畫面（含動畫）。回合、印章、晉級與 Timer 請在控制台操作。' }));
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
  else api('/api/remote/me').then(start).catch(function (e) { if (e.message) loginView(e.message); });
})();
