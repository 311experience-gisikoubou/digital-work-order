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
// ワイヤークラスプ専用SVGパス (ワイヤー.svg, viewBox: 0 0 3508 2481)
// 図形の中心 (約 cx=1350, cy=810) を原点に移動するため translate(-1350,-810) を適用
// 外側のtransformでスケールと位置調整を行う（二重スケールにならないよう内部scaleは使用しない）
var WIRE_SVG_PATHS = '<g transform="translate(-1350,-810)">'
  + '<g transform="matrix(1,0,0,1,0.0272578,-5.4213)"><path d="M1271.82,883.917C1268.52,882.796 1256.98,877.126 1243.59,850.342C1238.59,840.355 1239.96,834.227 1242.76,827.7C1245.29,821.811 1250.02,815.403 1246.9,799.772C1244.67,788.648 1246.4,779.523 1250.63,772.297C1256.8,761.788 1268.66,755.053 1283.47,752.824C1316.69,747.824 1364.93,765.808 1382.57,804.605C1387.08,814.518 1385.27,823.719 1381.95,831.717C1380.64,834.893 1379.09,837.836 1377.85,840.491C1377.18,841.923 1376.47,843.127 1376.42,844.227C1376.2,849.731 1376.74,856.206 1376.09,862.699C1374.9,874.56 1370.36,886.453 1354.3,894.482C1352.5,895.381 1349.18,896.244 1345.07,896.805C1338.28,897.734 1328.64,898.187 1323.72,899.171C1319.39,900.037 1315.18,897.225 1314.31,892.895C1313.44,888.565 1316.26,884.347 1320.59,883.481C1325.06,882.587 1333.2,882.055 1339.98,881.309C1343.12,880.963 1345.89,880.799 1347.14,880.172C1356.77,875.359 1359.45,868.208 1360.17,861.099C1360.79,854.945 1360.23,848.805 1360.44,843.588C1360.6,839.645 1363,834.535 1365.74,828.776C1368.12,823.783 1371,817.825 1368,811.226C1353.41,779.119 1313.35,764.508 1285.86,768.645C1276.38,770.072 1268.38,773.666 1264.44,780.389C1261.94,784.65 1261.27,790.075 1262.59,796.634C1266.15,814.437 1262.33,823.501 1258.99,830.689C1257.15,834.646 1255.07,837.535 1257.9,843.186C1264.82,857.027 1269.8,863.614 1273.5,866.773C1275.47,868.447 1276.83,868.681 1277.65,868.939L1280.22,870.065L1282.3,871.746L1283.95,874.21C1285.81,878.216 1284.07,882.975 1280.06,884.832C1277.27,886.126 1274.11,885.67 1271.82,883.917Z"/></g>'
  + '<path d="M1287.44,764.836C1287.34,764.463 1287.04,763.268 1286.4,760.723C1285.33,756.439 1287.94,752.092 1292.22,751.021C1296.51,749.951 1300.85,752.559 1301.92,756.842C1303.22,762.032 1303.12,761.616 1303.19,762.038C1303.62,764.59 1303.62,764.211 1304.21,766.555C1305.28,770.838 1302.67,775.185 1298.39,776.256C1294.1,777.327 1289.76,774.719 1288.69,770.435C1287.95,767.497 1287.95,767.908 1287.44,764.836Z"/>'
  + '<path d="M1353.73,762.62C1360.95,765.756 1375.61,770.124 1390.17,769.174C1404.4,768.245 1418.59,761.789 1424.15,742.302C1430.04,721.688 1429.61,719.007 1433.47,703.158C1430.75,699.762 1426.89,694.486 1421.23,686.148C1418.91,682.734 1419.57,678.119 1422.75,675.49C1425.93,672.862 1430.59,673.082 1433.5,675.999L1446.61,689.106C1449.19,686.19 1452.65,682.519 1457.14,678.182C1460.32,675.118 1465.39,675.21 1468.46,678.388C1471.52,681.567 1471.43,686.635 1468.25,689.7C1457.64,699.933 1454.41,704.936 1452.84,706.904L1451.01,708.84L1449.4,709.938L1448.18,710.425C1445.07,723.705 1445.06,727.381 1439.54,746.698C1431.6,774.473 1411.5,783.816 1391.21,785.14C1372.31,786.373 1353.28,780.18 1345.36,776.387C1342.29,774.916 1340.4,773.434 1339.65,772.627L1338.32,770.769L1337.43,768.145L1337.62,764.671L1338.37,762.856L1339.46,761.356L1340.97,760.058L1342.89,759.109L1345.3,758.644L1348.25,758.855C1350.63,759.271 1352.58,760.699 1353.73,762.62Z"/>'
  + '<path d="M1303.89,758.983C1305.54,758.606 1307.33,758.748 1308.99,759.506C1309.78,759.869 1310.49,760.346 1311.09,760.908C1311.48,760.85 1311.87,760.82 1312.28,760.819C1313.37,760.817 1314.41,761.034 1315.36,761.429C1317.17,760.15 1319.5,759.634 1321.81,760.181C1323.07,760.479 1324.2,761.062 1325.13,761.848C1326.24,761.609 1327.42,761.607 1328.6,761.877C1331.98,762.658 1334.45,765.524 1334.76,768.931C1335.61,768.961 1336.46,769.126 1337.27,769.431C1340.05,770.467 1342.03,772.953 1342.41,775.891C1342.48,776.429 1342.54,777.018 1342.59,777.615C1344.45,778.365 1346.03,779.809 1346.91,781.784C1348.7,785.818 1346.88,790.55 1342.85,792.343C1341.28,793.038 1340,793.43 1338.96,793.633L1335.39,793.772L1333.55,793.346L1332.43,792.823L1331.14,793.358L1328.64,793.646L1326.58,793.334L1324.29,792.349L1324.12,792.22L1324.11,792.239L1322.42,793.437L1320.53,794.181L1320.02,794.245L1319.12,795.418L1317.81,796.362C1317.12,797.123 1316.28,797.758 1315.33,798.217C1313.03,799.319 1310.38,799.254 1308.17,798.104C1307.57,797.908 1306.44,797.517 1305.7,797.141L1302.71,795.03C1301.05,793.467 1299.09,790.886 1297.73,785.814C1297.43,784.677 1294.93,775.164 1294.44,770.291C1294.29,768.768 1294.31,767.497 1294.42,766.605L1295.2,763.789L1296.81,761.422L1299.08,759.737L1302.27,758.825L1303.89,758.983Z"/>'
  + '<path d="M1291.71,742.418C1296.11,742.022 1300,745.27 1300.39,749.668C1300.79,754.065 1297.54,757.957 1293.14,758.353C1271.02,760.347 1260.16,765.33 1255.64,772.192C1252.32,777.235 1253.3,782.88 1254.44,787.178C1255.6,791.506 1257.07,794.965 1257.41,796.691C1259.51,807.172 1256.98,815.315 1254.32,822.405C1253.52,824.534 1252.71,826.535 1252.16,828.481C1251.73,830.021 1251.37,831.485 1251.94,832.998C1259.75,853.824 1261.99,852.677 1280.46,864.991C1284.13,867.441 1285.13,872.412 1282.68,876.085C1280.23,879.759 1275.26,880.753 1271.59,878.304C1248.89,863.172 1246.56,864.209 1236.96,838.616C1234.69,832.561 1235.7,826.706 1238.02,820.309C1240.03,814.745 1243.46,808.49 1241.72,799.829C1241.31,797.762 1239.16,793.118 1238.11,787.474C1236.73,780.063 1237.02,771.372 1242.28,763.391C1248.35,754.174 1261.99,745.095 1291.71,742.418Z"/>'
  + '<path d="M1373.74,792.959C1342.95,766.603 1339.6,769.067 1332.11,767.193C1289.04,756.426 1289.5,755.899 1285.7,755.424C1281.32,754.876 1278.2,750.874 1278.75,746.493C1279.3,742.112 1283.3,738.999 1287.68,739.547C1291.63,740.041 1291.19,740.471 1335.99,751.671C1344.63,753.83 1348.77,750.48 1384.48,781.092C1385.47,781.939 1391.64,789.101 1394.61,798.549C1397.77,808.578 1397.6,820.807 1386.25,830.734C1383.56,833.093 1382.87,836.282 1382.41,839.664C1381.93,843.103 1381.81,846.759 1381.46,850.461C1380.64,859.297 1378.61,868.232 1371.26,876.027C1364.5,883.19 1352.8,889.646 1331.53,893.193C1330.87,893.301 1330.92,893.288 1323.35,894.484C1318.99,895.172 1314.89,892.19 1314.2,887.829C1313.51,883.468 1316.49,879.368 1320.86,878.679C1328.3,877.504 1328.25,877.517 1328.89,877.41C1347.56,874.299 1356.94,869.352 1361.47,862.765C1365.93,856.281 1365.52,848.772 1366.08,841.993C1366.83,832.912 1368.76,824.779 1375.72,818.693C1381.1,813.985 1380.85,808.104 1379.35,803.348C1377.85,798.57 1374.28,793.681 1373.74,792.959Z"/>'
  + '<path d="M1377,814.63C1375.41,808.838 1371.36,793.892 1370.62,789.92C1369.81,785.58 1372.67,781.397 1377.01,780.585C1380.98,779.843 1384.82,782.179 1386.07,785.907C1389.15,782.018 1393.49,778.534 1399.97,774.724C1402.03,773.513 1404.42,773.325 1406.54,774.023C1410.08,770.442 1413.78,765.808 1417.48,759.015C1419.45,755.399 1423.85,753.871 1427.64,755.485C1431.43,757.099 1433.37,761.327 1432.13,765.255C1427.51,779.915 1419.84,787.798 1411.14,796.398C1405.66,801.812 1399.74,807.593 1394.26,816.554C1394.01,817.676 1393.78,818.86 1393.56,820.111C1393.11,822.674 1391.49,824.749 1389.33,825.859C1389.26,826.005 1389.2,826.152 1389.13,826.3C1388.12,828.544 1387.72,829.853 1382.88,856.439C1382.09,860.783 1377.92,863.668 1373.58,862.878C1369.24,862.089 1366.35,857.92 1367.14,853.576C1372.58,823.636 1373.41,822.241 1374.55,819.714C1375.35,817.936 1376.17,816.244 1377,814.63Z"/>'
  + '<g transform="matrix(0.875561,0,0,1.06053,162.188,-48.4411)"><path d="M1313.53,792.388C1315.14,791.717 1318.55,790.235 1320.65,788.892C1325.56,785.751 1330.31,781.949 1333.78,779.6C1336.22,777.954 1338.36,776.859 1339.87,776.354C1344.55,774.795 1349.88,776.664 1351.77,780.525C1353.61,784.297 1351.49,788.584 1347.03,790.232C1346.69,790.459 1343.54,792.537 1341.24,794.227C1335.35,798.544 1327.92,803.831 1321.43,806.176C1316.9,807.809 1312.58,808.217 1308.83,807.48L1304.11,805.834L1300.26,803.005C1296.31,799.055 1294.6,794.159 1293.64,789.03C1293.23,786.876 1292.95,784.686 1292.44,782.6C1292.03,780.857 1291.62,779.141 1290.09,777.911C1286.47,775.014 1286.38,770.235 1289.88,767.245C1293.39,764.255 1299.18,764.18 1302.81,767.077C1307.43,770.779 1309.55,775.634 1310.66,780.957C1311.21,783.625 1311.51,786.42 1312.21,789.069C1312.51,790.23 1312.86,791.372 1313.53,792.388Z"/></g>'
  + '</g>';

