/* =========================================================================
 * 三選一冒煙——環境與共用小工具（命名空間 DEMO、網址參數、存檔 helper）
 *
 * 契約（demo-kit/CONTRACT.md）：
 *   window.DEMO   命名空間：DEMO.game（核心）／DEMO.shots／DEMO.t／DEMO.ui
 *   DEMO.q        網址參數：{ dev, shot, vw, lang, tut }
 *   DEMO.ls(name, v)  localStorage 讀寫（key 自動加 kitsmoke. 前綴、值走 JSON）；
 *                     ?shot= 模式不讀不寫（截圖用無痕 context 也保證互不汙染）
 * 必須在 values.js 之後、其餘 js 之前載入。
 * ========================================================================= */
(function(){
'use strict';
var D = window.DEMO = window.DEMO || {};
var sp = new URLSearchParams(location.search);
D.key = DEMO_KEY;
D.q = {
  dev:  sp.get('dev') === '1',
  shot: sp.get('shot') || '',
  vw:   sp.get('vw') || '',
  lang: sp.get('lang') || '',
  tut:  sp.get('tut')                    // '1' 強制重播、'0' 關閉、null 照存檔
};
D.persist = !D.q.shot;                   // 截圖模式不落地

D.ls = function(name, v){
  if(!D.persist) return null;
  var k = DEMO_KEY + '.' + name;
  try{
    if(v === undefined){ var r = localStorage.getItem(k); return r == null ? null : JSON.parse(r); }
    if(v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
  }catch(e){}
  return null;
};

/* ?vw=375：鎖 app 寬並靠左（桌面瀏覽器檢視用） */
D.applyVw = function(){
  var app = document.getElementById('app');
  if(app && D.q.vw){ app.style.width = D.q.vw + 'px'; app.style.margin = '0'; }
};
D.applyVw();

D.fmt = function(n){ return Math.round(n).toLocaleString('en-US'); };
D.signed = function(n){ return n > 0 ? '+' + D.fmt(n) : n < 0 ? '−' + D.fmt(-n) : '±0'; };
D.esc = function(s){ return String(s).replace(/[&<>"]/g, function(c){
  return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'; }); };
D.pad2 = function(x){ return (x < 10 ? '0' : '') + x; };
D.fmtTime = function(ts){
  var d = new Date(ts);
  return D.pad2(d.getMonth() + 1) + '/' + D.pad2(d.getDate()) + ' ' + D.pad2(d.getHours()) + ':' + D.pad2(d.getMinutes());
};
D.shots = D.shots || {};
})();
