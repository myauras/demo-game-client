/* =========================================================================
 * 空投爭奪——Node 無頭蒙地卡羅自測（A～E 只 eval values.js；F 區 eval core.js 做端到端）
 * 執行：node test/mc-test.js [N] [seed]（預設 200000／項；不給 seed 用 Math.random，給了用固定種子可重現）
 * 項目：A 各落點獨佔率　B 各落點 RTP＝設定值（另印最小注額含取整的 RTP，不判 PASS／FAIL）
 *       C 整體 RTP　D 精確檢查（窮舉，不抽樣）　E 極值與單元
 *       F 端到端（經 DemoCore.createGame 跑 bet／ack）：與 drawRound 逐局比對、各落點 RTP／獨佔率、
 *         錢包守恆、盤面公告穩定、重整接回、改點、輸入防呆、零 DOM 載入
 * 判定：|偏差| ≤ max(0.1pp, 3σ)（單統計量）；FAIL 時 exit code 1。
 * 結尾印「規格書用數值表」（Markdown）。
 * 註：本檔不得含頂層 'use strict'（直接 eval 需讓 var EV 落本模組作用域）。
 *     記號 hotdrop 沒替換也能跑。
 * ========================================================================= */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(ROOT, 'values.js'), 'utf8'));

const N = Math.floor(+(process.argv[2]) || 200000);
const SEED = process.argv[3] !== undefined ? (+process.argv[3] >>> 0) : null;
const STAKE = 1e6;               // 大押額令取整偏差 <1e-6，遠低於 MC 噪音
const MIN_STAKE = EV.CFG.STAKES[0];
let nPass = 0, nFail = 0;
const t0 = Date.now();

function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const RNG = SEED === null ? Math.random : mulberry32(SEED);

/* 判定：|偏差| ≤ max(0.1pp, 3σ)；name 與理論／實測／σ 一併印出 */
function report(tag, name, theory, mean, se, sigma){
  sigma = sigma || 3;
  const tol = Math.max(0.001, sigma * se);
  const ok = Math.abs(mean - theory) <= tol;
  ok ? nPass++ : nFail++;
  console.log(`${ok?'PASS':'FAIL'} [${tag}] ${name}  理論 ${theory.toFixed(4)}  實測 ${mean.toFixed(4)}  容許 ±${tol.toFixed(4)}(${sigma}σ或0.1pp)`);
}
function unit(name, cond, detail){
  cond ? nPass++ : nFail++;
  console.log(`${cond?'PASS':'FAIL'} [${name[0]}] ${name}${detail?'  '+detail:''}`);
}

const CFG = EV.CFG, POINTS = EV.POINTS, BOX = EV.BOX, K = POINTS.length;
const BOARDS = EV.allBoards();
const LIM = EV.limits();
const NBOT = CFG.PLAYERS - 1;

/* 每局自洽檢查（獨立重算，不信 drawRound 自己的欄位）；回傳違規訊息或 null */
function checkRound(r, p){
  if(r.pointIdx !== p) return 'pointIdx';
  if(r.supply.length !== K || r.botPicks.length !== NBOT || r.counts.length !== K) return '長度';
  for(let i = 1; i < K; i++) if(!(r.supply[i] > r.supply[i-1])) return '物資未嚴格遞增';
  const cnt = new Array(K).fill(0); cnt[p]++;
  for(const b of r.botPicks){ if(!(b >= 0 && b < K && Number.isInteger(b))) return '機器人選點越界'; cnt[b]++; }
  for(let i = 0; i < K; i++) if(cnt[i] !== r.counts[i]) return 'counts 與選點不符';
  if(r.counts.reduce((a, b) => a + b, 0) !== CFG.PLAYERS) return 'counts 總和≠人數';
  if(r.solo !== (cnt[p] === 1)) return 'solo 與 counts 不符';
  const bm = BOX.tiers[r.boxIdx].mult;
  if(!(bm >= 1)) return '箱倍率<1';
  if(r.solo){
    if(!(Math.abs(r.mult - r.baseOdds * bm) < 1e-9)) return '獨佔 mult≠基準×箱倍率';
    if(!(r.mult >= r.baseOdds - 1e-12 && r.baseOdds >= (p === 0 ? 1 : 0))) return '獨佔 mult<基準 或 綠點基準<1';
  } else if(r.mult !== 0) return '撞車 mult≠0';
  // topSoloPoint：所有 counts==1 的落點中基準賠率最高者；全撞＝-1
  let top = -1;
  for(let i = 0; i < K; i++) if(cnt[i] === 1 && (top < 0 || r.board.odds[i] > r.board.odds[top])) top = i;
  if(r.topSoloPoint !== top) return 'topSoloPoint 不自洽';
  if(r.topSoloPoint >= 0 && r.counts[r.topSoloPoint] !== 1) return 'topSoloPoint 非獨佔';
  if(r.solo && r.topSoloPoint < 0) return '玩家獨佔但 topSoloPoint=-1';
  if(r.baseOdds !== r.board.odds[p]) return 'baseOdds≠board.odds[p]';
  return null;
}

