'use strict';
// 預設賽事狀態（規格書第 7 節）。
// 位置與尺寸單位為 1920×1080 下的 px，時間單位為 ms。
// 舊存檔載入時，缺少的欄位會自動從這裡補上。

const TEAM_LIST = [
  ['t1', 'IP LOCKERS', '', false],
  ['t2', 'FREEDOM SOUL', '', false],
  ['t3', 'FRESUKI', '', false],
  ['t4', 'LONELY LOCKERS+', '', false],
  ['t5', 'GAYのFUNK', '', false],
  ['t6', 'FLOCHEE', '', false],
  ['t7', 'DA PHANTOM', 'TAIPEI', true],
  ['t8', 'CU LOCKERS', 'KEELUNG', true],
  ['t9', 'LOCK’N’LOL CREW', 'SEOUL', true]
];

const step = (fx) => ({ fx, dur: 0, extra: 0 });
const bg = () => ({ mode: 'color', color: '#8b2420', src: null, sound: false, texture: true });

function emptyBattle() {
  return { l: 0, r: 0, round: 1, seal: null, winner: null, hist: [] };
}

function defaultLayouts() {
  return {
    idle: { bg: bg(), marquee: true },
    overview: { bg: bg() },
    black: {},
    team: {
      bg: bg(),
      v: { pw: 840, px: 0, pt: 180, pad: 40, ng: 44, es: 76, zs: 36, lg: 18 },
      anim: { duration: 500, overlap: 60, steps: { fr: step('fade'), ph: step('ink'), en: step('brush'), zh: step('brush') } }
    },
    judge: {
      bg: bg(),
      intro: true,
      ratio: '3:2',
      text: { lead: 'NEXT JUDGE IS...', leadZh: '下一位評審', title: 'JUDGE' },
      v: { pw: 760, px: 0, pt: 230, pad: 40, ng: 40, es: 76, zs: 36, lg: 18, tS: 34, tG: 30, lEs: 96, lZs: 40, lY: 440, lG: 28 },
      anim: {
        duration: 500, overlap: 60,
        steps: { lt: step('ink'), lz: step('ink'), fr: step('fade'), ph: step('ink'), en: step('brush'), zh: step('brush'), tt: step('ink') }
      },
      pause: 1500, leadOut: 'fade'
    },
    top4: {
      bg: bg(),
      mode: 'step',
      v: { w: 300, close: 24, vsg: 170, pg: 110, top: 340, pad: 40, ng: 24, ens: 38, zhs: 22, vss: 64 },
      anim: { duration: 500, overlap: 60, steps: { fr: step('fade'), ph: step('ink'), en: step('brush'), zh: step('brush') } },
      vsFx: 'slam', wait: 800, split: 800, itv: 1500
    },
    battle: {
      bg: bg(),
      v: {
        pw: 420, pd: 250, pt: 300, pad: 40,
        ss: 150, sd: 120, sy: 440,
        hy: 170, hs: 34, hg: 60,
        ty: 700, ts: 64,
        es: 46, zs: 26, ng: 30,
        gs: 150, gx: -20, gy: -50, ga: -6
      },
      divider: true,
      anim: { duration: 500, overlap: 60, stagger: 300, steps: { fr: step('fade'), ph: step('ink'), nm: step('brush'), info: step('fade') } },
      scoreFx: 'fade',
      seal: { text: '勝', ink: '#ece0c8', color: '#8b2420', img: null, anim: 'ritual', fadeMs: 800, fadeMode: 'fade', autoFade: true },
      timer: { fx: 'heartbeat', warn: 10, vignette: true, shake: true }
    },
    champ: {
      bg: bg(),
      text: {
        lc: 'THE BATTLE CHAMPION IS...', lcz: 'BATTLE 冠軍是', tc: 'BATTLE CHAMPION', cz: 'BATTLE 冠軍',
        lr: 'THE SHOWCASE CHAMPION IS...', lrz: '排舞賽冠軍是', trr: 'SHOWCASE CHAMPION', rz: '排舞賽冠軍'
      },
      v: {
        lEs: 96, lZs: 40, lY: 440, lG: 28,
        sw: 660, sy: 250, sTs: 44, sTg: 34, sNs: 64, sNg: 34, sZs: 30, sZg: 18,
        cw: 520, rw: 520, gap: 140, dy: 280, cTs: 36, cNs: 46, rTs: 36, rNs: 46, dTg: 26, dNg: 30,
        pad: 40
      },
      anim: {
        duration: 500, overlap: 60,
        steps: {
          lt: step('ink'), lz: step('ink'),
          sf: step('fade'), sp: step('ink'), sn: step('brush'), sz: step('brush'), st: step('ink'),
          df: step('fade'), dp: step('ink'), dn: step('brush'), dt: step('ink')
        }
      },
      pause: 1500, leadOut: 'fade', duoOrder: 'rc', stg: 300
    }
  };
}

