/* =========================================================================
 * 空投爭奪——對局核心（可移植層，零 DOM）
 *
 * 對外：DemoCore.createGame(opts) → game
 *   opts：{ storage:物件|false, rng, now, wallet, keyPrefix }
 *   game：board() / bet(pointIdx, stake) / changePoint(pointIdx) / ack() /
 *         getState() / clearSaved() / addMoney(n) / on(fn) / setRng(fn) / getRng()
 *
 * 一局的資料流（「盤面先公告、結果後抽定」）：
 *   開新局：抽「盤面」（4 個落點各自的物資 → 賠率、獨佔率），公告給玩家，存檔。
 *   下注  ：玩家看著已公告的盤面選落點；bet 才抽 3 個機器人落點與 1 個箱子（盤面不再抽、不會換）。
 *   結算  ：ack 後派彩，並立刻抽下一局盤面（emit board）。
 *   亂數順序（與 values.js 的 EV.drawRound 完全一致，mc-test F 區逐局比對）：
 *     盤面 4 個（落點由低到高各 1 個）→ 機器人 3 個 → 箱子 1 個；下一局盤面接在結算時抽。
 *
 * 事件（on(fn(type, data))）：
 *   wallet  { wallet }
 *   board   { board, reason }                 新盤面公告（reason：'next' 結算後換局）
 *   result  { ...round, wallet }              下注成功，整局結果已抽定，交給 UI 演出
 *   repick  { ...round, wallet }              封盤倒數中改點（changePoint）後的新結果
 *   settled { ...round, net, wallet, restored, nextBoard }
 *   error   { msg }
 *   round 欄位見檔尾 snapRound 與任務卡 H01 完成註記。
 * 狀態機：BET —bet→ ANIM（結果已抽定、注額已扣；可 changePoint）—ack→ BET（派彩入帳＋換新盤面）。
 *   UI 演完才呼叫 ack()；核心不自帶動畫計時。
 * 重整接回：待命中重整＝盤面不變；演出中重整＝直接結算（存檔裡的結果已定，不重演、不重抽）。
 *
 * 換玩法時只改下面 RULES 這一段，其餘（錢包、狀態機、注單、存檔、事件）不動。
 * 依賴：values.js 的 EV、DEMO_KEY（Node 測試用 eval 載入，故不碰 window）。
 * 程式碼維持 ES5（舊手機）。
 * ========================================================================= */
