// ============================================================
//  歯式チャート生成
// ============================================================
function buildToothChart() {
  // 上顎：右から 18〜11, 左 21〜28
  const upperRight = [18,17,16,15,14,13,12,11];
  const upperLeft  = [21,22,23,24,25,26,27,28];
  // 下顎：右から 48〜41, 左 31〜38
  const lowerRight = [48,47,46,45,44,43,42,41];
  const lowerLeft  = [31,32,33,34,35,36,37,38];

  buildJaw('jaw-upper', [...upperRight, ...upperLeft]);
  buildJaw('jaw-lower', [...lowerRight, ...lowerLeft]);
}

function buildJaw(containerId, teeth) {
  const container = document.getElementById(containerId);
  teeth.forEach((num, idx) => {
    // 中切歯の間に中心線
    if (idx === 8) {
      const mid = document.createElement('div');
      mid.className = 'midline';
      container.appendChild(mid);
    }
    const el = document.createElement('div');
    el.className = 'tooth';
    el.textContent = num;
    el.dataset.num = num;
    el.addEventListener('click', () => toggleTooth(num, el));
    container.appendChild(el);
  });
}

function toggleTooth(num, el) {
  if (state.selectedTeeth.has(num)) {
    state.selectedTeeth.delete(num);
    el.classList.remove('selected');
    // 歯式図の欠損マークを解除
    syncToothChart(num, false);
  } else {
    state.selectedTeeth.add(num);
    el.classList.add('selected');
    // 歯式図に欠損マークを付ける
    syncToothChart(num, true);
  }
  updateTeethDisplay();
}

// 歯式チャート → 歯式図 への同期
function syncToothChart(num, isSelected) {
  var toothEl = document.getElementById('tooth-' + num);
  var stamp   = document.getElementById('stamp-' + num);
  if (!toothEl || !stamp) return;

  if (isSelected) {
    toothState[num] = 'missing';
    toothEl.setAttribute('class', 'tooth-el missing');
    stamp.setAttribute('class', 'tooth-stamp show missing');
    stamp.textContent = '✕';
  } else {
    toothState[num] = null;
    toothEl.setAttribute('class', 'tooth-el');
    stamp.setAttribute('class', 'tooth-stamp');
    stamp.textContent = '';
  }
  updateResults();
}

function updateTeethDisplay() {
  const display = document.getElementById('selected-display');
  if (state.selectedTeeth.size === 0) {
    display.innerHTML = '患歯：<span>未選択</span>';
  } else {
    const sorted = [...state.selectedTeeth].sort((a,b)=>a-b);
    display.innerHTML = `患歯：<span>${sorted.join('、')}</span>`;
  }
}

var upperTeeth = [
  {num:18, cx:95, cy:462, rx:38, ry:38},
  {num:17, cx:97, cy:396, rx:36, ry:36},
  {num:16, cx:111, cy:321, rx:36, ry:36},
  {num:15, cx:126, cy:255, rx:32, ry:32},
  {num:14, cx:144, cy:201, rx:30, ry:30},
  {num:13, cx:166, cy:140, rx:27, ry:27},
  {num:12, cx:211, cy:99, rx:24, ry:24},
  {num:11, cx:263, cy:74, rx:24, ry:24},
  {num:21, cx:320, cy:74, rx:24, ry:24},
  {num:22, cx:372, cy:91, rx:24, ry:24},
  {num:23, cx:420, cy:128, rx:27, ry:27},
  {num:24, cx:444, cy:189, rx:30, ry:30},
  {num:25, cx:470, cy:244, rx:32, ry:32},
  {num:26, cx:485, cy:309, rx:36, ry:36},
  {num:27, cx:502, cy:379, rx:36, ry:36},
  {num:28, cx:514, cy:447, rx:38, ry:38}
];
var lowerTeeth = [
  {num:48, cx:107, cy:628, rx:38, ry:38},
  {num:47, cx:126, cy:701, rx:36, ry:36},
  {num:46, cx:149, cy:787, rx:36, ry:36},
  {num:45, cx:174, cy:859, rx:32, ry:32},
  {num:44, cx:192, cy:917, rx:28, ry:28},
  {num:43, cx:228, cy:965, rx:26, ry:26},
  {num:42, cx:264, cy:996, rx:22, ry:22},
  {num:41, cx:306, cy:1008, rx:20, ry:20},
  {num:31, cx:346, cy:1007, rx:20, ry:20},
  {num:32, cx:386, cy:994, rx:22, ry:22},
  {num:33, cx:420, cy:960, rx:26, ry:26},
  {num:34, cx:448, cy:913, rx:28, ry:28},
  {num:35, cx:463, cy:851, rx:32, ry:32},
  {num:36, cx:483, cy:776, rx:36, ry:36},
  {num:37, cx:497, cy:690, rx:36, ry:36},
  {num:38, cx:507, cy:612, rx:38, ry:38}
];

var toothBB={11:{cx:263,cy:74,x1:239,x2:287,y1:50,y2:98},12:{cx:211,cy:99,x1:187,x2:235,y1:75,y2:123},13:{cx:166,cy:140,x1:139,x2:193,y1:113,y2:167},14:{cx:144,cy:201,x1:114,x2:174,y1:171,y2:231},15:{cx:126,cy:255,x1:94,x2:158,y1:223,y2:287},16:{cx:111,cy:321,x1:75,x2:147,y1:285,y2:357},17:{cx:97,cy:396,x1:61,x2:133,y1:360,y2:432},18:{cx:95,cy:462,x1:57,x2:133,y1:424,y2:500},21:{cx:320,cy:74,x1:296,x2:344,y1:50,y2:98},22:{cx:372,cy:91,x1:348,x2:396,y1:67,y2:115},23:{cx:420,cy:128,x1:393,x2:447,y1:101,y2:155},24:{cx:444,cy:189,x1:414,x2:474,y1:159,y2:219},25:{cx:470,cy:244,x1:438,x2:502,y1:212,y2:276},26:{cx:485,cy:309,x1:449,x2:521,y1:273,y2:345},27:{cx:502,cy:379,x1:466,x2:538,y1:343,y2:415},28:{cx:514,cy:447,x1:476,x2:552,y1:409,y2:485},31:{cx:346,cy:1007,x1:326,x2:366,y1:987,y2:1027},32:{cx:386,cy:994,x1:364,x2:408,y1:972,y2:1016},33:{cx:420,cy:960,x1:394,x2:446,y1:934,y2:986},34:{cx:448,cy:913,x1:420,x2:476,y1:885,y2:941},35:{cx:463,cy:851,x1:431,x2:495,y1:819,y2:883},36:{cx:483,cy:776,x1:447,x2:519,y1:740,y2:812},37:{cx:497,cy:690,x1:461,x2:533,y1:654,y2:726},38:{cx:507,cy:612,x1:469,x2:545,y1:574,y2:650},41:{cx:306,cy:1008,x1:286,x2:326,y1:988,y2:1028},42:{cx:264,cy:996,x1:242,x2:286,y1:974,y2:1018},43:{cx:228,cy:965,x1:202,x2:254,y1:939,y2:991},44:{cx:192,cy:917,x1:164,x2:220,y1:889,y2:945},45:{cx:174,cy:859,x1:142,x2:206,y1:827,y2:891},46:{cx:149,cy:787,x1:113,x2:185,y1:751,y2:823},47:{cx:126,cy:701,x1:90,x2:162,y1:665,y2:737},48:{cx:107,cy:628,x1:69,x2:145,y1:590,y2:666}};
// 内部キー → 歯式図上表示略号
var CLASP_LABELS={"W":"W","E":"C","T":"T","C":"CM","H":"H","R":"R","I":"I","WI":"WI"};
var STAMPS={missing:"✕",caution:"!"};
var toothState={},coords={},currentMode="missing";
var drag={active:false,moved:false,num:null,startX:0,startY:0,origCx:0,origCy:0};

