/* =========================================================================
 * 爆金連鎖——數值單點與純規則模型（可移植・凍結）
 *
 * 紀律（改東西前先讀）：
 *  1. 鐵表（TASKS.md「已定案數值」）是唯一數字來源。CFG 只放鐵表常數；RTP、各面額實付、
 *     寶物方向表、起始盤面、盤面最低總數全部由程式導出，禁手改。
 *  2. 嚴禁暗改機率 p（鑽石 1/40、皇冠 1/800）。要調 RTP 只准動各物的「值」與能量條長度 RAIN_EVERY。
 *  3. 本檔零 DOM、零依賴；瀏覽器以 <script> 載入、Node 以 eval 載入（test/mc-test.js）。
 *     不要加頂層 'use strict'：eval 時要讓 var EV／DEMO_KEY 落在呼叫端作用域。
 *  4. ES5 寫法（舊手機）。
 *
 * 玩法（v2）：5×5 盤面，每格 0～3 枚；丟一枚到某格，疊到 4 枚就炸開、往上下左右各噴 1 枚，
 * 隔壁達 4 枚跟著炸；噴出盤面的都是玩家的。普通幣被擠出盤面值 COIN_PAY 個面額，
 * 鑽石／皇冠（玩家丟的那一枚有機率是寶物）被擠出盤面才兌現。
 * 能量條：每張盤面（每個面額）一條，每丟一枚＋1，集滿 RAIN_EVERY（100）那一注，玩家那一枚（含連鎖）
 * 結算完後「金幣雨」：25 格每格同時掉一枚免費普通幣（不是寶物），再分波連爆到穩定，能量條歸零。
 * 能量條的值由呼叫端（核心）保存；本檔只給純函式（meterAfter／play 的 opts.rain／rainAll）。
 *
 * 連鎖獎池（v2.3）：每張盤面（每個面額）一個獎池，每注存 POT_ADD 個面額（實付 15／75／150，整數）。
 * 一注的順序：玩家那一枚（main）結算 → 金幣雨（若有）→ 這一注的 POT_ADD 入池 → 若 main.topples ≥ POT_CHAIN
 * （玩家自己那一枚炸到 POT_CHAIN 格以上；金幣雨帶出的連鎖不算）或這一注有下雨，獎池整個給玩家、歸零。
 * 獎池金額用「實付整數」累加、由呼叫端（核心）保存；本檔只給純函式 potAfter(pot, res, di)。
 * 獎池是玩家自己存的錢，遲早被拿走（最慢在下雨那一注），所以長期拿回與丟法無關。
 *
 * RTP（長期、與丟哪一格無關）＝ (1 − pDiamond − pCrown ＋ 25／RAIN_EVERY) × COIN_PAY
 *                               ＋ pDiamond × DIAMOND.PAY ＋ pCrown × CROWN.PAY ＋ POT_ADD
 *   ＝ (1 − 1/40 − 1/800 ＋ 25/100) × 0.5 ＋ 1/40 × 5 ＋ 1/800 × 50 ＋ 0.15 ＝ 94.94%
 * 金幣雨的 25 枚免費幣沒收錢，成本攤在每一枚普通幣的落袋值裡。
 *
 * 抽獎入口：play(board, i, rng, { rec, rain })。rng 是「回傳 [0,1) 的函式」，一注只取一次：
 *   這枚是什麼（rollKind）。有沒有金幣雨不抽，由呼叫端依能量條決定（opts.rain：布林）。
 *   呼叫端慣例：var m = EV.meterAfter(meter); res = EV.play(board, i, rng, { rain: m.rain }); meter = m.meter;
 * 測試與導演台用 EV.scripted(plan, baseRng) 指定「這枚是什麼」，其餘照 baseRng。
 *
 * ===== v3（單一盤面＋刷新＋換金額；鐵表 TASKS.md「v3 單一盤面＋刷新＋Combo」）新增的對外介面（只新增、舊的一個都沒拿掉） =====
 *  EV.isLegal(board) → boolean
 *      合法盤面＝形狀正確（25 格、每格 0～3 枚、每格寶物數 ≤ 該格枚數）且是穩定循環盤面（isRecurrent；燃燒測試）。
 *      合法盤面總枚數永遠 ≥ MIN_TOTAL（40）；從合法盤面照規則丟幣（含金幣雨）結果仍合法（沙堆模型的性質，mc-test 以程式複驗）。
 *  EV.reshuffle(board, rng, opts) → 新盤面（不改傳入的盤面；rng 省略＝Math.random；opts.tries 省略＝CFG.RESHUFFLE_TRIES）
 *      總枚數完全相同、合法、寶物種類與數量不變（換位置，且只放在有幣的格子；board.g 的格式同 emptyBoard）。
 *      做法：隨機「燃燒順序」建出最小穩定循環盤面（40 枚），再把剩下的枚數隨機補在還有空位的格子＝構造上必合法；
 *      這樣抽 tries 張，取「現在點下去能炸最多格」的那張（chainBest 的 topples，同分比噴出枚數）。
 *      傳入的盤面不合法（理論上不會發生）→ 原盤面原樣（複製）回傳。
 *  EV.floorBoard(rng) → 新盤面：恰好 40 枚的合法盤面、沒有寶物（換金額用；隨機建、每次不同）。
 *  EV.chainBest(board) → { cell, topples, exitCount }：所有疊 3 枚的格子裡「現在丟普通幣下去炸最多格」的那格（沒有 3 枚格＝cell −1、topples 0）。
 *  EV.DEMO_METER_START（＝RAIN_EVERY − CFG.DEMO_FIRST_RAIN_BET＝70）：Demo 帳號第一張盤面的能量條預充值，讓第一場雨在第 30 注。
 *      （核心現在的 METER_START 之後由別的卡改；換金額／重置後能量條歸 0、不預充。）
 *  CFG 新增：DEMO_FIRST_RAIN_BET: 30、RESHUFFLE_TRIES: 24。
 * ========================================================================= */

