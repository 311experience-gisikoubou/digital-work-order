// ============================================================
//  納期カレンダーシステム v2
// ============================================================
var HOLIDAYS_CACHE = null;
var vcalYear = 0, vcalMonth = 0;
var selectedDeliveryDate = null;
var stdDeliveryDate = null;
var shippingDateGlobal = null;
var nextApDateGlobal = null;

async function fetchHolidays() {
  if (HOLIDAYS_CACHE) return HOLIDAYS_CACHE;
  try {
    var res = await fetch('https://holidays-jp.github.io/api/v1/date.json');
    HOLIDAYS_CACHE = await res.json();
  } catch(e) { HOLIDAYS_CACHE = {}; }
  return HOLIDAYS_CACHE;
}

function isHoliday(dateStr, holidays) {
  if (holidays[dateStr]) return true;
  var d = new Date(dateStr + 'T00:00:00');
  var day = d.getDay();
  if (day === 0 || day === 4 || day === 6) return true;
  var md = dateStr.slice(5);
  if (md >= '08-13' && md <= '08-16') return true;
  if (md >= '12-28' || md <= '01-04') return true;
  return false;
}

function addBizDays(startStr, days, holidays) {
  var d = new Date(startStr + 'T00:00:00');
  var count = 0;
  while (count < days) {
    d.setDate(d.getDate() + 1);
    if (!isHoliday(toDateStr(d), holidays)) count++;
  }
  return toDateStr(d);
}

