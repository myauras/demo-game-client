/* =========================================================================
 * 爆金連鎖——美術（全部程式畫、畫一次重複用；佔位美術，沒有外部圖）
 *
 * 做法：金幣、鑽石、皇冠、火花都是「SVG 字串 → data URI → CSS 背景圖」，載入時畫一次、
 * 之後只是被搬動（transform／opacity）。不用 filter、不用即時漸層。
 *
 * 金幣（斜看）：有厚度的側邊（圓柱高光＋逐條刻紋）、幣緣浮起的環、珠粒圈、凹下去的幣面、
 *   浮雕星徽（亮面朝左上、暗面朝右下）、左上弧形高光。兩種配色：n 古金、h 亮金（快滿的格子、飛行中的幣、能量條快滿時的幣頭）。
 * 盤面（斜看）：後窄前寬的梯形，金屬邊框＋四角鉚釘＋格子凹槽＋幣座。幾何常數與靜態稿 B 案相同。
 *
 * 對外：ART.G（幾何）、ART.css()（所有精靈的 CSS 類：.cn .ch .gd .gk .spk .spg）、ART.boardSVG()（盤面底圖）、
 *       ART.coinSVG/gemSVG/crownSVG/sparkSVG（字串）、ART.CW/CH…（精靈尺寸）
 * ========================================================================= */