// ===== クラスプ管理 =====
var CLASP_COLORS={"W":"#2563a8","E":"#22aa66","T":"#8844cc","C":"#8B4513","H":"#cc2222","R":"#dd7700","I":"#0088aa","WI":"#0088aa"};
var claspState={};  // {歯番号: [{uid, type, dir, isTwin1, twinWith, cx, cy, sx, sy, angle}]}
var claspMode=null; // {type, dir}
var twinFirst=null; // 双子鉤の1本目

var activeClaspUid = null;
var claspDrag = { active: false, mode: null, uid: null, num: null, startX: 0, startY: 0, initT: null };

function genUid(){ return Date.now().toString(36)+Math.random().toString(36).substring(2,6); }

// ===== localStorage 保存・復元 =====
function saveClaspState() {
  var hasAny = upperTeeth.concat(lowerTeeth).some(function(t) {
    return claspState[t.num] && claspState[t.num].length > 0;
  });
  if (!hasAny) {
    if (typeof showToast === 'function') showToast('クラスプが配置されていません');
    return;
  }
  try {
    localStorage.setItem('dwo_clasp_v1', JSON.stringify(claspState));
    if (typeof showToast === 'function') showToast('クラスプ位置を保存しました');
  } catch(e) {}
}

function loadClaspState() {
  try {
    var raw = localStorage.getItem('dwo_clasp_v1');
    if (!raw) return;
    var saved = JSON.parse(raw);
    Object.keys(saved).forEach(function(num) {
      var n = parseInt(num, 10);
      if (claspState[n] !== undefined) {
        claspState[n] = saved[num];
      }
    });
    renderAllClasps();
    updateClaspList();
  } catch(e) {}
}

function initClasp(){
  upperTeeth.concat(lowerTeeth).forEach(function(t){ claspState[t.num]=[]; });

  // クラスプボタン → 直接モード設定（方向選択なし）
  document.querySelectorAll(".clasp-btn[data-clasp]").forEach(function(btn){
    btn.addEventListener("click",function(e){
      e.stopPropagation();
      var type=btn.getAttribute("data-clasp");
      if(claspMode && claspMode.type===type){
        claspMode=null; twinFirst=null;
        document.querySelectorAll(".clasp-btn").forEach(function(b){b.classList.remove("active");});
        document.getElementById("twinHint").className="twin-hint";
        return;
      }
      claspMode={type:type,dir:null};
      twinFirst=null;
      document.querySelectorAll(".clasp-btn").forEach(function(b){b.classList.remove("active");});
      btn.classList.add("active");
      document.getElementById("twinHint").className=type==="T"?"twin-hint show":"twin-hint";
      activeClaspUid=null;
      renderAllClasps();
    });
  });

  // クラスプクリアボタン
  document.getElementById("claspClearBtn").addEventListener("click",function(){
    claspMode=null; twinFirst=null; activeClaspUid=null;
    document.querySelectorAll(".clasp-btn").forEach(function(b){b.classList.remove("active");});
    document.getElementById("twinHint").className="twin-hint";
    renderAllClasps();
  });

  document.addEventListener("click",function(){});

  // クラスプ位置保存ボタンを claspClearBtn の隣に挿入
  var clearBtn = document.getElementById("claspClearBtn");
  if (clearBtn && !document.getElementById("claspSaveBtn")) {
    var saveBtn = document.createElement("button");
    saveBtn.id = "claspSaveBtn";
    saveBtn.textContent = "位置保存";
    saveBtn.className = clearBtn.className;
    saveBtn.addEventListener("click", saveClaspState);
    clearBtn.parentNode.insertBefore(saveBtn, clearBtn.nextSibling);
  }
}

function getInitialTransform(num) {
  var c = coords[num];
  if (!c) return { cx: 300, cy: 535 };
  return { cx: c.cx, cy: c.cy };
}

function getSavedTransform(num, type) {
  try {
    var raw = localStorage.getItem('dwo_clasp_v1');
    if (!raw) return null;
    var saved = JSON.parse(raw);
    var list = saved[String(num)];
    if (!list) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].type === type) {
        var m = list[i];
        return { cx: m.cx, cy: m.cy };
      }
    }
    return null;
  } catch(e) { return null; }
}

function applyClaspToTooth(num){
  if(drawMode) return;
  if(!claspMode) return;
  var type=claspMode.type;

  if(type==="T"){
    if(twinFirst===null){
      twinFirst=num;
      var t1 = getSavedTransform(num, type) || getInitialTransform(num);
      claspState[num].push(Object.assign({uid: genUid(), type:type, dir:null, twin:null, isTwin1:true}, t1));
      renderAllClasps();
    } else if(twinFirst!==num){
      var n1=twinFirst;
      var c1 = claspState[n1].find(function(c){return c.type==="T"&&c.isTwin1;});
      if(c1) { c1.isTwin1 = false; c1.twinWith = num; }
      var t2 = getSavedTransform(num, type) || getInitialTransform(num);
      claspState[num].push(Object.assign({uid: genUid(), type:type, dir:null, twinWith:n1}, t2));
      twinFirst=null;
      document.getElementById("twinHint").className="twin-hint";
      updateClaspList();
      renderAllClasps();
    }
    return;
  }

  var existing=claspState[num].findIndex(function(c){return c.type===type;});
  if(existing>=0){
    claspState[num].splice(existing,1);
  } else {
    var t0 = getSavedTransform(num, type) || getInitialTransform(num);
    var newUid = genUid();
    claspState[num].push(Object.assign({uid: newUid, type:type, dir:null}, t0));
    activeClaspUid = newUid;
  }
  updateClaspList();
  renderAllClasps();
}

