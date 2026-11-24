/* =========================================================================
 * 三路尋寶——數值單點（可移植・凍結）
 *
 * 紀律（改東西前先讀）：
 *  1. 禁手改單點：所有倍率、門檻範圍、上限一律由 CFG 推導，其他檔案嚴禁硬編碼。
 *  2. 嚴禁暗改機率：敵人門檻是真的（兩顆 6 面骰相加 ≥ 門檻才贏，勝率由骰子本身決定，
 *     見 winRate）；倍率反推與核心抽定都吃同一張表；顯示的就是真的。
 *  3. 要湊 RTP 只准動倍率（genMap 內的 fit），不准動門檻或骰子。
 *  4. 本檔零 DOM、零依賴；瀏覽器以 <script> 載入、Node 以 eval 載入（test/）。
 *     不要加頂層 'use strict'、不用 ES Modules：eval 時要讓 var EV／DEMO_KEY 落在呼叫端作用域。
 *
 * 玩法：每局一張地圖，三條路（穩 safe／中 mid／拚 risk）各是一條線；節點只有兩種：
 *   敵人 enemy（need＝兩顆骰相加要 ≥ 幾才贏，3～12）、寶物 prize（v＝倍率）。
 *   冒險者沿線前進：寶物照到就收；遇到敵人擲兩顆骰，打贏前進、打輸扣一顆心留在原地再打，
 *   心扣完撤退（已收的寶物照拿）。穩 3 顆心、中 2 顆、拚 1 顆。一局拿回＝收下的寶物倍率相加。
 *   路線期望值用精確遞推（節點位置 × 剩餘心數）；三條路都反推到 RTP。
 *   地圖只含邏輯結構（id／route／kind／idx／need／v／tier），不含版面座標；
 *   每條路另給一個 shape 種子（整數，畫面用它決定走向）。
 * ========================================================================= */

/* 記號：新建腳本會把 trails 換成 [a-z][a-z0-9]{1,11} 短名；沒替換也能跑 */
var DEMO_KEY = 'trails';