var CLASP_SYMBOLS={"W":"__WIRE__","E":"<path d=\"M8,10 L8,50 M8,30 Q22,18 34,30 Q22,42 8,30\" fill=\"none\" stroke=\"CLRCOLOR\" stroke-width=\"3\" stroke-linecap=\"round\"/>","T":"<rect x=\"4\" y=\"8\" width=\"32\" height=\"44\" rx=\"4\" fill=\"none\" stroke=\"CLRCOLOR\" stroke-width=\"3\"/><line x1=\"4\" y1=\"30\" x2=\"36\" y2=\"30\" stroke=\"CLRCOLOR\" stroke-width=\"2\"/>","C":"<path d=\"M8,10 Q20,2 34,10 L34,50 Q20,58 8,50 Z\" fill=\"none\" stroke=\"CLRCOLOR\" stroke-width=\"3\"/><line x1=\"8\" y1=\"30\" x2=\"20\" y2=\"30\" stroke=\"CLRCOLOR\" stroke-width=\"2.5\"/>","H":"<line x1=\"20\" y1=\"5\" x2=\"20\" y2=\"45\" stroke=\"CLRCOLOR\" stroke-width=\"3\"/><line x1=\"8\" y1=\"45\" x2=\"32\" y2=\"45\" stroke=\"CLRCOLOR\" stroke-width=\"3\"/><line x1=\"12\" y1=\"55\" x2=\"28\" y2=\"55\" stroke=\"CLRCOLOR\" stroke-width=\"2.5\"/>","R":"<line x1=\"5\" y1=\"45\" x2=\"35\" y2=\"45\" stroke=\"CLRCOLOR\" stroke-width=\"3.5\" stroke-linecap=\"round\"/><line x1=\"20\" y1=\"45\" x2=\"20\" y2=\"20\" stroke=\"CLRCOLOR\" stroke-width=\"3\"/><line x1=\"10\" y1=\"20\" x2=\"30\" y2=\"20\" stroke=\"CLRCOLOR\" stroke-width=\"3\"/>","I":"<line x1=\"20\" y1=\"8\" x2=\"20\" y2=\"52\" stroke=\"CLRCOLOR\" stroke-width=\"3.5\" stroke-linecap=\"round\"/><line x1=\"13\" y1=\"8\" x2=\"27\" y2=\"8\" stroke=\"CLRCOLOR\" stroke-width=\"2.5\"/>"}; 
var STAMPS={missing:"✕",caution:"!"};
var toothState={},coords={},currentMode="missing";
var drag={active:false,moved:false,num:null,startX:0,startY:0,origCx:0,origCy:0};

