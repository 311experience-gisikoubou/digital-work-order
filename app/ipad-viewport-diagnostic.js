/* Preview-only iPad Safari geometry diagnostics; no input values, no network. */
(function () {
  'use strict';
  const query = new URLSearchParams(location.search);
  if (query.get('uiDiag') !== '1') return;
  const hostname = location.hostname.toLowerCase();
  if (!(hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.trycloudflare.com'))) return;
  function sampleRect(selector) {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x:Math.round(r.x),right:Math.round(r.right),width:Math.round(r.width),
      y:Math.round(r.y),height:Math.round(r.height)
    };
  }
  function report() {
    const date = sampleRect('#shipping-date');
    const wrap = sampleRect('.approved-shipping-four > .shipping-input-wrap:first-child');
    const insurance = sampleRect('.approved-shipping-four > .approved-card-insurance');
    const controls = sampleRect('.approved-shipping-four .insurance-toggle');
    const vw = window.visualViewport;
    const area = document.getElementById('ipad-geometry-readout');
    if (!area) return;
    // Geometry only: intentionally do not read patient fields, saved drafts or cookies.
    area.textContent = [
      'iPad Safari表示診断（端末内のみ）',
      '画面: '+screen.width+' × '+screen.height,
      'CSS: '+innerWidth+' × '+innerHeight,
      'visualViewport: '+Math.round(vw?.width||0)+' × '+Math.round(vw?.height||0),
      '表示倍率: '+(vw?.scale||1).toFixed(2)+' / DPR '+devicePixelRatio,
      '発送日入力: '+JSON.stringify(date),
      '発送日枠: '+JSON.stringify(wrap),
      '保険・自費枠: '+JSON.stringify(insurance),
      '区分ボタン: '+JSON.stringify(controls),
      '入力→区分の距離: '+(date&&insurance?(insurance.x-date.right)+'px':'確認不能'),
      'パーツ枠内: '+(date&&wrap&&date.right<=wrap.right+1?'YES':'NO'),
      'レイアウト幅: '+document.documentElement.scrollWidth
    ].join('\n');
  }
  function init() {
    if (document.getElementById('ipad-geometry-button')) return;
    const button = document.createElement('button');
    button.id = 'ipad-geometry-button';
    button.type = 'button';
    button.textContent = '画面寸法';
    button.setAttribute('aria-controls','ipad-geometry-readout');
    button.style.cssText = 'position:fixed;bottom:13px;left:13px;z-index:2147483647;border:1px solid #0b736e;background:#e9fff8;color:#004e48;border-radius:8px;padding:7px 12px;font:600 13px system-ui;box-shadow:0 2px 7px #0002';
    const display = document.createElement('pre');
    display.id = 'ipad-geometry-readout';
    display.hidden = true;
    display.style.cssText = 'position:fixed;left:12px;right:12px;bottom:55px;z-index:2147483647;max-height:60vh;overflow:auto;background:#ffffff;color:#123735;border:2px solid #2c9e8a;border-radius:10px;padding:12px;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;box-shadow:0 7px 25px #0004';
    button.addEventListener('click',function(){
      display.hidden=!display.hidden;
      if (!display.hidden) report();
    });
    document.body.append(button,display);
    window.addEventListener('resize',function(){if(!display.hidden)report()});
    window.visualViewport?.addEventListener('resize',function(){if(!display.hidden)report()});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