/* ============ A／B 同一批抽樣：各落點獨佔率、RTP（含最小注額取整資訊）、逐局自洽 ============ */
const rtpByPoint = [], soloByPoint = [];
let maxSeen = 0, minBoxSeen = Infinity, roundBad = 0, roundBadMsg = '', greenSoloLossCount = 0, greenSoloCount = 0;
const minStakeRtp = [];
for(let p = 0; p < K; p++){
  let wins = 0, sum = 0, sumsq = 0, sumSm = 0;
  for(let i = 0; i < N; i++){
    const r = EV.drawRound(p, RNG);
    if(r.solo) wins++;
    const m = EV.payoutFloor(STAKE, r.mult) / STAKE;
    sum += m; sumsq += m * m;
    sumSm += EV.payoutFloor(MIN_STAKE, r.mult) / MIN_STAKE;
    if(r.mult > maxSeen) maxSeen = r.mult;
    const bm = BOX.tiers[r.boxIdx].mult; if(bm < minBoxSeen) minBoxSeen = bm;
    if(p === 0 && r.solo){ greenSoloCount++; if(EV.payoutFloor(MIN_STAKE, r.mult) < MIN_STAKE) greenSoloLossCount++; }
    const bad = checkRound(r, p);
    if(bad){ roundBad++; if(!roundBadMsg) roundBadMsg = bad; }
  }
  const pw = wins / N;
  soloByPoint.push({ p: pw, se: Math.sqrt(pw * (1 - pw) / N) });
  const mean = sum / N;
  rtpByPoint.push({ mean, se: Math.sqrt(Math.max(0, sumsq / N - mean * mean) / N) });
  minStakeRtp.push(sumSm / N);
}

console.log(`\n=== A 各落點獨佔率（實測 vs 窮舉 ${BOARDS.length} 個物資組合加權理論，N=${N}／落點${SEED===null?'':'，seed='+SEED}） ===`);
for(let p = 0; p < K; p++){
  report('A', `${POINTS[p].name}點獨佔率`, LIM.soloAvg[p], soloByPoint[p].p, soloByPoint[p].se);
}

console.log(`\n=== B 各落點 RTP＝${CFG.RTP}（大注額 ${STAKE}，避免取整噪音，N=${N}／落點） ===`);
for(let p = 0; p < K; p++){
  report('B', `${POINTS[p].name}點 RTP`, CFG.RTP, rtpByPoint[p].mean, rtpByPoint[p].se);
}
// 最小注額含取整：只印不判（取整損失已裁決不重要）
{
  // 解析值：Σ_組合 權重×q×Σ_箱 p×payoutFloor(stake, 基準×箱倍率)／stake
  const rows = [];
  for(let p = 0; p < K; p++){
    let ex = 0;
    for(const b of BOARDS){
      let s = 0;
      for(const t of BOX.tiers) s += t.p * EV.payoutFloor(MIN_STAKE, b.board.odds[p] * t.mult) / MIN_STAKE;
      ex += b.weight * b.board.q[p] * s;
    }
    rows.push(`${POINTS[p].name} 實測 ${(minStakeRtp[p]*100).toFixed(2)}%／解析 ${(ex*100).toFixed(2)}%（損失 ${((CFG.RTP-ex)*100).toFixed(2)}pp）`);
  }
  console.log(`INFO [B] 最小注額 ${MIN_STAKE} 含 payoutFloor 取整的 RTP（不列 PASS／FAIL）：${rows.join('；')}`);
}

/* ============ C 整體 RTP（隨機選點） ============ */
console.log(`\n=== C 整體 RTP（隨機選點，N=${N}） ===`);
{
  let sum = 0, sumsq = 0;
  for(let i = 0; i < N; i++){
    const p = Math.min(K - 1, Math.floor(RNG() * K));
    const r = EV.drawRound(p, RNG);
    const m = EV.payoutFloor(STAKE, r.mult) / STAKE;
    sum += m; sumsq += m * m;
    if(r.mult > maxSeen) maxSeen = r.mult;
    const bad = checkRound(r, p);
    if(bad){ roundBad++; if(!roundBadMsg) roundBadMsg = bad; }
  }
  const mean = sum / N;
  report('C', '整體', CFG.RTP, mean, Math.sqrt(Math.max(0, sumsq / N - mean * mean) / N));
}

/* ============ D 精確檢查（不抽樣） ============
 * 每個物資組合 × 每個落點：以「3 機器人選點三元組全窮舉」獨立算獨佔機率，
 * EV = P(獨佔) × 基準賠率 × Σ(箱機率×箱倍率) 必須＝RTP（誤差 <1e-9）。
 * 防套利：一局只能押一個落點，故只需「任何落點、任何組合 EV ≤ 1」。 */
