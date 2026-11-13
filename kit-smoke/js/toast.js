/* =========================================================================
 * 三選一冒煙——toast（拋棄式；樣式在 css/base.css）
 * 介面：Toast.show(msg, ms)。自建 #toast 掛進 #app，z-index 45（最上層，僅次引導 50）
 * ========================================================================= */
var Toast = (function(){
'use strict';
var el = null, tm = null;
function ensure(){
  if(el) return el;
  el = document.createElement('div');
  el.id = 'toast';
  (document.getElementById('app') || document.body).appendChild(el);
  return el;
}
function show(msg, ms){
  var n = ensure();
  n.textContent = msg;
  n.classList.add('show');
  if(tm) clearTimeout(tm);
  tm = setTimeout(function(){ n.classList.remove('show'); }, ms || 2600);
}
return { show:show };
})();