function renderAllClasps(){
  var svg=document.getElementById("toothSvg");
  var claspLayer=document.getElementById("claspLayer")||svg;
  Array.from(claspLayer.querySelectorAll(".clasp-group")).forEach(function(el){ el.parentNode.removeChild(el); });

  upperTeeth.concat(lowerTeeth).forEach(function(t){
    claspState[t.num].forEach(function(c){
      var label = CLASP_LABELS[c.type] || c.type;
      var color = CLASP_COLORS[c.type] || "#555";
      var tx = (c.cx !== undefined) ? c.cx : t.cx;
      var ty = (c.cy !== undefined) ? c.cy : t.cy;

      var g = document.createElementNS("http://www.w3.org/2000/svg","g");
      g.setAttribute("class", "clasp-group" + (activeClaspUid===c.uid ? " clasp-selected" : ""));
      g.id = "clasp-group-" + c.uid;
      g.setAttribute("transform", "translate("+tx+","+ty+")");

      g.addEventListener("mousedown", function(e){
        e.stopPropagation();
        activeClaspUid = c.uid;
        claspDrag.active = true;
        claspDrag.mode = 'move';
        claspDrag.uid = c.uid;
        claspDrag.num = t.num;
        claspDrag.startX = e.clientX;
        claspDrag.startY = e.clientY;
        claspDrag.initT = {cx: tx, cy: ty};
        renderAllClasps();
      });
      g.addEventListener("touchstart", function(e){
        e.stopPropagation();
        activeClaspUid = c.uid;
        claspDrag.active = true;
        claspDrag.mode = 'move';
        claspDrag.uid = c.uid;
        claspDrag.num = t.num;
        claspDrag.startX = e.touches[0].clientX;
        claspDrag.startY = e.touches[0].clientY;
        claspDrag.initT = {cx: tx, cy: ty};
        renderAllClasps();
      }, {passive:true});

      if(activeClaspUid === c.uid) {
        var bg = document.createElementNS("http://www.w3.org/2000/svg","rect");
        bg.setAttribute("x", "-14"); bg.setAttribute("y", "-14");
        bg.setAttribute("width", "28"); bg.setAttribute("height", "18");
        bg.setAttribute("rx", "3");
        bg.setAttribute("class", "clasp-sel-rect");
        g.appendChild(bg);
      }

      var txt = document.createElementNS("http://www.w3.org/2000/svg","text");
      txt.setAttribute("x", "0");
      txt.setAttribute("y", "0");
      txt.setAttribute("class", "clasp-label");
      txt.setAttribute("fill", color);
      txt.textContent = label;
      g.appendChild(txt);

      claspLayer.appendChild(g);
    });
  });
}

function updateClaspList(){
  var items=[];
  upperTeeth.concat(lowerTeeth).forEach(function(t){
    claspState[t.num].forEach(function(c){
      if(c.isTwin1) return;
      var color=CLASP_COLORS[c.type]||"#555";
      var CLASP_NAMES={"W":"W ワイヤークラスプ","E":"C キャスト鉤","T":"T 双子鉤","R":"R レスト","H":"H フック","C":"CM コンビ鉤","I":"I Iバー","WI":"WI ワイヤーIバー"};
      var label=(CLASP_NAMES[c.type]||c.type);
      if(c.twinWith) label+="("+t.num+"↔"+c.twinWith+")";
      else label+="("+t.num+")";
      items.push({ color: color, label: label });
    });
  });
  var el=document.getElementById("claspList");
  el.textContent = "";
  if (!items.length) {
    var empty = document.createElement("span");
    empty.className = "clasp-list-empty";
    empty.textContent = "—";
    el.appendChild(empty);
    return;
  }
  items.forEach(function(item) {
    var tag = document.createElement("span");
    tag.className = "clasp-tag";
    tag.style.background = item.color;
    tag.textContent = item.label;
    el.appendChild(tag);
  });
}

function resetClasp(){
  upperTeeth.concat(lowerTeeth).forEach(function(t){ claspState[t.num]=[]; });
  twinFirst=null;
  activeClaspUid=null;
  renderAllClasps();
  updateClaspList();
}

function getSVGPt(e){
  var svg=document.getElementById("toothSvg");
  var rect=svg.getBoundingClientRect();
  var cx=e.touches?e.touches[0].clientX:e.clientX;
  var cy=e.touches?e.touches[0].clientY:e.clientY;
  return{x:(cx-rect.left)*600/rect.width,y:(cy-rect.top)*987/rect.height};
}

function buildSVG(){
  var svg=document.getElementById("toothSvg");

  // レイヤー構造を確立（順序 = 描画の重なり順）
  var toothLayer=document.createElementNS("http://www.w3.org/2000/svg","g");
  toothLayer.id="toothLayer";
  var outlineLayer=document.createElementNS("http://www.w3.org/2000/svg","g");
  outlineLayer.id="outlineLayer";
  var claspLayer=document.createElementNS("http://www.w3.org/2000/svg","g");
  claspLayer.id="claspLayer";
  var freeLineLayer=document.createElementNS("http://www.w3.org/2000/svg","g");
  freeLineLayer.id="freeLineLayer";
  svg.appendChild(toothLayer);
  svg.appendChild(outlineLayer);
  svg.appendChild(claspLayer);
  svg.appendChild(freeLineLayer);

  // 手書きモード用の全面ヒットエリア（OFF時は pointer-events:none で無害）
  var hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  hitArea.id = 'drawHitArea';
  hitArea.setAttribute('x', '0');
  hitArea.setAttribute('y', '0');
  hitArea.setAttribute('width', '600');
  hitArea.setAttribute('height', '1070');
  hitArea.setAttribute('fill', 'transparent');
  hitArea.style.pointerEvents = 'none';
  freeLineLayer.appendChild(hitArea);

  upperTeeth.concat(lowerTeeth).forEach(function(t){
    toothState[t.num]=null;
    coords[t.num]={cx:t.cx,cy:t.cy,rx:t.rx,ry:t.ry};
    var g=document.createElementNS("http://www.w3.org/2000/svg","g");
    g.id="g-"+t.num;
    var el=document.createElementNS("http://www.w3.org/2000/svg","ellipse");
    el.setAttribute("cx",t.cx);el.setAttribute("cy",t.cy);
    el.setAttribute("rx",t.rx);el.setAttribute("ry",t.ry);
    el.setAttribute("class","tooth-el");el.id="tooth-"+t.num;
    (function(num){
      el.addEventListener("mousedown",function(e){onMD(e,num);});
      el.addEventListener("touchstart",function(e){onMD(e,num);},{passive:true});
      el.addEventListener("click",function(){clickTooth(num);});
    })(t.num);
    g.appendChild(el);
    var stamp=document.createElementNS("http://www.w3.org/2000/svg","text");
    stamp.setAttribute("x",t.cx);stamp.setAttribute("y",t.cy);
    stamp.setAttribute("class","tooth-stamp");stamp.id="stamp-"+t.num;
    g.appendChild(stamp);
    var numEl=document.createElementNS("http://www.w3.org/2000/svg","text");
    numEl.setAttribute("x",t.cx);numEl.setAttribute("y",t.cy+t.ry+11);
    numEl.setAttribute("class","tooth-num");numEl.textContent=t.num;
    g.appendChild(numEl);
    var enEl=document.createElementNS("http://www.w3.org/2000/svg","text");
    enEl.setAttribute("x",t.cx);enEl.setAttribute("y",t.cy);
    enEl.setAttribute("class","edit-num");enEl.id="en-"+t.num;
    enEl.textContent=t.num;
    g.appendChild(enEl);
    toothLayer.appendChild(g);
  });

  var svgEl=document.getElementById("toothSvg");
  svgEl.addEventListener("mousemove",onMM);
  svgEl.addEventListener("mouseup",onMU);
  svgEl.addEventListener("touchmove",function(e){onMM(e.touches[0]);});
  svgEl.addEventListener("touchend",onMU);

  // クラスプ操作用SVGイベント
  function onClaspDragMove(e){
    if(!claspDrag.active) return;
    e.preventDefault();
    var cx = e.clientX || (e.touches && e.touches[0].clientX);
    var cy = e.clientY || (e.touches && e.touches[0].clientY);
    var dx = cx - claspDrag.startX;
    var dy = cy - claspDrag.startY;

    var rect = svgEl.getBoundingClientRect();
    dx *= 600 / rect.width;
    dy *= 987 / rect.height;

    var c = claspState[claspDrag.num].find(function(item){return item.uid === claspDrag.uid;});
    if(!c) return;

    c.cx = claspDrag.initT.cx + dx;
    c.cy = claspDrag.initT.cy + dy;

    var g = document.getElementById("clasp-group-" + c.uid);
    if(g) {
      g.setAttribute("transform", "translate("+c.cx+","+c.cy+")");
    }
  }

  function onClaspDragEnd(e){
    if(claspDrag.active){
      claspDrag.active = false;
      renderAllClasps();
    }
  }

  svgEl.addEventListener("mousemove", onClaspDragMove);
  svgEl.addEventListener("touchmove", onClaspDragMove, {passive:false});
  window.addEventListener("mouseup", onClaspDragEnd);
  window.addEventListener("touchend", onClaspDragEnd);

  // SVG背景クリックでクラスプ選択解除
  svgEl.addEventListener("mousedown", function(e){
    if(drawMode) return;
    if(e.target === svgEl || e.target.classList.contains("overlay-svg")) {
      if(activeClaspUid) {
        activeClaspUid = null;
        renderAllClasps();
      }
    }
  });
}