var DemoCore = (function(){

/* ---------- 規則：只有這一段認識玩法 ---------- */
var RULES = (function(){
  var CFG = EV.CFG;
  var K = EV.POINTS.length;                       // 落點數
  var NBOT = CFG.PLAYERS - 1;                     // 機器人數
  var BOXT = EV.BOX.tiers;
  var BOXP = [];
  var BOARDS = EV.allBoards();                    // 窮舉的物資組合表（賠率全由 values.js 算好）
  var i;
  for(i = 0; i < BOXT.length; i++) BOXP.push(BOXT[i].p);

  function pickBy(weights, u){                    // 與 values.js 同一口徑（浮點尾差落最後一格）
    var acc = 0, j;
    for(j = 0; j < weights.length; j++){ acc += weights[j]; if(u < acc) return j; }
    return weights.length - 1;
  }
  function copyBoard(b){
    return { idx:b.idx, supply:b.supply.slice(), odds:b.odds.slice(), q:b.q.slice(), botP:b.botP.slice() };
  }
  function boardAt(idx){                          // 由物資組合編號取盤面（內部唯讀物件）
    var e = BOARDS[idx];
    return { idx:idx, supply:e.c.slice(), odds:e.board.odds.slice(), q:e.board.q.slice(), botP:e.board.botP.slice() };
  }

  return {
    K: K, NBOT: NBOT,
    copyBoard: copyBoard,
    validChoice: function(c){ return typeof c === 'number' && c >= 0 && c < K && Math.floor(c) === c; },

    /* 開新局盤面：各落點各抽 1 個亂數（由低到高），等機率選物資 */
    drawBoard: function(rng){
      var idx = 0, j, list;
      for(var p = 0; p < K; p++){
        list = CFG.SUPPLY[p];
        j = Math.floor(rng() * list.length);
        if(j >= list.length) j = list.length - 1;
        idx = idx * list.length + j;
      }
      return boardAt(idx);
    },
    /* 由存檔的 4 個物資量重建盤面；不合法回 null */
    boardFromSupply: function(supply){
      if(!supply || supply.length !== K) return null;
      var idx = 0, j;
      for(var p = 0; p < K; p++){
        j = CFG.SUPPLY[p].indexOf(supply[p]);
        if(j < 0) return null;
        idx = idx * CFG.SUPPLY[p].length + j;
      }
      return boardAt(idx);
    },
    /* 下注後才抽：3 個機器人落點 → 1 個箱子（不論輸贏都抽滿 4 個亂數） */
    drawRest: function(rng, board){
      var botPicks = [], b;
      for(b = 0; b < NBOT; b++) botPicks.push(pickBy(board.botP, rng()));
      return { botPicks: botPicks, boxIdx: pickBy(BOXP, rng()) };
    },
    validRest: function(botPicks, boxIdx){
      if(!botPicks || botPicks.length !== NBOT) return false;
      for(var b = 0; b < NBOT; b++) if(!(RULES.validChoice(botPicks[b]))) return false;
      return typeof boxIdx === 'number' && boxIdx >= 0 && boxIdx < BOXT.length && Math.floor(boxIdx) === boxIdx;
    },
    /* 由「盤面＋自己的落點＋機器人落點＋箱子」決定性算出各點人數、是否獨佔、倍率、本局最高獨佔色 */
    resolve: function(board, pointIdx, botPicks, boxIdx){
      var counts = [], p, b;
      for(p = 0; p < K; p++) counts.push(0);
      counts[pointIdx]++;
      for(b = 0; b < botPicks.length; b++) counts[botPicks[b]]++;
      var solo = counts[pointIdx] === 1;
      var baseOdds = board.odds[pointIdx];
      var boxMult = BOXT[boxIdx].mult;
      var top = -1;                                // 本局獨佔成功且基準賠率最高的落點；全撞＝-1
      for(p = 0; p < K; p++)
        if(counts[p] === 1 && (top < 0 || board.odds[p] > board.odds[top])) top = p;
      return { counts: counts, solo: solo, baseOdds: baseOdds, boxMult: boxMult,
               mult: solo ? baseOdds * boxMult : 0, topSoloPoint: top };
    },
    /* 派彩：全精度算、取整一次（獨佔＝注額×基準賠率×箱倍率；撞車＝0） */
    payout: function(stake, mult){ return mult > 0 ? EV.payoutFloor(stake, mult) : 0; }
  };
})();

function createGame(opts){
  opts = opts || {};
  var rng = opts.rng || Math.random;
  var now = opts.now || function(){ return Date.now(); };
  var store = resolveStore(opts.storage);
  var KEY = (opts.keyPrefix || DEMO_KEY) + '.core';
  var startWallet = (opts.wallet != null) ? opts.wallet : EV.CFG.WALLET;

  var wallet = startWallet;
  var records = [];                       // 已結注單（核心留 200 筆）
  var board = null;                       // 目前公告的盤面（BET：下一注用；ANIM：進行中那一局的盤面）
  var st = null;                          // 進行中的一單（內部格式，含盤面參照）
  var phase = 'BET';                      // BET | ANIM
  var seq = 0;                            // 注單流水號（存檔）
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
  function emitL(type, mk){ if(subs.length) emit(type, mk()); }   // 沒人訂閱就不組 payload（蒙地卡羅提速）
  function fail(msg){ emit('error', { msg:msg }); return false; }
  function extend(o, src){ for(var k in src) if(src.hasOwnProperty(k)) o[k] = src[k]; return o; }

  /* ---------- 一局的對外格式（唯讀快照，UI 隨便拿） ---------- */
  function snapRound(r){
    return { orderId:r.orderId, ts:r.ts, pointIdx:r.pointIdx, stake:r.stake,
             board:RULES.copyBoard(r.board),
             botPicks:r.botPicks.slice(), counts:r.counts.slice(),
             solo:r.solo, win:r.solo, boxIdx:r.boxIdx, boxMult:r.boxMult,
             baseOdds:r.baseOdds, mult:r.mult, topSoloPoint:r.topSoloPoint, payout:r.payout };
  }
  /* 注單紀錄（瘦身版：盤面只留物資、賠率、獨佔率） */
  function recordOf(r){
    return { orderId:r.orderId, ts:r.ts, pointIdx:r.pointIdx, stake:r.stake,
             board:{ idx:r.board.idx, supply:r.board.supply.slice(), odds:r.board.odds.slice(), q:r.board.q.slice() },
             botPicks:r.botPicks.slice(), counts:r.counts.slice(),
             solo:r.solo, win:r.solo, boxIdx:r.boxIdx, boxMult:r.boxMult,
             baseOdds:r.baseOdds, mult:r.mult, topSoloPoint:r.topSoloPoint,
             payout:r.payout, net:r.payout - r.stake };
  }
  /* 由「抽定的原料」組出完整內部單（存檔接回與改點共用，保證衍生欄位一致） */
  function buildRound(o){
    var d = RULES.resolve(o.board, o.pointIdx, o.botPicks, o.boxIdx);
    return { orderId:o.orderId, ts:o.ts, stake:o.stake, pointIdx:o.pointIdx, board:o.board,
             botPicks:o.botPicks, boxIdx:o.boxIdx,
             counts:d.counts, solo:d.solo, boxMult:d.boxMult, baseOdds:d.baseOdds, mult:d.mult,
             topSoloPoint:d.topSoloPoint, payout:RULES.payout(o.stake, d.mult) };
  }

  /* ---------- 存檔／接回 ---------- */
  function save(){
    if(!store) return;
    try{
      store.setItem(KEY, JSON.stringify({ v:2, wallet:wallet, seq:seq,
        records:records,
        board: board ? board.supply : null,
        pending: st ? { orderId:st.orderId, ts:st.ts, stake:st.stake, pointIdx:st.pointIdx,
                        supply:st.board.supply, botPicks:st.botPicks, boxIdx:st.boxIdx } : null }));
    }catch(e){}
  }
  function restore(){
    if(!store) return;
    var raw = null, d = null;
    try{ raw = store.getItem(KEY); }catch(e){}
    if(!raw) return;
    try{ d = JSON.parse(raw); }catch(e){ return; }
    if(!d || d.v !== 2 || !(typeof d.wallet === 'number' && isFinite(d.wallet))) return;
    wallet = d.wallet; seq = d.seq || 0; records = d.records || [];
    board = RULES.boardFromSupply(d.board);                    // 不合法＝null，之後重抽
    var p = d.pending, pb = p ? RULES.boardFromSupply(p.supply) : null;
    if(p && pb && RULES.validChoice(p.pointIdx) && RULES.validRest(p.botPicks, p.boxIdx) && p.stake > 0){
      st = buildRound({ orderId:p.orderId, ts:p.ts, stake:p.stake, pointIdx:p.pointIdx,
                        board:pb, botPicks:p.botPicks, boxIdx:p.boxIdx });
      phase = 'ANIM'; settle(true);                            // 演出中重整＝直接結算，不重抽
    } else if(p && p.stake > 0){
      wallet += p.stake;                                       // 存檔損毀：退還已扣的注額
    }
  }

  /* ---------- 注單號：前綴＋時間（36 進位）＋流水號，同毫秒也不撞 ---------- */
  function newOrderId(ts){
    seq++;
    return String(DEMO_KEY).toUpperCase() + '-' + ts.toString(36).toUpperCase() + '-' +
      ('000' + seq).slice(-4);
  }

  function bet(pointIdx, stake){
    if(phase !== 'BET') return fail('非下注階段');
    if(!RULES.validChoice(pointIdx)) return fail('未知落點');
    stake = Math.floor(stake);
    if(!(stake > 0)) return fail('押額需為正整數');
    if(stake > wallet) return fail('餘額不足');
    var ts = now();
    wallet -= stake;
    var rest = RULES.drawRest(rng, board);               // 結果先定（盤面早已公告），之後 UI 只負責演
    st = buildRound({ orderId:newOrderId(ts), ts:ts, stake:stake, pointIdx:pointIdx,
                      board:board, botPicks:rest.botPicks, boxIdx:rest.boxIdx });
    phase = 'ANIM';
    save();
    emit('wallet', { wallet:wallet });
    emitL('result', function(){ return extend(snapRound(st), { wallet:wallet }); });
    return true;
  }

  /* 封盤倒數中改點：機器人落點與箱子早已抽定且與玩家選哪點無關，換點只重算人數／獨佔／派彩，注額不變 */
  function changePoint(pointIdx){
    if(phase !== 'ANIM') return fail('非演出階段');
    if(!RULES.validChoice(pointIdx)) return fail('未知落點');
    if(pointIdx === st.pointIdx) return true;
    st = buildRound({ orderId:st.orderId, ts:st.ts, stake:st.stake, pointIdx:pointIdx,
                      board:st.board, botPicks:st.botPicks, boxIdx:st.boxIdx });
    save();
    emitL('repick', function(){ return extend(snapRound(st), { wallet:wallet }); });
    return true;
  }

  function ack(){                                        // UI 演出完成的結算點
    if(phase !== 'ANIM') return fail('非演出結算點');
    settle(false);
    return true;
  }

  function settle(restored){
    var done = st, pay = done.payout;
    wallet += pay;
    records.push(recordOf(done));
    if(records.length > 200) records.splice(0, records.length - 200);
    st = null; phase = 'BET';
    board = RULES.drawBoard(rng);                        // 結算後立刻公告下一局盤面
    save();
    emitL('settled', function(){ return extend(snapRound(done), { net:pay - done.stake, wallet:wallet,
      restored:!!restored, nextBoard:RULES.copyBoard(board) }); });
    emit('wallet', { wallet:wallet });
    emitL('board', function(){ return { board:RULES.copyBoard(board), reason:'next' }; });
  }

  function getState(){
    return { phase:phase, wallet:wallet,
             board: board ? RULES.copyBoard(board) : null,
             st: st ? snapRound(st) : null,
             records: records.slice(-20) };
  }

  function clearSaved(){                                  // 錢包重置（演出中不可）；盤面維持不變
    if(st) return fail('對局中不可重置');
    if(store){ try{ store.removeItem(KEY); }catch(e){} }
    wallet = startWallet; records = []; seq = 0; save();
    emit('wallet', { wallet:wallet });
    return true;
  }

  function addMoney(n){                                   // 導演台加錢（Demo 專用）
    if(st) return fail('對局中不可加錢');
    wallet += Math.floor(n); save();
    emit('wallet', { wallet:wallet });
    return true;
  }

  restore();
  if(!board){ board = RULES.drawBoard(rng); save(); }     // 全新開局或存檔盤面不合法
  return { bet:bet, changePoint:changePoint, ack:ack, getState:getState,
           board:function(){ return RULES.copyBoard(board); },
           clearSaved:clearSaved, addMoney:addMoney,
           on:function(fn){ subs.push(fn); },
           setRng:function(fn){ rng = fn; },
           getRng:function(){ return rng; } };
}

return { createGame:createGame, RULES:RULES };
})();
if(typeof module !== 'undefined' && module.exports) module.exports = DemoCore;
