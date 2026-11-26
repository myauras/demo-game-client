/* =========================================================================
 * 爆金連鎖——數值單點與純規則模型（可移植・凍結）
 *
 * 紀律（改東西前先讀）：
 *  1. 鐵表（TASKS.md「已定案數值」）是唯一數字來源。CFG 只放鐵表常數；RTP、各面額實付、
 *     寶物方向表、起始盤面、盤面最低總數全部由程式導出，禁手改。
 *  2. 嚴禁暗改機率 p（鑽石 1/40、皇冠 1/800、天降 1/7）。要調 RTP 只准動各物的「值」。
 *  3. 本檔零 DOM、零依賴；瀏覽器以 <script> 載入、Node 以 eval 載入（test/mc-test.js）。
 *     不要加頂層 'use strict'：eval 時要讓 var EV／DEMO_KEY 落在呼叫端作用域。
 *  4. ES5 寫法（舊手機）。
 *
 * 玩法：5×5 盤面，每格 0～3 枚；丟一枚到某格，疊到 4 枚就炸開、往上下左右各噴 1 枚，
 * 隔壁達 4 枚跟著炸；噴出盤面的都是玩家的。普通幣被擠出盤面值 COIN_PAY 個面額，
 * 鑽石／皇冠（玩家丟的那一枚有機率是寶物）被擠出盤面才兌現。每注 1/7 機率天上再掉一枚
 * 免費普通幣到隨機一格。
 *
 * 抽獎入口：play(board, i, rng)。rng 是「回傳 [0,1) 的函式」，一注固定依序取：
 *   1) 這枚是什麼（rollKind）  2) 有沒有天降（rollSky）  3) 只有天降才取：落哪格（rollSkyCell）
 * 測試與導演台用 EV.scripted(plan, baseRng) 指定其中幾項，其餘照 baseRng。
 * ========================================================================= */

/* 記號：新建腳本會把 burst 換成 [a-z][a-z0-9]{1,11} 短名；沒替換也能跑 */
var DEMO_KEY = 'burst';

