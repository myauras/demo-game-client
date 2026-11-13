/* =========================================================================
 * 三選一冒煙——拖曳滾動（可移植工具，無依賴）
 *
 * 介面：DragScroll.attach(el)
 * 規則（B 案 §7.5 慣例，無原生捲軸＋滑鼠也能拖）：
 *  - 只處理滑鼠；觸控／筆保留原生滾動（touch-action:pan-y），不攔截以免雙重滾動
 *  - pointerdown 起算，位移 > 5px 才算拖曳（改 scrollTop、游標 grabbing）
 *  - move／up 掛 window（拖出容器不中斷）；禁用 setPointerCapture
 *  - 拖過的那次放開，其後的 click 以捕獲階段吞掉；< 5px 放開＝一般點擊
 * 捲軸本身的隱藏在各自的 css（.dscroll 類，見 css/base.css）
 * ========================================================================= */
var DragScroll = (function(){
'use strict';
var THRESHOLD = 5;
function attach(el){
  if(!el || el._dragScroll) return;
  el._dragScroll = true;
  el.classList.add('dscroll');
  el.style.touchAction = 'pan-y';
  var active = false, moved = false, y0 = 0, top0 = 0, suppress = false;
  el.addEventListener('pointerdown', function(e){
    if(e.pointerType !== 'mouse' || e.button !== 0) return;
    active = true; moved = false; suppress = false; y0 = e.clientY; top0 = el.scrollTop;
  });
  function mv(e){
    if(!active) return;
    var dy = e.clientY - y0;
    if(!moved){ if(Math.abs(dy) <= THRESHOLD) return; moved = true; el.classList.add('dragging'); }
    el.scrollTop = top0 - dy;
    e.preventDefault();
  }
  function up(){
    if(!active) return;
    active = false;
    if(moved){
      moved = false; suppress = true; el.classList.remove('dragging');
      setTimeout(function(){ suppress = false; }, 0);
    }
  }
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  el.addEventListener('click', function(e){
    if(suppress){ suppress = false; e.stopPropagation(); e.preventDefault(); }
  }, true);
}
return { attach:attach };
})();