function clickTooth(num){
  if(drawMode) return;
  if(currentMode==="edit"||drag.moved)return;

  if(claspMode){
    applyClaspToTooth(num);
    return;
  }

  if(activeClaspUid) {
    activeClaspUid = null;
    renderAllClasps();
  }

  var el=document.getElementById("tooth-"+num);
  var stamp=document.getElementById("stamp-"+num);
  var isEdit=currentMode==="edit";

  if(currentMode==="clear"||toothState[num]===currentMode){
    toothState[num]=null;
    el.setAttribute("class","tooth-el"+(isEdit?" edit-mode":""));
    stamp.setAttribute("class","tooth-stamp");stamp.textContent="";
    if(currentMode==="clear"||currentMode==="missing"){
      syncToShijiChart(num, false);
    }
  } else {
    toothState[num]=currentMode;
    el.setAttribute("class","tooth-el "+currentMode);
    stamp.setAttribute("class","tooth-stamp show "+currentMode);
    stamp.textContent=STAMPS[currentMode];
    if(currentMode==="missing"){
      syncToShijiChart(num, true);
    }
  }
  updateResults();
}

function syncToShijiChart(num, isSelected) {
  if(typeof state === 'undefined' || !state.selectedTeeth) return;
  var chartEl = document.querySelector('.tooth[data-num="' + num + '"]');
  if(!chartEl) return;

  if(isSelected){
    state.selectedTeeth.add(num);
    chartEl.classList.add('selected');
  } else {
    state.selectedTeeth.delete(num);
    chartEl.classList.remove('selected');
  }
  updateTeethDisplay();
}

function onMD(e,num){
  if(drawMode) return;
  if(currentMode!=="edit")return;
  var pt=getSVGPt(e);
  drag.active=true;drag.moved=false;drag.num=num;
  drag.startX=pt.x;drag.startY=pt.y;
  drag.origCx=coords[num].cx;drag.origCy=coords[num].cy;
  document.getElementById("tooth-"+num).classList.add("dragging");
}
function onMM(e){
  if(!drag.active)return;
  var pt=getSVGPt(e);
  var dx=pt.x-drag.startX,dy=pt.y-drag.startY;
  if(Math.abs(dx)>2||Math.abs(dy)>2)drag.moved=true;
  var num=drag.num,nx=Math.round(drag.origCx+dx),ny=Math.round(drag.origCy+dy);
  nx = Math.max(10, Math.min(590, nx));
  ny = Math.max(10, Math.min(1100, ny));
  coords[num].cx=nx;coords[num].cy=ny;
  var el=document.getElementById("tooth-"+num);
  var st=document.getElementById("stamp-"+num);
  var en=document.getElementById("en-"+num);
  var nEl=el.parentNode.querySelector(".tooth-num");
  el.setAttribute("cx",nx);el.setAttribute("cy",ny);
  st.setAttribute("x",nx);st.setAttribute("y",ny);
  if(en){en.setAttribute("x",nx);en.setAttribute("y",ny);}
  if(nEl){nEl.setAttribute("x",nx);nEl.setAttribute("y",ny+coords[num].ry+11);}
}
function onMU(){
  if(!drag.active)return;
  document.getElementById("tooth-"+drag.num).classList.remove("dragging");
  drag.active=false;
  setTimeout(function(){drag.moved=false;},50);
}

document.querySelectorAll(".mode-btn").forEach(function(btn){
  btn.addEventListener("click",function(){
    var mode=btn.getAttribute("data-mode");
    if(mode==="clear"&&currentMode==="clear"){
      resetAll();currentMode="missing";
      document.querySelectorAll(".mode-btn").forEach(function(b){b.classList.remove("active");});
      document.querySelector("[data-mode=missing]").classList.add("active");return;
    }
    document.querySelectorAll(".mode-btn").forEach(function(b){b.classList.remove("active");});
    btn.classList.add("active");currentMode=mode;
    var isEdit=(mode==="edit");
    document.getElementById("editHint").className=isEdit?"edit-hint show":"edit-hint";
    document.getElementById("btnCopy").style.display=isEdit?"inline-block":"none";
    document.body.className=isEdit?"edit-active":"";
    upperTeeth.concat(lowerTeeth).forEach(function(t){
      var el=document.getElementById("tooth-"+t.num);
      var st=toothState[t.num];
      el.setAttribute("class","tooth-el"+(isEdit?" edit-mode":"")+(st?" "+st:""));
    });
  });
});

