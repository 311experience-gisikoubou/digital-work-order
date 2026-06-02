// ============================================================
//  日付ユーティリティ
// ============================================================
function formatDateLabel(dateStr) {
  if (dateStr === '日付未設定') return dateStr;
  try {
    const d = new Date(dateStr);
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.floor((d - today) / 86400000);
    const week = ['日','月','火','水','木','金','土'];
    const w = week[d.getDay()];
    const base = `${d.getMonth()+1}/${d.getDate()}(${w})`;
    if (diff === 0) return `本日 ${base}`;
    if (diff === 1) return `明日 ${base}`;
    return base;
  } catch { return dateStr; }
}

// YYYY-MM-DD 形式の日付を元号表示に変換（曜日付き）
function formatJapaneseEraDate(dateStr) {
  if (!dateStr) return '';
  try {
    var parts = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!parts) return dateStr;
    var y = parseInt(parts[1], 10), m = parseInt(parts[2], 10), day = parseInt(parts[3], 10);
    var d = new Date(y, m - 1, day);
    var weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    var wd = weekdays[d.getDay()];
    var eraName, eraYear;
    if (y > 2019 || (y === 2019 && m >= 5)) {
      eraName = '令和'; eraYear = y - 2018;
    } else if (y > 1989 || (y === 1989 && m >= 1)) {
      eraName = '平成'; eraYear = y - 1988;
    } else {
      eraName = '昭和'; eraYear = y - 1925;
    }
    return eraName + eraYear + '年' + m + '月' + day + '日(' + wd + ')';
  } catch (e) { return dateStr; }
}