console.log('\n=== D 精確檢查（窮舉） ===');
{
  let worstDev = 0, worstEV = 0, qDev = 0, probDev = 0, evBad = 0, cells = 0;
  let worstRoundedEV = 0;
  const idxs = [];
  (function walk(n, cur){ if(n === 0){ idxs.push(cur.slice()); return; } for(let k = 0; k < K; k++){ cur.push(k); walk(n - 1, cur); cur.pop(); } })(NBOT, []);
  let wSum = 0;
  for(const b of BOARDS){
    wSum += b.weight;
    for(let p = 0; p < K; p++){
      // 三元組窮舉
      let soloProb = 0, tot = 0;
      for(const t of idxs){
        let pr = 1; for(const k of t) pr *= b.board.botP[k];
        tot += pr;
        if(t.indexOf(p) === -1) soloProb += pr;
      }
      probDev = Math.max(probDev, Math.abs(tot - 1));
      qDev = Math.max(qDev, Math.abs(soloProb - b.board.q[p]));
      let boxMean = 0; for(const t of BOX.tiers) boxMean += t.p * t.mult;
      const ev = soloProb * b.board.odds[p] * boxMean;
      cells++;
      worstDev = Math.max(worstDev, Math.abs(ev - CFG.RTP));
      worstEV = Math.max(worstEV, ev);
      if(ev > 1 + 1e-9) evBad++;
      // 取整後（任何標準注額）EV 也不得超過 stake
      for(const st of CFG.STAKES){
        let s = 0; for(const t of BOX.tiers) s += t.p * EV.payoutFloor(st, b.board.odds[p] * t.mult);
        const rev = soloProb * s / st;
        worstRoundedEV = Math.max(worstRoundedEV, rev);
        if(rev > 1 + 1e-9) evBad++;
      }
    }
  }
  unit(`D1 組合權重和＝1、機器人選點三元組機率和＝1（權重 ${wSum.toFixed(12)}，三元組偏差 ${probDev.toExponential(1)}）`, Math.abs(wSum - 1) < 1e-12 && probDev < 1e-9);
  unit(`D2 獨佔率：三元組窮舉＝公式 q（最大偏差 ${qDev.toExponential(1)}）`, qDev < 1e-9);
  unit(`D3 每組合×每落點 EV＝RTP（${cells} 格，最大偏差 ${worstDev.toExponential(1)}）`, worstDev < 1e-9);
  unit(`D4 防套利：任何落點、任何組合 EV ≤ 1（最高 ${worstEV.toFixed(6)}；含取整最高 ${worstRoundedEV.toFixed(6)}）`, evBad === 0);
  // 箱子機率與平均倍率
  let ps = 0, mm = 0; for(const t of BOX.tiers){ ps += t.p; mm += t.p * t.mult; }
  unit(`D5 箱子機率和＝1、平均 M＝Σp×倍率（M＝${BOX.M.toFixed(4)}）`, Math.abs(ps - 1) < 1e-12 && Math.abs(mm - BOX.M) < 1e-12);
}