function countBizDays(fromStr, toStr, holidays) {
  var from = new Date(fromStr + 'T00:00:00');
  var to   = new Date(toStr + 'T00:00:00');
  var count = 0;
  var d = new Date(from);
  d.setDate(d.getDate() + 1);
  while (d <= to) {
    if (!isHoliday(toDateStr(d), holidays)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function toDateStr(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0');
}

function formatDateJP(dateStr) {
  var d = new Date(dateStr + 'T00:00:00');
  var days = ['日','月','火','水','木','金','土'];
  return (d.getMonth()+1) + '月' + d.getDate() + '日（' + days[d.getDay()] + '）';
}

function getStdDays() {
  var insBtn = document.getElementById('btn-insurance');
  return (!insBtn || insBtn.classList.contains('active')) ? 11 : 14;
}

async function onNextApChange() {
  var el = document.getElementById('next-appointment');
  if (!el || !el.value) {
    nextApDateGlobal = null;
  } else {
    nextApDateGlobal = el.value.slice(0, 10);
  }
  if (shippingDateGlobal) {
    await renderVcal();
    if (selectedDeliveryDate) {
      var hols = await fetchHolidays();
      await applyDelivery(selectedDeliveryDate, hols);
    }
  }
}

async function onShippingDateChange() {
  var shippingEl = document.getElementById('shipping-date');
  var today = toDateStr(new Date());
  var shippingStr = shippingEl.value || today;
  if (shippingStr < today) { shippingStr = today; shippingEl.value = today; }

  shippingDateGlobal = shippingStr;
  var holidays = await fetchHolidays();
  var stdDays = getStdDays();

  stdDeliveryDate = addBizDays(shippingStr, stdDays, holidays);
  selectedDeliveryDate = stdDeliveryDate;

  var d = new Date(stdDeliveryDate + 'T00:00:00');
  vcalYear = d.getFullYear();
  vcalMonth = d.getMonth();

  document.getElementById('vcalWrap').style.display = 'block';
  await renderVcal();
  await applyDelivery(selectedDeliveryDate, holidays);
}

async function renderVcal() {
  var holidays = await fetchHolidays();
  var today = toDateStr(new Date());
  var stdDays = getStdDays();

  document.getElementById('vcalMonth').textContent = vcalYear + '年 ' + (vcalMonth+1) + '月';

  var grid = document.getElementById('vcalGrid');
  grid.innerHTML = '';

  var dows = ['日','月','火','水','木','金','土'];
  dows.forEach(function(d,i) {
    var el = document.createElement('div');
    el.className = 'vcal-dow';
    el.textContent = d;
    if (i===0) el.style.color='#e07070';
    if (i===6) el.style.color='#7090e0';
    grid.appendChild(el);
  });

  var firstDay = new Date(vcalYear, vcalMonth, 1).getDay();
  for (var i=0; i<firstDay; i++) {
    var emp = document.createElement('div');
    emp.className = 'vcal-day empty';
    grid.appendChild(emp);
  }

  var daysInMonth = new Date(vcalYear, vcalMonth+1, 0).getDate();
  for (var day=1; day<=daysInMonth; day++) {
    var dateStr = vcalYear + '-' + String(vcalMonth+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
    var el = document.createElement('div');
    el.textContent = day;
    el.setAttribute('data-date', dateStr);
    if (dateStr === today) el.classList.add('vcal-today');

    var cls = 'vcal-day';
    if (isHoliday(dateStr, holidays)) {
      cls += ' holiday';
    } else if (dateStr < today) {
      cls += ' past';
    } else if (nextApDateGlobal && dateStr >= nextApDateGlobal) {
      cls += ' after-nextap';
    } else if (shippingDateGlobal) {
      var biz = countBizDays(shippingDateGlobal, dateStr, holidays);
      if (biz <= 1) cls += ' no-accept';
      else if (biz <= 3) cls += ' hard-urgent';
      else if (biz < stdDays) cls += ' mild-urgent';
      else cls += ' std-delivery';
    }
    el.className = cls;
    if (dateStr === selectedDeliveryDate) el.classList.add('selected');

    (function(ds, isHol, isPast, isAfterAp) {
      el.addEventListener('click', async function() {
        if (isHol || isPast || isAfterAp) return;
        var hols = await fetchHolidays();
        var biz = shippingDateGlobal ? countBizDays(shippingDateGlobal, ds, hols) : 999;
        if (biz <= 1) {
          if (!confirm('この日は通常受注不可です。急ぎ強行（¥10,000）で進めますか？')) return;
        }
        selectedDeliveryDate = ds;
        await renderVcal();
        await applyDelivery(ds, hols);
      });
    })(dateStr, isHoliday(dateStr, holidays), dateStr < today, nextApDateGlobal && dateStr >= nextApDateGlobal);

    grid.appendChild(el);
  }
}

async function applyDelivery(dateStr, holidays) {
  document.getElementById('delivery-date').value = dateStr;
  var result   = document.getElementById('deliveryResult');
  var drDate   = document.getElementById('drDate');
  var drBiz    = document.getElementById('drBizDays');
  var drFee    = document.getElementById('drFee');
  var drWarn   = document.getElementById('drWarning');
  var saveMsg  = document.getElementById('saveMsgEl');
  var submitBtn = document.getElementById('submit-btn');

  var stdDays = getStdDays();
  var bizDays = shippingDateGlobal ? countBizDays(shippingDateGlobal, dateStr, holidays) : stdDays;
  var isStd = (dateStr === stdDeliveryDate);

  drDate.textContent = formatDateJP(dateStr);
  drBiz.textContent = '発送後 ' + bizDays + ' 営業日' + (isStd ? '（推薦納品日）' : '');
  saveMsg.className = 'save-msg';

  var fee = 0;
  if (bizDays <= 1) {
    fee = 10000;
    result.className = 'delivery-result danger';
    drFee.textContent = '¥10,000'; drFee.className = 'dr-fee danger';
    drWarn.textContent = '⚫ 受注不可日のため急ぎ強行対応（¥10,000）として処理します。';
    drWarn.className = 'dr-warning danger show';
    submitBtn.disabled = false;
  } else if (bizDays <= 3) {
    fee = 10000;
    result.className = 'delivery-result danger';
    drFee.textContent = '¥10,000'; drFee.className = 'dr-fee danger';
    drWarn.innerHTML = '🟠 <strong>緊急対応！</strong> 残り' + bizDays + '営業日のため急ぎ料金 ¥10,000 が加算されます。';
    drWarn.className = 'dr-warning danger show';
    submitBtn.disabled = false;
  } else if (bizDays < stdDays) {
    var shortfall = stdDays - bizDays;
    fee = shortfall * 1000;
    result.className = 'delivery-result urgent';
    drFee.textContent = '¥' + fee.toLocaleString(); drFee.className = 'dr-fee urgent';
    drWarn.textContent = '🟡 急ぎ対応（標準より' + shortfall + '日短縮）急ぎ料金 ¥' + fee.toLocaleString() + ' が加算されます。';
    drWarn.className = 'dr-warning urgent show';
    saveMsg.textContent = '💡 標準納期（' + formatDateJP(stdDeliveryDate) + '）を選ぶと¥' + fee.toLocaleString() + '節約できます';
    saveMsg.className = 'save-msg show';
    submitBtn.disabled = false;
  } else {
    fee = 0;
    result.className = 'delivery-result normal';
    drFee.textContent = '¥0'; drFee.className = 'dr-fee normal';
    drWarn.className = 'dr-warning';
    submitBtn.disabled = false;
  }
  window._urgentFee = fee;
  window._urgentFlag = fee > 0;
}

function vcalPrev() {
  vcalMonth--;
  if (vcalMonth < 0) { vcalMonth = 11; vcalYear--; }
  renderVcal();
}
function vcalNext() {
  vcalMonth++;
  if (vcalMonth > 11) { vcalMonth = 0; vcalYear++; }
  renderVcal();
}

// 保険/自費切替連動
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('submit-btn').disabled = true;
  fetchHolidays();
  setTimeout(function() {
    document.querySelectorAll('.ins-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        setTimeout(onShippingDateChange, 50);
      });
    });
  }, 500);
});