function defaultCues() {
  const cues = [
    { id: 'c-open', type: 'idle', name: '開場主視覺' },
    { id: 'c-all', type: 'overview', name: '九隊總覽' }
  ];
  TEAM_LIST.forEach(([id], i) => cues.push({ id: 'c-team' + (i + 1), type: 'team', team: id }));
  cues.push(
    { id: 'c-judge', type: 'idle', name: '評審討論' },
    { id: 'c-top4', type: 'top4', name: '四強公布' },
    {
      id: 'c-semi1', type: 'battle', battle: 'semi1', name: '四強對戰 1',
      left: { source: 'top4', index: 0 }, right: { source: 'top4', index: 1 },
      title: 'SEMI FINAL', zh: '四強賽', rounds: 4, seconds: 60, own: false
    },
    {
      id: 'c-semi2', type: 'battle', battle: 'semi2', name: '四強對戰 2',
      left: { source: 'top4', index: 2 }, right: { source: 'top4', index: 3 },
      title: 'SEMI FINAL', zh: '四強賽', rounds: 4, seconds: 60, own: false
    },
    {
      id: 'c-final', type: 'battle', battle: 'final', name: '決賽',
      left: { source: 'winner', battle: 'semi1' }, right: { source: 'winner', battle: 'semi2' },
      title: 'FINAL', zh: '決賽', rounds: 5, seconds: 60, own: false
    },
    {
      id: 'c-champ', type: 'champ', name: '冠軍公布',
      // champ = Battle 冠軍（決賽勝方），runner = 排舞賽冠軍（演出中選擇）
      champ: { source: 'winner', battle: 'final' }, runner: { source: 'team', team: null }
    }
  );
  return cues;
}

function defaultState() {
  return {
    schema: 3,
    event: {
      title: 'FUNKDATION VOL.4',
      fonts: [],
      fontEn: 'Cinzel',
      fontZh: 'Noto Serif TC',
      ink: '#140707',
      light: '#ece0c8',
      line2: 'zh',
      grain: true,
      effectsEnabled: true
    },
    frame: null,
    teams: TEAM_LIST.map(([id, en, tag, seed]) => ({
      id, en, zh: '', tag, seed,
      photo: { src: null, trim: null, fit: 'auto', zoom: 100, x: 0, y: 0 }
    })),
    judges: [1, 2, 3].map(n => ({
      id: 'j' + n, en: 'JUDGE ' + n, zh: '', tag: '',
      photo: { src: null, trim: null, fit: 'auto', zoom: 100, x: 0, y: 0 }
    })),
    sponsors: {
      logos: [],
      speed: 120, height: 80, gap: 100, y: 1000, direction: -1,
      color: 'original', band: 'none'
    },
    results: {
      top4: [null, null, null, null],
      battles: { semi1: emptyBattle(), semi2: emptyBattle(), final: emptyBattle() }
    },
    cues: defaultCues(),
    layouts: defaultLayouts(),
    show: {
      cueId: null,
      seq: 0,
      teamOut: false,
      top4Shown: 0,
      champView: 'none',
      blackout: false,
      timer: { duration: 60, endsAt: null, pausedLeft: 60 }
    }
  };
}

module.exports = { defaultState, defaultLayouts, emptyBattle };