// ===== クラスプ管理 =====
var CLASP_COLORS={"W":"#2563a8","E":"#22aa66","T":"#8844cc","C":"#8B4513","H":"#cc2222","R":"#dd7700","I":"#0088aa"};
var claspState={};  // {歯番号: [{uid, type, dir, isTwin1, twinWith, cx, cy, sx, sy, angle}]}
var claspMode=null; // {type, dir}
var twinFirst=null; // 双子鉤の1本目

var activeClaspUid = null;
var claspDrag = { active: false, mode: null, uid: null, num: null, startX: 0, startY: 0, initT: null };

function genUid(){ return Date.now().toString(36)+Math.random().toString(36).substring(2,6); }

// ===== localStorage 保存・復元 =====
function saveClaspState() {
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

  // クラスプボタン → 展開メニュー表示
  document.querySelectorAll(".clasp-btn[data-clasp]").forEach(function(btn){
    btn.addEventListener("click",function(e){
      e.stopPropagation();
      var type=btn.getAttribute("data-clasp");
      document.querySelectorAll(".dir-menu").forEach(function(m){m.classList.remove("show");});
      var menu=document.getElementById("menu-"+type);
      if(menu) menu.classList.add("show");
    });
  });

  // 方向選択
  document.querySelectorAll(".dir-item").forEach(function(item){
    item.addEventListener("click",function(e){
      e.stopPropagation();
      var type=item.getAttribute("data-clasp");
      var dir=item.getAttribute("data-dir");
      claspMode={type:type,dir:dir};
      twinFirst=null;
      document.querySelectorAll(".clasp-btn").forEach(function(b){b.classList.remove("active");});
      document.querySelector(".clasp-btn[data-clasp='"+type+"']").classList.add("active");
      document.querySelectorAll(".dir-menu").forEach(function(m){m.classList.remove("show");});
      document.getElementById("twinHint").className=type==="T"?"twin-hint show":"twin-hint";
      activeClaspUid = null;
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

  document.addEventListener("click",function(){
    document.querySelectorAll(".dir-menu").forEach(function(m){m.classList.remove("show");});
  });

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

  loadClaspState();
}

function getInitialTransform(num, type, dir) {
  var c=coords[num];
  var bb=toothBB[num]||{cx:c.cx,cy:c.cy,x1:c.cx-c.rx,x2:c.cx+c.rx,y1:c.cy-c.ry,y2:c.cy+c.ry};
  var tw=bb.x2-bb.x1; var th=bb.y2-bb.y1;
  var sz=Math.min(tw,th)*0.85;

  if(type === "W") {
    // ワイヤー.svg: translate(-1350,-810) 後の座標範囲は約 -113～+119(幅232), -135～+90(高225)
    // 外側の scale(sx,sy) で 歯のサイズ / 元座標範囲 に合わせる
    var WIRE_WIDTH = 232; // 元SVG座標のおよその幅
    var WIRE_HEIGHT = 225; // 元SVG座標のおよその高さ
    var wScale = sz / Math.max(WIRE_WIDTH, WIRE_HEIGHT); // 歯に合わせたスケール
    var rightTeeth=[18,17,16,15,14,13,12,11,48,47,46,45,44,43,42,41];
    var isRight=rightTeeth.indexOf(num)>=0;
    var flipX = (dir==="M") ? (isRight ? 1 : -1) : (isRight ? -1 : 1);
    // 初期配置: 歯の近心/遠心端に合わせる
    var posX = (dir==="M") ? (isRight ? bb.x2 : bb.x1) : (isRight ? bb.x1 : bb.x2);
    return { cx: posX, cy: bb.cy, sx: flipX*wScale, sy: wScale, angle: 0 };
  }

  var sx=sz/40; var sy=sz/60;
  var rightTeeth=[18,17,16,15,14,13,12,11,48,47,46,45,44,43,42,41];
  var isRight=rightTeeth.indexOf(num)>=0;
  var mesialIsRight=isRight;
  var posX, flipX=1;
  if(dir==="M"){
    posX=mesialIsRight?bb.x2-sz*0.5:bb.x1-sz*0.5;
    flipX=1;
  } else {
    posX=mesialIsRight?bb.x1-sz*0.5:bb.x2-sz*0.5;
    flipX=-1;
  }
  var posY=bb.cy-sz*0.5;
  var cx = posX + (flipX===-1?sz:0) + 20*sx*flipX;
  var cy = posY + 30*sy;
  return { cx: cx, cy: cy, sx: flipX*sx, sy: sy, angle: 0 };
}

function applyClaspToTooth(num){
  if(!claspMode) return;
  var type=claspMode.type, dir=claspMode.dir;

  if(type==="T"){
    if(twinFirst===null){
      twinFirst=num;
      var t1 = getInitialTransform(num, type, dir);
      claspState[num].push(Object.assign({uid: genUid(), type:type, dir:dir, twin:null, isTwin1:true}, t1));
      renderAllClasps();
    } else if(twinFirst!==num){
      var n1=twinFirst;
      var c1 = claspState[n1].find(function(c){return c.type==="T"&&c.isTwin1;});
      if(c1) { c1.isTwin1 = false; c1.twinWith = num; }
      var t2 = getInitialTransform(num, type, dir);
      claspState[num].push(Object.assign({uid: genUid(), type:type, dir:dir, twinWith:n1}, t2));
      twinFirst=null;
      document.getElementById("twinHint").className="twin-hint";
      updateClaspList();
      renderAllClasps();
    }
    return;
  }

  var existing=claspState[num].findIndex(function(c){return c.type===type&&c.dir===dir;});
  if(existing>=0){
    claspState[num].splice(existing,1);
  } else {
    var t0 = getInitialTransform(num, type, dir);
    var newUid = genUid();
    claspState[num].push(Object.assign({uid: newUid, type:type, dir:dir}, t0));
    activeClaspUid = newUid;
  }
  updateClaspList();
  renderAllClasps();
}

function renderAllClasps(){
  var svg=document.getElementById("toothSvg");
  Array.from(svg.querySelectorAll(".clasp-group")).forEach(function(el){ el.parentNode.removeChild(el); });

  upperTeeth.concat(lowerTeeth).forEach(function(t){
    claspState[t.num].forEach(function(c){
      var g=document.createElementNS("http://www.w3.org/2000/svg","g");
      g.setAttribute("class", "clasp-group" + (activeClaspUid===c.uid ? " clasp-selected" : ""));
      g.id = "clasp-group-" + c.uid;
      
      var trans;
      if(c.type === "W") {
        // Wタイプ: ワイヤーSVGは内部でscaleしているので translate(-20,-30)は使わない
        // cx,cy が中心点、scaleを外側に掛けるだけ
        trans = "translate("+c.cx+","+c.cy+") rotate("+c.angle+") scale("+c.sx+","+c.sy+")";
      } else {
        trans = "translate("+c.cx+","+c.cy+") rotate("+c.angle+") scale("+c.sx+","+c.sy+") translate(-20,-30)";
      }
      g.setAttribute("transform", trans);
      
      // 移動イベント
      g.addEventListener("mousedown", function(e){
        e.stopPropagation();
        activeClaspUid = c.uid;
        claspDrag.active = true;
        claspDrag.mode = 'move';
        claspDrag.uid = c.uid;
        claspDrag.num = t.num;
        claspDrag.startX = e.clientX || e.touches[0].clientX;
        claspDrag.startY = e.clientY || e.touches[0].clientY;
        claspDrag.initT = {cx:c.cx, cy:c.cy, sx:c.sx, sy:c.sy, angle:c.angle};
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
        claspDrag.initT = {cx:c.cx, cy:c.cy, sx:c.sx, sy:c.sy, angle:c.angle};
        renderAllClasps();
      }, {passive:true});

      var color=CLASP_COLORS[c.type]||"#555";
      var inner=document.createElementNS("http://www.w3.org/2000/svg","g");
      if(c.type === "W") {
        // ワイヤー.svg の実際の図形を使用（fill色をCLASP_COLORSで着色）
        inner.innerHTML = WIRE_SVG_PATHS.replace(/fill="[^"]*"/g,'').replace(/<g /g,'<g fill="'+color+'" ').replace(/^<g /,'<g fill="'+color+'" ');
        // 全pathにfillを適用するため、子要素にも直接設定
        var wireContainer = document.createElementNS("http://www.w3.org/2000/svg","g");
        wireContainer.setAttribute("fill", color);
        wireContainer.innerHTML = WIRE_SVG_PATHS;
        inner = wireContainer;
      } else {
        var symHtml=(CLASP_SYMBOLS[c.type]||"").replace(/CLRCOLOR/g,color);
        inner.innerHTML = symHtml;
      }
      
      var bbox=document.createElementNS("http://www.w3.org/2000/svg","rect");
      bbox.setAttribute("x", "0"); bbox.setAttribute("y", "0");
      bbox.setAttribute("width", "40"); bbox.setAttribute("height", "60");
      bbox.setAttribute("class", "clasp-bbox");
      
      g.appendChild(bbox);
      g.appendChild(inner);

      if(activeClaspUid === c.uid) {
        var rotLine=document.createElementNS("http://www.w3.org/2000/svg","line");
        rotLine.setAttribute("x1", "20"); rotLine.setAttribute("y1", "0");
        rotLine.setAttribute("x2", "20"); rotLine.setAttribute("y2", "-20");
        rotLine.setAttribute("class", "rot-line");
        g.appendChild(rotLine);
        
        g.appendChild(createHandle(c, t.num, "rot", 20, -20));
        g.appendChild(createHandle(c, t.num, "tl", 0, 0));
        g.appendChild(createHandle(c, t.num, "tr", 40, 0));
        g.appendChild(createHandle(c, t.num, "bl", 0, 60));
        g.appendChild(createHandle(c, t.num, "br", 40, 60));
      }
      svg.appendChild(g);
    });
  });
}

function createHandle(c, num, mode, x, y){
  var h = document.createElementNS("http://www.w3.org/2000/svg","circle");
  var maxScale = Math.max(Math.abs(c.sx), Math.abs(c.sy));
  if(maxScale < 0.01) maxScale = 0.01;
  h.setAttribute("cx", x); h.setAttribute("cy", y);
  h.setAttribute("r", 4 / maxScale); 
  h.setAttribute("class", "clasp-handle " + mode);
  
  var startDrag = function(e){
    e.stopPropagation();
    activeClaspUid = c.uid;
    claspDrag.active = true;
    claspDrag.mode = mode;
    claspDrag.uid = c.uid;
    claspDrag.num = num;
    claspDrag.startX = e.clientX || e.touches[0].clientX;
    claspDrag.startY = e.clientY || e.touches[0].clientY;
    claspDrag.initT = {cx:c.cx, cy:c.cy, sx:c.sx, sy:c.sy, angle:c.angle};
  };
  h.addEventListener("mousedown", startDrag);
  h.addEventListener("touchstart", startDrag, {passive:true});
  return h;
}

function updateClaspList(){
  var items=[];
  upperTeeth.concat(lowerTeeth).forEach(function(t){
    claspState[t.num].forEach(function(c){
      if(c.isTwin1) return;
      var color=CLASP_COLORS[c.type]||"#555";
      var CLASP_NAMES={"W":"キャストE","E":"エーカース","T":"双子鉤","R":"レスト","H":"フック","C":"コンビ鉤","I":"バー"};
      var label=(CLASP_NAMES[c.type]||c.type)+(c.dir?"-"+c.dir:"");
      if(c.twinWith) label+="("+t.num+"↔"+c.twinWith+")";
      else label+="("+t.num+")";
      items.push('<span class="clasp-tag" style="background:'+color+'">'+label+'</span>');
    });
  });
  var el=document.getElementById("claspList");
  el.innerHTML=items.length?items.join(""): "<span class=\"clasp-list-empty\">—</span>";
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
    svg.appendChild(g);
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
    var scaleX = 600 / rect.width;
    var scaleY = 987 / rect.height; // 表示領域高さに合わせて適宜調整
    dx *= scaleX; dy *= scaleY;

    var c = claspState[claspDrag.num].find(function(item){return item.uid === claspDrag.uid;});
    if(!c) return;

    var init = claspDrag.initT;
    if(claspDrag.mode === 'move'){
      c.cx = init.cx + dx;
      c.cy = init.cy + dy;
    } else if(claspDrag.mode === 'rot'){
      var centerPtX = rect.left + (init.cx / scaleX);
      var centerPtY = rect.top + (init.cy / scaleY);
      var ang1 = Math.atan2(claspDrag.startY - centerPtY, claspDrag.startX - centerPtX);
      var ang2 = Math.atan2(cy - centerPtY, cx - centerPtX);
      c.angle = init.angle + (ang2 - ang1) * 180 / Math.PI;
    } else {
      var scaleChangeX = dx / 40;
      var scaleChangeY = dy / 60;
      if(claspDrag.mode === 'tl') { c.sx = init.sx - scaleChangeX; c.sy = init.sy - scaleChangeY; }
      else if(claspDrag.mode === 'tr') { c.sx = init.sx + scaleChangeX; c.sy = init.sy - scaleChangeY; }
      else if(claspDrag.mode === 'bl') { c.sx = init.sx - scaleChangeX; c.sy = init.sy + scaleChangeY; }
      else if(claspDrag.mode === 'br') { c.sx = init.sx + scaleChangeX; c.sy = init.sy + scaleChangeY; }
    }

    var g = document.getElementById("clasp-group-" + c.uid);
    if(g) {
      var trans = "translate("+c.cx+","+c.cy+") rotate("+c.angle+") scale("+c.sx+","+c.sy+") translate(-20,-30)";
      g.setAttribute("transform", trans);
      var maxScale = Math.max(Math.abs(c.sx), Math.abs(c.sy));
      if(maxScale < 0.01) maxScale = 0.01;
      Array.from(g.querySelectorAll(".clasp-handle")).forEach(function(h){ h.setAttribute("r", 4/maxScale); });
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
    if(e.target === svgEl || e.target.classList.contains("overlay-svg")) {
      if(activeClaspUid) {
        activeClaspUid = null;
        renderAllClasps();
      }
    }
  });
}

function clickTooth(num){
  if(currentMode==="edit"||drag.moved)return;

  if(claspMode){
    applyClaspToTooth(num);
    return;
  }
  
  // 歯をクリックした際、もしクラスプが選択中なら選択解除
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
    // 歯式チャートの選択を解除
    if(currentMode==="clear"||currentMode==="missing"){
      syncToShijiChart(num, false);
    }
  } else {
    toothState[num]=currentMode;
    el.setAttribute("class","tooth-el "+currentMode);
    stamp.setAttribute("class","tooth-stamp show "+currentMode);
    stamp.textContent=STAMPS[currentMode];
    // 欠損モードの場合のみ歯式チャートに反映
    if(currentMode==="missing"){
      syncToShijiChart(num, true);
    }
  }
  updateResults();
}

// 歯式図 → 歯式チャート への同期
function syncToShijiChart(num, isSelected) {
  // state.selectedTeethはSetなのでtypeofチェック
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
  // 範囲制限（SVGの表示範囲内に収める）
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
  // clipboardが使えない環境用のフォールバック
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
  // 歯式チャートも同時リセット
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
