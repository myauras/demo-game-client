/* =========================================================================
 * 爆金連鎖——對局核心（可移植層，零 DOM）　v3-1：單一盤面、換金額重來、刷新與冷卻
 *
 * 只包「狀態」：錢包、目前金額、【一張】盤面＋一條能量條＋一個獎池＋刷新冷卻、注單流水、進行中一單、存檔與接回。
 * 規則（丟一枚、連爆、金幣雨、寶物方向、實付、分級、能量條進位、獎池、合法盤面、刷新、底盤）全部呼叫凍結的 values.js
 * （EV.play／meterAfter／potAfter／cash／tier／reshuffle／floorBoard），這裡不重寫規則、不碰任何機率。
 *
 * 一句話：「一注」＝丟一枚。扣一個金額 → 能量條 +1（集滿這一注＝金幣雨）→ EV.play 算完（含金幣雨）
 *         → EV.potAfter：這一注的獎池入池，自己連鎖炸到門檻或下雨就整個拿走 → 盤面已是新盤面 → UI 演出 → ack() 入帳。
 *         拿回 payout ＝ 噴出的東西（Σ items.amount）＋ 拿走的獎池（potWin）。
 *
 * ── 亂數（兩串，互不影響）──────────────────────────────────────────────
 *  rng       「這一注丟的是什麼」那一串（只交給 EV.play，一注固定取 1 次）。opts.rng；setRng／getRng。
 *  boardRng  盤面那一串：刷新（EV.reshuffle）與換金額的底盤（EV.floorBoard）專用。opts.boardRng；setBoardRng／getBoardRng。
 *            預設：沒給 opts.rng ＝ Math.random（正式遊玩）；有給 opts.rng（測試、導演台重現）＝固定種子的 EV.rng(BOARD_SEED)，
 *            所以同 rng 序列重跑仍完全相同。因為分成兩串，刷新或換金額「不會改變之後每一注抽到什麼」。
 *
 * ── 常數 ───────────────────────────────────────────────────────────────
 * METER_START＝EV.DEMO_METER_START（70）：能量條起始值。【Demo 專用】新帳號（建立遊戲、clearSaved）的第一張盤面才有（第 30 注下第一場雨）；
 *   換金額後的新盤面能量條從 0 開始，不預充。正式版該是 0。DemoCore.METER_START 可讀。
 * REFRESH_COOLDOWN_BETS＝10：刷新冷卻注數。上次刷新後要再丟滿 10 注才能再刷；新盤面（新玩家、換金額後）一開始就能刷。DemoCore.REFRESH_COOLDOWN_BETS 可讀。
 * 能量條長度＝EV.RAIN_EVERY（100，values.js 單點）；值域 0～99；每注 +1，第 100 注（meterBefore＝99）觸發金幣雨、歸零。
 * 獎池（實付整數）：每注存 EV.PAY[目前金額].pot、自己那一枚連鎖炸到 EV.POT_CHAIN 格以上或下雨就整個拿走；
 *   值域 0～EV.potMax(目前金額)；新盤面從 0；跟盤面一起存檔；重置錢包不動它；換金額歸零；clearSaved 歸零。
 * DemoCore.SAVE_V（存檔版本，現為 6）、DemoCore.RULES。
 *
 * ── 公開介面 ───────────────────────────────────────────────────────────
 * DemoCore.createGame(opts) → game
 *   opts：{ storage:物件|false, rng, boardRng, now, wallet, keyPrefix }
 *         storage 不給＝localStorage（沒有就不存）；false＝不存。keyPrefix 預設 DEMO_KEY（'burst'）。
 *
 * 動作（回傳 true＝成功；false＝失敗，同時發 error 事件，game.getLastError() 可查）
 *   bet(cellIndex)     丟一枚到第 cellIndex 格（0～24，列優先：row*5+col）。以目前金額為注額，用那一張盤面與能量條。
 *   ack()              UI 演完後呼叫：把拿回金額入帳，回到可下注。核心不自帶計時。
 *   setDenom(di)       換金額（DENOMS 索引）。【換金額＝重來】金額真的改變時：盤面＝EV.floorBoard（40 枚、無寶物）、能量條＝0、
 *                      獎池＝0、刷新冷卻＝0（新盤面可立刻刷）、「還沒丟過」旗標＝false（新盤面不算首次進場）；錢包、注單不動。
 *                      演出中（ANIM）不可。金額沒變（同一個 di）＝回 true、什麼都不做、不發事件。
 *                      發 denom 事件（含被放棄的東西，見事件）。純查詢「會清掉什麼」用 peekDenomChange（確認視窗用；核心不擋）。
 *   refresh()          刷新盤面：EV.reshuffle（枚數、寶物顆數不變、合法）；能量條、獎池、錢包不動；成功後冷卻＝REFRESH_COOLDOWN_BETS、
 *                      「還沒丟過」旗標＝false（刷新過的盤面沒有起始盤面的發光格）。失敗回 false＋error 事件（code：phase 演出中｜
 *                      cooldown 冷卻中，error 事件與 getLastError() 多帶 left＝還要丟幾注｜board 盤面不合法），盤面完全不變。
 *   clearSaved()       重置：整份回到新玩家：錢包回 wallet 選項（預設 10,000）、盤面回起始盤面（還沒丟過）、能量條回 METER_START、
 *                      獎池歸零、冷卻 0、注單清空、金額回預設。演出中不可。
 *   resetWallet()      重置錢包（紀錄頁那顆鈕用這個）：只把錢包補回 wallet 選項（預設 10,000）、注單清空；
 *                      盤面、能量條、獎池、冷卻、金額都不動。演出中不可。
 *   addMoney(n)        導演台加錢（Demo 專用）。演出中不可。
 *   armNext(plan)      導演台：指定「下一注」玩家丟的那枚是什麼：{ kind:'coin'|'diamond'|'crown' }（沒給＝照 rng；
 *                      多給的欄位一律忽略）。只對下一次成功的 bet 生效，用完自動清掉；armNext(null) 取消。
 *                      kind 不合法回 false（error code 'plan'）。
 *   setMeter(v)        導演台：把能量條設成 v（取整、夾在 0～RAIN_EVERY−1）。設成 RAIN_EVERY−1（99）＝下一注必下金幣雨。
 *                      演出中不可；v 不是有限數字 → false（error code 'meter'）。成功發 meter 事件並存檔。（v2 的第二個參數 di 已忽略）
 *   setPot(v)          導演台：把獎池設成 v（實付金額、取整、夾在 0～EV.potMax(目前金額)）。演出中不可；v 不是有限數字 → false（'pot'）。
 *                      成功發 pot 事件並存檔。（第二個參數 di 已忽略）
 *   setRefreshLeft(n)  導演台：把刷新冷卻剩餘注數設成 n（取整、夾在 0～REFRESH_COOLDOWN_BETS）。演出中不可；非數字 → false（'refresh'）。
 *                      成功發 cooldown 事件並存檔。
 *   on(fn(type, data)) 訂閱事件
 *   setRng(fn)／getRng()　setBoardRng(fn)／getBoardRng()
 *
 * 查詢（全部唯讀；回傳的盤面都是拷貝，改了不影響核心）
 *   getState()         { phase:'BET'|'ANIM', wallet, denomIndex, denom, denoms:[各金額], board, fresh, glow, canBet,
 *                        meter, rainEvery:100,
 *                        pot:獎池金額(實付整數), potChain:8（炸幾格拿）, potAdd:這一個金額每注存多少(15／75／150),
 *                        refreshLeft:刷新冷卻還剩幾注（0＝可刷）, refreshEvery:10, canRefresh:現在能不能刷（BET 階段且冷卻 0）,
 *                        st:進行中一單的 result|null, records:最近 20 筆, seq }
 *                      （v2 的 meters／pots 陣列已拿掉）
 *   getBoard()         目前那一張盤面 { h:[25], g:[25][寶物種類清單] }。
 *                      演出中（ANIM）回的是「算完後」的盤面（重整接回也是這張）；演出起點看 result.boardBefore。
 *   getPot()           目前獎池金額（實付整數）。演出中（ANIM）已是「這一注之後」的值（拿走了＝0）；演出起點看 result.potBefore。
 *   getMeter()         目前能量條值（0～99）。演出中（ANIM）已是「這一注之後」的值（金幣雨那一注＝0）；演出起點看 result.meterBefore。
 *   getRefreshLeft()   刷新冷卻還剩幾注（0＝可刷）；getRefreshEvery()＝10
 *   canRefresh()       BET 階段且冷卻 0
 *   isFresh()          這張盤面是否還是「沒丟過」的起始盤面（首次進場旗標；只有新玩家的第一張盤面是 true；換金額、刷新、丟過都變 false）
 *   glowCell()         isFresh → 發光格編號（EV.bestCell：起始盤面最會爆的那格）；否則 -1
 *   peekDenomChange(di) 純查詢「換成 di 會清掉什麼」（不改任何狀態），回傳：
 *                      { valid:di 是否合法, can:現在能不能換（BET 階段且 valid）, reason:null|'phase'|'denom'（can 為 false 的原因）,
 *                        changes:會不會真的變（valid 且 di≠目前金額）,
 *                        from, to:金額索引, fromAmount, toAmount:金額,
 *                        lost:{ pot:獎池金額, meter:能量條格數, pieces:盤面原本枚數, gems:{ total, diamond, crown } }
 *                              （changes 為 false 時全是 0）,
 *                        meterMax:能量條長度(RAIN_EVERY), newPieces:換金額後的新盤面枚數(MIN_TOTAL＝40) }
 *   getDenom()／getDenomIndex()  目前金額／索引
 *   getWallet()        錢包（整數）
 *   getRecords(n?)     注單流水（時間順序、最舊在前；不給 n＝全部，核心封頂 200 筆；每筆是「紀錄」，見下）
 *   getPending()       進行中一單的 result（沒有＝null）
 *   getRestored()      建立遊戲時若有「演出中重整」被直接結算，回那一筆紀錄（rec 形狀，見下），否則 null
 *   getLastError()     最近一次失敗 { code, msg, left? }：code ∈ 'phase'（階段不對）｜'cell'（格號不合法）｜'funds'（餘額不足）
 *                      ｜'denom'（金額索引不合法）｜'meter'（能量條值不合法）｜'pot'（獎池金額不合法）｜'plan'（armNext 的 kind 不合法）
 *                      ｜'cooldown'（刷新冷卻中，left＝還要丟幾注）｜'board'（刷新時盤面不合法）｜'refresh'（setRefreshLeft 的值不合法）
 *   canBet()           目前能不能下注（BET 階段且餘額 ≥ 目前金額）
 *
 * 事件（on(fn(type, data))）
 *   wallet  { wallet }                                          餘額變動（扣注、入帳、重置、加錢）
 *   result  { orderId, denomIndex, stake, cell, result, win, payout, mult, tier, hasRain, meterBefore, meterAfter,
 *             potBefore, potAdd, potWin, potAfter, potBy, refreshLeft }
 *                                                               結果已先定（錢已扣、盤面已是新盤面、能量條已是新值、冷卻已倒數），交給 UI 演出
 *   settled { orderId, denomIndex, stake, cell, payout, net, mult, tier, potWin, wallet, restored, rec }
 *                                                               ack 後入帳（restored＝重整接回的直接結算）
 *   denom   { denomIndex, denom, prevIndex, prevDenom, board, meter:0, pot:0, refreshLeft:0,
 *             lost:{ pot, meter, pieces, gems:{ total, diamond, crown } } }
 *                                                               換金額（只有真的改變才發）；board 是換好的新盤面（拷貝）；lost＝放棄了什麼
 *   refresh { board, boardBefore, pieces, gems, refreshLeft, refreshEvery }
 *                                                               刷新成功；board＝新盤面（拷貝）、boardBefore＝刷新前、pieces／gems 是（不變的）枚數與寶物顆數、
 *                                                               refreshLeft＝剛重設的冷卻（10）
 *   meter   { meter }                                           導演台 setMeter 改了能量條（bet 造成的變動看 result 事件）
 *   pot     { pot }                                             導演台 setPot 改了獎池（bet 造成的變動看 result 事件）
 *   cooldown { refreshLeft }                                    導演台 setRefreshLeft 改了冷卻（bet 造成的倒數看 result.refreshLeft）
 *   reset   { wallet, meter, pot, refreshLeft, walletOnly? }    重置完成（clearSaved：盤面／能量條／獎池／冷卻／金額／錢包都已回初始；walletOnly＝只重置錢包，
 *                                                               其餘欄位是原值）
 *   error   { code, msg, left? }
 *
 * ── 一注的結果 result（演出與紀錄頁只讀它；EV.play 的欄位原樣帶入，沒有毫秒）──────────
 *   orderId, ts            注單號、時間戳
 *   denomIndex, stake      金額索引、注額（＝該金額；整數）
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
 *   meterBefore            這一注丟之前的能量條值（0～99；hasRain 時一定是 99）
 *   meterAfter             這一注之後的能量條值（hasRain 時＝0，否則＝meterBefore+1）
 *   potBefore              這一注之前獎池金額（實付整數）
 *   potAdd                 這一注存進獎池多少（＝EV.PAY[di].pot：15／75／150）
 *   potWin                 這一注拿走獎池多少（沒拿＝0）。＝ potBefore＋potAdd（先入池再拿，所以含這一注存的）
 *   potAfter               這一注之後的獎池金額（拿走了＝0，否則＝potBefore＋potAdd）
 *   potBy                  'chain'（玩家自己那一枚連鎖炸到 POT_CHAIN 格以上；與下雨同注時算這個）｜'rain'（下金幣雨）｜null（沒拿）
 *                          金幣雨帶出的連鎖不算進門檻（只看 main.topples）
 *   refreshLeft            這一注之後的刷新冷卻（＝之前的冷卻−1，最少 0）
 *   exits, enter           噴出盤面各種類枚數（玩家那一枚＋金幣雨合計）、這一注進場各種類枚數（金幣雨的 25 枚算進 enter.coin）
 *   inValue, pay, topples, exitCount   values.js 原值：進場面值／噴出的東西的拿回（個金額；玩家那枚加金幣雨合計；**不含獎池**）／連爆總格數／噴出總枚數
 *   items                  噴出清單（依發生順序：先玩家那一枚的各波、再金幣雨的各波）：
 *                            [{ src:'main'|'rain', wave:波序(0 起，在各自的 waves 內計), from, dir, kind, amount:該枚實付金額(整數) }]
 *                            Σamount ＋ potWin ＝ payout（items 只列噴出的東西，獎池另列）；每枚金額取自 EV.PAY[di]，不另算
 *                            注意：落下的 25 枚雨幣都是普通幣，但雨連爆時盤面上「原本就在的」寶物也可能被擠出，
 *                            所以 src:'rain' 的 item，kind 不一定是 'coin'
 *   payout                 拿回金額（整數；＝EV.cash(play, di) ＋ potWin，含獎池）
 *   mult                   倍數＝拿回幾個金額（含獎池；＝payout ÷ stake；不等於 res.pay，那個只含噴出的）
 *   net                    淨額 payout − stake
 *   tier                   分級 EV.tier(res, di, potWin)：'none'|'back'|'big'|'huge'（用含獎池的拿回算）
 *   quiet                  沒爆也沒金幣雨（topples===0 且沒雨）：UI 可不等演出、立刻 ack()（沒爆＝不可能拿獎池，所以 quiet 的注 potWin 一定是 0）
 *   boardBefore, boardAfter 這一注前後的盤面（拷貝；boardAfter 含金幣雨之後）
 *
 * ── 紀錄 rec（getRecords／settled.rec；一注一筆，不含分波，留 200 筆）────────────────
 *   { orderId, ts, denomIndex, stake, cell, kind, hasRain, payout, net, mult, tier, win(payout>0), potWin,
 *     exits:{coin,diamond,crown}, exitCount, topples }（payout／net／mult 含獎池）
 *
 * ── 存檔 ───────────────────────────────────────────────────────────
 *   單一 key：<keyPrefix>.core＝'burst.core'，內容 { v:6, wallet, seq, denom, fresh:布林, board, meter, pot（實付整數）,
 *   refreshLeft, records, pending:進行中一單（含完整 result）|null }。
 *   每次 bet／ack／換金額／刷新／setMeter／setPot／setRefreshLeft／重置後整份寫（錢、盤面、能量條、獎池、冷卻、進行中一單同一次 setItem）。
 *   版本不是 6（v1～v5 舊存檔；v5 是每金額一張盤面）→ 整份忽略，當成新玩家。
 *   重整接回：有 pending＝演出中被重整→直接入帳（結果早已定，不重演、不重抽；盤面、能量條、獎池、冷卻本來就存的是算完的值）。
 *   剛刷新／剛換金額後重整：拿到同一張盤面（盤面在動作當下就寫進存檔，不重抽）。
 *   壞檔（格式不對）→ 整份忽略；盤面不合法→回起始盤面（還沒丟過）；能量條不合法→回 METER_START；獎池不合法（非整數、負數、超過上界）／缺→0；
 *   冷卻不合法／缺→0。
 *
 * 流程：BET —bet→ ANIM（結果已抽定、押額已扣）—ack→ BET（拿回入帳）。「上一單已 ack 才能下一單」。
 * 依賴：values.js 的 EV、DEMO_KEY（Node 測試用 eval 載入，故不碰 window）。
 * ========================================================================= */
