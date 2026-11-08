/* 控制面板與輸出畫面共用的資料邏輯：隊伍來源解析、版型、動畫時序 */
(function (global) {
  'use strict';

  var ZH = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  function zhNum(n) {
    if (n <= 10) return ZH[n] || String(n);
    if (n < 20) return '十' + ZH[n - 10];
    if (n < 100) return ZH[Math.floor(n / 10)] + '十' + (n % 10 ? ZH[n % 10] : '');
    return String(n);
  }

  var TYPES = {
    idle: '主視覺待機',
    overview: '九隊總覽',
    team: '單隊展示',
    judge: '評審表演',
    mc: 'MC 介紹',
    dj: 'DJ 介紹',
    top4: '四強公布',
    battle: '對戰計分',
    champ: '冠軍公布',
    black: '黑畫面'
  };

  // 四強位置 → 晉級名次：對戰 1 = 第 1 名 vs 第 4 名，對戰 2 = 第 2 名 vs 第 3 名
  var TOP4_RANK = [1, 4, 2, 3];
  function top4Label(i) { return '晉級第 ' + TOP4_RANK[i] + ' 名'; }

  var BATTLES = { semi1: '四強對戰 1', semi2: '四強對戰 2', final: '決賽', exhibition: '表演賽' };

  var FX_IN = [
    ['ink', '潑墨暈開'], ['brush', '毛筆刷出'], ['fade', '淡入'],
    ['slide', '由下滑入'], ['slam', '重擊落下'], ['none', '直接出現']
  ];
  var FX_OUT = [['fade', '淡出'], ['inkout', '墨跡收回'], ['none', '直接消失']];

  function teamById(state, id) {
    if (!state || !id) return null;
    for (var i = 0; i < state.teams.length; i++) if (state.teams[i].id === id) return state.teams[i];
    return null;
  }

  // 評審／MC／DJ 共用同一種版面，資料分開存；Cue 上的 judge 欄位存人員 id
  var PEOPLE = {
    judge: { list: 'judges', label: '評審', prefix: 'j', ph: 'JUDGE' },
    mc: { list: 'mcs', label: 'MC', prefix: 'm', ph: 'MC' },
    dj: { list: 'djs', label: 'DJ', prefix: 'd', ph: 'DJ' }
  };
  function isPerson(type) { return !!PEOPLE[type]; }
  function peopleOf(state, type) { var k = PEOPLE[type]; return (state && k && state[k.list]) || []; }
  function personById(state, type, id) {
    var list = peopleOf(state, type);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function judgeById(state, id) { return personById(state, 'judge', id); }

  // 回合稱號（先鋒、策應…）與這回合兩隊上場的舞者名字
  // rtOverride：Cue 用獨立版型時傳那個版型的 rt
  // cueOrBattle：對戰 Cue（出賽名單在 cue.lineup）或場次 id
  function roundInfo(state, cueOrBattle, round, rtOverride) {
    var L = state && state.layouts && state.layouts.battle, rt = rtOverride || (L && L.rt) || {};
    var cue = typeof cueOrBattle === 'object' ? cueOrBattle : (state.cues || []).filter(function (c) { return c.type === 'battle' && c.battle === cueOrBattle; })[0];
    var battleId = cue ? cue.battle : cueOrBattle;
    var b = state && state.results && state.results.battles && state.results.battles[battleId];
    var i = (round || (b && b.round) || 1) - 1, nm = (cue && cue.lineup) || {};
    var show = rt.showNames !== false;
    var L1 = show ? lineupEntry(state, cue, 'l', i) : { text: '', card: '' }, R1 = show ? lineupEntry(state, cue, 'r', i) : { text: '', card: '' };
    return {
      title: rt.on === false ? '' : ((rt.titles || [])[i] || ''),
      img: rt.on === false ? '' : ((rt.images || [])[i] || ''),
      l: L1.text, r: R1.text, lCard: L1.card, rCard: R1.card
    };
  }
  // 出賽名單的一格：字串＝直接打的名字；{ m: 成員 id }＝從隊伍成員選（有字卡就用字卡）
  // 成員必須屬於這一側目前的隊伍（四強換隊後，舊隊伍的人不會出現）
  function lineupEntry(state, cue, side, i) {
    var raw = cue && cue.lineup && (cue.lineup[side] || [])[i];
    if (!raw) return { text: '', card: '' };
    if (typeof raw === 'string') return { text: raw.trim(), card: '' };
    if (raw.m) {
      var t = resolve(state, side === 'l' ? cue.left : cue.right), mem = memberOf(t, raw.m);
      if (!mem) return { text: '', card: '' };
      return { text: (mem.name || '').trim(), card: mem.card ? (mem.card.trim || mem.card.src || '') : '' };
    }
    return { text: '', card: '' };
  }
  function memberOf(team, id) {
    var ms = (team && team.members) || [];
    for (var k = 0; k < ms.length; k++) if (ms[k].id === id) return ms[k];
    return null;
  }

  // 九隊總覽：上排 top 隊、其餘在下排
  function overviewRows(n, top) {
    var t = Math.max(0, Math.min(n, top == null ? Math.floor(n / 2) : top));
    return [t, n - t];
  }

  function battleCue(state, battleId) {
    for (var i = 0; i < state.cues.length; i++) {
      var c = state.cues[i];
      if (c.type === 'battle' && c.battle === battleId) return c;
    }
    return null;
  }

  function sourceLabel(src) {
    if (!src) return '未設定';
    if (src.source === 'team') return src.team ? '指定隊伍' : '未選隊伍';
    if (src.source === 'top4') return top4Label(src.index);
    if (src.source === 'winner') return (BATTLES[src.battle] || src.battle) + ' 勝方';
    if (src.source === 'loser') return (BATTLES[src.battle] || src.battle) + ' 敗方';
    return '未設定';
  }

  // 回傳隊伍物件，尚未決定時回傳 null
  function resolve(state, src, depth) {
    depth = depth || 0;
    if (!src || depth > 6) return null;
    if (src.source === 'team') return teamById(state, src.team);
    if (src.source === 'top4') return teamById(state, state.results.top4[src.index]);
    if (src.source === 'winner' || src.source === 'loser') {
      var b = state.results.battles[src.battle];
      var cue = battleCue(state, src.battle);
      if (!b || !b.winner || !cue) return null;
      var side = src.source === 'winner' ? b.winner : (b.winner === 'l' ? 'r' : 'l');
      return resolve(state, side === 'l' ? cue.left : cue.right, depth + 1);
    }
    return null;
  }

  function cueTitle(state, cue) {
    if (cue.type === 'team') {
      var t = teamById(state, cue.team);
      return t ? t.en : '（未選隊伍）';
    }
    if (PEOPLE[cue.type]) {
      var j = personById(state, cue.type, cue.judge);
      return j ? j.en : '（未選' + PEOPLE[cue.type].label + '）';
    }
    return cue.name || TYPES[cue.type] || cue.type;
  }

  function cueSub(state, cue) {
    if (cue.type === 'team') return TYPES.team;
    if (PEOPLE[cue.type]) return TYPES[cue.type];
    if (cue.type === 'battle') {
      var l = resolve(state, cue.left), r = resolve(state, cue.right);
      return (l ? l.en : sourceLabel(cue.left)) + ' vs ' + (r ? r.en : sourceLabel(cue.right));
    }
    if (cue.type === 'champ') {
      var c = resolve(state, cue.champ), r = resolve(state, cue.runner);
      return '排舞賽 ' + (r ? r.en : '未選') + '／Battle ' + (c ? c.en : '未決定');
    }
    return TYPES[cue.type] || '';
  }

  function layoutKey(cue) {
    if (!cue) return null;
    if (cue.type === 'battle' && cue.own) return 'battle@' + cue.id;
    return cue.type;
  }

  function layoutFor(state, cue) {
    var k = layoutKey(cue);
    return (k && state.layouts[k]) || state.layouts[cue && cue.type] || {};
  }

  // 接力式時序：下一個元素在前一個跑到 overlap% 時開始
  function chain(order, anim, base, effectsOn) {
    base = base || 0;
    var res = {}, prev = null;
    for (var i = 0; i < order.length; i++) {
      var k = order[i];
      var s = (anim.steps && anim.steps[k]) || { fx: 'fade', dur: 0, extra: 0 };
      var d = effectsOn === false ? 0 : (s.dur > 0 ? s.dur : anim.duration);
      var t = prev ? res[prev].start + res[prev].dur * (anim.overlap / 100) : base;
      var start = Math.max(base, t + (effectsOn === false ? 0 : (s.extra || 0)));
      res[k] = { start: start, dur: d, end: start + d, fx: effectsOn === false ? 'none' : s.fx };
      prev = k;
    }
    res._end = 0;
    for (var key in res) if (key !== '_end' && res[key].end > res._end) res._end = res[key].end;
    return res;
  }

  // 各畫面的預設動畫組合
  var PRESETS = {
    std: { label: '標準', duration: 500, overlap: 60 },
    ritual: { label: '儀式感', duration: 800, overlap: 70 },
    sharp: { label: '俐落', duration: 350, overlap: 50 }
  };
  var PRESET_FX = {
    team: { std: { fr: 'fade', ph: 'ink', en: 'brush', zh: 'brush' }, sharp: { fr: 'slam', ph: 'slide', en: 'slide', zh: 'slide' } },
    overview: { std: { hd: 'ink', fr: 'fade', ph: 'ink', en: 'brush', zh: 'brush' }, sharp: { hd: 'slam', fr: 'slam', ph: 'slide', en: 'slide', zh: 'slide' } },
    judge: {
      std: { lt: 'ink', lz: 'ink', fr: 'fade', ph: 'ink', en: 'brush', zh: 'brush', tt: 'ink' },
      sharp: { lt: 'slam', lz: 'slide', fr: 'slam', ph: 'slide', en: 'slide', zh: 'slide', tt: 'slam' }
    },
    top4: { std: { fr: 'fade', ph: 'ink', en: 'brush', zh: 'brush' }, sharp: { fr: 'slam', ph: 'slide', en: 'slide', zh: 'slide' } },
    battle: { std: { fr: 'fade', ph: 'ink', nm: 'brush', info: 'fade', rt: 'ink' }, sharp: { fr: 'slam', ph: 'slide', nm: 'slide', info: 'fade', rt: 'slam' } },
    champ: {
      std: { lt: 'ink', lz: 'ink', sf: 'fade', sp: 'ink', sn: 'brush', sz: 'brush', st: 'ink', df: 'fade', dp: 'ink', dn: 'brush', dt: 'ink' },
      sharp: { lt: 'slam', lz: 'slide', sf: 'slam', sp: 'slide', sn: 'slide', sz: 'slide', st: 'slam', df: 'slam', dp: 'slide', dn: 'slide', dt: 'slam' }
    }
  };
  function presetAnim(type, key, anim) {
    if (PEOPLE[type]) type = 'judge';
    var p = PRESETS[key], fx = PRESET_FX[type] && (PRESET_FX[type][key] || PRESET_FX[type].std);
    var out = JSON.parse(JSON.stringify(anim));
    out.duration = p.duration;
    out.overlap = p.overlap;
    for (var k in out.steps) {
      out.steps[k] = { fx: (fx && fx[k]) || out.steps[k].fx, dur: 0, extra: 0 };
    }
    return out;
  }

  function line2(state, team) {
    if (!team) return '';
    var m = state.event.line2 || 'zh';
    if (m === 'none') return '';
    if (m === 'tag') return team.tag || '';
    return team.zh || team.tag || '';
  }

  global.FDM = {
    zhNum: zhNum, TYPES: TYPES, BATTLES: BATTLES, FX_IN: FX_IN, FX_OUT: FX_OUT,
    teamById: teamById, judgeById: judgeById, PEOPLE: PEOPLE, isPerson: isPerson, roundInfo: roundInfo, lineupEntry: lineupEntry, memberOf: memberOf, peopleOf: peopleOf, personById: personById, overviewRows: overviewRows, TOP4_RANK: TOP4_RANK, top4Label: top4Label, battleCue: battleCue, resolve: resolve, sourceLabel: sourceLabel,
    cueTitle: cueTitle, cueSub: cueSub, layoutKey: layoutKey, layoutFor: layoutFor,
    chain: chain, PRESETS: PRESETS, presetAnim: presetAnim, line2: line2
  };
})(window);
