/* =========================================================================
 * 爆金連鎖——對局核心（可移植層，零 DOM）　v2.3：能量條、金幣雨與連鎖獎池
 *
 * 只包「狀態」：錢包、目前面額、每個面額各一張盤面＋各一條能量條＋各一個獎池、注單流水、進行中一單、存檔與接回。
 * 規則（丟一枚、連爆、金幣雨、寶物方向、實付、分級、能量條進位）全部呼叫凍結的 values.js
 * （EV.play／meterAfter／potAfter／cash／tier），這裡不重寫規則、不碰任何機率、不自己取亂數
 * （只把 rng 交給 EV.play；一注固定只取 1 次，見 values.js 檔頭）。
 *
 * 一句話：「一注」＝丟一枚。扣一個面額 → 能量條 +1（集滿這一注＝金幣雨）→ EV.play 算完（含金幣雨）
 *         → EV.potAfter：這一注的獎池入池，自己連鎖炸到門檻或下雨就整個拿走 → 盤面已是新盤面 → UI 演出 → ack() 入帳。
 *         拿回 payout ＝ 噴出的東西（Σ items.amount）＋ 拿走的獎池（potWin）。
 *
 * ── 常數 ───────────────────────────────────────────────────────────────
 * METER_START＝56：能量條起始值。【Demo 專用】（用戶裁決「預充」：新玩家丟 30 注就看到第一場金幣雨）；
 *   正式版該是 0。建立遊戲、重置時三條能量條都回這個值。DemoCore.METER_START 可讀。
 * 能量條長度＝EV.RAIN_EVERY（86，values.js 單點）；值域 0～85；每注 +1，第 86 注（meterBefore＝85）觸發金幣雨、歸零。
 * 獎池（每張盤面一個，實付整數）：每注存 EV.PAY[di].pot（15／75／150）、自己那一枚連鎖炸到 EV.POT_CHAIN 格以上或下雨就整個拿走；
 *   值域 0～EV.potMax(di)；新盤面從 0；跟盤面、能量條一起存檔；重置錢包不動它；clearSaved 歸零。DemoCore.SAVE_V 可讀（存檔版本）。
 *
 * ── 公開介面 ───────────────────────────────────────────────────────────
 * DemoCore.createGame(opts) → game
 *   opts：{ storage:物件|false, rng, now, wallet, keyPrefix }
 *         storage 不給＝localStorage（沒有就不存）；false＝不存。keyPrefix 預設 DEMO_KEY（'burst'）。
 * DemoCore.METER_START、DemoCore.SAVE_V、DemoCore.RULES
 *
 * 動作（回傳 true＝成功；false＝失敗，同時發 error 事件，game.getLastError() 可查）
 *   bet(cellIndex)     丟一枚到第 cellIndex 格（0～24，列優先：row*5+col）。以目前面額為注額、用目前面額那張盤面與能量條。
 *   ack()              UI 演完後呼叫：把拿回金額入帳，回到可下注。核心不自帶計時。
 *   setDenom(di)       換面額（DENOMS 索引）＝切到那張盤面（連同它的能量條）。演出中（ANIM）不可。
 *   clearSaved()       重置：錢包回 wallet 選項（預設 10,000）、三張盤面回起始盤面（全部「還沒丟過」）、
 *                      三條能量條回 METER_START、三個獎池歸零、注單清空、面額回預設。演出中不可。
 *   resetWallet()      重置錢包（紀錄頁那顆鈕用這個）：只把錢包補回 wallet 選項（預設 10,000）、注單清空；
 *                      **盤面、能量條、獎池、面額都不動**（2026-11-26 用戶「重置錢包不要刷新盤面啊」）。演出中不可。
 *                      clearSaved() 是整份回到新玩家，只給測試與探針用。
 *   addMoney(n)        導演台加錢（Demo 專用）。演出中不可。
 *   armNext(plan)      導演台：指定「下一注」玩家丟的那枚是什麼：{ kind:'coin'|'diamond'|'crown' }（沒給＝照 rng；
 *                      多給的欄位，例如 v1 的 sky，一律忽略）。只對下一次成功的 bet 生效，用完自動清掉；armNext(null) 取消。
 *                      kind 不合法回 false（error code 'plan'）。一般的 rng 注入用 setRng(fn)／getRng()。
 *   setMeter(v, di?)   導演台：把能量條設成 v（取整、夾在 0～RAIN_EVERY−1）。di 不給＝目前面額。設成 RAIN_EVERY−1（42）＝下一注必下金幣雨。
 *                      演出中不可；v 不是有限數字、di 不合法 → false（error code 'meter'／'denom'）。成功發 meter 事件。
 *   setPot(v, di?)     導演台：把獎池設成 v（實付金額、取整、夾在 0～EV.potMax(di)）。di 不給＝目前面額。演出中不可；
 *                      v 不是有限數字 → false（error code 'pot'）、di 不合法 → false（'denom'）。成功發 pot 事件並存檔。
 *   on(fn(type, data)) 訂閱事件
 *   setRng(fn)／getRng()
 *
 * 查詢（全部唯讀；回傳的盤面都是拷貝，改了不影響核心）
 *   getState()         { phase:'BET'|'ANIM', wallet, denomIndex, denom, board, fresh, glow, canBet,
 *                        meter:目前面額的能量條, meters:[各面額能量條], rainEvery:86,
 *                        pot:目前面額的獎池金額(實付整數), pots:[各面額獎池], potChain:8（炸幾格拿）, potAdd:目前面額每注存多少(15／75／150),
 *                        st:進行中一單的 result|null, records:最近 20 筆, seq }
 *   getBoard(di?)      該面額「目前」盤面 { h:[25], g:[25][寶物種類清單] }；不給 di＝目前面額。
 *                      演出中（ANIM）回的是「算完後」的盤面（重整接回也是這張）；演出起點看 result.boardBefore。
 *   getPot(di?)        該面額「目前」獎池金額（實付整數）；不給 di＝目前面額；面額不合法回 -1。演出中（ANIM）已是「這一注之後」的值
 *                      （拿走了＝0）；演出起點看 result.potBefore。
 *   getMeter(di?)      該面額「目前」能量條值（0～85）；不給 di＝目前面額。
 *                      演出中（ANIM）已是「這一注之後」的值（金幣雨那一注＝0）；演出起點看 result.meterBefore。
 *   isFresh(di?)       這張盤面是否還沒丟過（首次進場旗標；重置後全部回 true）
 *   glowCell(di?)      還沒丟過 → 發光格編號（EV.bestCell：起始盤面最會爆的那格）；丟過了 → -1
 *   getDenom()／getDenomIndex()  目前面額金額／索引
 *   getWallet()        錢包（整數）
 *   getRecords(n?)     注單流水（時間順序、最舊在前；不給 n＝全部，核心封頂 200 筆；每筆是「紀錄」，見下）
 *   getPending()       進行中一單的 result（沒有＝null）
 *   getRestored()      建立遊戲時若有「演出中重整」被直接結算，回那一筆紀錄（rec 形狀，見下），否則 null
 *   getLastError()     最近一次失敗 { code, msg }：code ∈ 'phase'（階段不對）｜'cell'（格號不合法）｜'funds'（餘額不足）
 *                      ｜'denom'（面額索引不合法）｜'meter'（能量條值不合法）｜'pot'（獎池金額不合法）｜'plan'（armNext 的 kind 不合法）
 *   canBet()           目前能不能下注（BET 階段且餘額 ≥ 目前面額）
 *
 * 事件（on(fn(type, data))）
 *   wallet  { wallet }                                          餘額變動（扣注、入帳、重置、加錢）
 *   result  { orderId, denomIndex, stake, cell, result, win, payout, mult, tier, hasRain, meterBefore, meterAfter,
 *             potBefore, potAdd, potWin, potAfter, potBy }
 *                                                               結果已先定（錢已扣、盤面已是新盤面、能量條已是新值），交給 UI 演出
 *   settled { orderId, denomIndex, stake, cell, payout, net, mult, tier, potWin, wallet, restored, rec }
 *                                                               ack 後入帳（restored＝重整接回的直接結算）
 *   denom   { denomIndex, denom }                               換面額
 *   meter   { denomIndex, meter, meters }                       導演台 setMeter 改了能量條（bet 造成的變動看 result 事件）
 *   pot     { denomIndex, pot, pots }                           導演台 setPot 改了獎池（bet 造成的變動看 result 事件）
 *   reset   { wallet, meters, pots, walletOnly? }               重置完成（盤面／能量條／獎池／面額／錢包都已回初始；walletOnly＝只重置錢包）
 *   error   { code, msg }
 *
 * ── 一注的結果 result（演出與紀錄頁只讀它；EV.play 的欄位原樣帶入，沒有毫秒）──────────
 *   orderId, ts            注單號、時間戳
 *   denomIndex, stake      面額索引、注額（＝該面額金額；整數）
 *   cell                   玩家丟的格
 *   kind                   丟的是什麼 'coin'|'diamond'|'crown'
 *   main                   玩家那一枚的演出：{ cell, kind, waves, exits:{coin,diamond,crown}, topples, exitCount, pay }
 *                            waves[w] ＝ { cells:[這一波同時炸開的格], exitCount,
 *                                         moves:[{ from, dir(0左1右2上3下), to(-1＝噴出盤面), kind }] }（每格炸 4 筆 moves）
 *                            沒爆＝waves 是空陣列
 *   rain                   金幣雨：null＝這一注沒有；有＝{ cell:-1, kind:'coin', waves, exits, topples, exitCount, pay,
 *                            fall:[0..24]（第一波之前，這 25 格各同時落 1 枚免費普通幣）, coins:25 }；waves 格式同 main
 *                            （金幣雨在玩家那一枚連鎖完之後才開始，所以 rain.waves 接在 main.waves 後面演）
 *   hasRain                這一注有沒有金幣雨（＝rain !== null）
 *   meterBefore            這一注丟之前的能量條值（0～42；hasRain 時一定是 42）
 *   meterAfter             這一注之後的能量條值（hasRain 時＝0，否則＝meterBefore+1）
 *   potBefore              這一注之前獎池金額（實付整數）
 *   potAdd                 這一注存進獎池多少（＝EV.PAY[di].pot：15／75／150）
 *   potWin                 這一注拿走獎池多少（沒拿＝0）。＝ potBefore＋potAdd（先入池再拿，所以含這一注存的）
 *   potAfter               這一注之後的獎池金額（拿走了＝0，否則＝potBefore＋potAdd）
 *   potBy                  'chain'（玩家自己那一枚連鎖炸到 POT_CHAIN 格以上；與下雨同注時算這個）｜'rain'（下金幣雨）｜null（沒拿）
 *                          金幣雨帶出的連鎖不算進門檻（只看 main.topples）
 *   exits, enter           噴出盤面各種類枚數（玩家那一枚＋金幣雨合計）、這一注進場各種類枚數（金幣雨的 25 枚算進 enter.coin）
 *   inValue, pay, topples, exitCount   values.js 原值：進場面值／噴出的東西的拿回（個面額；玩家那枚加金幣雨合計；**不含獎池**）／連爆總格數／噴出總枚數
 *   items                  噴出清單（依發生順序：先玩家那一枚的各波、再金幣雨的各波）：
 *                            [{ src:'main'|'rain', wave:波序(0 起，在各自的 waves 內計), from, dir, kind, amount:該枚實付金額(整數) }]
 *                            Σamount ＋ potWin ＝ payout（items 只列噴出的東西，獎池另列）；每枚金額取自 EV.PAY[di]，不另算
 *                            注意：落下的 25 枚雨幣都是普通幣，但雨連爆時盤面上「原本就在的」寶物也可能被擠出，
 *                            所以 src:'rain' 的 item，kind 不一定是 'coin'
 *   payout                 拿回金額（整數；＝EV.cash(play, di) ＋ potWin，含獎池）
 *   mult                   倍數＝拿回幾個面額（含獎池；＝payout ÷ stake；不等於 res.pay，那個只含噴出的）
 *   net                    淨額 payout − stake
 *   tier                   分級 EV.tier(res, di, potWin)：'none'|'back'|'big'|'huge'（用含獎池的拿回算）
 *   quiet                  沒爆也沒金幣雨（topples===0 且沒雨）：UI 可不等演出、立刻 ack()（沒爆＝不可能拿獎池，所以 quiet 的注 potWin 一定是 0）
 *   boardBefore, boardAfter 這一注前後的盤面（拷貝；boardAfter 含金幣雨之後）
 *   （v1 的 sky、hasSky、skyCell 已拿掉）
 *
 * ── 紀錄 rec（getRecords／settled.rec；一注一筆，不含分波，留 200 筆）────────────────
 *   { orderId, ts, denomIndex, stake, cell, kind, hasRain, payout, net, mult, tier, win(payout>0), potWin,
 *     exits:{coin,diamond,crown}, exitCount, topples }（payout／net／mult 含獎池）
 *   （hasSky、skyCell 改成 hasRain）
 *
 * ── 存檔 ───────────────────────────────────────────────────────────
 *   單一 key：<keyPrefix>.core＝'burst.core'，內容 { v:5, wallet, seq, denom, fresh:[各面額還沒丟過],
 *   boards:[各面額盤面], meters:[各面額能量條], pots:[各面額獎池金額（實付整數）], records, pending:進行中一單（含完整 result）|null }。
 *   每次 bet／ack／換面額／setMeter／setPot／重置後整份寫。版本不是 5（v1～v4 舊存檔；v4 沒有獎池、能量條長度也不同）→ 整份忽略，當成新玩家。
 *   重整接回：有 pending＝演出中被重整→直接入帳（結果早已定，不重演、不重抽；盤面、能量條、獎池本來就存的是算完的值，
 *   金幣雨那一注接回後盤面是下完雨的、能量條已歸零；拿獎池那一注接回後獎池已歸零、payout（含獎池）只入帳一次）。
 *   壞檔（格式不對）→ 整份忽略；單張盤面不合法→只那張回起始盤面；單條能量條不合法→只那條回 METER_START；單個獎池不合法（非整數、負數、超過上界）／缺 pots→只那個回 0。
 *
 * 流程：BET —bet→ ANIM（結果已抽定、押額已扣）—ack→ BET（拿回入帳）。「上一單已 ack 才能下一單」。
 * 依賴：values.js 的 EV、DEMO_KEY（Node 測試用 eval 載入，故不碰 window）。
 * ========================================================================= */
