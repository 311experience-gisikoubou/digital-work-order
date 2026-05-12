// ============================================================
//  日付ユーティリティ
// ============================================================
function formatDateLabel(dateStr) {
  if (dateStr === 'æ¥ä»æªè¨­å®') return dateStr;
  try {
    const d = new Date(dateStr);
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.floor((d - today) / 86400000);
    const week = ['æ¥','æ','ç«','æ°´','æ¨','é','å'];
    const w = week[d.getDay()];
    const base = `${d.getMonth()+1}/${d.getDate()}(${w})`;
    if (diff === 0) return `æ¬æ¥ ${base}`;
    if (diff === 1) return `ææ¥ ${base}`;
    return base;
  } catch { return dateStr; }