function updateResults(){
  var g={missing:[],caution:[]};
  upperTeeth.concat(lowerTeeth).forEach(function(t){var m=toothState[t.num];if(m&&g[m])g[m].push(t.num);});
  function fmt(a){a.sort(function(x,y){return x-y;});return a.length?a.join("、"):"<span class=\"re\">—</span>";}
  document.getElementById("r-missing").innerHTML=fmt(g.missing);
  document.getElementById("r-caution").innerHTML=fmt(g.caution);
}
function copyCoords(){
  var lines=[];
  upperTeeth.concat(lowerTeeth).forEach(function(t){
    var c=coords[t.num];
    lines.push("  {num:"+t.num+", cx:"+c.cx+", cy:"+c.cy+", rx:"+c.rx+", ry:"+c.ry+"}");
  });
  var text = lines.join(",\n");
  try {
    navigator.clipboard.writeText(text).then(function(){
      alert("座標をコピーしました！\nClaudeに貼り付けてください。");
    }).catch(function(){
      fallbackCopy(text);
    });
  } catch(e) {
    fallbackCopy(text);
  }
}
function fallbackCopy(text){
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand("copy");
    alert("座標をコピーしました！\nClaudeに貼り付けてください。");
  } catch(e) {
    alert("コピーできませんでした。\n以下をClaudeに貼り付けてください：\n\n" + text);
  }
  document.body.removeChild(ta);
}
function resetAll(){
  var isEdit=currentMode==="edit";
  upperTeeth.concat(lowerTeeth).forEach(function(t){
    toothState[t.num]=null;
    var el=document.getElementById("tooth-"+t.num);
    var st=document.getElementById("stamp-"+t.num);
    if(el)el.setAttribute("class","tooth-el"+(isEdit?" edit-mode":""));
    if(st){st.setAttribute("class","tooth-stamp");st.textContent="";}
  });
  if(typeof state !== 'undefined' && state.selectedTeeth){
    state.selectedTeeth.clear();
    document.querySelectorAll('.tooth.selected').forEach(function(t){ t.classList.remove('selected'); });
    updateTeethDisplay();
  }
  updateResults();
}
buildToothChart();
buildSVG();
initClasp();
initDrawing();
initMemoDrawing();

// ===== 手書き機能 =====
var drawMode = false;
var drawCurrentColor = '#cc2222';
var drawCurrentWidth = 6;
var drawStrokes = [];
var drawActive = false;
var drawPts = [];
var drawPathEl = null;
var eraserMode = false;
var eraserRadius = 20;
var eraserCursorEl = null;
var drawHistory = [];
var drawRedoStack = [];
var drawSnapshot = null;

// ===== 手書きメモ欄（右側）変数 =====
var memoStrokes = [];
var memoDrawActive = false;
var memoDrawPts = [];
var memoDrawPathEl = null;
var memoEraserCursorEl = null;
var memoHistory = [];
var memoRedoStack = [];
var memoSnapshot = null;
var lastActiveZone = 'chart';

function getSVGCoord(e, svgEl) {
  var pt = svgEl.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  return pt.matrixTransform(svgEl.getScreenCTM().inverse());
}

function buildPathD(pts) {
  if (pts.length === 1) {
    return 'M ' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1) +
           ' l 0.1 0';
  }
  var d = 'M ' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
  for (var i = 1; i < pts.length - 1; i++) {
    var mx = ((pts[i].x + pts[i + 1].x) / 2).toFixed(1);
    var my = ((pts[i].y + pts[i + 1].y) / 2).toFixed(1);
    d += ' Q ' + pts[i].x.toFixed(1) + ' ' + pts[i].y.toFixed(1) + ' ' + mx + ' ' + my;
  }
  var last = pts[pts.length - 1];
  d += ' L ' + last.x.toFixed(1) + ' ' + last.y.toFixed(1);
  return d;
}

function eraseAtPoint(pt) {
  var layer = document.getElementById('freeLineLayer');
  if (!layer) return;
  var paths = Array.from(layer.querySelectorAll('.draw-path[data-draw-index]'));
  var beforeCount = drawStrokes.length;
  for (var i = paths.length - 1; i >= 0; i--) {
    try {
      var p = paths[i];
      var idx = parseInt(p.getAttribute('data-draw-index'), 10);
      if (isNaN(idx) || idx < 0 || idx >= drawStrokes.length) continue;
      var strokeWidth = parseFloat(drawStrokes[idx].width) || 6;
      var threshold = eraserRadius + strokeWidth / 2;
      var total = p.getTotalLength();
      if (total === 0) continue;
      var step = 5;
      var hit = false;
      for (var len = 0; len <= total + step; len += step) {
        var svgPt = p.getPointAtLength(Math.min(len, total));
        var dx = svgPt.x - pt.x;
        var dy = svgPt.y - pt.y;
        if (dx * dx + dy * dy <= threshold * threshold) { hit = true; break; }
      }
      if (hit) {
        drawStrokes.splice(idx, 1);
        renderDrawing();
        saveDrawing();
        return;
      }
    } catch(err) {}
  }
}