/* ============ E 極值與單元 ============ */
console.log('\n=== E 極值與單元 ===');
{
  // 獨立重算單局最高倍率：全組合×全落點 max(基準)×最大箱倍率
  let ref = 0;
  for(const b of BOARDS) for(let p = 0; p < K; p++) ref = Math.max(ref, b.board.odds[p] * Math.max(...BOX.tiers.map(t => t.mult)));
  unit(`E1 單局最高倍率＝limits()（${LIM.maxMult.toFixed(4)}x，落點 ${POINTS[LIM.maxMultPoint].name}，物資 [${LIM.maxMultBoard.join(',')}]）`, Math.abs(ref - LIM.maxMult) < 1e-12);
  unit(`E2 抽樣未曾超過單局最高倍率（抽樣最高 ${maxSeen.toFixed(4)}x）`, maxSeen <= LIM.maxMult + 1e-9);
  unit(`E3 箱子最低 ×1（全部倍率 ≥ 1；抽樣最低 ×${minBoxSeen}）`, BOX.tiers.every(t => t.mult >= 1) && minBoxSeen >= 1);
  const gMin = Math.min(...BOARDS.map(b => b.board.odds[0]));
  unit(`E4 綠點基準賠率 ≥ 1.00（全 ${BOARDS.length} 組合，最低 ${gMin.toFixed(4)}，顯示 ${EV.fmtX(gMin)}x）`, gMin >= 1 && EV.fmtX(gMin) >= '1.00');
  unit(`E5 逐局自洽（${K*N+N} 局：獨佔 mult＝基準×箱倍率 ≥ 基準；綠點獨佔基準 ≥1；撞車 mult＝0；counts／solo／topSoloPoint 與選點一致；物資嚴格遞增）`, roundBad === 0, roundBad ? `違規 ${roundBad} 局，首例：${roundBadMsg}` : '');
  unit(`E6 綠點獨佔最小注額 ${MIN_STAKE} 時含取整仍 ≥ 本金（獨佔 ${greenSoloCount} 局，不足 ${greenSoloLossCount} 局）`, greenSoloLossCount === 0);
  // 固定種子重跑相同＋亂數消耗固定
  {
    const run = (seed) => {
      const rng = mulberry32(seed), out = []; let calls = 0;
      const counted = () => { calls++; return rng(); };
      const per = [];
      for(let i = 0; i < 2000; i++){
        const before = calls;
        out.push(EV.drawRound(i % K, counted));
        per.push(calls - before);
      }
      return { json: JSON.stringify(out), per };
    };
    const a = run(20261113), b = run(20261113), c = run(7);
    unit('E7 固定種子重跑結果完全相同（且不同種子結果不同）', a.json === b.json && a.json !== c.json);
    const want = K + NBOT + 1;
    unit(`E8 每局亂數消耗固定＝${want}（${K} 物資＋${NBOT} 機器人＋1 箱子，不論輸贏）`, a.per.every(n => n === want));
  }
  // 撞車與獨佔都出現且撞車也有箱子（演出要播「錯過的箱子」）
  {
    const rng = mulberry32(99); let coll = 0, collBox = 0;
    for(let i = 0; i < 20000; i++){
      const r = EV.drawRound(3, rng);
      if(!r.solo){ coll++; if(Number.isInteger(r.boxIdx) && r.boxIdx >= 0 && r.boxIdx < BOX.tiers.length) collBox++; }
    }
    unit(`E9 撞車局也有箱子（撞車 ${coll} 局，皆有 boxIdx）`, coll > 0 && coll === collBox);
  }
  // 取整工具
  {
    let ok = true;
    for(const st of [1, 7, 13, 99, 1234]) for(const o of [1.0084, 1.3333, 2.5, 3.9452, 19.7264]){
      const pay = EV.payoutFloor(st, o), exact = st * o;
      if(!(pay <= exact + 1e-9 && pay > exact - 1 && Number.isInteger(pay))) ok = false;
    }
    unit('E10 payoutFloor：整數、不高估、至多少 1', ok);
    unit('E11 fmtX 兩位無條件捨去', EV.fmtX(1.9199)==='1.91' && EV.fmtX(1.9199999)==='1.92' && EV.fmtX(3.2)==='3.20' && EV.fmtX(1.0084)==='1.00');
  }
  // 載入自我檢查確實會擋（以手改 CFG 副本重載 values.js）
  {
    const src = fs.readFileSync(path.join(ROOT, 'values.js'), 'utf8');
    const tryLoad = (mut) => { try { new Function(mut(src) + '\nreturn EV;')(); return false; } catch(e) { return true; } };
    const b1 = tryLoad(s => s.replace("p:0.72", "p:0.70"));                       // 箱機率和≠1
    const b2 = tryLoad(s => s.replace("mult:1,   p:0.72", "mult:0.5, p:0.72"));  // 箱倍率<1
    const b3 = tryLoad(s => s.replace("[9, 10, 11]", "[7, 10, 11]"));             // 藍紫重疊、非嚴格遞增
    const b4 = tryLoad(s => s.replace("[5, 6]", "[2, 3]"));                       // 綠點太低→綠基準賠率 <1 或無解
    unit('E12 自我檢查會擋：箱機率和≠1／箱倍率<1／物資未遞增／綠點基準<1', b1 && b2 && b3 && b4, `擋下 ${[b1,b2,b3,b4].map(x=>x?'Y':'N').join('')}`);
  }
}

/* ============ F 端到端（經 DemoCore.createGame，不碰 values.js 的 drawRound 內部） ============
 * 核心與 EV.drawRound 用同一種子、同一亂數順序，必須逐局完全一致（盤面先抽、對手與箱子下注後抽）。 */