var DemoCore = (function(){

var REC_CAP = 200;                      // 核心留的注單筆數
var METER_START = 56;                   // 【Demo 專用】能量條起始值（預充；正式版 0）
var SAVE_V = 5;                         // 存檔版本；規則或存檔欄位變了就加一，舊版整份忽略＝新玩家

/* ---------- 規則：只有這幾個函式認識玩法，全部轉呼叫 values.js ---------- */
var RULES = {
  validCell:  function(i){ return typeof i === 'number' && i === Math.floor(i) && i >= 0 && i < EV.N; },
  validDenom: function(di){ return typeof di === 'number' && di === Math.floor(di) && di >= 0 && di < EV.CFG.DENOMS.length; },
  validMeter: function(m){ return typeof m === 'number' && m === Math.floor(m) && m >= 0 && m < EV.RAIN_EVERY; },
  meterAfter: function(meter){ return EV.meterAfter(meter); },                       // { meter:下一值, rain:這注是否金幣雨 }
  play:       function(board, cell, rng, rain){ return EV.play(board, cell, rng, { rain: rain }); },   // 結果先定；直接改 board
  payout:     function(res, di){ return EV.cash(res, di); },                          // 實付（整數）
  tier:       function(res, di, potWin){ return EV.tier(res, di, potWin); },          // 分級含獎池的拿回
  potAfter:   function(pot, res, di){ return EV.potAfter(pot, res, di); },            // { pot:之後, win:拿走, add:存入, by:'chain'|'rain'|null }
  validPot:   function(p, di){ return typeof p === 'number' && p === Math.floor(p) && p >= 0 && p <= EV.potMax(di); },
  startBoard: function(di){ return EV.startBoard(di); }
};

/* 噴出清單：把各波 moves 裡 to<0 的挑出來，金額取自 EV.PAY（不另算） */
function collectItems(res, di){
  var items = [], pay = EV.PAY[di];
  function scan(part, src){
    if(!part || !part.waves) return;
    for(var w = 0; w < part.waves.length; w++){
      var mv = part.waves[w].moves;
      for(var m = 0; m < mv.length; m++){
        if(mv[m].to < 0) items.push({ src: src, wave: w, from: mv[m].from, dir: mv[m].dir, kind: mv[m].kind, amount: pay[mv[m].kind] });
      }
    }
  }
  scan(res.main, 'main'); scan(res.rain, 'rain');
  return items;
}

function copyExits(e){ return { coin: e.coin, diamond: e.diamond, crown: e.crown }; }

function summarize(r){
  return { orderId: r.orderId, ts: r.ts, denomIndex: r.denomIndex, stake: r.stake, cell: r.cell, kind: r.kind,
           hasRain: r.hasRain, payout: r.payout, net: r.net, mult: r.mult, tier: r.tier,
           win: r.payout > 0, potWin: r.potWin, exits: copyExits(r.exits), exitCount: r.exitCount, topples: r.topples };
}

function validBoard(b){
  var N = EV.N, i, q;
  if(!b || !Array.isArray(b.h) || !Array.isArray(b.g) || b.h.length !== N || b.g.length !== N) return false;
  for(i = 0; i < N; i++){
    if(typeof b.h[i] !== 'number' || b.h[i] !== Math.floor(b.h[i]) || b.h[i] < 0 || b.h[i] >= EV.CFG.CAP) return false;
    if(!Array.isArray(b.g[i]) || b.g[i].length > b.h[i]) return false;
    for(q = 0; q < b.g[i].length; q++) if(b.g[i][q] !== 'diamond' && b.g[i][q] !== 'crown') return false;
  }
  return true;
}

function createGame(opts){
  opts = opts || {};
  var rng = opts.rng || Math.random;
  var now = opts.now || function(){ return Date.now(); };
  var store = resolveStore(opts.storage);
  var KEY = (opts.keyPrefix || DEMO_KEY) + '.core';
  var startWallet = (opts.wallet != null) ? opts.wallet : EV.CFG.WALLET;
  var ND = EV.CFG.DENOMS.length;

  var wallet = startWallet;
  var records = [];                       // 已結注單紀錄（核心留 200 筆）
  var st = null;                          // 進行中的一單（結果已定，含完整 result）
  var phase = 'BET';                      // BET | ANIM
  var seq = 0;                            // 注單流水號（存檔）
  var denom = EV.CFG.DENOM_DEFAULT;       // 目前面額索引
  var boards = [], fresh = [], meters = [], pots = [];   // 每個面額一張盤面、還沒丟過的旗標、一條能量條、一個獎池（實付整數）
  var nextPlan = null;                    // 導演台指定的下一注結果
  var lastError = null, restoredRec = null;
  var subs = [];

  function resolveStore(s){
    if(s === false) return null;
    if(s) return s;
    try{ if(typeof localStorage !== 'undefined') return localStorage; }catch(e){}
    return null;
  }
  function emit(type, data){
    for(var i = 0; i < subs.length; i++){ try{ subs[i](type, data || {}); }catch(e){} }
  }
  function fail(code, msg){ lastError = { code: code, msg: msg }; emit('error', { code: code, msg: msg }); return false; }
  function resetBoards(){
    boards = []; fresh = []; meters = []; pots = [];
    for(var d = 0; d < ND; d++){ boards.push(RULES.startBoard(d)); fresh.push(true); meters.push(METER_START); pots.push(0); }
  }

  /* ---------- 存檔／接回 ---------- */
  function save(){
    if(!store) return;
    try{
      store.setItem(KEY, JSON.stringify({ v: SAVE_V, wallet: wallet, seq: seq, denom: denom, fresh: fresh,
        boards: boards, meters: meters, pots: pots, records: records, pending: st }));
    }catch(e){}
  }
  function restore(){
    if(!store) return;
    var raw = null, d = null, i;
    try{ raw = store.getItem(KEY); }catch(e){}
    if(!raw) return;
    try{ d = JSON.parse(raw); }catch(e){ return; }
    if(!d || d.v !== SAVE_V || typeof d.wallet !== 'number' || !isFinite(d.wallet) || !Array.isArray(d.boards)) return;   // 舊版（v1～v4）＝新玩家
    wallet = d.wallet; seq = d.seq || 0; records = Array.isArray(d.records) ? d.records : [];
    if(RULES.validDenom(d.denom)) denom = d.denom;
    for(i = 0; i < ND; i++){                                        // 壞掉的盤面／能量條只重置那一張／那一條
      if(validBoard(d.boards[i])){ boards[i] = d.boards[i]; fresh[i] = !!(d.fresh && d.fresh[i]); }
      if(Array.isArray(d.meters) && RULES.validMeter(d.meters[i])) meters[i] = d.meters[i];
      if(Array.isArray(d.pots) && RULES.validPot(d.pots[i], i)) pots[i] = d.pots[i];
    }
    if(d.pending && d.pending.result && typeof d.pending.payout === 'number'){
      st = d.pending; phase = 'ANIM'; settle(true);                 // 演出中重整＝直接結算（盤面、能量條本來就是算完的）
      restoredRec = records[records.length - 1];
    }
  }

  /* ---------- 注單號：前綴＋時間（36 進位）＋流水號，同毫秒也不撞 ---------- */
  function newOrderId(ts){
    seq++;
    return String(DEMO_KEY).toUpperCase() + '-' + ts.toString(36).toUpperCase() + '-' +
      ('000' + seq).slice(-4);
  }

  function canBet(){ return phase === 'BET' && wallet >= EV.CFG.DENOMS[denom]; }

  function bet(cell){
    if(phase !== 'BET') return fail('phase', '非下注階段');
    if(!RULES.validCell(cell)) return fail('cell', '格號不合法');
    var stake = EV.CFG.DENOMS[denom];
    if(stake > wallet) return fail('funds', '餘額不足');
    var ts = now();
    var board = boards[denom];
    var before = EV.cloneBoard(board);
    var meterBefore = meters[denom];
    var m = RULES.meterAfter(meterBefore);                          // 能量條 +1；集滿這一注＝金幣雨
    wallet -= stake;
    var useRng = nextPlan ? EV.scripted(nextPlan, rng) : rng;
    nextPlan = null;
    var res = RULES.play(board, cell, useRng, m.rain);              // 結果先定：一次算完（含金幣雨），board 已是新盤面
    meters[denom] = m.meter;
    fresh[denom] = false;
    var potBefore = pots[denom];
    var pa = RULES.potAfter(potBefore, res, denom);                 // 獎池：先入池再判斷（自己連鎖到門檻或下雨就整個給玩家）
    pots[denom] = pa.pot;
    var payout = RULES.payout(res, denom) + pa.win;                 // 拿回＝噴出的東西 ＋ 獎池（items 只列噴出的，Σitems.amount＋potWin＝payout）
    res.orderId = newOrderId(ts); res.ts = ts;
    res.denomIndex = denom; res.stake = stake;
    res.hasRain = !!res.rain;
    res.meterBefore = meterBefore; res.meterAfter = m.meter;
    res.potBefore = potBefore; res.potAdd = pa.add; res.potWin = pa.win; res.potAfter = pa.pot; res.potBy = pa.by;
    res.quiet = res.topples === 0 && !res.rain;
    res.payout = payout; res.mult = payout / stake; res.net = payout - stake;   // pay 仍是 values.js 原值（只含噴出的）；mult 含獎池
    res.tier = RULES.tier(res, denom, pa.win);
    res.items = collectItems(res, denom);
    res.boardBefore = before; res.boardAfter = EV.cloneBoard(board);
    st = { orderId: res.orderId, ts: ts, denomIndex: denom, stake: stake, cell: cell, payout: payout, result: res };
    phase = 'ANIM';
    save();
    emit('wallet', { wallet: wallet });
    emit('result', { orderId: res.orderId, denomIndex: denom, stake: stake, cell: cell, result: res,
                     win: payout > 0, payout: payout, mult: res.mult, tier: res.tier,
                     hasRain: res.hasRain, meterBefore: meterBefore, meterAfter: m.meter,
                     potBefore: potBefore, potAdd: pa.add, potWin: pa.win, potAfter: pa.pot, potBy: pa.by });
    return true;
  }

  function ack(){                                                   // UI 演出完成的結算點
    if(phase !== 'ANIM') return fail('phase', '非演出結算點');
    settle(false);
    return true;
  }

  function settle(restored){
    var r = st.result, pay = st.payout;                             // 結果先定：結算只認抽定時的金額
    wallet += pay;
    var rec = summarize(r);
    records.push(rec);
    if(records.length > REC_CAP) records.splice(0, records.length - REC_CAP);
    st = null; phase = 'BET';
    save();
    emit('settled', { orderId: rec.orderId, denomIndex: rec.denomIndex, stake: rec.stake, cell: rec.cell,
      payout: pay, net: rec.net, mult: rec.mult, tier: rec.tier, potWin: rec.potWin, wallet: wallet, restored: !!restored,
      rec: rec });
    emit('wallet', { wallet: wallet });
  }

  function setDenom(di){
    if(phase !== 'BET') return fail('phase', '演出中不可換面額');
    if(!RULES.validDenom(di)) return fail('denom', '面額不合法');
    denom = di; save();
    emit('denom', { denomIndex: di, denom: EV.CFG.DENOMS[di] });
    return true;
  }

  function dix(di){ return di == null ? denom : di; }
  function getBoard(di){ di = dix(di); return RULES.validDenom(di) ? EV.cloneBoard(boards[di]) : null; }
  function getMeter(di){ di = dix(di); return RULES.validDenom(di) ? meters[di] : -1; }
  function getPot(di){ di = dix(di); return RULES.validDenom(di) ? pots[di] : -1; }
  function isFresh(di){ di = dix(di); return RULES.validDenom(di) ? !!fresh[di] : false; }
  function glowCell(di){ di = dix(di); return (RULES.validDenom(di) && fresh[di]) ? EV.bestCell(boards[di]) : -1; }

  function getState(){
    return { phase: phase, wallet: wallet, denomIndex: denom, denom: EV.CFG.DENOMS[denom],
             board: EV.cloneBoard(boards[denom]), fresh: !!fresh[denom], glow: glowCell(denom), canBet: canBet(),
             meter: meters[denom], meters: meters.slice(), rainEvery: EV.RAIN_EVERY,
             pot: pots[denom], pots: pots.slice(), potChain: EV.POT_CHAIN, potAdd: EV.PAY[denom].pot,
             st: st ? st.result : null, records: records.slice(-20), seq: seq };
  }

  function clearSaved(){                                            // 重置：錢包、三張盤面、三條能量條、注單、面額全部回初始（演出中不可）
    if(st) return fail('phase', '對局中不可重置');
    if(store){ try{ store.removeItem(KEY); }catch(e){} }
    wallet = startWallet; records = []; seq = 0; denom = EV.CFG.DENOM_DEFAULT; nextPlan = null;
    resetBoards(); save();
    emit('wallet', { wallet: wallet });
    emit('reset', { wallet: wallet, meters: meters.slice(), pots: pots.slice() });
    return true;
  }

  function resetWallet(){                                           // 只重置錢包與注單；盤面、能量條、獎池、面額不動（演出中不可）
    if(st) return fail('phase', '對局中不可重置');
    wallet = startWallet; records = []; save();
    emit('wallet', { wallet: wallet });
    emit('reset', { wallet: wallet, meters: meters.slice(), pots: pots.slice(), walletOnly: true });
    return true;
  }

  function addMoney(n){                                             // 導演台加錢（Demo 專用）
    if(st) return fail('phase', '對局中不可加錢');
    wallet += Math.floor(n); save();
    emit('wallet', { wallet: wallet });
    return true;
  }

  function setMeter(v, di){                                         // 導演台：改能量條（Demo 專用）
    if(st) return fail('phase', '對局中不可改能量條');
    di = dix(di);
    if(!RULES.validDenom(di)) return fail('denom', '面額不合法');
    if(typeof v !== 'number' || !isFinite(v)) return fail('meter', '能量條值不合法');
    v = Math.floor(v);
    meters[di] = v < 0 ? 0 : (v > EV.RAIN_EVERY - 1 ? EV.RAIN_EVERY - 1 : v);
    save();
    emit('meter', { denomIndex: di, meter: meters[di], meters: meters.slice() });
    return true;
  }

  function setPot(v, di){                                           // 導演台：改獎池金額（實付整數；Demo 專用）
    if(st) return fail('phase', '對局中不可改獎池');
    di = dix(di);
    if(!RULES.validDenom(di)) return fail('denom', '面額不合法');
    if(typeof v !== 'number' || !isFinite(v)) return fail('pot', '獎池金額不合法');
    v = Math.floor(v);
    pots[di] = v < 0 ? 0 : (v > EV.potMax(di) ? EV.potMax(di) : v);
    save();
    emit('pot', { denomIndex: di, pot: pots[di], pots: pots.slice() });
    return true;
  }

  function armNext(plan){
    if(plan && plan.kind !== undefined && plan.kind !== 'coin' && plan.kind !== 'diamond' && plan.kind !== 'crown')
      return fail('plan', 'kind 不合法');
    nextPlan = plan ? { kind: plan.kind } : null;                   // 只認 kind（v1 的 sky 忽略）
    return true;
  }

  resetBoards();
  restore();
  if(store){ var had = null; try{ had = store.getItem(KEY); }catch(e){} if(!had) save(); }   // 未下注重整＝同樣的盤面
  return { bet: bet, ack: ack, setDenom: setDenom, clearSaved: clearSaved, resetWallet: resetWallet, addMoney: addMoney, armNext: armNext, setMeter: setMeter, setPot: setPot,
           getState: getState, getBoard: getBoard, getMeter: getMeter, getPot: getPot, isFresh: isFresh, glowCell: glowCell,
           getDenom: function(){ return EV.CFG.DENOMS[denom]; }, getDenomIndex: function(){ return denom; },
           getWallet: function(){ return wallet; },
           getRecords: function(n){ return (n > 0 ? records.slice(-n) : records.slice()); },
           getPending: function(){ return st ? st.result : null; },
           getRestored: function(){ return restoredRec; },
           getLastError: function(){ return lastError; },
           canBet: canBet,
           on: function(fn){ subs.push(fn); },
           setRng: function(fn){ rng = fn; },
           getRng: function(){ return rng; } };
}

return { createGame: createGame, RULES: RULES, METER_START: METER_START, SAVE_V: SAVE_V };
})();
if(typeof module !== 'undefined' && module.exports) module.exports = DemoCore;