function initDrawing() {
  var svgEl = document.getElementById('toothSvg');

  // 消しゴムカーソル circle を SVG最前面の専用レイヤーに追加
  var eraserLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  eraserLayer.id = 'eraserLayer';
  eraserLayer.style.pointerEvents = 'none';
  svgEl.appendChild(eraserLayer);
  eraserCursorEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  eraserCursorEl.setAttribute('class', 'eraser-cursor');
  eraserCursorEl.setAttribute('r', '20');
  eraserCursorEl.setAttribute('fill', 'none');
  eraserCursorEl.setAttribute('stroke', '#888');
  eraserCursorEl.setAttribute('stroke-width', '2');
  eraserCursorEl.setAttribute('stroke-dasharray', '4 3');
  eraserCursorEl.style.pointerEvents = 'none';
  eraserCursorEl.style.display = 'none';
  eraserLayer.appendChild(eraserCursorEl);

  svgEl.addEventListener('pointerdown', function(e) {
    if (!drawMode) return;
    e.preventDefault();
    e.stopPropagation();

    // 消しゴムモード：タップしたストロークを削除
    if (eraserMode) {
      eraseAtPoint(getSVGCoord(e, svgEl));
      drawActive = true;
      return;
    }

    // 描画開始時にスナップショット保存（Undo用）
    drawSnapshot = JSON.parse(JSON.stringify(drawStrokes));
    drawActive = true;
    drawPts = [getSVGCoord(e, svgEl)];
    drawPathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    drawPathEl.setAttribute('class', 'draw-path');
    drawPathEl.setAttribute('fill', 'none');
    drawPathEl.setAttribute('stroke', drawCurrentColor);
    drawPathEl.setAttribute('stroke-width', String(drawCurrentWidth));
    drawPathEl.setAttribute('stroke-linecap', 'round');
    drawPathEl.setAttribute('stroke-linejoin', 'round');
    drawPathEl.setAttribute('d', 'M ' + drawPts[0].x.toFixed(1) + ' ' + drawPts[0].y.toFixed(1));
    document.getElementById('freeLineLayer').appendChild(drawPathEl);
    try { svgEl.setPointerCapture(e.pointerId); } catch(err) {}
  });

  svgEl.addEventListener('pointermove', function(e) {
    if (!drawMode || !drawActive) return;
    e.preventDefault();
    if (eraserMode) {
      var pt = getSVGCoord(e, svgEl);
      eraseAtPoint(pt);
      return;
    }
    if (!drawPathEl) return;
    var pt = getSVGCoord(e, svgEl);
    var last = drawPts[drawPts.length - 1];
    var dx = pt.x - last.x, dy = pt.y - last.y;
    if (dx * dx + dy * dy < 9) return;
    drawPts.push(pt);
    drawPathEl.setAttribute('d', buildPathD(drawPts));
  });

  function endDraw() {
    if (!drawActive) return;
    drawActive = false;
    if (drawPts.length > 1 && drawPathEl) {
      // drawPtsを25点単位に分割してdrawStrokesへ push
      var chunkSize = 25;
      for (var start = 0; start < drawPts.length; start += chunkSize) {
        var end = Math.min(start + chunkSize, drawPts.length);
        // 継ぎ目が切れないよう次チャンクの先頭に末尾点を含める
        var chunk = drawPts.slice(start, end);
        if (start > 0) chunk.unshift(drawPts[start - 1]);
        if (chunk.length < 2) continue;
        drawStrokes.push({
          color: drawCurrentColor,
          width: String(drawCurrentWidth),
          d: buildPathD(chunk)
        });
      }
      // Undo履歴に登録
      if (drawSnapshot !== null) {
        drawHistory.push(drawSnapshot);
        drawRedoStack = [];
        drawSnapshot = null;
        updateUndoRedoBtns();
      }
      // 描画中pathを削除してrenderDrawingで正式に描画
      try { document.getElementById('freeLineLayer').removeChild(drawPathEl); } catch(err) {}
      renderDrawing();
      saveDrawing();
    } else if (drawPathEl) {
      try { document.getElementById('freeLineLayer').removeChild(drawPathEl); } catch(err) {}
    }
    drawPathEl = null;
    drawPts = [];
  }

  // passive:false を明示してスクロール抑制を確実に行う
  svgEl.addEventListener('pointermove', function(e) {
    if (drawMode) e.preventDefault();
  }, {passive: false});

  // 消しゴムカーソル追従：drawActive不要、SVG内の全pointermoveで更新
  svgEl.addEventListener('pointermove', function(e) {
    if (!drawMode || !eraserMode) return;
    var pt = getSVGCoord(e, svgEl);
    if (eraserCursorEl) {
      eraserCursorEl.setAttribute('cx', pt.x.toFixed(1));
      eraserCursorEl.setAttribute('cy', pt.y.toFixed(1));
    }
  });

  svgEl.addEventListener('pointerup', endDraw);
  svgEl.addEventListener('pointercancel', function() {
    if (drawActive && drawPts.length > 1 && drawPathEl) {
      endDraw();
    } else {
      drawActive = false;
      if (drawPathEl) {
        try { document.getElementById('freeLineLayer').removeChild(drawPathEl); } catch(err) {}
      }
      drawPathEl = null;
      drawPts = [];
    }
  });

  loadDrawing();
}

function saveDrawing() {
  try {
    localStorage.setItem('dwo_drawing_v1', JSON.stringify({ strokes: drawStrokes, memoStrokes: memoStrokes }));
  } catch(e) {}
}

function loadDrawing() {
  try {
    var raw = localStorage.getItem('dwo_drawing_v1');
    if (!raw) return;
    var data = JSON.parse(raw);
    if (data.strokes) drawStrokes = data.strokes;
    if (data.memoStrokes) memoStrokes = data.memoStrokes;
    renderDrawing();
    renderMemoDrawing();
  } catch(e) {}
}

function renderDrawing() {
  var layer = document.getElementById('freeLineLayer');
  Array.from(layer.querySelectorAll('.draw-path')).forEach(function(el) {
    layer.removeChild(el);
  });
  drawStrokes.forEach(function(s, i) {
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('class', 'draw-path');
    p.setAttribute('data-idx', String(i));
    p.setAttribute('data-draw-index', String(i));
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', s.color);
    p.setAttribute('stroke-width', String(s.width));
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    p.style.pointerEvents = 'stroke';
    p.setAttribute('d', s.d);
    layer.appendChild(p);
  });
}

function undoDrawing() {
  if (lastActiveZone === 'memo') {
    if (memoHistory.length === 0) return;
    memoRedoStack.push(JSON.parse(JSON.stringify(memoStrokes)));
    memoStrokes = memoHistory.pop();
    renderMemoDrawing();
  } else {
    if (drawHistory.length === 0) return;
    drawRedoStack.push(JSON.parse(JSON.stringify(drawStrokes)));
    drawStrokes = drawHistory.pop();
    renderDrawing();
  }
  saveDrawing();
  updateUndoRedoBtns();
}

function redoDrawing() {
  if (lastActiveZone === 'memo') {
    if (memoRedoStack.length === 0) return;
    memoHistory.push(JSON.parse(JSON.stringify(memoStrokes)));
    memoStrokes = memoRedoStack.pop();
    renderMemoDrawing();
  } else {
    if (drawRedoStack.length === 0) return;
    drawHistory.push(JSON.parse(JSON.stringify(drawStrokes)));
    drawStrokes = drawRedoStack.pop();
    renderDrawing();
  }
  saveDrawing();
  updateUndoRedoBtns();
}

function updateUndoRedoBtns() {
  var undoBtn = document.getElementById('undoBtn');
  var redoBtn = document.getElementById('redoBtn');
  var hasUndo = lastActiveZone === 'memo' ? memoHistory.length > 0 : drawHistory.length > 0;
  var hasRedo = lastActiveZone === 'memo' ? memoRedoStack.length > 0 : drawRedoStack.length > 0;
  if (undoBtn) undoBtn.disabled = !hasUndo;
  if (redoBtn) redoBtn.disabled = !hasRedo;
}

function clearDrawing() {
  if (!confirm('手書きをすべて消去しますか？')) return;
  drawStrokes = [];
  renderDrawing();
  saveDrawing();
}