var EV = (function(){

var CFG = {
  COLS: 5, ROWS: 5,                              // 盤面 5×5
  CAP: 4,                                        // 疊到 4 枚就炸開（四向，各噴 1 枚；固定 4）
  COIN_PAY: 0.7,                                 // 普通幣被擠出盤面＝0.7 個面額（RTP 由它導出）
  DIAMOND: { P: 1 / 40,  PAY: 5 },               // 玩家丟的那枚是鑽石的機率、值 5 個面額
  CROWN:   { P: 1 / 800, PAY: 50 },              // 皇冠
  SKY_P: 1 / 7,                                  // 天降幣：每注機率（免費普通幣，不會是寶物）
  DENOMS: [100, 500, 1000],                      // 面額（暫用，待 Q5 裁決）；每個面額各一張盤面
  DENOM_DEFAULT: 0,                              // 預設面額＝DENOMS 的索引（0＝100）
  WALLET: 10000,                                 // 起始錢包
  LOG_CAP: 50,                                   // 勝負 log 封頂筆數（公司規格）
  RTP_MIN: 0.96, RTP_MAX: 0.97,                  // RTP 必須落在這個範圍（不在就 throw）
  TIERS: { BACK: 1, BIG: 4, HUGE: 10 },          // 回饋分級：這一下拿回幾倍面額以上＝回本／大連爆／全畫面
  START_EXTRA: 3,                                // 起始盤面總枚數＝最低可能總數＋3
  /* 起始盤面（每個面額一張）：固定種子從空盤隨機丟 drops 枚，再用「挑最會爆」丟 thin 枚把它丟瘦。
     種子由 node game/test/find-start.js --write 搜尋後寫入（不手排）。START-BEGIN／END 是它的改寫範圍。 */
  START: /*START-BEGIN*/[
    { seed: 16333, drops: 400, thin: 5 },
    { seed: 15922, drops: 400, thin: 1 },
    { seed: 1628, drops: 400, thin: 7 }
  ]/*START-END*/
};

/* 起始盤面的條件（rationale「起始盤面」）：總數＝最低＋START_EXTRA、是穩定循環盤面、
   「發光格」（最會爆的 3 枚格）第一下噴 EXITS 枚且連爆 ≥TOPPLES 格、發光格不在邊上 */
var START_RULE = { EXITS: 4, TOPPLES: 7, NOT_EDGE: true };

/* mulberry32：固定種子的亂數（起始盤面、測試用；遊戲抽獎用注入的 rng） */
function rng(seed){
  var a = seed >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gcd(a, b){ return b ? gcd(b, a % b) : a; }

/* 理論 RTP：(1−Σp＋天降)×普通幣值 ＋ Σ(p×寶物值)。天降幣沒收錢，成本攤在每一枚普通幣的落袋值 */
function rtpOf(cfg){
  var sp = cfg.DIAMOND.P + cfg.CROWN.P;
  return (1 - sp + cfg.SKY_P) * cfg.COIN_PAY + cfg.DIAMOND.P * cfg.DIAMOND.PAY + cfg.CROWN.P * cfg.CROWN.PAY;
}

function mergeCfg(over){
  var cfg = {}, k;
  for(k in CFG) cfg[k] = CFG[k];
  if(over) for(k in over) cfg[k] = over[k];
  return cfg;
}

/* 替代設定比較用：給定寶物值，找「各面額實付皆整數、RTP 最接近 target」的普通幣值（掃格點，不暗改機率） */
function solveCoinPay(over, target){
  var cfg = mergeCfg(over), g = 0, i, best = null, k, v, r, e;
  for(i = 0; i < cfg.DENOMS.length; i++) g = gcd(g, cfg.DENOMS[i]);
  for(k = 1; k <= 3 * g; k++){                    // v＝k/g：每個面額×v 都是整數（g＝面額最大公因數）
    v = k / g;
    cfg.COIN_PAY = v; r = rtpOf(cfg); e = Math.abs(r - target);
    if(best === null || e < best.err - 1e-12) best = { coinPay: v, rtp: r, err: e };
  }
  return best;
}

/* 以一組設定建出整個模型（預設的 EV 就是 build()；over 只給替代設定比較用，不改 CFG） */
function build(over){
  var cfg = mergeCfg(over);
  var C = cfg.COLS, R = cfg.ROWS, N = C * R, CAP = cfg.CAP, i, d, k;

  /* ---- 自我檢查與導出 ---- */
  if(CAP !== 4) throw new Error('values.js：CAP 必須為 4（四向各噴 1 枚），現為 ' + CAP);
  var GEMS = [ { id: 'diamond', p: cfg.DIAMOND.P, pay: cfg.DIAMOND.PAY },
               { id: 'crown',   p: cfg.CROWN.P,   pay: cfg.CROWN.PAY } ];
  var gemP = cfg.DIAMOND.P + cfg.CROWN.P;
  if(!(gemP >= 0 && gemP < 1 && cfg.SKY_P >= 0 && cfg.SKY_P < 1)) throw new Error('values.js：機率不合法');
  var VALUE = { coin: cfg.COIN_PAY, diamond: cfg.DIAMOND.PAY, crown: cfg.CROWN.PAY };   // 各物被擠出盤面值幾個面額
  var RTP = rtpOf(cfg);
  var RTP_PARTS = {                                // 理論 RTP 拆解（各佔幾個面額；加總＝RTP）
    coin:    (1 - gemP) * cfg.COIN_PAY,
    sky:     cfg.SKY_P * cfg.COIN_PAY,
    diamond: cfg.DIAMOND.P * cfg.DIAMOND.PAY,
    crown:   cfg.CROWN.P * cfg.CROWN.PAY
  };
  if(!(RTP >= cfg.RTP_MIN - 1e-12 && RTP <= cfg.RTP_MAX + 1e-12))
    throw new Error('values.js：RTP ' + (RTP * 100).toFixed(3) + '% 不在 ' + cfg.RTP_MIN * 100 + '%～' + cfg.RTP_MAX * 100 + '%');
  var PAY = [];                                    // 各面額下各物的實付金額（整數）
  for(d = 0; d < cfg.DENOMS.length; d++){
    var row = { denom: cfg.DENOMS[d] };
    for(k in VALUE){
      var x = cfg.DENOMS[d] * VALUE[k];
      if(Math.abs(x - Math.round(x)) > 1e-9) throw new Error('values.js：面額 ' + cfg.DENOMS[d] + ' 的 ' + k + ' 實付 ' + x + ' 不是整數');
      row[k] = Math.round(x);
    }
    PAY.push(row);
  }
  var MIN_TOTAL = (C - 1) * R + C * (R - 1);       // 穩定循環盤面總枚數下限＝相鄰格的邊數（5×5＝40）
  var START_TOTAL = MIN_TOTAL + cfg.START_EXTRA;

  /* ---- 盤面幾何：方向 0 左 1 右 2 上 3 下 ---- */
  var DR = [0, 0, -1, 1], DC = [-1, 1, 0, 0];
  var NB = [], DIRS = [];
  for(i = 0; i < N; i++){
    var r = (i / C) | 0, c = i % C, nb = [], dist = [c + 1, C - c, r + 1, R - r];
    for(d = 0; d < 4; d++){
      var rr = r + DR[d], cc = c + DC[d];
      nb.push((rr < 0 || rr >= R || cc < 0 || cc >= C) ? -1 : rr * C + cc);
    }
    NB.push(nb);
    /* 寶物方向表：炸開時離盤面外最近的方向排最前，同距離 左、右 先於 上、下。沒有亂數。
       同格第 n 顆寶物走第 n 近的方向，其餘位置由普通幣補滿 */
    DIRS.push([0, 1, 2, 3].sort(function(a, b){ return dist[a] - dist[b] || a - b; }));
  }
  function neighbor(i, dir){ return NB[i][dir]; }

  /* ---- 盤面 ---- */
  function emptyBoard(){
    var h = [], g = [], j;
    for(j = 0; j < N; j++){ h.push(0); g.push([]); }
    return { h: h, g: g };                          // h[i]＝該格總枚數（含寶物）；g[i]＝該格的寶物種類清單（有順序）
  }
  function cloneBoard(b){ return { h: b.h.slice(), g: b.g.map(function(x){ return x.slice(); }) }; }
  function total(b){ var s = 0, j; for(j = 0; j < N; j++) s += b.h[j]; return s; }
  function boardValue(b){                           // 盤面上所有東西的面值（個面額）
    var s = 0, j, q;
    for(j = 0; j < N; j++){
      s += (b.h[j] - b.g[j].length) * VALUE.coin;
      for(q = 0; q < b.g[j].length; q++) s += VALUE[b.g[j][q]];
    }
    return s;
  }

  /* ---- 核心：丟一枚到第 i 格並連鎖到全部 <CAP。g 為 null＝只算枚數、不分種類（probe 用）。
     rec＝是否記錄分波明細（演出要；大量模擬可關）。每一波＝當下所有 ≥CAP 的格子同時炸開一次 ---- */
  function run(h, g, i, kind, rec){
    var exits = { coin: 0, diamond: 0, crown: 0 }, topples = 0, waves = rec ? [] : null;
    var cells, a, c, j, s, to, kk, order, out, olen, outs, moves, wexit;
    h[i]++;
    if(g && kind !== 'coin') g[i].push(kind);
    cells = h[i] >= CAP ? [i] : [];
    while(cells.length){
      outs = [];
      for(a = 0; a < cells.length; a++){            // 先全部扣掉、寶物先離格，再發放（同一波同時發生）
        c = cells[a]; h[c] -= CAP;
        outs.push(g && g[c].length ? g[c].splice(0, CAP) : null);
      }
      moves = rec ? [] : null; wexit = 0;
      for(a = 0; a < cells.length; a++){
        c = cells[a]; order = DIRS[c]; out = outs[a]; olen = out ? out.length : 0;
        for(s = 0; s < CAP; s++){
          to = NB[c][order[s]]; kk = s < olen ? out[s] : 'coin';
          if(to < 0){ exits[kk]++; wexit++; }
          else { h[to]++; if(g && kk !== 'coin') g[to].push(kk); }
          if(rec) moves.push({ from: c, dir: order[s], to: to, kind: kk });
        }
      }
      topples += cells.length;
      if(rec) waves.push({ cells: cells, moves: moves, exitCount: wexit });
      cells = [];
      for(j = 0; j < N; j++) if(h[j] >= CAP) cells.push(j);
    }
    return finish(i, kind, waves, exits, topples);
  }
  function finish(i, kind, waves, exits, topples){
    return { cell: i, kind: kind, waves: waves, exits: exits, topples: topples,
             exitCount: exits.coin + exits.diamond + exits.crown,
             pay: exits.coin * VALUE.coin + exits.diamond * VALUE.diamond + exits.crown * VALUE.crown };   // pay＝個面額
  }

  /* 丟一枚 kind（'coin'｜'diamond'｜'crown'）到第 i 格，直接改 board，回傳完整分波結果（演出只讀這個） */
  function drop(board, i, kind){ return run(board.h, board.g, i, kind || 'coin', true); }

  /* 不改盤面，原樣試算（含寶物） */
  function preview(board, i, kind){ return run(board.h.slice(), board.g.map(function(x){ return x.slice(); }), i, kind || 'coin', true); }
  /* 不改盤面、只算枚數（不分種類、不記分波；模擬的「挑最會爆」用，結果的 exitCount／topples 與 preview 相同） */
  function probe(board, i){ return run(board.h.slice(), null, i, 'coin', false); }

  /* 發光格：疊 CAP−1 枚的格子裡噴出最多的（同分比連爆格數、再同分取編號小的）；沒有就 −1 */
  function bestCell(board){
    var best = -1, bp = -1, bt = -1, j, p;
    for(j = 0; j < N; j++){
      if(board.h[j] !== CAP - 1) continue;
      p = probe(board, j);
      if(p.exitCount > bp || (p.exitCount === bp && p.topples > bt)){ best = j; bp = p.exitCount; bt = p.topples; }
    }
    return best;
  }

  /* ---- 抽獎：一注依序取 3 項（見檔頭） ---- */
  function rollKind(u){
    var acc = 0, j;
    for(j = 0; j < GEMS.length; j++){ acc += GEMS[j].p; if(u < acc) return GEMS[j].id; }
    return 'coin';
  }
  function rollSky(u){ return u < cfg.SKY_P; }
  function rollSkyCell(u){ return Math.min(N - 1, Math.floor(u * N)); }

  /* 反查：必落在對應區間中點的 u（測試、導演台指定結果用） */
  function uForKind(kind){
    var acc = 0, j;
    for(j = 0; j < GEMS.length; j++){ if(GEMS[j].id === kind) return acc + GEMS[j].p / 2; acc += GEMS[j].p; }
    if(kind === 'coin') return (gemP + 1) / 2;
    throw new Error('uForKind：未知種類 ' + kind);
  }
  function uForSky(on){ return on ? cfg.SKY_P / 2 : (cfg.SKY_P + 1) / 2; }
  function uForCell(cell){ return (cell + 0.5) / N; }

  /* 包一層 rng：只替前幾次取值指定結果，用完照 base。
     plan.kind：'coin'｜'diamond'｜'crown'（不給＝照 base）
     plan.sky：false＝沒天降；true＝有天降、落點照 base；整數＝有天降、落在該格（不給＝照 base） */
  function scripted(plan, base){
    var q = [];
    plan = plan || {};
    q.push(plan.kind === undefined ? null : uForKind(plan.kind));
    if(plan.sky === false) q.push(uForSky(false));
    else if(plan.sky === true) q.push(uForSky(true));
    else if(typeof plan.sky === 'number'){ q.push(uForSky(true)); q.push(uForCell(plan.sky)); }
    else q.push(null);
    return function(){
      if(q.length){ var v = q.shift(); if(v !== null) return v; }
      return base();
    };
  }

  /* 一注（抽獎唯一入口）：抽這枚是什麼 → drop → 抽天降與落點 → drop，整注結果一次定完。
     opts.rec===false 時不記分波明細（大量模擬用）。 */
  function play(board, i, rng, opts){
    var rec = !(opts && opts.rec === false);
    var kind = rollKind(rng());
    var main = run(board.h, board.g, i, kind, rec), sky = null;
    if(rollSky(rng())) sky = run(board.h, board.g, rollSkyCell(rng()), 'coin', rec);
    var exits = { coin: main.exits.coin, diamond: main.exits.diamond, crown: main.exits.crown };
    var enter = { coin: kind === 'coin' ? 1 : 0, diamond: kind === 'diamond' ? 1 : 0, crown: kind === 'crown' ? 1 : 0 };
    if(sky){ exits.coin += sky.exits.coin; exits.diamond += sky.exits.diamond; exits.crown += sky.exits.crown; enter.coin++; }
    return { cell: i, kind: kind, main: main, sky: sky, exits: exits, enter: enter,
             inValue: enter.coin * VALUE.coin + enter.diamond * VALUE.diamond + enter.crown * VALUE.crown,   // 這一注進場東西的面值
             exitCount: exits.coin + exits.diamond + exits.crown,
             topples: main.topples + (sky ? sky.topples : 0),
             pay: main.pay + (sky ? sky.pay : 0) };                                                          // 這一注拿回（個面額）
  }

  /* 這一注拿回的實付金額（整數；di＝面額索引） */
  function cash(res, di){
    var p = PAY[di];
    return res.exits.coin * p.coin + res.exits.diamond * p.diamond + res.exits.crown * p.crown;
  }
  /* 回饋分級：'none'｜'back'（回本）｜'big'（大連爆）｜'huge'（全畫面；≥10 倍或皇冠落袋） */
  function tier(res){
    var p = res.pay + 1e-9;
    if(p >= cfg.TIERS.HUGE || res.exits.crown > 0) return 'huge';
    if(p >= cfg.TIERS.BIG) return 'big';
    if(p >= cfg.TIERS.BACK) return 'back';
    return 'none';
  }

  /* ---- 起始盤面 ---- */
  /* 是不是穩定循環盤面（燃燒測試：沿邊加一輪，每格恰炸一次且盤面復原）。
     從這種盤面開始，之後盤面永遠 ≥MIN_TOTAL 枚，所以玩家最多只能挖走起始總數−MIN_TOTAL 枚 */
  function isRecurrent(b){
    var t = cloneBoard(b), before = t.h.slice(), cnt = [], j, dd, cells, a, nn;
    for(j = 0; j < N; j++) cnt.push(0);
    for(j = 0; j < N; j++) for(dd = 0; dd < 4; dd++) if(NB[j][dd] < 0) t.h[j]++;
    for(;;){
      cells = [];
      for(j = 0; j < N; j++) if(t.h[j] >= CAP) cells.push(j);
      if(!cells.length) break;
      for(a = 0; a < cells.length; a++){ t.h[cells[a]] -= CAP; cnt[cells[a]]++; }
      for(a = 0; a < cells.length; a++) for(dd = 0; dd < 4; dd++){ nn = NB[cells[a]][dd]; if(nn >= 0) t.h[nn]++; }
    }
    for(j = 0; j < N; j++) if(cnt[j] !== 1 || t.h[j] !== before[j]) return false;
    return true;
  }
  /* 逐項檢查起始盤面條件，回傳明細與 ok */
  function checkStart(b){
    var tot = total(b), cell = bestCell(b), p = cell >= 0 ? probe(b, cell) : null;
    var rr = cell >= 0 ? (cell / C) | 0 : -1, cc = cell >= 0 ? cell % C : -1;
    var onEdge = cell >= 0 && (rr === 0 || rr === R - 1 || cc === 0 || cc === C - 1);
    var rec = isRecurrent(b);
    var o = { total: tot, minTotal: MIN_TOTAL, recurrent: rec, cell: cell, exitCount: p ? p.exitCount : 0,
              topples: p ? p.topples : 0, waves: 0, onEdge: onEdge };
    if(cell >= 0) o.waves = preview(b, cell).waves.length;
    o.ok = tot === START_TOTAL && rec && cell >= 0 && o.exitCount === START_RULE.EXITS && o.topples >= START_RULE.TOPPLES &&
           !(START_RULE.NOT_EDGE && onEdge);
    return o;
  }
  /* 該面額的起始盤面（每次產生新的一份）：固定種子，不手排 */
  function startBoard(di){
    var s = cfg.START[di], rr, b, n, c;
    if(!s) throw new Error('startBoard：沒有面額索引 ' + di + ' 的起始盤面設定');
    rr = rng(s.seed); b = emptyBoard();
    for(n = 0; n < s.drops; n++) run(b.h, b.g, Math.floor(rr() * N), 'coin', false);
    for(n = 0; n < s.thin; n++){ c = bestCell(b); run(b.h, b.g, c < 0 ? Math.floor(rr() * N) : c, 'coin', false); }
    return b;
  }

  var M = {
    CFG: cfg, N: N, GEMS: GEMS, VALUE: VALUE, RTP: RTP, RTP_PARTS: RTP_PARTS, PAY: PAY,
    MIN_TOTAL: MIN_TOTAL, START_TOTAL: START_TOTAL, START_RULE: START_RULE, DIRS: DIRS,
    rng: rng, neighbor: neighbor, emptyBoard: emptyBoard, cloneBoard: cloneBoard, total: total, boardValue: boardValue,
    drop: drop, preview: preview, probe: probe, bestCell: bestCell,
    rollKind: rollKind, rollSky: rollSky, rollSkyCell: rollSkyCell,
    uForKind: uForKind, uForSky: uForSky, uForCell: uForCell, scripted: scripted, play: play,
    cash: cash, tier: tier, isRecurrent: isRecurrent, checkStart: checkStart, startBoard: startBoard
  };

  /* 起始盤面自我檢查（find-start.js 搜尋時以 EV_SKIP_START_CHECK 略過） */
  if(!(typeof EV_SKIP_START_CHECK !== 'undefined' && EV_SKIP_START_CHECK)){
    if(cfg.START.length !== cfg.DENOMS.length) throw new Error('values.js：START 數量必須等於面額數');
    for(d = 0; d < cfg.DENOMS.length; d++){
      var cs = checkStart(startBoard(d));
      if(!cs.ok) throw new Error('values.js：面額 ' + cfg.DENOMS[d] + ' 的起始盤面不合條件 ' + JSON.stringify(cs) + '（重跑 node game/test/find-start.js --write）');
    }
  }
  return M;
}

var EV = build();
EV.build = build;                 // build(over)：替代設定的完整模型，只給比較用，不改 CFG
EV.rtpOf = rtpOf;
EV.solveCoinPay = solveCoinPay;
return EV;
})();