/* 記號：新建腳本會把 burst 換成 [a-z][a-z0-9]{1,11} 短名；沒替換也能跑 */
var DEMO_KEY = 'burst';

var EV = (function(){

var CFG = {
  COLS: 5, ROWS: 5,                              // 盤面 5×5
  CAP: 4,                                        // 疊到 4 枚就炸開（四向，各噴 1 枚；固定 4）
  COIN_PAY: 0.5,                                 // 普通幣被擠出盤面＝0.5 個面額（RTP 由它導出）
  DIAMOND: { P: 1 / 40,  PAY: 5 },               // 玩家丟的那枚是鑽石的機率、值 5 個面額
  CROWN:   { P: 1 / 800, PAY: 50 },              // 皇冠
  RAIN_EVERY: 100,                               // 能量條長度：每丟 100 枚集滿一次（v3 單一盤面；v2.3 是 86）→下一場全盤金幣雨（25 格各落 1 枚免費普通幣）
  POT_ADD: 0.15,                                 // 連鎖獎池：每注存進獎池 0.15 個面額（實付 15／75／150；RTP 由它導出）
  POT_CHAIN: 8,                                  // 玩家自己那一枚連鎖炸到幾格以上拿走獎池（同一格炸兩次算兩格；金幣雨的連鎖不算）
  DENOMS: [100, 500, 1000],                      // 面額（暫用，待 Q5 裁決）；每個面額各一張盤面
  DENOM_DEFAULT: 0,                              // 預設面額＝DENOMS 的索引（0＝100）
  WALLET: 10000,                                 // 起始錢包
  LOG_CAP: 50,                                   // 勝負 log 封頂筆數（公司規格）
  RTP_MIN: 0.94, RTP_MAX: 0.96,                  // RTP 必須落在這個範圍（不在就 throw）
  TIERS: { BACK: 1, BIG: 4, HUGE: 10 },          // 回饋分級：這一下拿回幾倍面額以上＝回本／大連爆／全畫面
  DEMO_FIRST_RAIN_BET: 30,                       // Demo 專用：帳號第一張盤面的第 30 注下第一場雨→預充 RAIN_EVERY−30＝70（EV.DEMO_METER_START）
  RESHUFFLE_TRIES: 24,                           // 刷新盤面：抽幾張合法盤面、取「現在點下去能炸最多格」的那張（不影響長期拿回）
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

/* 理論 RTP：(1−Σp＋全盤格數／RAIN_EVERY)×普通幣值 ＋ Σ(p×寶物值) ＋ POT_ADD（獎池每注存的，遲早全數發還）。
   金幣雨的免費幣（每 RAIN_EVERY 注一次、每次＝盤面格數枚）沒收錢，成本攤在每一枚普通幣的落袋值 */
function rtpOf(cfg){
  var sp = cfg.DIAMOND.P + cfg.CROWN.P;
  return (1 - sp + cfg.COLS * cfg.ROWS / cfg.RAIN_EVERY) * cfg.COIN_PAY + cfg.DIAMOND.P * cfg.DIAMOND.PAY + cfg.CROWN.P * cfg.CROWN.PAY + cfg.POT_ADD;
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
  if(!(gemP >= 0 && gemP < 1)) throw new Error('values.js：機率不合法');
  if(!(cfg.RAIN_EVERY >= 1 && Math.floor(cfg.RAIN_EVERY) === cfg.RAIN_EVERY)) throw new Error('values.js：RAIN_EVERY 必須是 ≥1 的整數，現為 ' + cfg.RAIN_EVERY);
  var RAIN_EVERY = cfg.RAIN_EVERY;
  if(!(typeof cfg.POT_ADD === 'number' && cfg.POT_ADD >= 0 && isFinite(cfg.POT_ADD))) throw new Error('values.js：POT_ADD 必須是 ≥0 的數字，現為 ' + cfg.POT_ADD);
  if(!(cfg.POT_CHAIN >= 1 && Math.floor(cfg.POT_CHAIN) === cfg.POT_CHAIN)) throw new Error('values.js：POT_CHAIN 必須是 ≥1 的整數，現為 ' + cfg.POT_CHAIN);
  var POT_ADD = cfg.POT_ADD, POT_CHAIN = cfg.POT_CHAIN;
  var VALUE = { coin: cfg.COIN_PAY, diamond: cfg.DIAMOND.PAY, crown: cfg.CROWN.PAY };   // 各物被擠出盤面值幾個面額
  var RTP = rtpOf(cfg);
  var RTP_PARTS = {                                // 理論 RTP 拆解（各佔幾個面額；加總＝RTP）
    coin:    (1 - gemP) * cfg.COIN_PAY,
    rain:    (C * R / RAIN_EVERY) * cfg.COIN_PAY,
    diamond: cfg.DIAMOND.P * cfg.DIAMOND.PAY,
    crown:   cfg.CROWN.P * cfg.CROWN.PAY,
    pot:     POT_ADD                                // 連鎖獎池：每注存的，遲早全數發還給玩家
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
    var xp = cfg.DENOMS[d] * POT_ADD;                // 獎池每注存的實付（整數）：獎池金額一律用這個整數累加
    if(Math.abs(xp - Math.round(xp)) > 1e-9) throw new Error('values.js：面額 ' + cfg.DENOMS[d] + ' 的獎池每注存入 ' + xp + ' 不是整數');
    row.pot = Math.round(xp);
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
    var cells, s;
    h[i]++;
    if(g && kind !== 'coin') g[i].push(kind);
    cells = h[i] >= CAP ? [i] : [];
    s = settle(h, g, cells, rec);
    return finish(i, kind, s.waves, s.exits, s.topples);
  }
  /* 從「這批格子 ≥CAP」開始分波連爆到全部 <CAP（run 與 rainAll 共用） */
  function settle(h, g, cells, rec){
    var exits = { coin: 0, diamond: 0, crown: 0 }, topples = 0, waves = rec ? [] : null;
    var a, c, j, s, to, kk, order, out, olen, outs, moves, wexit;
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
    return { waves: waves, exits: exits, topples: topples };
  }
  function finish(i, kind, waves, exits, topples){
    return { cell: i, kind: kind, waves: waves, exits: exits, topples: topples,
             exitCount: exits.coin + exits.diamond + exits.crown,
             pay: exits.coin * VALUE.coin + exits.diamond * VALUE.diamond + exits.crown * VALUE.crown };   // pay＝個面額
  }

  /* 丟一枚 kind（'coin'｜'diamond'｜'crown'）到第 i 格，直接改 board，回傳完整分波結果（演出只讀這個） */
  function drop(board, i, kind){ return run(board.h, board.g, i, kind || 'coin', true); }

  /* 金幣雨：25 格每格「同時」落下 1 枚免費普通幣（不是寶物），再照一般規則分波連爆到穩定；直接改 board。
     回傳格式同 drop 的結果（cell＝−1、kind＝'coin'、waves／exits／topples／exitCount／pay），另有
       fall：[0..N−1]（第一波之前這 N 格各落 1 枚，演出「一整片一起落、一起炸」讀它）、coins：N。
     不是 25 次 drop 依序模擬：分波是同時的。沙堆模型可交換，最後盤面與噴出枚數與依序 drop 相同
     （純普通幣盤面逐格相同；有寶物時 h／噴出總數相同、寶物落點可能因同格多顆的出場順序而不同，見 mc-test）。
     rec 省略＝true（與 drop 一致）；大量模擬傳 false。 */
  function rainAll(board, rec){
    var h = board.h, cells = [], fall = [], j, s, r;
    for(j = 0; j < N; j++){ h[j]++; fall.push(j); if(h[j] >= CAP) cells.push(j); }
    s = settle(h, board.g, cells, rec !== false);
    r = finish(-1, 'coin', s.waves, s.exits, s.topples);
    r.fall = fall; r.coins = N;
    return r;
  }

  /* 能量條（值由呼叫端保存）：這一注丟之前的能量條值 meter（0～RAIN_EVERY−1）→ 這一注之後的值，
     以及這一注是否觸發金幣雨。第 RAIN_EVERY 注觸發（meter＝RAIN_EVERY−1 時）、之後歸零 */
  function meterAfter(meter){
    var m = Math.floor(meter) || 0, n = (m < 0 ? 0 : m) + 1;
    return n >= RAIN_EVERY ? { meter: 0, rain: true } : { meter: n, rain: false };
  }

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

  /* ---- 抽獎：一注只取一次 rng（見檔頭） ---- */
  function rollKind(u){
    var acc = 0, j;
    for(j = 0; j < GEMS.length; j++){ acc += GEMS[j].p; if(u < acc) return GEMS[j].id; }
    return 'coin';
  }

  /* 反查：必落在對應區間中點的 u（測試、導演台指定結果用） */
  function uForKind(kind){
    var acc = 0, j;
    for(j = 0; j < GEMS.length; j++){ if(GEMS[j].id === kind) return acc + GEMS[j].p / 2; acc += GEMS[j].p; }
    if(kind === 'coin') return (gemP + 1) / 2;
    throw new Error('uForKind：未知種類 ' + kind);
  }

  /* 包一層 rng：只替第一次取值（這枚是什麼）指定結果，用完照 base。
     plan.kind：'coin'｜'diamond'｜'crown'（不給＝照 base） */
  function scripted(plan, base){
    var first = (plan && plan.kind !== undefined) ? uForKind(plan.kind) : null;
    return function(){
      if(first !== null){ var v = first; first = null; return v; }
      return base();
    };
  }

  /* 一注（抽獎唯一入口）：抽這枚是什麼 → drop → （opts.rain 為真）金幣雨 rainAll，整注結果一次定完。
     opts.rec===false 時不記分波明細（大量模擬用）。opts.rain＝這一注是否觸發金幣雨（呼叫端依能量條決定）。
     enter／inValue 已把金幣雨的 N 枚免費幣算進去。res.rain 為 null 或 rainAll 的結果。 */
  function play(board, i, rng, opts){
    var rec = !(opts && opts.rec === false), doRain = !!(opts && opts.rain);
    var kind = rollKind(rng());
    var main = run(board.h, board.g, i, kind, rec), rain = doRain ? rainAll(board, rec) : null;
    var exits = { coin: main.exits.coin, diamond: main.exits.diamond, crown: main.exits.crown };
    var enter = { coin: kind === 'coin' ? 1 : 0, diamond: kind === 'diamond' ? 1 : 0, crown: kind === 'crown' ? 1 : 0 };
    if(rain){ exits.coin += rain.exits.coin; exits.diamond += rain.exits.diamond; exits.crown += rain.exits.crown; enter.coin += rain.coins; }
    return { cell: i, kind: kind, main: main, rain: rain, exits: exits, enter: enter,
             inValue: enter.coin * VALUE.coin + enter.diamond * VALUE.diamond + enter.crown * VALUE.crown,   // 這一注進場東西的面值（含金幣雨的免費幣）
             exitCount: exits.coin + exits.diamond + exits.crown,
             topples: main.topples + (rain ? rain.topples : 0),
             pay: main.pay + (rain ? rain.pay : 0) };                                                        // 這一注拿回（個面額）
  }

  /* 這一注「噴出的東西」的實付金額（整數；di＝面額索引；不含獎池，獎池看 potAfter 的 win） */
  function cash(res, di){
    var p = PAY[di];
    return res.exits.coin * p.coin + res.exits.diamond * p.diamond + res.exits.crown * p.crown;
  }
  /* 連鎖獎池（純函式，獎池的值由呼叫端保存；金額一律是「實付整數」，di＝面額索引）：
     pot＝這一注之前獎池金額（整數）、res＝play 的回傳（用 res.main.topples 與 res.rain）。
     回傳 { pot:這一注之後的獎池, win:這一注拿走多少（沒拿＝0）, add:這一注存了多少（＝PAY[di].pot）,
            by:'chain'（玩家那一枚炸到 POT_CHAIN 格以上；與下雨同注時算這個）｜'rain'（下金幣雨）｜null }
     順序：先入池再判斷，所以拿走的包含這一注存的。 */
  function potAfter(pot, res, di){
    var add = PAY[di].pot, total = (pot > 0 ? Math.floor(pot) : 0) + add;
    var by = res.main.topples >= POT_CHAIN ? 'chain' : (res.rain ? 'rain' : null);
    return by ? { pot: 0, win: total, add: add, by: by } : { pot: total, win: 0, add: add, by: null };
  }
  /* 獎池金額上界（實付整數）：最慢在第 RAIN_EVERY 注下雨時拿走，所以入池後、拿走前最多 RAIN_EVERY×每注存的 */
  function potMax(di){ return RAIN_EVERY * PAY[di].pot; }

  /* 回饋分級：'none'｜'back'（回本）｜'big'（大連爆）｜'huge'（全畫面；≥10 倍或皇冠落袋）
     只給 res 算「噴出的東西」；有拿獎池時多給 di、potWin（實付整數），含獎池的拿回才是分級依據 */
  function tier(res, di, potWin){
    var p = res.pay + (potWin > 0 ? potWin / cfg.DENOMS[di] : 0) + 1e-9;
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

  /* ---- v3：合法盤面、刷新、換金額用的底盤 ---- */
  /* 合法盤面：形狀正確＋穩定循環（燃燒測試）。總枚數因此永遠 ≥ MIN_TOTAL */
  function isLegal(b){
    var j, x;
    if(!b || !b.h || !b.g || b.h.length !== N || b.g.length !== N) return false;
    for(j = 0; j < N; j++){
      x = b.h[j];
      if(typeof x !== 'number' || x !== Math.floor(x) || x < 0 || x >= CAP) return false;
      if(!b.g[j] || b.g[j].length > x) return false;
    }
    return isRecurrent(b);
  }
  /* 隨機建一張「總枚數 tot（MIN_TOTAL～N×(CAP−1)）」的合法盤面的每格枚數 h。
     原理：穩定循環盤面 c 一定 ≥ 某張「最小」穩定循環盤面 m（m[v]＝燃燒順序裡排在 v 後面的相鄰格數，總和＝邊數＝40）；
     反過來，任何 ≥ m 的穩定盤面也都穩定循環。所以：隨機燃燒順序（從邊上的格子往內長）→ m → 隨機補 tot−40 枚到還有空位的格子。
     每格最多 3 枚的限制由「空位清單」保證。涵蓋所有合法盤面（每張合法盤面都有正機率被抽到）。 */
  function sampleLegalH(tot, rr){
    var order = [], inEl = [], el = [], h = [], slots = [], j, d, k, v, nn, pos, cnt, extra, t, q;
    for(j = 0; j < N; j++){ order.push(-1); inEl.push(false); }
    for(j = 0; j < N; j++) for(d = 0; d < 4; d++) if(NB[j][d] < 0){ el.push(j); inEl[j] = true; break; }
    for(pos = 0; pos < N; pos++){
      k = Math.floor(rr() * el.length); v = el[k]; el[k] = el[el.length - 1]; el.pop();
      order[v] = pos;
      for(d = 0; d < 4; d++){ nn = NB[v][d]; if(nn >= 0 && order[nn] < 0 && !inEl[nn]){ inEl[nn] = true; el.push(nn); } }
    }
    for(j = 0; j < N; j++){
      cnt = 0;
      for(d = 0; d < 4; d++){ nn = NB[j][d]; if(nn >= 0 && order[nn] > order[j]) cnt++; }
      h.push(cnt);
      for(q = cnt; q < CAP - 1; q++) slots.push(j);
    }
    extra = tot - MIN_TOTAL;
    for(t = 0; t < extra; t++){
      k = t + Math.floor(rr() * (slots.length - t));
      v = slots[k]; slots[k] = slots[t]; slots[t] = v;
      h[v]++;
    }
    return h;
  }
  /* 疊 3 枚的格子裡，現在丟普通幣下去炸最多格的那格（同分比噴出枚數、再同分取編號小的）；沒有＝cell −1 */
  function chainBest(b){
    var best = -1, bt = 0, be = -1, j, p;
    for(j = 0; j < N; j++){
      if(b.h[j] !== CAP - 1) continue;
      p = probe(b, j);
      if(p.topples > bt || (p.topples === bt && p.exitCount > be)){ best = j; bt = p.topples; be = p.exitCount; }
    }
    return { cell: best, topples: bt, exitCount: be < 0 ? 0 : be };
  }
  /* 刷新盤面（見檔頭）。rr 是回傳 [0,1) 的函式 */
  function reshuffle(board, rr, opts){
    var rnd = rr || Math.random, tries = (opts && opts.tries) || cfg.RESHUFFLE_TRIES;
    var tot, gl = [], j, q, t, best = null, bs = -1, be = -1, cand, ch, free, k;
    if(!isLegal(board)) return cloneBoard(board);
    tot = total(board);
    for(j = 0; j < N; j++) for(q = 0; q < board.g[j].length; q++) gl.push(board.g[j][q]);
    for(t = 0; t < tries; t++){
      cand = emptyBoard(); cand.h = sampleLegalH(tot, rnd);
      for(q = 0; q < gl.length; q++){                 // 寶物只放在還有幣可疊的格子
        free = [];
        for(j = 0; j < N; j++) if(cand.h[j] > cand.g[j].length) free.push(j);
        k = free[Math.floor(rnd() * free.length)];
        cand.g[k].push(gl[q]);
      }
      ch = chainBest(cand);
      if(ch.topples > bs || (ch.topples === bs && ch.exitCount > be)){ best = cand; bs = ch.topples; be = ch.exitCount; }
    }
    return best;
  }
  /* 換金額用的盤面：恰好 MIN_TOTAL（40）枚的合法盤面，沒有寶物 */
  function floorBoard(rr){
    var b = emptyBoard();
    b.h = sampleLegalH(MIN_TOTAL, rr || Math.random);
    return b;
  }

  var M = {
    CFG: cfg, N: N, GEMS: GEMS, VALUE: VALUE, RTP: RTP, RTP_PARTS: RTP_PARTS, PAY: PAY, RAIN_EVERY: RAIN_EVERY,
    POT_ADD: POT_ADD, POT_CHAIN: POT_CHAIN, potAfter: potAfter, potMax: potMax,
    MIN_TOTAL: MIN_TOTAL, START_TOTAL: START_TOTAL, START_RULE: START_RULE, DIRS: DIRS,
    rng: rng, neighbor: neighbor, emptyBoard: emptyBoard, cloneBoard: cloneBoard, total: total, boardValue: boardValue,
    drop: drop, rainAll: rainAll, meterAfter: meterAfter, preview: preview, probe: probe, bestCell: bestCell,
    rollKind: rollKind, uForKind: uForKind, scripted: scripted, play: play,
    cash: cash, tier: tier, isRecurrent: isRecurrent, checkStart: checkStart, startBoard: startBoard,
    isLegal: isLegal, reshuffle: reshuffle, floorBoard: floorBoard, chainBest: chainBest,
    DEMO_METER_START: Math.max(0, RAIN_EVERY - cfg.DEMO_FIRST_RAIN_BET)
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