console.log('\n=== F 端到端（DemoCore：盤面公告／bet／ack／存檔接回，N=' + N + '／落點） ===');
eval(fs.readFileSync(path.join(ROOT, 'js', 'core.js'), 'utf8'));      // var DemoCore 落本作用域
{
  const vm = require('vm');
  const KEYF = 'hotdrop.core';
  const memStore = () => { const m = {}; return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const asRound = r => Object.assign({}, r, { supply: r.board.supply });   // 讓 E 區的 checkRound 可直接驗核心的 round
  const calcPay = (stake, r) => r.solo ? Math.floor(Math.round(stake * r.baseOdds * CFG.BOX[r.boxIdx].mult * 1e6) / 1e6) : 0;

  /* ---- F1～F4 逐局比對 EV.drawRound ＋ 派彩公式 ＋ 錢包逐步守恆 ＋ 盤面公告穩定 ---- */
  {
    const R = 20000, SEEDF = 20261117;
    const g = DemoCore.createGame({ storage: false, rng: mulberry32(SEEDF), wallet: 1e12, now: () => 1e12 });
    const ref = mulberry32(SEEDF);
    let lastRes = null, lastSet = null, nBoardEv = 0, lastBoardEv = null;
    g.on((t, d) => { if(t === 'result') lastRes = d; else if(t === 'settled') lastSet = d; else if(t === 'board'){ nBoardEv++; lastBoardEv = d.board; } });
    let diff = 0, diffMsg = '', walletBad = 0, boardBad = 0, payBad = 0, selfBad = 0, soloN = 0, collN = 0;
    for(let i = 0; i < R; i++){
      const p = i % K, stake = CFG.STAKES[i % CFG.STAKES.length];
      const want = EV.drawRound(p, ref);
      const w0 = g.getState().wallet, b0 = g.board();
      if(!same(b0, g.board())) boardBad++;                               // 待命中連讀兩次盤面不變
      if(!g.bet(p, stake)){ diff++; diffMsg = 'bet 被拒'; break; }
      const r = lastRes, w1 = g.getState().wallet;
      if(w1 !== w0 - stake) walletBad++;
      if(!same(r.board, b0) || !same(g.board(), b0) || !same(g.getState().st.board, b0)) boardBad++;   // 下注前後、演出中盤面一致
      if(!same(r.board.supply, want.supply) || !same(r.board.odds, want.board.odds) || !same(r.botPicks, want.botPicks) ||
         !same(r.counts, want.counts) || r.solo !== want.solo || r.boxIdx !== want.boxIdx || r.baseOdds !== want.baseOdds ||
         r.mult !== want.mult || r.topSoloPoint !== want.topSoloPoint || r.pointIdx !== p){
        diff++; if(!diffMsg) diffMsg = '第 ' + i + ' 局';
      }
      if(r.payout !== calcPay(stake, r) || r.payout !== EV.payoutFloor(stake, want.mult)) payBad++;
      if(!r.solo && r.payout !== 0) payBad++;
      if(checkRound(asRound(r), p)) selfBad++;
      if(r.solo) soloN++; else collN++;
      g.ack();
      const s = lastSet;
      if(s.wallet !== w1 + s.payout || s.net !== s.payout - stake || g.getState().wallet !== s.wallet) walletBad++;
      if(!same(s.nextBoard, g.board()) || !same(lastBoardEv, g.board()) || nBoardEv !== i + 1) boardBad++;
      if(s.payout !== r.payout || s.orderId !== r.orderId || s.restored !== false) payBad++;
      const rec = g.getState().records.slice(-1)[0];
      if(rec.payout !== r.payout || rec.topSoloPoint !== r.topSoloPoint || rec.net !== s.net || !same(rec.board.odds, r.board.odds)) payBad++;
    }
    unit(`F1 與 EV.drawRound 同種子逐局完全一致（${R} 局：盤面、機器人、人數、獨佔、箱子、賠率、倍率、最高獨佔色；下一局盤面亂數順序也一致）`, diff === 0, diff ? `不符 ${diff}，首例 ${diffMsg}` : '');
    unit(`F2 派彩＝獨佔 取整(注額×基準賠率×箱倍率)／撞車 0；round 逐局自洽（獨佔 ${soloN} 局、撞車 ${collN} 局，派彩錯誤 ${payBad}、自洽錯誤 ${selfBad}）`, payBad === 0 && selfBad === 0 && soloN > 0 && collN > 0);
    unit(`F3 錢包逐步守恆（下注扣注額、結算加派彩、wallet 事件／getState 一致；錯誤 ${walletBad}）`, walletBad === 0);
    unit(`F4 盤面：bet 前可取得、同一局內不變、結算後才換；board 事件＝settled.nextBoard＝board()（錯誤 ${boardBad}，board 事件 ${nBoardEv} 次）`, boardBad === 0 && nBoardEv === R);
  }

  /* ---- F5～F7 各落點 RTP、獨佔率（走核心）、錢包守恆（總和）、盤面抽樣均勻 ---- */
  {
    const g = DemoCore.createGame({ storage: false, rng: RNG, wallet: 1e15 });
    const startW = g.getState().wallet;
    let lastSet = null; g.on((t, d) => { if(t === 'settled') lastSet = d; });
    let sumPay = 0, sumStake = 0, nRound = 0;
    const rows = [], supCnt = CFG.SUPPLY.map(l => new Array(l.length).fill(0));
    for(let p = 0; p < K; p++){
      let wins = 0, sum = 0, sumsq = 0;
      for(let i = 0; i < N; i++){
        const bd = g.board();
        for(let k = 0; k < K; k++) supCnt[k][CFG.SUPPLY[k].indexOf(bd.supply[k])]++;
        nRound++;
        g.bet(p, STAKE); g.ack();
        const s = lastSet, m = s.payout / STAKE;
        if(s.solo) wins++;
        sum += m; sumsq += m * m; sumPay += s.payout; sumStake += STAKE;
      }
      const pw = wins / N, mean = sum / N;
      rows.push({ pw, se: Math.sqrt(pw * (1 - pw) / N), mean, mse: Math.sqrt(Math.max(0, sumsq / N - mean * mean) / N) });
    }
    for(let p = 0; p < K; p++) report('F', `F5 核心 ${POINTS[p].name}點獨佔率（對 A 區窮舉理論）`, LIM.soloAvg[p], rows[p].pw, rows[p].se);
    for(let p = 0; p < K; p++) report('F', `F5 核心 ${POINTS[p].name}點 RTP`, CFG.RTP, rows[p].mean, rows[p].mse);
    unit(`F6 錢包守恆（總和）：Σ派彩 − Σ注額 ＝ 錢包變化（${sumPay} − ${sumStake} ＝ ${g.getState().wallet - startW}）`, sumPay - sumStake === g.getState().wallet - startW);
    let supBad = 0, supWorst = 0;     // 9 個格子同時判，改用 4σ 避免多重比較誤報
    for(let k = 0; k < K; k++) for(const c of supCnt[k]){ const pr = 1 / supCnt[k].length, ph = c / nRound, se = Math.sqrt(pr * (1 - pr) / nRound); supWorst = Math.max(supWorst, Math.abs(ph - pr) / se); if(Math.abs(ph - pr) > Math.max(0.001, 4 * se)) supBad++; }
    unit(`F7 公告盤面的物資抽樣均勻（${K} 落點各候選頻率＝等機率，${nRound} 局，最大偏差 ${supWorst.toFixed(2)}σ；越界 ${supBad} 項）`, supBad === 0);
  }

  /* ---- F8 重整接回：隨機在待命／演出中重整，終局存檔必須與「不重整」的孿生局逐位元相同 ---- */
  {
    const ROUNDS = 3000;
    const run = (reloadMode, seed) => {
      const mem = memStore(), rngA = mulberry32(seed), pick = mulberry32(seed ^ 0x5bd1e995), dec = mulberry32(seed + 77);
      let tick = 0; const now = () => 1700000000000 + (tick++);
      const mk = () => DemoCore.createGame({ storage: mem, rng: rngA, now, wallet: 1e9 });
      let g = mk(), reloadsIdle = 0, reloadsAnim = 0, restoredBad = 0;
      for(let i = 0; i < ROUNDS; i++){
        const p = Math.floor(pick() * K), stake = CFG.STAKES[Math.floor(pick() * CFG.STAKES.length)];
        if(reloadMode && dec() < 0.3){ g = mk(); reloadsIdle++; }
        if(!g.bet(p, stake)) return { err: '第 ' + i + ' 局 bet 被拒' };
        if(reloadMode && dec() < 0.5){
          const w = g.getState().wallet, orderId = g.getState().st.orderId, pay = g.getState().st.payout;
          g = mk(); reloadsAnim++;                                       // 演出中重整：直接結算
          const s = g.getState();
          if(s.phase !== 'BET' || s.st !== null || s.records.slice(-1)[0].orderId !== orderId || s.wallet !== w + pay) restoredBad++;
        } else g.ack();
      }
      return { saved: mem.m[KEYF], wallet: g.getState().wallet, reloadsIdle, reloadsAnim, restoredBad };
    };
    const a = run(false, 31337), b = run(true, 31337);
    unit(`F8 重整接回：${ROUNDS} 局中隨機重整（待命 ${b.reloadsIdle} 次、演出中 ${b.reloadsAnim} 次），終局存檔（錢包、注單、盤面、流水號）與不重整的孿生局完全相同、演出中重整不重抽`,
      !a.err && !b.err && a.saved === b.saved && a.wallet === b.wallet && b.restoredBad === 0 && b.reloadsIdle > 0 && b.reloadsAnim > 0,
      a.err || b.err || (a.saved !== b.saved ? '終局存檔不同' : '') || (b.restoredBad ? '接回異常 ' + b.restoredBad : ''));
  }

  /* ---- F9 重整接回細項：待命不耗亂數、演出中只耗下一局盤面 4 個、損毀存檔處理 ---- */
  {
    const boom = () => { throw new Error('不該抽亂數'); };
    let calls = 0; const counted = seed => { const r = mulberry32(seed); return () => { calls++; return r(); }; };
    // 待命中重整：盤面不變、零亂數、錢包不變
    const mem = memStore();
    const g1 = DemoCore.createGame({ storage: mem, rng: mulberry32(5), now: () => 1700000000000 });
    const b1 = g1.board(), w1 = g1.getState().wallet;
    const g2 = DemoCore.createGame({ storage: mem, rng: boom });
    unit('F9a 下注前重整：盤面不變、錢包不變、不抽亂數', same(g2.board(), b1) && g2.getState().wallet === w1 && g2.getState().phase === 'BET');
    // 演出中重整（含改點後）：直接結算、結果與重整前宣告的相同、只耗 4 個亂數（下一局盤面）
    let res = null; g2.on((t, d) => { if(t === 'result' || t === 'repick') res = d; });
    g2.setRng(mulberry32(5));
    g2.bet(2, 100); const r0 = res;
    g2.changePoint(0); const r1 = res;                                   // 改點：同一組機器人／箱子
    const wBefore = g2.getState().wallet;
    calls = 0;
    const g3 = DemoCore.createGame({ storage: mem, rng: counted(99) });
    const s3 = g3.getState();
    const rec = s3.records.slice(-1)[0];
    unit('F9b 演出中重整：直接結算（回 BET、無進行中單）、不重抽（只耗下一局盤面 4 個亂數）', s3.phase === 'BET' && s3.st === null && calls === K);
    unit('F9c 重整後的結算＝重整前宣告的結果（含改點後的落點）：落點、機器人、箱子、派彩、錢包', rec.orderId === r1.orderId && rec.pointIdx === 0 && same(rec.botPicks, r0.botPicks) && rec.boxIdx === r0.boxIdx && rec.payout === r1.payout && s3.wallet === wBefore + r1.payout);
    // 損毀／舊版／盤面不合法的存檔
    const fresh = raw => { const m = memStore(); if(raw !== null) m.m[KEYF] = raw; return DemoCore.createGame({ storage: m, rng: mulberry32(1) }); };
    const gA = fresh('not json'), gB = fresh(JSON.stringify({ v: 1, wallet: 5, seq: 1, records: [], pending: null })), gC = fresh(null);
    unit('F9d 損毀／舊版存檔：開新局、起始錢包、仍有盤面', [gA, gB, gC].every(g => g.getState().wallet === CFG.WALLET && g.getState().phase === 'BET' && g.board().supply.length === K));
    const m4 = memStore(); DemoCore.createGame({ storage: m4, rng: mulberry32(8), now: () => 1 });
    const sv = JSON.parse(m4.m[KEYF]); sv.board = [1, 2, 3, 4]; m4.m[KEYF] = JSON.stringify(sv);
    const gD = DemoCore.createGame({ storage: m4, rng: mulberry32(8) });
    unit('F9e 存檔盤面不合法：重抽新盤面（不崩潰，錢包保留）', gD.board().supply.every((c, i) => CFG.SUPPLY[i].indexOf(c) >= 0) && gD.getState().wallet === sv.wallet);
    const m5 = memStore(); const gE0 = DemoCore.createGame({ storage: m5, rng: mulberry32(8), now: () => 1 });
    gE0.bet(1, 50); const sv5 = JSON.parse(m5.m[KEYF]); sv5.pending.botPicks = [9, 9]; m5.m[KEYF] = JSON.stringify(sv5);
    const gE = DemoCore.createGame({ storage: m5, rng: mulberry32(8) });
    unit('F9f 進行中單損毀：退還已扣注額、回待命', gE.getState().phase === 'BET' && gE.getState().wallet === CFG.WALLET);
  }

  /* ---- F10 封盤倒數中改點：機器人／箱子／盤面／注額／錢包不變，其餘重算且自洽 ---- */
  {
    const g = DemoCore.createGame({ storage: false, rng: mulberry32(424242), now: () => 1, wallet: 1e9 });
    let res = null, nRe = 0, lastSet = null;
    g.on((t, d) => { if(t === 'result' || t === 'repick'){ res = d; if(t === 'repick') nRe++; } if(t === 'settled') lastSet = d; });
    let bad = 0, n = 0, expRe = 0;
    for(let i = 0; i < 400; i++){
      const p = i % K; g.bet(p, 50); const r0 = res, w0 = g.getState().wallet;
      let cur = p;
      for(let q = 0; q < K; q++){
        if(q !== cur) expRe++;                                   // 同點不發 repick
        g.changePoint(q); cur = q; n++;
        const r = res;
        if(!same(r.botPicks, r0.botPicks) || r.boxIdx !== r0.boxIdx || !same(r.board, r0.board) || r.orderId !== r0.orderId ||
           r.stake !== 50 || r.wallet !== w0 || g.getState().wallet !== w0 || r.pointIdx !== q || checkRound(asRound(r), q) ||
           r.payout !== calcPay(50, r) || g.getState().st.pointIdx !== q) bad++;
      }
      g.ack();
      if(lastSet.pointIdx !== cur || lastSet.payout !== res.payout) bad++;
    }
    unit(`F10 改點（${n} 次）：機器人落點／箱子／盤面／注額／錢包不變；人數、獨佔、倍率、派彩重算且自洽；結算用最後一次落點（錯誤 ${bad}）`, bad === 0 && nRe === expRe && nRe > 0);
  }

  /* ---- F11 防呆：非法輸入只發 error、狀態不變；亂數消耗固定（盤面 4／bet 4／ack 4） ---- */
  {
    let calls = 0; const r = mulberry32(3); const counted = () => { calls++; return r(); };
    const g = DemoCore.createGame({ storage: false, rng: counted, wallet: 1000, now: () => 1 });
    let errs = 0; g.on((t) => { if(t === 'error') errs++; });
    const c0 = calls;
    let rej = 0;
    for(const p of [-1, 4, 1.5, '1', NaN, undefined, null]) if(g.bet(p, 10) === false) rej++;
    for(const s of [0, -5, NaN, 0.4, 1001]) if(g.bet(0, s) === false) rej++;
    if(g.ack() === false) rej++;                // 待命中不可 ack
    if(g.changePoint(1) === false) rej++;       // 待命中不可改點
    unit(`F11a 非法落點／押額／時機全被拒（${rej}/14）：只發 error 事件（${errs}）、錢包與階段不變、不耗亂數`, rej === 14 && errs === 14 && g.getState().wallet === 1000 && g.getState().phase === 'BET' && calls === c0);
    calls = 0; g.bet(1, 10);
    const afterBet = calls; let rej2 = 0;
    if(g.bet(1, 10) === false) rej2++;          // 演出中不可再下
    if(g.changePoint(7) === false) rej2++;
    if(g.clearSaved() === false) rej2++;
    if(g.addMoney(10) === false) rej2++;
    calls = 0; g.ack(); const afterAck = calls;
    unit(`F11b 亂數消耗固定：盤面 ${K}（建局時）、bet ${NBOT + 1}（機器人 ${NBOT}＋箱子 1）、ack ${K}（下一局盤面）；演出中 bet／非法改點／重置／加錢被拒（${rej2}/4）`,
      c0 === K && afterBet === NBOT + 1 && afterAck === K && rej2 === 4 && g.getState().wallet >= 990);
    unit('F11c 重置錢包：回起始錢包、清注單、盤面不變；加錢生效', (() => {
      const b = g.board(); g.addMoney(500); const w = g.getState().wallet; g.clearSaved();
      return g.getState().wallet === 1000 && g.getState().records.length === 0 && same(g.board(), b) && w >= 1490;
    })());
  }

  /* ---- F12 零 DOM：在沒有任何全域（window／document／localStorage）的 vm 沙盒載入並跑完一局 ---- */
  {
    let ok = false, msg = '';
    try{
      const src = fs.readFileSync(path.join(ROOT, 'values.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'js', 'core.js'), 'utf8') + '\n;DemoCore';
      const DC = vm.runInNewContext(src, {});
      const g = DC.createGame({ storage: false, rng: mulberry32(1) });
      ok = g.bet(0, 10) === true && g.ack() === true && g.getState().records.length === 1;
    }catch(e){ msg = String(e && e.message); }
    unit('F12 core.js 零 DOM：只有 values.js 的空沙盒可載入並完成一局', ok, msg);
  }
}

/* ============ 規格書用數值表（Markdown，直接貼） ============ */
{
  const f4 = x => x.toFixed(4), pct = x => (x * 100).toFixed(2) + '%';
  const L = [];
  L.push('\n=== 規格書用數值表（由 values.js 窮舉反推，勿手改） ===\n');
  L.push('**CFG**\n');
  L.push('| 項目 | 值 |');
  L.push('|---|---|');
  L.push(`| RTP | ${CFG.RTP} |`);
  L.push(`| 人數 | ${CFG.PLAYERS}（1 玩家＋${NBOT} 機器人） |`);
  L.push(`| 單注面額 | ${CFG.STAKES.join(' / ')} |`);
  L.push(`| 起始錢包 | ${CFG.WALLET} |`);
  L.push(`| 勝負 log 封頂 | ${CFG.LOG_CAP} 筆 |`);
  L.push(`| 物資組合數 | ${LIM.boards}（${CFG.SUPPLY.map(l => l.length).join('×')}，各組合等機率） |`);
  L.push('\n**各落點：物資候選、基準賠率區間、獨佔率區間**\n');
  L.push('| 落點 | 物資候選 | 基準賠率（最小～最大） | 獨佔率（最小～最大） | 獨佔率（加權平均） |');
  L.push('|---|---|---|---|---|');
  for(let p = 0; p < K; p++){
    L.push(`| ${POINTS[p].name} | ${CFG.SUPPLY[p].join(' / ')} | ${EV.fmtX(LIM.oddsMin[p])}x ～ ${EV.fmtX(LIM.oddsMax[p])}x | ${pct(LIM.soloMin[p])} ～ ${pct(LIM.soloMax[p])} | ${pct(LIM.soloAvg[p])} |`);
  }
  L.push('\n**箱子**\n');
  L.push('| 箱子 | 倍率 | 機率 |');
  L.push('|---|---|---|');
  for(const t of BOX.tiers) L.push(`| ${t.name} | ×${t.mult} | ${(t.p*100).toFixed(0)}% |`);
  L.push(`| 平均 M | ${BOX.M.toFixed(2)} | 合計 100% |`);
  L.push('\n**極值**\n');
  L.push('| 項目 | 值 |');
  L.push('|---|---|');
  L.push(`| 單局最高倍率 | ${EV.fmtX(LIM.maxMult)}x（${POINTS[LIM.maxMultPoint].name}點、物資 [${LIM.maxMultBoard.join(',')}]、傳說箱 ×${LIM.maxBoxMult}） |`);
  L.push(`| 綠點基準賠率最低 | ${f4(Math.min(...BOARDS.map(b => b.board.odds[0])))}x（護欄 ≥ 1.00） |`);
  L.push(`| 任一落點任一局 EV | = RTP ${CFG.RTP}（窮舉最大偏差 <1e-9） |`);
  console.log(L.join('\n'));
}

console.log(`\n${nFail===0?'ALL PASS':'HAS FAIL'}：PASS ${nPass}／FAIL ${nFail}（${((Date.now()-t0)/1000).toFixed(1)}s）`);
process.exit(nFail === 0 ? 0 : 1);