function toggleDrawMode() {
  drawMode = !drawMode;
  var btn = document.getElementById('drawToggleBtn');
  var opts = document.getElementById('drawOptions');
  var svgEl = document.getElementById('toothSvg');
  var chartWrap = svgEl.closest ? svgEl.closest('.chart-wrap') : svgEl.parentElement;
  var hitArea = document.getElementById('drawHitArea');
  var toothLayer = document.getElementById('toothLayer');
  var claspLayer = document.getElementById('claspLayer');
  var outlineLayer = document.getElementById('outlineLayer');
  var memoSvgEl = document.getElementById('memoSvg');
  var memoHitArea = document.getElementById('memoHitArea');
  if (drawMode) {
    btn.textContent = '✏️ 手書き ON';
    btn.classList.add('draw-mode-on');
    if (opts) opts.style.display = 'flex';
    svgEl.style.cursor = 'crosshair';
    svgEl.style.touchAction = 'none';
    if (chartWrap) chartWrap.style.touchAction = 'none';
    if (hitArea) hitArea.style.pointerEvents = 'all';
    // 手書き中は歯・クラスプレイヤーのイベントを抑制してpointermoveを確実に取得
    if (toothLayer) toothLayer.style.pointerEvents = 'none';
    if (claspLayer) claspLayer.style.pointerEvents = 'none';
    if (outlineLayer) outlineLayer.style.pointerEvents = 'none';
    // メモSVGも描画モードに
    if (memoSvgEl) { memoSvgEl.style.cursor = 'crosshair'; memoSvgEl.style.touchAction = 'none'; }
    if (memoHitArea) memoHitArea.style.pointerEvents = 'all';
    updateUndoRedoBtns();
  } else {
    btn.textContent = '✏️ 手書き OFF';
    btn.classList.remove('draw-mode-on');
    if (opts) opts.style.display = 'none';
    svgEl.style.cursor = '';
    svgEl.style.touchAction = '';
    if (chartWrap) chartWrap.style.touchAction = '';
    if (hitArea) hitArea.style.pointerEvents = 'none';
    // 手書きOFF時にレイヤーのpointer-eventsを元に戻す
    if (toothLayer) toothLayer.style.pointerEvents = '';
    if (claspLayer) claspLayer.style.pointerEvents = '';
    if (outlineLayer) outlineLayer.style.pointerEvents = '';
    // メモSVGも戻す
    if (memoSvgEl) { memoSvgEl.style.cursor = ''; memoSvgEl.style.touchAction = ''; }
    if (memoHitArea) memoHitArea.style.pointerEvents = 'none';
    // 消しゴムモードもリセット
    eraserMode = false;
    var eraserBtn = document.getElementById('eraserBtn');
    if (eraserBtn) eraserBtn.classList.remove('active');
    if (eraserCursorEl) eraserCursorEl.style.display = 'none';
    if (memoEraserCursorEl) memoEraserCursorEl.style.display = 'none';
    var sizeGroup = document.getElementById('eraserSizeGroup');
    if (sizeGroup) sizeGroup.style.display = 'none';
  }
}

function toggleEraserMode() {
  eraserMode = !eraserMode;
  var eraserBtn = document.getElementById('eraserBtn');
  var hitArea = document.getElementById('drawHitArea');
  var svgEl = document.getElementById('toothSvg');
  var memoSvgEl2 = document.getElementById('memoSvg');
  if (eraserMode) {
    if (eraserBtn) eraserBtn.classList.add('active');
    svgEl.style.cursor = 'none';
    if (memoSvgEl2) memoSvgEl2.style.cursor = 'none';
    if (hitArea) hitArea.style.pointerEvents = 'all';
    if (eraserCursorEl) {
      eraserCursorEl.setAttribute('r', String(eraserRadius));
      eraserCursorEl.style.display = '';
    }
    if (memoEraserCursorEl) {
      memoEraserCursorEl.setAttribute('r', String(eraserRadius));
      memoEraserCursorEl.style.display = '';
    }
    var sizeGroup = document.getElementById('eraserSizeGroup');
    if (sizeGroup) sizeGroup.style.display = 'flex';
  } else {
    if (eraserBtn) eraserBtn.classList.remove('active');
    svgEl.style.cursor = 'crosshair';
    if (memoSvgEl2) memoSvgEl2.style.cursor = 'crosshair';
    if (hitArea) hitArea.style.pointerEvents = 'all';
    if (eraserCursorEl) eraserCursorEl.style.display = 'none';
    if (memoEraserCursorEl) memoEraserCursorEl.style.display = 'none';
    var sizeGroup = document.getElementById('eraserSizeGroup');
    if (sizeGroup) sizeGroup.style.display = 'none';
  }
}