var ART = (function(){
'use strict';

function n2(v){ return Math.round(v * 100) / 100; }
function uri(svg){ return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22') + '")'; }
function P(pts){ return pts.map(function(p){ return n2(p[0]) + ',' + n2(p[1]); }).join(' '); }

/* ---------- 金幣 ---------- */
var CW = 56, CH = 38, CXc = 28, CYc = 13.5, RX = 25, RY = 10.5, TH = 11;   // 精靈尺寸：寬、高、面心、半徑、厚度

var PAL = {
  n: { sd: ['#6a3f06', '#b98418', '#f7de8e', '#d3a22c', '#8f5d0c', '#5a3503'],        // 側邊：左暗→高光→右暗
       face0: '#fdf0b4', face1: '#e2b03c', face2: '#a96f14', lip: '#6e4508',
       ring0: '#fff3bd', ring1: '#8f5b0a', fld0: '#f5d77c', fld1: '#cf9626',
       star0: '#f6cf62', star1: '#b87a16', sHi: '#fffbe0', sLo: '#7a4b06', bead: '#fff2b8', beadLo: '#8a5808' },
  h: { sd: ['#8a4e04', '#e6a41c', '#fff3ac', '#f6c23a', '#b06c0c', '#6e3a02'],
       face0: '#fffbd6', face1: '#ffd54a', face2: '#e09a22', lip: '#8a4a06',
       ring0: '#fffbd4', ring1: '#b8690a', fld0: '#ffeba0', fld1: '#f4b52e',
       star0: '#ffd770', star1: '#d58916', sHi: '#ffffea', sLo: '#955205', bead: '#fffbd4', beadLo: '#a65e08' }
};

function ptE(cx, cy, rx, ry, deg){ var a = deg * Math.PI / 180; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; }
function arcPath(cx, cy, rx, ry, a1, a2){
  var p1 = ptE(cx, cy, rx, ry, a1), p2 = ptE(cx, cy, rx, ry, a2), large = ((a2 - a1 + 360) % 360) > 180 ? 1 : 0;
  return 'M' + n2(p1[0]) + ' ' + n2(p1[1]) + 'A' + rx + ' ' + ry + ' 0 ' + large + ' 1 ' + n2(p2[0]) + ' ' + n2(p2[1]);
}
function ellPerim(a, b){ return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))); }
function starPts(cx, cy, ro, ri, k, rot){
  var pts = [], i;
  for(i = 0; i < k * 2; i++){ var r = i % 2 ? ri : ro, a = rot + i * Math.PI / k; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return pts;
}

function coinSVG(kind){
  var q = PAL[kind], s = '', i, x, yt;
  s += '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + CW + ' ' + CH + '" width="' + CW + '" height="' + CH + '"><defs>'
    + '<linearGradient id="a" gradientUnits="userSpaceOnUse" x1="3" y1="0" x2="53" y2="0"><stop offset="0" stop-color="' + q.sd[0] + '"/><stop offset=".1" stop-color="' + q.sd[1] + '"/>'
    + '<stop offset=".28" stop-color="' + q.sd[2] + '"/><stop offset=".48" stop-color="' + q.sd[3] + '"/><stop offset=".78" stop-color="' + q.sd[4] + '"/><stop offset="1" stop-color="' + q.sd[5] + '"/></linearGradient>'
    + '<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".55" stop-color="#2a1500" stop-opacity=".12"/><stop offset="1" stop-color="#2a1500" stop-opacity=".5"/></linearGradient>'
    + '<linearGradient id="c" x1=".15" y1="0" x2=".85" y2="1"><stop offset="0" stop-color="' + q.face0 + '"/><stop offset=".5" stop-color="' + q.face1 + '"/><stop offset="1" stop-color="' + q.face2 + '"/></linearGradient>'
    + '<linearGradient id="d" x1=".1" y1=".1" x2=".9" y2=".9"><stop offset="0" stop-color="' + q.ring0 + '"/><stop offset=".5" stop-color="' + q.face1 + '"/><stop offset="1" stop-color="' + q.ring1 + '"/></linearGradient>'
    + '<radialGradient id="e" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="' + q.fld0 + '"/><stop offset="1" stop-color="' + q.fld1 + '"/></radialGradient>'
    + '<linearGradient id="f" x1=".2" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="' + q.star0 + '"/><stop offset="1" stop-color="' + q.star1 + '"/></linearGradient>'
    + '</defs>';
  /* 側邊：圓柱漸層＋下緣壓暗＋逐條刻紋 */
  var side = 'M3 ' + CYc + 'V' + (CYc + TH) + 'A' + RX + ' ' + RY + ' 0 0 0 53 ' + (CYc + TH) + 'V' + CYc + 'A' + RX + ' ' + RY + ' 0 0 1 3 ' + CYc + 'Z';
  s += '<path d="' + side + '" fill="url(#a)"/><path d="' + side + '" fill="url(#b)"/>';
  var reedD = '', reedL = '';
  for(i = 0; i < 27; i++){
    x = 4.6 + i * 1.8;
    yt = CYc + RY * Math.sqrt(Math.max(0, 1 - Math.pow((x - CXc) / RX, 2)));
    reedD += 'M' + n2(x) + ' ' + n2(yt) + 'v' + TH;
    reedL += 'M' + n2(x + .75) + ' ' + n2(yt) + 'v' + TH;
  }
  s += '<path d="' + reedD + '" stroke="' + q.sd[5] + '" stroke-opacity=".42" stroke-width=".7" fill="none"/>'
    + '<path d="' + reedL + '" stroke="#fff" stroke-opacity=".13" stroke-width=".5" fill="none"/>';
  s += '<path d="M3 ' + CYc + 'V' + (CYc + TH) + 'A' + RX + ' ' + RY + ' 0 0 0 53 ' + (CYc + TH) + 'V' + CYc + '" fill="none" stroke="' + q.sd[5] + '" stroke-width="1.1" stroke-linejoin="round"/>';
  /* 幣面：外緣唇、浮起的環、珠粒圈、凹下去的幣面 */
  s += '<ellipse cx="' + CXc + '" cy="' + CYc + '" rx="' + RX + '" ry="' + RY + '" fill="url(#c)" stroke="' + q.lip + '" stroke-width="1"/>';
  s += '<ellipse cx="' + CXc + '" cy="' + CYc + '" rx="22.6" ry="9.5" fill="none" stroke="url(#d)" stroke-width="1.5"/>';
  var br = 20.7, bb = br * .42, per = ellPerim(br, bb), gap = per / 34;
  s += '<ellipse cx="' + (CXc + .35) + '" cy="' + (CYc + .45) + '" rx="' + br + '" ry="' + n2(bb) + '" fill="none" stroke="' + q.beadLo + '" stroke-opacity=".6" stroke-width="1.25" stroke-linecap="round" stroke-dasharray="0.01 ' + n2(gap - .01) + '"/>';
  s += '<ellipse cx="' + CXc + '" cy="' + CYc + '" rx="' + br + '" ry="' + n2(bb) + '" fill="none" stroke="' + q.bead + '" stroke-opacity=".95" stroke-width="1.25" stroke-linecap="round" stroke-dasharray="0.01 ' + n2(gap - .01) + '"/>';
  s += '<ellipse cx="' + CXc + '" cy="' + CYc + '" rx="18.2" ry="7.6" fill="url(#e)"/>';
  s += '<path d="' + arcPath(CXc, CYc, 18.2, 7.6, 135, 315) + '" fill="none" stroke="' + q.sLo + '" stroke-opacity=".75" stroke-width="1.1"/>'
    + '<path d="' + arcPath(CXc, CYc, 18.2, 7.6, 315, 135) + '" fill="none" stroke="' + q.sHi + '" stroke-opacity=".9" stroke-width="1"/>';
  /* 浮雕星徽（在壓扁的座標系裡畫，亮面朝左上、暗面朝右下） */
  var st = starPts(0, 0, 14.5, 7.1, 8, -Math.PI / 2), stPts = P(st);
  s += '<g transform="translate(' + CXc + ' ' + CYc + ') scale(1 .42)">'
    + '<polygon points="' + stPts + '" transform="translate(1 2.2)" fill="' + q.sLo + '" fill-opacity=".55"/>'
    + '<polygon points="' + stPts + '" transform="translate(-.8 -1.6)" fill="' + q.sHi + '" fill-opacity=".95"/>'
    + '<polygon points="' + stPts + '" fill="url(#f)" stroke="' + q.sLo + '" stroke-opacity=".55" stroke-width=".7" stroke-linejoin="round"/>'
    + '<circle r="4.6" fill="none" stroke="' + q.sLo + '" stroke-opacity=".55" stroke-width="1.1"/>'
    + '<circle r="4.6" fill="none" stroke="' + q.sHi + '" stroke-opacity=".8" stroke-width=".7" transform="translate(-.5 -.9)"/>'
    + '<circle r="1.9" fill="' + q.sHi + '" fill-opacity=".9"/></g>';
  /* 高光：幣面左上弧、側邊直條、右下壓暗 */
  s += '<path d="' + arcPath(CXc, CYc, 23.9, 10, 196, 262) + '" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="3.2" stroke-linecap="round"/>'
    + '<path d="' + arcPath(CXc, CYc, 23.9, 10, 200, 258) + '" fill="none" stroke="#fff" stroke-opacity=".95" stroke-width="1.15" stroke-linecap="round"/>'
    + '<path d="' + arcPath(CXc, CYc, 23.9, 10, 20, 70) + '" fill="none" stroke="' + q.sd[5] + '" stroke-opacity=".28" stroke-width="1.6" stroke-linecap="round"/>';
  s += '<path d="M11.6 ' + (CYc + 6.2) + 'v' + (TH - 4.2) + '" stroke="#fff" stroke-opacity=".32" stroke-width="1.5" stroke-linecap="round"/>';
  s += '</svg>';
  return s;
}

/* ---------- 鑽石（正面刻面） ---------- */
var GW = 40, GH = 46;
function gemSVG(){
  var f = [
    [[2, 14], [11, 3], [11, 14], '#9fe9ff'], [[11, 3], [20, 14], [11, 14], '#67d2f6'], [[11, 3], [29, 3], [20, 14], '#effcff'],
    [[29, 3], [29, 14], [20, 14], '#8ddcf8'], [[29, 3], [38, 14], [29, 14], '#c9f4ff'],
    [[2, 14], [11, 14], [20, 44], '#2b9fcf'], [[11, 14], [20, 14], [20, 44], '#63d1f5'], [[20, 14], [29, 14], [20, 44], '#34b3e2'], [[29, 14], [38, 14], [20, 44], '#1c84b6']
  ], s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + GW + ' ' + GH + '" width="' + GW + '" height="' + GH + '"><defs>'
    + '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#05506f" stop-opacity=".35"/></linearGradient></defs>';
  f.forEach(function(q){ s += '<polygon points="' + P([q[0], q[1], q[2]]) + '" fill="' + q[3] + '" stroke="#0b6d94" stroke-width=".9" stroke-linejoin="round"/>'; });
  s += '<polygon points="' + P([[11, 3], [29, 3], [38, 14], [20, 44], [2, 14]]) + '" fill="url(#g)"/>';
  s += '<polygon points="' + P([[11, 3], [29, 3], [38, 14], [20, 44], [2, 14]]) + '" fill="none" stroke="#06526f" stroke-width="1.3" stroke-linejoin="round"/>';
  s += '<polygon points="' + P(starPts(11.5, 9, 5.4, 1.2, 4, -Math.PI / 2)) + '" fill="#fff"/><polygon points="' + P(starPts(31, 19, 2.8, .7, 4, -Math.PI / 2)) + '" fill="#fff" fill-opacity=".9"/>';
  s += '</svg>';
  return s;
}

/* ---------- 皇冠 ---------- */
var KW = 48, KH = 42;
function crownSVG(){
  var q = PAL.n, s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + KW + ' ' + KH + '" width="' + KW + '" height="' + KH + '"><defs>'
    + '<linearGradient id="a" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a86f10"/><stop offset=".3" stop-color="#ffe27a"/><stop offset=".55" stop-color="#e3a926"/><stop offset="1" stop-color="#8a5508"/></linearGradient>'
    + '<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffeb9a"/><stop offset=".5" stop-color="#eab12c"/><stop offset="1" stop-color="#9a600a"/></linearGradient>'
    + '<radialGradient id="r" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffb4b4"/><stop offset=".45" stop-color="#e5283a"/><stop offset="1" stop-color="#7a0818"/></radialGradient>'
    + '<radialGradient id="u" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#c8f0ff"/><stop offset=".5" stop-color="#2d9ad8"/><stop offset="1" stop-color="#0b3f78"/></radialGradient></defs>';
  s += '<path d="M4 31L7 11l10 9 7-14 7 14 10-9 3 20z" fill="url(#a)" stroke="#6a3f06" stroke-width="1.3" stroke-linejoin="round"/>';
  s += '<path d="M7 11l10 9 7-14v25H4z" fill="#fff" fill-opacity=".12"/><path d="M24 6l7 14 10-9 3 20H24z" fill="#3a1f00" fill-opacity=".16"/>';
  s += '<path d="M8 14l9 8 7-12" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1" stroke-linecap="round"/>';
  [[7, 9.2], [24, 4.4], [41, 9.2]].forEach(function(c){ s += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="3" fill="url(#b)" stroke="#6a3f06" stroke-width="1"/><circle cx="' + (c[0] - 1) + '" cy="' + (c[1] - 1) + '" r=".9" fill="#fff"/>'; });
  s += '<rect x="3" y="30" width="42" height="9" rx="2.4" fill="url(#b)" stroke="#6a3f06" stroke-width="1.3"/>';
  s += '<path d="M5.5 32.2h37" stroke="#fff" stroke-opacity=".55" stroke-width="1" stroke-linecap="round"/>';
  s += '<circle cx="24" cy="23.5" r="3.6" fill="url(#r)" stroke="#5a0a14" stroke-width="1"/><circle cx="22.9" cy="22.3" r="1" fill="#fff"/>';
  s += '<circle cx="13.5" cy="26" r="2.4" fill="url(#u)" stroke="#06305e" stroke-width=".9"/><circle cx="34.5" cy="26" r="2.4" fill="url(#u)" stroke="#06305e" stroke-width=".9"/>';
  s += '<path d="M8 35h3M15 35h3M22 35h4M30 35h3M37 35h3" stroke="#6a3f06" stroke-opacity=".55" stroke-width="1" stroke-linecap="round"/>';
  s += '</svg>';
  return s;
}

/* ---------- 爆炸徽章（獎池的圖示：黃色尖角＋紅橙圓心，數字由呼叫端疊上去）----------
   viewBox -20～20；pts＝尖角（12 個）。主畫面的獎池、拿獎池的飛行牌、盤面上「能炸 8 格」的提示都用同一個形狀，玩家一眼連得起來 */
function burstPts(ro, ri){ return P(starPts(0, 0, ro, ri, 12, -Math.PI / 2)); }
function burstSVG(blue){                                   // blue＝金幣雨那一段的 Combo 用（金色尖角＋藍色圓心），其餘同形狀
  var c = blue ? ['#fff6b8', '#ffd24a', '#e0a21a', '#7fd8ff', '#2a7ad8', '#0e3a8a', '#8a5a04', '#d6f2ff'] : ['#fff6b8', '#ffbc2e', '#ff7a1e', '#ff8a44', '#e5391a', '#a3180a', '#8a2a04', '#ffe9a0'];
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -20 40 40" width="40" height="40"><defs>'
    + '<radialGradient id="a" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="' + c[0] + '"/><stop offset=".5" stop-color="' + c[1] + '"/><stop offset="1" stop-color="' + c[2] + '"/></radialGradient>'
    + '<radialGradient id="b" cx=".38" cy=".3" r=".85"><stop offset="0" stop-color="' + c[3] + '"/><stop offset=".55" stop-color="' + c[4] + '"/><stop offset="1" stop-color="' + c[5] + '"/></radialGradient></defs>'
    + '<polygon points="' + burstPts(19.2, 15.2) + '" fill="url(#a)" stroke="' + c[6] + '" stroke-width="1.5" stroke-linejoin="round"/>'
    + '<circle r="11.4" fill="url(#b)" stroke="' + c[7] + '" stroke-width="1.3"/>'
    + '<path d="M-7.6 -5.2A9.4 9.4 0 0 1 0 -9.6" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.5" stroke-linecap="round"/></svg>';
}

/* 四角閃光（裝飾） */
function sparkSVG(col){
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 24 24" width="24" height="24"><polygon points="' + P(starPts(0, 0, 11, 2.4, 4, -Math.PI / 2)) + '" fill="' + (col || '#fff7c2') + '"/><circle r="2.2" fill="#fff"/></svg>';
}

/* ---------- 幾何（與靜態稿 B 案相同；斜看：後窄前寬） ---------- */
var CX = 187.5, CWd = 67, TOP = 108, RH = [74, 76, 78, 80, 82], F0 = 0.95, F1 = 1.0, KS = 1.1, rt = [], BOT = TOP;   // v3：盤面放大（靜態稿 B 案：各列加高、透視變小、幣放大 1.1 倍）
RH.forEach(function(h){ rt.push(BOT); BOT += h; });                       // BOT = 498
function fy(y){ return F0 + (F1 - F0) * (y - TOP) / (BOT - TOP); }        // 近大遠小
function cellPts(r, c){
  var yt = rt[r], yb = yt + RH[r], ft = fy(yt), fb = fy(yb);
  return { yt: yt, yb: yb, xtl: CX + (c - 2.5) * CWd * ft, xtr: CX + (c - 1.5) * CWd * ft, xbl: CX + (c - 2.5) * CWd * fb, xbr: CX + (c - 1.5) * CWd * fb };
}
function dims(r, c){
  var yt = rt[r], yb = yt + RH[r], yc = (yt + yb) / 2, fc = fy(yc), w = CWd * fc;
  var rx = w * 0.37, ry = rx * 0.42, th = RH[r] * 0.17;
  return { x: CX + (c - 2) * w, yt: yt, yb: yb, yc: yc, f: fc, w: w, h: RH[r], s: rx / RX * KS, cy0: yb - 8 - th - ry };
}
function xL(y, p){ return CX - 2.5 * CWd * fy(y) - p; }
function xR(y, p){ return CX + 2.5 * CWd * fy(y) + p; }

/* ---------- 盤面底圖（靜態）：框、格子、幣座 ---------- */
function boardSVG(){
  var yT = TOP - 8, yB = BOT + 8, s = '', r, c, p, i = 1.1;
  s += '<defs>'
    + '<linearGradient id="bf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26356b"/><stop offset=".5" stop-color="#16204a"/><stop offset="1" stop-color="#0b1230"/></linearGradient>'
    + '<linearGradient id="bl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d4f8e"/><stop offset=".12" stop-color="#1b274f"/><stop offset="1" stop-color="#070b1c"/></linearGradient>'
    + '<linearGradient id="bt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6c372"/><stop offset=".45" stop-color="#9a7428"/><stop offset="1" stop-color="#4a3410"/></linearGradient>'
    + '<linearGradient id="cf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1632"/><stop offset=".55" stop-color="#16224a"/><stop offset="1" stop-color="#1b2a58"/></linearGradient>'
    + '<radialGradient id="seat" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#050914" stop-opacity=".85"/><stop offset=".7" stop-color="#050914" stop-opacity=".45"/><stop offset="1" stop-color="#050914" stop-opacity="0"/></radialGradient>'
    + '<radialGradient id="stud" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff0b0"/><stop offset=".45" stop-color="#d9a932"/><stop offset="1" stop-color="#6a4308"/></radialGradient>'
    + '<radialGradient id="aura" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#3a5bb8" stop-opacity=".42"/><stop offset=".6" stop-color="#27428c" stop-opacity=".16"/><stop offset="1" stop-color="#27428c" stop-opacity="0"/></radialGradient>'
    + '</defs>';
  s += '<ellipse cx="187.5" cy="' + n2((TOP + BOT) / 2 + 20) + '" rx="250" ry="' + n2((BOT - TOP) * 0.77) + '" fill="url(#aura)"/>';
  /* 前緣厚度＋金屬邊 */
  s += '<polygon points="' + P([[xL(yB, 12), yB], [xR(yB, 12), yB], [xR(yB, 7), yB + 17], [xL(yB, 7), yB + 17]]) + '" fill="url(#bl)" stroke="#2a3a72" stroke-width="1.2" stroke-linejoin="round"/>';
  s += '<polygon points="' + P([[xL(yB, 12), yB], [xR(yB, 12), yB], [xR(yB, 12), yB + 2.2], [xL(yB, 12), yB + 2.2]]) + '" fill="url(#bt)"/>';
  s += '<polygon points="' + P([[xL(yT, 10), yT], [xR(yT, 10), yT], [xR(yB, 12), yB], [xL(yB, 12), yB]]) + '" fill="url(#bf)" stroke="#4b5fa3" stroke-width="1.4" stroke-linejoin="round"/>';
  s += '<polygon points="' + P([[xL(yT, 10) + 2, yT + 1.6], [xR(yT, 10) - 2, yT + 1.6], [xR(yB, 12) - 1.5, yB - 1.5], [xL(yB, 12) + 1.5, yB - 1.5]]) + '" fill="none" stroke="url(#bt)" stroke-opacity=".85" stroke-width="1.5" stroke-linejoin="round"/>';
  s += '<polygon points="' + P([[xL(yT, 4), yT + 5], [xR(yT, 4), yT + 5], [xR(yB, 5), yB - 5], [xL(yB, 5), yB - 5]]) + '" fill="#070c1f" stroke="#05081a" stroke-width="1.2" stroke-linejoin="round"/>';
  /* 四角鉚釘 */
  [[xL(yT, 10) + 6, yT + 6], [xR(yT, 10) - 6, yT + 6], [xL(yB, 12) + 7, yB - 6], [xR(yB, 12) - 7, yB - 6]].forEach(function(q){
    s += '<circle cx="' + n2(q[0]) + '" cy="' + n2(q[1] + 1) + '" r="3.4" fill="#05081a" fill-opacity=".6"/><circle cx="' + n2(q[0]) + '" cy="' + n2(q[1]) + '" r="3.2" fill="url(#stud)" stroke="#4a3008" stroke-width=".7"/><circle cx="' + n2(q[0] - 1) + '" cy="' + n2(q[1] - 1) + '" r=".9" fill="#fff"/>';
  });
  /* 格子：凹槽（上緣內陰影、下緣亮線）＋幣座 */
  for(r = 0; r < 5; r++) for(c = 0; c < 5; c++){
    p = cellPts(r, c);
    var pp = [[p.xtl + i, p.yt + i], [p.xtr - i, p.yt + i], [p.xbr - i, p.yb - i], [p.xbl + i, p.yb - i]], d = dims(r, c);
    s += '<polygon points="' + P(pp) + '" fill="url(#cf)" stroke="#2a3a70" stroke-width="1" stroke-linejoin="round"/>';
    s += '<polygon points="' + P([pp[0], pp[1], [pp[1][0] - 2, pp[1][1] + 5], [pp[0][0] + 2, pp[0][1] + 5]]) + '" fill="#000" fill-opacity=".34"/>';
    s += '<line x1="' + n2(pp[3][0] + 2) + '" y1="' + n2(pp[3][1] - .6) + '" x2="' + n2(pp[2][0] - 2) + '" y2="' + n2(pp[2][1] - .6) + '" stroke="#7186c8" stroke-opacity=".3" stroke-width="1"/>';
    s += '<ellipse cx="' + n2(d.x) + '" cy="' + n2(d.cy0 + 6) + '" rx="' + n2(d.w * .44) + '" ry="' + n2(d.w * .2) + '" fill="url(#seat)"/>';
  }
  return s;
}

/* ---------- CSS：精靈類別（畫一次，之後只搬動） ---------- */
function css(){
  var out = '';
  out += '.cn{background-image:' + uri(coinSVG('n')) + '}';
  out += '.ch{background-image:' + uri(coinSVG('h')) + '}';
  out += '.gd{background-image:' + uri(gemSVG()) + '}';
  out += '.gk{background-image:' + uri(crownSVG()) + '}';
  out += '.spk{background-image:' + uri(sparkSVG('#fff7c2')) + '}';
  out += '.spg{background-image:' + uri(sparkSVG('#ffd24a')) + '}';
  out += '.bst{background-image:' + uri(burstSVG()) + '}';
  out += '.bsb{background-image:' + uri(burstSVG(true)) + '}';
  return out;
}

return { burstPts: burstPts, burstSVG: burstSVG, CW: CW, CH: CH, CXc: CXc, CYc: CYc, RX: RX, RY: RY, TH: TH, GW: GW, GH: GH, KW: KW, KH: KH,
  G: { CX: CX, CWd: CWd, TOP: TOP, BOT: BOT, RH: RH, rt: rt, fy: fy, cellPts: cellPts, dims: dims, xL: xL, xR: xR },
  css: css, boardSVG: boardSVG, coinSVG: coinSVG, gemSVG: gemSVG, crownSVG: crownSVG, sparkSVG: sparkSVG };
})();
