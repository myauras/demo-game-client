/* =========================================================================
 * 爆金連鎖——演出用虛擬時間軸（零 DOM；可變速、可凍結）
 *
 * 為什麼自己推時間：演出分很多段（壓→彈→飛→落→進槽→進錢包），高速要整體變快、
 * 截圖要能停在「某一波的一半」。所有事件驅動的動畫都掛在這條時間軸上，
 * 每幀只改 transform／opacity（由呼叫端的 fn 寫），瀏覽器暫停分頁時時間也暫停。
 *
 * FX.now()                         目前虛擬毫秒（普通速度下 1 虛擬毫秒＝1 真實毫秒）
 * FX.at(t, fn)                     在虛擬時間 t 執行 fn（t 已過就下一幀執行）
 * FX.tw(t0, dur, fn(p), done, ease) 從 t0 起 dur 毫秒，每幀 fn(ease(p))；p 到 1 時再呼叫一次 fn(1) 與 done
 * FX.setSpeed(k)                   倍率（1＝普通；高速＝1/0.6）
 * FX.freezeAt(t, cb)               時間走到 t 就停住（截圖用），呼叫 cb；FX.thaw() 繼續
 * FX.idle()                        沒有待辦的計時器與補間
 * FX.E                             緩動：lin／out／in／io／back
 * ========================================================================= */
var FX = (function(){
'use strict';
var vt = 0, speed = 1, last = 0, raf = 0, freeze = null, frozen = false;
var timers = [], tweens = [];
var E = {
  lin: function(p){ return p; },
  out: function(p){ return 1 - (1 - p) * (1 - p); },
  in:  function(p){ return p * p; },
  io:  function(p){ return p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; },
  back: function(p){ var c = 1.70158; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); }
};

function nowMs(){ return (window.performance && performance.now) ? performance.now() : Date.now(); }
/* 用 setTimeout 而不是 rAF：無頭瀏覽器／背景分頁的 rAF 會被暫停，演出和截圖就卡死（上一款同樣做法） */
function kick(){
  if(raf || frozen) return;
  if(!timers.length && !tweens.length) return;
  last = nowMs();
  raf = setTimeout(frame, 16);
}
function frame(){
  raf = 0;
  var ts = nowMs();
  var dt = Math.min(64, ts - last); last = ts;
  step(dt * speed);
  if(!frozen && (timers.length || tweens.length)) raf = setTimeout(frame, 16);
}
function step(dv){
  var target = vt + dv, hit = false, i, k, nx, tw, p;
  if(freeze && target >= freeze.t){ target = Math.max(vt, freeze.t); hit = true; }
  for(;;){                                                  // 到期的計時器，依時間先後、各自在自己的時間點執行
    nx = -1;
    for(i = 0; i < timers.length; i++) if(timers[i].t <= target && (nx < 0 || timers[i].t < timers[nx].t)) nx = i;
    if(nx < 0) break;
    k = timers.splice(nx, 1)[0];
    if(k.t > vt) vt = k.t;
    try{ k.fn(); }catch(e){ if(window.console) console.error('[FX.at]', e); }
  }
  vt = target;
  var cur = tweens; tweens = [];                            // fn 裡新增的補間放到下一輪
  for(i = 0; i < cur.length; i++){
    tw = cur[i]; p = (vt - tw.t0) / tw.d;
    if(p < 0){ tweens.push(tw); continue; }
    try{
      if(p >= 1){ tw.fn(tw.ease(1)); if(tw.done) tw.done(); }
      else{ tw.fn(tw.ease(p)); tweens.push(tw); }
    }catch(e){ if(window.console) console.error('[FX.tw]', e); }
  }
  if(hit){
    var cb = freeze.cb; freeze = null; frozen = true;
    if(cb) try{ cb(); }catch(e){ if(window.console) console.error('[FX.freeze]', e); }
  }
}

return {
  E: E,
  now: function(){ return vt; },
  at: function(t, fn){ timers.push({ t: t, fn: fn }); kick(); },
  tw: function(t0, dur, fn, done, ease){ tweens.push({ t0: t0, d: Math.max(1, dur), fn: fn, done: done, ease: ease || E.lin }); kick(); },
  setSpeed: function(k){ speed = k > 0 ? k : 1; },
  getSpeed: function(){ return speed; },
  freezeAt: function(t, cb){ freeze = { t: t, cb: cb }; kick(); },
  thaw: function(){ frozen = false; kick(); },
  isFrozen: function(){ return frozen; },
  idle: function(){ return !timers.length && !tweens.length; }
};
})();