function setEraserRadius(r, btn) {
  eraserRadius = r;
  if (eraserCursorEl) eraserCursorEl.setAttribute('r', String(eraserRadius));
  if (memoEraserCursorEl) memoEraserCursorEl.setAttribute('r', String(eraserRadius));
  document.querySelectorAll('.eraser-size-btn').forEach(function(b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
}

function setDrawColor(btn) {
  drawCurrentColor = btn.getAttribute('data-color');
  document.querySelectorAll('.draw-color-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
}

function setDrawWidth(btn) {
  drawCurrentWidth = parseInt(btn.getAttribute('data-width'), 10);
  document.querySelectorAll('.draw-width-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
}

// ===== 手書きメモ欄 描画関数 =====
function renderMemoDrawing() {
  if (!memoStrokes) memoStrokes = [];
  var layer = document.getElementById('memoFreeLineLayer');
  if (!layer) return;
  Array.from(layer.querySelectorAll('.draw-path')).forEach(function(el) { layer.removeChild(el); });
  memoStrokes.forEach(function(s, i) {
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('class', 'draw-path');
    p.setAttribute('data-draw-index', String(i));
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', s.color);
    p.setAttribute('stroke-width', String(s.width));
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    p.style.pointerEvents = 'stroke';
    p.setAttribute('d', s.d);
    layer.appendChild(p);
  });
}

function eraseAtPointMemo(pt) {
  var layer = document.getElementById('memoFreeLineLayer');
  if (!layer) return;
  var paths = Array.from(layer.querySelectorAll('.draw-path[data-draw-index]'));
  for (var i = paths.length - 1; i >= 0; i--) {
    try {
      var p = paths[i];
      var idx = parseInt(p.getAttribute('data-draw-index'), 10);
      if (isNaN(idx) || idx < 0 || idx >= memoStrokes.length) continue;
      var strokeWidth = parseFloat(memoStrokes[idx].width) || 6;
      var threshold = eraserRadius + strokeWidth / 2;
      var total = p.getTotalLength();
      if (total === 0) continue;
      var hit = false;
      for (var len = 0; len <= total + 5; len += 5) {
        var svgPt = p.getPointAtLength(Math.min(len, total));
        var dx = svgPt.x - pt.x; var dy = svgPt.y - pt.y;
        if (dx * dx + dy * dy <= threshold * threshold) { hit = true; break; }
      }
      if (hit) { memoStrokes.splice(idx, 1); renderMemoDrawing(); saveDrawing(); return; }
    } catch(err) {}
  }
}

function clearMemoDrawing() {
  if (!confirm('手書きメモをすべて消去しますか？')) return;
  memoStrokes = [];
  renderMemoDrawing();
  saveDrawing();
}

function initMemoDrawing() {
  var svgEl = document.getElementById('memoSvg');
  if (!svgEl) return;

  // Safari向けCSS: スタイルシートだけでは効かない場合があるためインライン直接設定
  svgEl.style.touchAction = 'none';
  svgEl.style.userSelect = 'none';
  svgEl.style.webkitUserSelect = 'none';
  svgEl.style.webkitTouchCallout = 'none';
  svgEl.style.webkitTapHighlightColor = 'transparent';
  var memoWrap = svgEl.parentElement;
  if (memoWrap) {
    memoWrap.style.touchAction = 'none';
    memoWrap.style.userSelect = 'none';
    memoWrap.style.webkitUserSelect = 'none';
    memoWrap.style.webkitTouchCallout = 'none';
  }

  // レイヤー構造
  var freeLineLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  freeLineLayer.id = 'memoFreeLineLayer';
  svgEl.appendChild(freeLineLayer);

  // ヒットエリア（手書きOFF時はpointer-events:none）
  var hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  hitArea.id = 'memoHitArea';
  hitArea.setAttribute('x', '0'); hitArea.setAttribute('y', '0');
  hitArea.setAttribute('width', '400'); hitArea.setAttribute('height', '500');
  hitArea.setAttribute('fill', 'transparent');
  hitArea.style.pointerEvents = 'none';
  freeLineLayer.appendChild(hitArea);

  // 消しゴムカーソル
  var eraserLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  eraserLayer.id = 'memoEraserLayer';
  eraserLayer.style.pointerEvents = 'none';
  svgEl.appendChild(eraserLayer);
  memoEraserCursorEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  memoEraserCursorEl.setAttribute('class', 'eraser-cursor');
  memoEraserCursorEl.setAttribute('r', '20');
  memoEraserCursorEl.setAttribute('fill', 'none');
  memoEraserCursorEl.setAttribute('stroke', '#888');
  memoEraserCursorEl.setAttribute('stroke-width', '2');
  memoEraserCursorEl.setAttribute('stroke-dasharray', '4 3');
  memoEraserCursorEl.style.pointerEvents = 'none';
  memoEraserCursorEl.style.display = 'none';
  eraserLayer.appendChild(memoEraserCursorEl);

  // Safari: TouchEvent も直接抑制（PointerEventと並走してコンテキストメニューを起動させない）
  svgEl.addEventListener('touchstart', function(e) { e.preventDefault(); }, {passive: false});
  svgEl.addEventListener('touchmove',  function(e) { e.preventDefault(); }, {passive: false});
  svgEl.addEventListener('touchend',   function(e) { e.preventDefault(); }, {passive: false});

  // pointerdown: setPointerCapture を drawMode チェックより先に実行（ブラウザに奪わせない）
  svgEl.addEventListener('pointerdown', function(e) {
    e.preventDefault();
    e.stopPropagation();
    // drawMode に関わらず即キャプチャ
    try { svgEl.setPointerCapture(e.pointerId); } catch(err) {}
    if (!drawMode) return;
    lastActiveZone = 'memo';
    if (eraserMode) {
      eraseAtPointMemo(getSVGCoord(e, svgEl));
      memoDrawActive = true;
      return;
    }
    memoSnapshot = JSON.parse(JSON.stringify(memoStrokes));
    memoDrawActive = true;
    memoDrawPts = [getSVGCoord(e, svgEl)];
    memoDrawPathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    memoDrawPathEl.setAttribute('class', 'draw-path');
    memoDrawPathEl.setAttribute('fill', 'none');
    memoDrawPathEl.setAttribute('stroke', drawCurrentColor);
    memoDrawPathEl.setAttribute('stroke-width', String(drawCurrentWidth));
    memoDrawPathEl.setAttribute('stroke-linecap', 'round');
    memoDrawPathEl.setAttribute('stroke-linejoin', 'round');
    memoDrawPathEl.setAttribute('d', 'M ' + memoDrawPts[0].x.toFixed(1) + ' ' + memoDrawPts[0].y.toFixed(1));
    freeLineLayer.appendChild(memoDrawPathEl);
  }, {passive: false});

  // pointermove: 常時 passive:false・常時 preventDefault（スクロール・選択を確実に抑制）
  svgEl.addEventListener('pointermove', function(e) {
    e.preventDefault();
    if (drawMode && eraserMode && memoEraserCursorEl) {
      var pt = getSVGCoord(e, svgEl);
      memoEraserCursorEl.setAttribute('cx', pt.x.toFixed(1));
      memoEraserCursorEl.setAttribute('cy', pt.y.toFixed(1));
    }
    if (!drawMode || !memoDrawActive) return;
    if (eraserMode) { eraseAtPointMemo(getSVGCoord(e, svgEl)); return; }
    if (!memoDrawPathEl) return;
    var pt = getSVGCoord(e, svgEl);
    var last = memoDrawPts[memoDrawPts.length - 1];
    var dx = pt.x - last.x, dy = pt.y - last.y;
    if (dx * dx + dy * dy < 9) return;
    memoDrawPts.push(pt);
    memoDrawPathEl.setAttribute('d', buildPathD(memoDrawPts));
  }, {passive: false});

  function endMemoDraw(e) {
    if (e) {
      e.preventDefault();
      try { if (svgEl.hasPointerCapture(e.pointerId)) svgEl.releasePointerCapture(e.pointerId); } catch(err) {}
    }
    if (!memoDrawActive) return;
    memoDrawActive = false;
    if (memoDrawPts.length > 1 && memoDrawPathEl) {
      var chunkSize = 25;
      for (var start = 0; start < memoDrawPts.length; start += chunkSize) {
        var end = Math.min(start + chunkSize, memoDrawPts.length);
        var chunk = memoDrawPts.slice(start, end);
        if (start > 0) chunk.unshift(memoDrawPts[start - 1]);
        if (chunk.length < 2) continue;
        memoStrokes.push({ color: drawCurrentColor, width: String(drawCurrentWidth), d: buildPathD(chunk) });
      }
      if (memoSnapshot !== null) {
        memoHistory.push(memoSnapshot);
        memoRedoStack = [];
        memoSnapshot = null;
        updateUndoRedoBtns();
      }
      try { freeLineLayer.removeChild(memoDrawPathEl); } catch(err) {}
      renderMemoDrawing();
      saveDrawing();
    } else if (memoDrawPathEl) {
      try { freeLineLayer.removeChild(memoDrawPathEl); } catch(err) {}
    }
    memoDrawPathEl = null;
    memoDrawPts = [];
  }

  svgEl.addEventListener('pointerup', endMemoDraw, {passive: false});
  svgEl.addEventListener('pointercancel', function(e) {
    if (e) {
      e.preventDefault();
      try { if (svgEl.hasPointerCapture(e.pointerId)) svgEl.releasePointerCapture(e.pointerId); } catch(err) {}
    }
    if (memoDrawActive && memoDrawPts.length > 1 && memoDrawPathEl) {
      endMemoDraw();
    } else {
      memoDrawActive = false;
      if (memoDrawPathEl) { try { freeLineLayer.removeChild(memoDrawPathEl); } catch(err) {} }
      memoDrawPathEl = null; memoDrawPts = [];
    }
  }, {passive: false});

  // iPad Safari: コピー/選択メニュー・長押しメニューを抑制
  svgEl.addEventListener('contextmenu', function(e) { e.preventDefault(); });
  svgEl.addEventListener('selectstart', function(e) { e.preventDefault(); });

  renderMemoDrawing();
}

function selectUpperDenture() {
  [17,16,15,14,13,12,11,21,22,23,24,25,26,27].forEach(function(num) {
    if (!state.selectedTeeth.has(num)) {
      var el = document.querySelector('.tooth[data-num="' + num + '"]');
      if (el) toggleTooth(num, el);
    }
  });
}
function selectLowerDenture() {
  [47,46,45,44,43,42,41,31,32,33,34,35,36,37].forEach(function(num) {
    if (!state.selectedTeeth.has(num)) {
      var el = document.querySelector('.tooth[data-num="' + num + '"]');
      if (el) toggleTooth(num, el);
    }
  });
}
