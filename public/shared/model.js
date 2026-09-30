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
    top4: '四強公布',
    battle: '對戰計分',
    champ: '冠亞軍公布',
    black: '黑畫面'
  };

  var BATTLES = { semi1: '四強對戰 1', semi2: '四強對戰 2', final: '決賽' };

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

  function judgeById(state, id) {
    if (!state || !id || !state.judges) return null;
    for (var i = 0; i < state.judges.length; i++) if (state.judges[i].id === id) return state.judges[i];
    return null;
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
    if (src.source === 'team') return '指定隊伍';
    if (src.source === 'top4') return '四強第 ' + (src.index + 1) + ' 隊';
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
    if (cue.type === 'judge') {
      var j = judgeById(state, cue.judge);
      return j ? j.en : '（未選評審）';
    }
    return cue.name || TYPES[cue.type] || cue.type;
  }

  function cueSub(state, cue) {
    if (cue.type === 'team') return TYPES.team;
    if (cue.type === 'judge') return TYPES.judge;
    if (cue.type === 'battle') {
      var l = resolve(state, cue.left), r = resolve(state, cue.right);
      return (l ? l.en : sourceLabel(cue.left)) + ' vs ' + (r ? r.en : sourceLabel(cue.right));
    }
    if (cue.type === 'champ') {
      var c = resolve(state, cue.champ);
      return c ? '冠軍 ' + c.en : TYPES.champ;
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
    judge: {
      std: { lt: 'ink', lz: 'ink', fr: 'fade', ph: 'ink', en: 'brush', zh: 'brush', tt: 'ink' },
      sharp: { lt: 'slam', lz: 'slide', fr: 'slam', ph: 'slide', en: 'slide', zh: 'slide', tt: 'slam' }
    },
    top4: { std: { fr: 'fade', ph: 'ink', en: 'brush', zh: 'brush' }, sharp: { fr: 'slam', ph: 'slide', en: 'slide', zh: 'slide' } },
    battle: { std: { fr: 'fade', ph: 'ink', nm: 'brush', info: 'fade' }, sharp: { fr: 'slam', ph: 'slide', nm: 'slide', info: 'fade' } },
    champ: {
      std: { lt: 'ink', lz: 'ink', sf: 'fade', sp: 'ink', sn: 'brush', sz: 'brush', st: 'ink', df: 'fade', dp: 'ink', dn: 'brush', dt: 'ink' },
      sharp: { lt: 'slam', lz: 'slide', sf: 'slam', sp: 'slide', sn: 'slide', sz: 'slide', st: 'slam', df: 'slam', dp: 'slide', dn: 'slide', dt: 'slam' }
    }
  };
  function presetAnim(type, key, anim) {
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
    teamById: teamById, judgeById: judgeById, battleCue: battleCue, resolve: resolve, sourceLabel: sourceLabel,
    cueTitle: cueTitle, cueSub: cueSub, layoutKey: layoutKey, layoutFor: layoutFor,
    chain: chain, PRESETS: PRESETS, presetAnim: presetAnim, line2: line2
  };
})(window);