var EV = (function(){

var CFG = {
  RTP: 0.965,                 // 每條路線的期望值（倍率）；三條路線相同（容許範圍 96%～97%，出處 brief）
  EV_TOL: 0.0014,             // 湊整後每條路線與 RTP 的容許誤差（±0.14pp，比驗收線 ±0.15pp 略緊），超過就整條路線重抽
  STAKES: [100, 500, 1000],   // 下注面板可選單注（預設 100）
  WALLET: 10000,              // 起始錢包
  LOG_CAP: 50,                // 勝負 log 封頂筆數（公司規格）
  REC_CAP: 200,               // 核心留的已結注單筆數
  GEM_MIN: 1, CROWN_MIN: 10,  // 寶物樣子：<1 金幣、1～未滿 10 寶石、≥10 大寶藏
  MID_X: 5, BIG_X: 20,        // 演出分級：一局拿回 ≥5 倍「大贏」、≥20 倍「大獎」
  MAX_PRIZE_X: 150,           // 單顆寶物上限（超過就重抽）
  GRID: [[2, 0.1], [10, 0.5], [50, 1], [1e9, 5]],   // 顯示格：<2 以 0.1、<10 以 0.5、<50 以 1、其餘 5
  CSLACK: 2,                  // 湊整時小寶物最多微調幾格（大寶物見各路線 jslack）
  TRIES: 20, INNER: 60,       // 一條路線最多換 TRIES 個樣板、每個樣板內最多重抽 INNER 次
  FACES: 6,                   // 骰子面數（兩顆 6 面骰相加，核心擲兩顆）
  NEED_MIN: 3, NEED_MAX: 12,  // 敵人門檻範圍
  NODES_MIN: 6, NODES_MAX: 9, // 每條路的節點數（敵人＋寶物）

  /* 門檻高低錯落（用戶「門檻數挺高的，感覺可以打散一點」）：每條路各自的限制見 ROUTES.stag（以這條路的敵人門檻序列檢查，不過就重抽）：
   *   high／hiMax    門檻 ≥ high 的敵人最多 hiMax 隻
   *   red／redMax    門檻 ≥ red（畫面紅色）的敵人最多 redMax 隻
   *   green／greenMin 門檻 ≤ green（畫面綠色）的敵人至少 greenMin 隻
   *   spread         最高與最低門檻至少差幾
   *   drop           敵人 ≥ 3 隻時，至少有一處「後面的比前面的好打 drop 以上」（存在 i<j 使 need[i]−need[j] ≥ drop）
   *   meanMax        敵人門檻平均不得超過（整條都偏高就擋掉） */

  /* 三條路線設計（位置固定，顏色固定綠／黃／紅）。三條路線的差別只在這裡：
   *   hearts 心數
   *   tpl    骨架樣板（由入口起的順序）。字元：e／m／h（及 need 有定義的其他字母）＝敵人（好打／中等／難打…，各自抽 need 範圍），
   *          c／g＝寶物（小／中，只決定期望值占比，倍率由反推決定），J＝這條路最大的寶物（必為最後一個節點）。
   *          長度 6～9；每個樣板恰一個 J。
   *   need   各敵人等級的門檻範圍 [lo,hi]（整數）：e 好打、m 中等、h 難打；中路另有 a＝開場必打的 7+（讓「沒拿到」落在 15%～25%）
   *   w      寶物「期望值占比」的相對權重（倍率 ≈ 占比 × RTP ÷ 到達機率）
   *   val    反推＋湊整後各種寶物允許的倍率範圍，超出就重抽
   *   jslack 大寶物湊整時允許再微調的格數（小寶物 ±CSLACK 格）
   *   band   每張圖這條路線的目標帶（鐵表三組目標，以精確分布逐張檢查，不在帶內就整條路線重抽）：
   *          p0＝沒拿到、ge1＝拿回 ≥1 倍、ge20＝拿回 ≥20 倍、sd＝每局標準差（最大寶物倍率範圍由 val.J 管）
   */
  ROUTES: [
    { id:'safe', label:'穩', hearts:3,
      tpl:['checeJ', 'echecJ', 'gehceJ',
           'ecmhceJ', 'egheceJ', 'echgmhJ',
           'chgecemJ', 'cehgeghJ', 'checeghJ', 'ghcegmhJ',
           'eghgcechJ', 'echgegehJ', 'gehgecchJ', 'cghgegmmJ'],
      need:{ e:[3,6], m:[7,8], h:[9,10] },
      w:{ c:[0.3,1], g:[0.8,2], J:[2,5] },
      val:{ c:[0.1,3], g:[0.1,3], J:[2,8] }, jslack:1,
      stag:{ high:10, hiMax:1, red:9, redMax:2, green:6, greenMin:1, spread:3, drop:3, meanMax:7.5 },
      band:{ p0:[0,0.10], ge1:[0.35,0.45], sd:[1,1.5] } },
    { id:'mid',  label:'中', hearts:2,
      tpl:['aghgehJ', 'aeghghJ', 'acehchJ',
           'aghegghJ', 'agehgchJ', 'aeghgchJ', 'achegchJ', 'emcehghJ', 'mecheghJ',
           'acmgmeghJ', 'agmmceghJ', 'aechgeghJ', 'aghcegheJ', 'emchgechJ', 'meghegchJ'],
      need:{ a:[7,7], e:[3,6], m:[7,8], h:[9,11] },
      w:{ c:[0.2,1], g:[0.5,2], J:[1.5,5] },
      val:{ c:[0.1,3], g:[0.1,3], J:[5,15] }, jslack:1,
      stag:{ high:10, hiMax:1, red:9, redMax:2, green:6, greenMin:1, spread:3, drop:3, meanMax:7.5 },
      band:{ p0:[0.15,0.25], ge1:[0.25,0.35] } },
    { id:'risk', label:'拚', hearts:1,
      tpl:['mgheeJ', 'mcheeJ', 'mgeheJ',
           'mcmgheJ', 'mghgehJ', 'mghcmeJ', 'mecmchJ',
           'mghcgmeJ', 'mchgecmJ', 'mcmceghJ', 'mcmechcJ', 'eechcemJ', 'meghcmcJ',
           'mchegecmJ', 'mgmchmceJ', 'mghcmecmJ', 'mchgeeghJ', 'eeghgecmJ'],
      need:{ e:[3,6], m:[7,8], h:[9,11] },
      w:{ c:[0.3,1], g:[0.8,2], J:[3,8] },
      val:{ c:[0.1,5], g:[0.1,5], J:[20,150] }, jslack:1,
      stag:{ high:10, hiMax:2, red:9, redMax:2, green:6, greenMin:1, spread:3, drop:3, meanMax:7.5 },
      band:{ p0:[0.30,0.45], ge20:[0.015,0.03] } }
  ]
};

/* ---------- 小工具 ---------- */
function mulberry32(seed){
  var a = seed >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function r1(x){ return Math.round(x * 10) / 10; }
function r2(x){ return Math.round(x * 100) / 100; }
function grid(v){
  for(var i = 0; i < CFG.GRID.length; i++) if(v < CFG.GRID[i][0]) return CFG.GRID[i][1];
  return 5;
}
function snap(v){ var g = grid(v); return Math.max(0.1, r1(Math.round(v / g) * g)); }
/* 倍率是否落在顯示格上（<2 的 0.1 倍數、<10 的 0.5 倍數、<50 的整數、其餘 5 的倍數） */
function onGrid(v){ var q = v / grid(v); return Math.abs(q - Math.round(q)) < 1e-9; }
function tierOf(v){ return v < CFG.GEM_MIN ? 'coin' : v < CFG.CROWN_MIN ? 'gem' : 'chest'; }
function floor2(n){ return Math.floor(Math.round(n * 1e6) / 1e4) / 100; }
/* 倍率顯示：最多 2 位小數、尾端的 0 不補（8.5→"8.5"、10→"10"） */
function fmtX(n){ return String(+floor2(n).toFixed(2)); }
/* 取整：先四捨到 1e-6 吃掉浮點雜訊，再無條件捨去 */
function payoutFloor(stake, mult){ return Math.floor(Math.round(stake * mult * 1e6) / 1e6); }
function ids(){ return CFG.ROUTES.map(function(r){ return r.id; }); }
function routeIndex(id){ return ids().indexOf(id); }
function between(rng, lo, hi){ return lo + (hi - lo) * rng(); }
function randInt(rng, lo, hi){ return lo + Math.floor(rng() * (hi - lo + 1)); }

/* ---------- 骰子：兩顆 6 面骰相加（固定事實，不依任何狀態） ---------- */
/* 點數和 ≥ need 的組合數（共 36 種）；need ≤ 2 全贏、> 12 全輸 */
function ways(need){
  var c = 0;
  for(var a = 1; a <= CFG.FACES; a++) for(var b = 1; b <= CFG.FACES; b++) if(a + b >= need) c++;
  return c;
}
/* 這個門檻的勝率（36 分之幾） */
function winRate(need){ return ways(need) / (CFG.FACES * CFG.FACES); }

/* 自我檢查：樣板合法（長度 6～9、恰一個 J 且在最後、字元認得、用到的敵人等級有定義） */
function checkTemplates(){
  CFG.ROUTES.forEach(function(rt){
    rt.tpl.forEach(function(str){
      if(str.length < CFG.NODES_MIN || str.length > CFG.NODES_MAX) throw new Error('values.js：樣板 ' + str + ' 長度要 ' + CFG.NODES_MIN + '～' + CFG.NODES_MAX);
      if((str.match(/J/g) || []).length !== 1 || str[str.length - 1] !== 'J') throw new Error('values.js：樣板 ' + str + ' 必須恰一個 J 且在最後');
      var bad = str.split('').filter(function(ch){ return !rt.need[ch] && 'cgJ'.indexOf(ch) < 0; }).join('');
      if(bad) throw new Error('values.js：樣板 ' + str + ' 含不認得的字元 ' + bad);
    });
  });
}
checkTemplates();

/* ---------- 精確分布：節點位置 × 剩餘心數遞推 ----------
 * route：{ hearts, nodes:[{kind:'enemy'|'prize', need, v}] }
 * 回傳 { D:[[倍率, 機率], ...]（依倍率排序、同倍率合併）, pEnd（走到底的機率）, rolls（平均擲幾次）,
 *        maxRolls（理論最多擲幾次）, nEnemy }
 * 狀態：vec[c]＝抵達目前節點時剩 c 顆心（c≥1）的機率；打敵人：連輸 f 次再贏（f＜c）→ 剩 c−f 顆心前進；
 *       連輸 c 次 → 心扣完撤退，帶走此刻已收下的寶物。 */
function routeDist(route){
  var N = route.nodes, h = route.hearts, vec = [], c, f, i, sum = 0, rolls = 0, nEnemy = 0;
  var map = {};                                     // 倍率 → 機率
  for(c = 0; c <= h; c++) vec.push(0);
  vec[h] = 1;
  function add(x, p){ var k = r2(x); map[k] = (map[k] || 0) + p; }
  for(i = 0; i < N.length; i++){
    var n = N[i];
    if(n.kind === 'prize'){ sum = r2(sum + n.v); continue; }
    nEnemy++;
    var w = winRate(n.need), l = 1 - w, nv = [], die = 0;
    for(c = 0; c <= h; c++) nv.push(0);
    for(c = 1; c <= h; c++){
      var m = vec[c];
      if(!m) continue;
      var pf = 1;
      for(f = 0; f < c; f++){                       // 連輸 f 次後贏：共擲 f+1 次，剩 c−f 顆心
        nv[c - f] += m * pf * w;
        rolls += m * pf * w * (f + 1);
        pf *= l;
      }
      die += m * pf;                                // 連輸 c 次：共擲 c 次，撤退
      rolls += m * pf * c;
    }
    add(sum, die);
    vec = nv;
  }
  var pEnd = 0;
  for(c = 1; c <= h; c++) pEnd += vec[c];
  add(sum, pEnd);
  var D = Object.keys(map).map(function(k){ return [+k, map[k]]; }).sort(function(a, b){ return a[0] - b[0]; });
  return { D:D, pEnd:pEnd, rolls:rolls, maxRolls:nEnemy + h - 1, nEnemy:nEnemy };
}
function distStats(D){
  var ev = 0, ev2 = 0, p0 = 0, ge1 = 0, ge5 = 0, ge20 = 0, max = 0;
  D.forEach(function(x){
    if(x[1] <= 0) return;
    ev += x[0] * x[1]; ev2 += x[0] * x[0] * x[1];
    if(x[0] <= 0) p0 += x[1];
    if(x[0] >= 1) ge1 += x[1];
    if(x[0] >= CFG.MID_X) ge5 += x[1];
    if(x[0] >= CFG.BIG_X) ge20 += x[1];
    if(x[0] > max) max = x[0];
  });
  return { ev:ev, sd:Math.sqrt(Math.max(0, ev2 - ev * ev)), p0:p0, ge1:ge1, ge5:ge5, ge20:ge20, max:max };
}
function routeStats(route){
  var d = routeDist(route), s = distStats(d.D);
  s.pEnd = d.pEnd; s.rolls = d.rolls; s.maxRolls = d.maxRolls;
  return s;
}
function routeEV(route){ return routeStats(route).ev; }
/* 這條路上最大的寶物節點（同大取最後一個） */
function bigPrize(route){
  var best = null;
  route.nodes.forEach(function(n){ if(n.kind === 'prize' && (!best || n.v >= best.v)) best = n; });
  return best;
}

/* ---------- 門檻錯落檢查（stag） ----------
 * needs＝這條路由入口起的敵人門檻；s＝ROUTES[].stag（欄位見 CFG 註解） */
function staggerOK(needs, s){
  if(!needs.length) return true;
  var i, j, hi = 0, red = 0, green = 0, mx = 0, mn = 99, sum = 0, drop = 0;
  for(i = 0; i < needs.length; i++){
    var x = needs[i];
    if(x >= s.high) hi++;
    if(x >= s.red) red++;
    if(x <= s.green) green++;
    mx = Math.max(mx, x); mn = Math.min(mn, x); sum += x;
    for(j = i + 1; j < needs.length; j++) if(x - needs[j] > drop) drop = x - needs[j];
  }
  if(hi > s.hiMax || red > s.redMax || green < s.greenMin) return false;
  if(mx - mn < s.spread) return false;
  if(sum / needs.length > s.meanMax + 1e-9) return false;
  if(needs.length >= 3 && drop < s.drop) return false;
  return true;
}

/* ---------- 一條路線：樣板 → 門檻 → 寶物倍率反推 → 湊整 ----------
 * 節點：{ id, route(0..2), kind:'enemy'|'prize', idx, need（enemy）, v／tier／role（prize）}
 * id＝route*10+idx（全圖唯一，idx 0～8） */
function arrivalProbs(hearts, kinds, needs){        // 每個節點被「抵達」的機率（寶物＝被收下的機率）
  var vec = [], c, f, i, out = [];
  for(c = 0; c <= hearts; c++) vec.push(0);
  vec[hearts] = 1;
  for(i = 0; i < kinds.length; i++){
    var a = 0;
    for(c = 1; c <= hearts; c++) a += vec[c];
    out.push(a);
    if(kinds[i] === 'prize') continue;
    var w = winRate(needs[i]), l = 1 - w, nv = [];
    for(c = 0; c <= hearts; c++) nv.push(0);
    for(c = 1; c <= hearts; c++){
      var m = vec[c], pf = 1;
      if(!m) continue;
      for(f = 0; f < c; f++){ nv[c - f] += m * pf * w; pf *= l; }
    }
    vec = nv;
  }
  return out;
}

function tryTemplate(ri, rng, ti){
  var cls = CFG.ROUTES[ri], T = CFG.RTP, str = cls.tpl[ti], n = str.length, i, ch;
  var kinds = [], needs = [], roles = [], enemyNeeds = [];
  for(i = 0; i < n; i++){
    ch = str[i];
    if(cls.need[ch]){
      var rg = cls.need[ch], nd = randInt(rng, rg[0], rg[1]);
      kinds.push('enemy'); needs.push(nd); roles.push(null); enemyNeeds.push(nd);
    } else { kinds.push('prize'); needs.push(0); roles.push(ch); }
  }
  if(!staggerOK(enemyNeeds, cls.stag)) return null;
  var a = arrivalProbs(cls.hearts, kinds, needs);
  var pi = [], ws = [], sum = 0, pa = [], prole = [], v0 = [];
  for(i = 0; i < n; i++) if(kinds[i] === 'prize'){
    var b = cls.w[roles[i]], w = between(rng, b[0], b[1]);
    pi.push(i); ws.push(w); sum += w;
  }
  for(i = 0; i < pi.length; i++){
    pa.push(a[pi[i]]); prole.push(roles[pi[i]]);
    v0.push((ws[i] / sum) * T / pa[i]);
    var vr = cls.val[prole[i]];                                   // 一眼就差太遠的先擋掉（省時間）
    if(v0[i] > vr[1] * 1.5 || (vr[0] >= 1 && v0[i] < vr[0] * 0.5)) return null;
  }
  var vals = fit(pa, prole, v0, T, cls);
  if(!vals) return null;
  var jv = vals[vals.length - 1];
  for(i = 0; i < pi.length; i++){
    var r = cls.val[prole[i]];
    if(vals[i] < r[0] - 1e-9 || vals[i] > r[1] + 1e-9 || vals[i] > CFG.MAX_PRIZE_X + 1e-9) return null;
    if(i < pi.length - 1 && vals[i] >= jv - 1e-9) return null;   // 最後的 J 必須嚴格最大
  }
  var nodes = [], vi = 0;
  for(i = 0; i < n; i++){
    var o = { id:ri * 10 + i, route:ri, kind:kinds[i], idx:i };
    if(kinds[i] === 'enemy') o.need = needs[i];
    else { o.role = roles[i]; o.v = vals[vi++]; o.tier = tierOf(o.v); }
    nodes.push(o);
  }
  var route = { id:cls.id, index:ri, hearts:cls.hearts, tpl:str, tplIndex:ti, nodes:nodes };
  var st = routeStats(route);
  for(var bk in cls.band){
    var lim = cls.band[bk];
    if(st[bk] < lim[0] - 1e-9 || st[bk] > lim[1] + 1e-9) return null;
  }
  route.shape = 0;
  return route;
}
/* 先均勻抽樣板，再在同一個樣板內重抽門檻與權重直到湊得出來（各樣板出現機會均等；
 * 某個樣板怎麼抽都湊不出來才換樣板）。只動倍率，不動骰子。 */
function buildRoute(ri, rng){
  var cls = CFG.ROUTES[ri];
  for(var a = 0; a < CFG.TRIES; a++){
    var ti = Math.floor(rng() * cls.tpl.length);
    for(var k = 0; k < CFG.INNER; k++){
      var r = tryTemplate(ri, rng, ti);
      if(r) return r;
    }
  }
  throw new Error('buildRoute 失敗：' + ri);
}

/* 湊整：全部先貼到顯示格，再微調（小寶物 ±CSLACK 格、大寶物 ±jslack 格）讓 EV 最接近 RTP。
 * 只動倍率，不動機率。回傳 null＝湊不到容許誤差內（整條路線重抽）。
 * pa＝各寶物的到達機率、roles＝各寶物種類、v0＝反推出的原始倍率 */
function fit(pa, roles, v0, T, cls){
  var n = pa.length, vals = new Array(n), steps = new Array(n), lims = new Array(n), k;
  for(k = 0; k < n; k++){
    vals[k] = snap(v0[k]); steps[k] = grid(vals[k]);
    lims[k] = roles[k] === 'J' ? cls.jslack : CFG.CSLACK;
  }
  var cur = new Array(n), bestErr = 1e9, bestDev = 1e9, bestD = null;
  (function rec(k, ev, dev){
    if(k === n){
      var err = Math.abs(ev - T);
      if(err < bestErr - 1e-12 || (Math.abs(err - bestErr) <= 1e-12 && dev < bestDev)){
        bestErr = err; bestDev = dev; bestD = cur.slice();
      }
      return;
    }
    var base = vals[k];
    for(var d = -lims[k]; d <= lims[k]; d++){
      var nv = r1(base + d * steps[k]);
      if(nv < 0.1 - 1e-9 || !onGrid(nv)) continue;       // 微調跨過顯示格邊界時要仍落在新格上
      cur[k] = nv;
      rec(k + 1, ev + nv * pa[k], dev + (d < 0 ? -d : d));
    }
  })(0, 0, 0);
  if(!bestD || bestErr > CFG.EV_TOL) return null;
  return bestD;
}

/* 一張地圖：三條路線各自生成。回傳 { seed?, routes:[{ id, index, hearts, tpl, tplIndex, shape, nodes }] }
 * shape＝畫面決定走向用的整數種子（核心不帶座標） */
function genMap(rng){
  var routes = [];
  for(var ri = 0; ri < CFG.ROUTES.length; ri++){
    var r = buildRoute(ri, rng);
    r.shape = Math.floor(rng() * 4294967296) >>> 0;
    routes.push(r);
  }
  return { routes:routes };
}
function genMapSeed(seed){
  var m = genMap(mulberry32(seed));
  m.seed = seed >>> 0;
  return m;
}

return { CFG:CFG, ids:ids, routeIndex:routeIndex, mulberry32:mulberry32, r1:r1, r2:r2,
         grid:grid, onGrid:onGrid, tierOf:tierOf, floor2:floor2, fmtX:fmtX, payoutFloor:payoutFloor,
         ways:ways, winRate:winRate,
         genMap:genMap, genMapSeed:genMapSeed,
         routeDist:routeDist, distStats:distStats, routeStats:routeStats, routeEV:routeEV,
         bigPrize:bigPrize, staggerOK:staggerOK, tryTemplate:tryTemplate,
         checkTemplates:checkTemplates };
})();