var DemoCore = (function(){

var REC_CAP = 200;                      // 核心留的注單筆數
var METER_START = EV.DEMO_METER_START;  // 【Demo 專用】新帳號第一張盤面的能量條起始值（預充；換金額後與正式版是 0）
var REFRESH_COOLDOWN_BETS = 10;         // 刷新冷卻：上次刷新後要再丟滿幾注才能再刷（鐵表「冷卻 10 注」）
var SAVE_V = 6;                         // 存檔版本；規則或存檔欄位變了就加一，舊版整份忽略＝新玩家
var BOARD_SEED = 20261127;              // 有注入 rng 時，盤面那一串用這個固定種子（可重現）
var DEFAULT_RNG = Math.random;          // 沒注入時的預設

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
  validCooldown: function(n){ return typeof n === 'number' && n === Math.floor(n) && n >= 0 && n <= REFRESH_COOLDOWN_BETS; },
  startBoard: function(){ return EV.startBoard(EV.CFG.DENOM_DEFAULT); },             // 新帳號的第一張盤面（有發光格）
  floorBoard: function(rng){ return EV.floorBoard(rng); },                            // 換金額後的新盤面：40 枚、無寶物
  reshuffle:  function(board, rng){ return EV.reshuffle(board, rng); },               // 刷新：枚數、寶物顆數不變、合法
  isLegal:    function(board){ return EV.isLegal(board); }
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

/* 盤面上寶物顆數 { total, diamond, crown } */
function countGems(b){
  var o = { total: 0, diamond: 0, crown: 0 }, i, q, k;
  for(i = 0; i < b.g.length; i++) for(q = 0; q < b.g[i].length; q++){ k = b.g[i][q]; if(o[k] !== undefined){ o[k]++; o.total++; } }
  return o;
}

function createGame(opts){
  opts = opts || {};
  var rng = opts.rng || DEFAULT_RNG;
  var boardRng = opts.boardRng || (opts.rng ? EV.rng(BOARD_SEED) : DEFAULT_RNG);
  var now = opts.now || function(){ return Date.now(); };
  var store = resolveStore(opts.storage);
  var KEY = (opts.keyPrefix || DEMO_KEY) + '.core';
  var startWallet = (opts.wallet != null) ? opts.wallet : EV.CFG.WALLET;

  var wallet = startWallet;
  var records = [];                       // 已結注單紀錄（核心留 200 筆）
  var st = null;                          // 進行中的一單（結果已定，含完整 result）
  var phase = 'BET';                      // BET | ANIM
  var seq = 0;                            // 注單流水號（存檔）
  var denom = EV.CFG.DENOM_DEFAULT;       // 目前金額索引
  var board = null, fresh = true, meter = 0, pot = 0, refreshLeft = 0;   // 唯一一張盤面、「沒丟過」旗標、能量條、獎池（實付整數）、刷新冷卻（還要丟幾注）
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
  function fail(code, msg, left){
    lastError = { code: code, msg: msg };
    var ev = { code: code, msg: msg };
    if(left !== undefined){ lastError.left = left; ev.left = left; }
    emit('error', ev);
    return false;
  }
  function resetBoard(){                  // 新玩家的盤面狀態
    board = RULES.startBoard(); fresh = true; meter = METER_START; pot = 0; refreshLeft = 0;
  }

  /* ---------- 存檔／接回 ---------- */
  function save(){
    if(!store) return;
    try{
      store.setItem(KEY, JSON.stringify({ v: SAVE_V, wallet: wallet, seq: seq, denom: denom, fresh: fresh,
        board: board, meter: meter, pot: pot, refreshLeft: refreshLeft, records: records, pending: st }));
    }catch(e){}
  }
  function restore(){
    if(!store) return;
    var raw = null, d = null;
    try{ raw = store.getItem(KEY); }catch(e){}
    if(!raw) return;
    try{ d = JSON.parse(raw); }catch(e){ return; }
    if(!d || d.v !== SAVE_V || typeof d.wallet !== 'number' || !isFinite(d.wallet) || !d.board) return;   // 舊版（v1～v5）＝新玩家
    wallet = d.wallet; seq = d.seq || 0; records = Array.isArray(d.records) ? d.records : [];
    if(RULES.validDenom(d.denom)) denom = d.denom;
    if(validBoard(d.board)){ board = d.board; fresh = !!d.fresh; }     // 壞掉的盤面回起始盤面（resetBoard 已設好）
    if(RULES.validMeter(d.meter)) meter = d.meter;                     // 不合法＝維持 METER_START
    pot = RULES.validPot(d.pot, denom) ? d.pot : 0;
    refreshLeft = RULES.validCooldown(d.refreshLeft) ? d.refreshLeft : 0;
    if(d.pending && d.pending.result && typeof d.pending.payout === 'number'){
      st = d.pending; phase = 'ANIM'; settle(true);                 // 演出中重整＝直接結算（盤面、能量條、獎池本來就是算完的）
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
  function canRefresh(){ return phase === 'BET' && refreshLeft === 0; }

  function bet(cell){
    if(phase !== 'BET') return fail('phase', '非下注階段');
    if(!RULES.validCell(cell)) return fail('cell', '格號不合法');
    var stake = EV.CFG.DENOMS[denom];
    if(stake > wallet) return fail('funds', '餘額不足');
    var ts = now();
    var di = denom;
    var before = EV.cloneBoard(board);
    var meterBefore = meter;
    var m = RULES.meterAfter(meterBefore);                          // 能量條 +1；集滿這一注＝金幣雨
    wallet -= stake;
    var useRng = nextPlan ? EV.scripted(nextPlan, rng) : rng;
    nextPlan = null;
    var res = RULES.play(board, cell, useRng, m.rain);              // 結果先定：一次算完（含金幣雨），board 已是新盤面
    meter = m.meter;
    fresh = false;
    if(refreshLeft > 0) refreshLeft--;                              // 刷新冷卻：每丟一注倒數 1
    var potBefore = pot;
    var pa = RULES.potAfter(potBefore, res, di);                    // 獎池：先入池再判斷（自己連鎖到門檻或下雨就整個給玩家）
    pot = pa.pot;
    var payout = RULES.payout(res, di) + pa.win;                    // 拿回＝噴出的東西 ＋ 獎池（items 只列噴出的，Σitems.amount＋potWin＝payout）
    res.orderId = newOrderId(ts); res.ts = ts;
    res.denomIndex = di; res.stake = stake;
    res.hasRain = !!res.rain;
    res.meterBefore = meterBefore; res.meterAfter = m.meter;
    res.potBefore = potBefore; res.potAdd = pa.add; res.potWin = pa.win; res.potAfter = pa.pot; res.potBy = pa.by;
    res.refreshLeft = refreshLeft;
    res.quiet = res.topples === 0 && !res.rain;
    res.payout = payout; res.mult = payout / stake; res.net = payout - stake;   // pay 仍是 values.js 原值（只含噴出的）；mult 含獎池
    res.tier = RULES.tier(res, di, pa.win);
    res.items = collectItems(res, di);
    res.boardBefore = before; res.boardAfter = EV.cloneBoard(board);
    st = { orderId: res.orderId, ts: ts, denomIndex: di, stake: stake, cell: cell, payout: payout, result: res };
    phase = 'ANIM';
    save();
    emit('wallet', { wallet: wallet });
    emit('result', { orderId: res.orderId, denomIndex: di, stake: stake, cell: cell, result: res,
                     win: payout > 0, payout: payout, mult: res.mult, tier: res.tier,
                     hasRain: res.hasRain, meterBefore: meterBefore, meterAfter: m.meter,
                     potBefore: potBefore, potAdd: pa.add, potWin: pa.win, potAfter: pa.pot, potBy: pa.by,
                     refreshLeft: refreshLeft });
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

  /* 換成 di 會清掉什麼（純查詢；確認視窗用） */
  function peekDenomChange(di){
    var valid = RULES.validDenom(di);
    var changes = valid && di !== denom;
    var gems = changes ? countGems(board) : { total: 0, diamond: 0, crown: 0 };
    return {
      valid: valid, can: valid && phase === 'BET', reason: !valid ? 'denom' : (phase !== 'BET' ? 'phase' : null),
      changes: changes,
      from: denom, to: valid ? di : -1,
      fromAmount: EV.CFG.DENOMS[denom], toAmount: valid ? EV.CFG.DENOMS[di] : -1,
      lost: { pot: changes ? pot : 0, meter: changes ? meter : 0, pieces: changes ? EV.total(board) : 0, gems: gems },
      meterMax: EV.RAIN_EVERY, newPieces: EV.MIN_TOTAL
    };
  }

  function setDenom(di){
    if(phase !== 'BET') return fail('phase', '演出中不可換金額');
    if(!RULES.validDenom(di)) return fail('denom', '金額不合法');
    if(di === denom) return true;                                   // 沒變＝什麼都不做
    var pk = peekDenomChange(di), prev = denom;
    denom = di;
    board = RULES.floorBoard(boardRng); fresh = false; meter = 0; pot = 0; refreshLeft = 0;   // 換金額＝重來（錢包、注單不動）
    save();
    emit('denom', { denomIndex: di, denom: EV.CFG.DENOMS[di], prevIndex: prev, prevDenom: EV.CFG.DENOMS[prev],
                    board: EV.cloneBoard(board), meter: 0, pot: 0, refreshLeft: 0, lost: pk.lost });
    return true;
  }

  function refresh(){
    if(phase !== 'BET') return fail('phase', '演出中不可刷新');
    if(refreshLeft > 0) return fail('cooldown', '刷新冷卻中', refreshLeft);
    if(!RULES.isLegal(board)) return fail('board', '盤面不合法，無法刷新');
    var before = EV.cloneBoard(board), gems = countGems(board);
    board = RULES.reshuffle(board, boardRng);                       // 枚數、寶物顆數不變；用盤面那一串亂數，不碰抽獎那一串
    fresh = false; refreshLeft = REFRESH_COOLDOWN_BETS;
    save();
    emit('refresh', { board: EV.cloneBoard(board), boardBefore: before, pieces: EV.total(board), gems: gems,
                      refreshLeft: refreshLeft, refreshEvery: REFRESH_COOLDOWN_BETS });
    return true;
  }

  function getState(){
    return { phase: phase, wallet: wallet, denomIndex: denom, denom: EV.CFG.DENOMS[denom], denoms: EV.CFG.DENOMS.slice(),
             board: EV.cloneBoard(board), fresh: fresh, glow: glowCell(), canBet: canBet(),
             meter: meter, rainEvery: EV.RAIN_EVERY,
             pot: pot, potChain: EV.POT_CHAIN, potAdd: EV.PAY[denom].pot,
             refreshLeft: refreshLeft, refreshEvery: REFRESH_COOLDOWN_BETS, canRefresh: canRefresh(),
             st: st ? st.result : null, records: records.slice(-20), seq: seq };
  }
  function glowCell(){ return fresh ? EV.bestCell(board) : -1; }

  function clearSaved(){                                            // 重置：整份回新玩家（演出中不可）
    if(st) return fail('phase', '對局中不可重置');
    if(store){ try{ store.removeItem(KEY); }catch(e){} }
    wallet = startWallet; records = []; seq = 0; denom = EV.CFG.DENOM_DEFAULT; nextPlan = null;
    resetBoard(); save();
    emit('wallet', { wallet: wallet });
    emit('reset', { wallet: wallet, meter: meter, pot: pot, refreshLeft: refreshLeft });
    return true;
  }

  function resetWallet(){                                           // 只重置錢包與注單；盤面、能量條、獎池、冷卻、金額不動（演出中不可）
    if(st) return fail('phase', '對局中不可重置');
    wallet = startWallet; records = []; save();
    emit('wallet', { wallet: wallet });
    emit('reset', { wallet: wallet, meter: meter, pot: pot, refreshLeft: refreshLeft, walletOnly: true });
    return true;
  }

  function addMoney(n){                                             // 導演台加錢（Demo 專用）
    if(st) return fail('phase', '對局中不可加錢');
    wallet += Math.floor(n); save();
    emit('wallet', { wallet: wallet });
    return true;
  }

  function setMeter(v){                                             // 導演台：改能量條（Demo 專用；舊的第二個參數 di 忽略）
    if(st) return fail('phase', '對局中不可改能量條');
    if(typeof v !== 'number' || !isFinite(v)) return fail('meter', '能量條值不合法');
    v = Math.floor(v);
    meter = v < 0 ? 0 : (v > EV.RAIN_EVERY - 1 ? EV.RAIN_EVERY - 1 : v);
    save();
    emit('meter', { meter: meter });
    return true;
  }

  function setPot(v){                                               // 導演台：改獎池金額（實付整數；Demo 專用；舊的第二個參數 di 忽略）
    if(st) return fail('phase', '對局中不可改獎池');
    if(typeof v !== 'number' || !isFinite(v)) return fail('pot', '獎池金額不合法');
    v = Math.floor(v);
    pot = v < 0 ? 0 : (v > EV.potMax(denom) ? EV.potMax(denom) : v);
    save();
    emit('pot', { pot: pot });
    return true;
  }

  function setRefreshLeft(n){                                       // 導演台：改刷新冷卻剩餘注數（Demo 專用）
    if(st) return fail('phase', '對局中不可改冷卻');
    if(typeof n !== 'number' || !isFinite(n)) return fail('refresh', '冷卻值不合法');
    n = Math.floor(n);
    refreshLeft = n < 0 ? 0 : (n > REFRESH_COOLDOWN_BETS ? REFRESH_COOLDOWN_BETS : n);
    save();
    emit('cooldown', { refreshLeft: refreshLeft });
    return true;
  }

  function armNext(plan){
    if(plan && plan.kind !== undefined && plan.kind !== 'coin' && plan.kind !== 'diamond' && plan.kind !== 'crown')
      return fail('plan', 'kind 不合法');
    nextPlan = plan ? { kind: plan.kind } : null;                   // 只認 kind（其餘欄位忽略）
    return true;
  }

  resetBoard();
  restore();
  if(store){ var had = null; try{ had = store.getItem(KEY); }catch(e){} if(!had) save(); }   // 未下注重整＝同樣的盤面
  return { bet: bet, ack: ack, setDenom: setDenom, peekDenomChange: peekDenomChange, refresh: refresh,
           clearSaved: clearSaved, resetWallet: resetWallet, addMoney: addMoney, armNext: armNext,
           setMeter: setMeter, setPot: setPot, setRefreshLeft: setRefreshLeft,
           getState: getState,
           getBoard: function(){ return EV.cloneBoard(board); },
           getMeter: function(){ return meter; },
           getPot: function(){ return pot; },
           getRefreshLeft: function(){ return refreshLeft; },
           getRefreshEvery: function(){ return REFRESH_COOLDOWN_BETS; },
           canRefresh: canRefresh,
           isFresh: function(){ return fresh; },
           glowCell: glowCell,
           getDenom: function(){ return EV.CFG.DENOMS[denom]; }, getDenomIndex: function(){ return denom; },
           getWallet: function(){ return wallet; },
           getRecords: function(n){ return (n > 0 ? records.slice(-n) : records.slice()); },
           getPending: function(){ return st ? st.result : null; },
           getRestored: function(){ return restoredRec; },
           getLastError: function(){ return lastError; },
           canBet: canBet,
           on: function(fn){ subs.push(fn); },
           setRng: function(fn){ rng = fn; },
           getRng: function(){ return rng; },
           setBoardRng: function(fn){ boardRng = fn; },
           getBoardRng: function(){ return boardRng; } };
}

return { createGame: createGame, RULES: RULES, METER_START: METER_START, SAVE_V: SAVE_V, REFRESH_COOLDOWN_BETS: REFRESH_COOLDOWN_BETS };
})();
if(typeof module !== 'undefined' && module.exports) module.exports = DemoCore;
