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
