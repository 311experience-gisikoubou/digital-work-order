// ============================================================
//  トースト
// ============================================================
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show${type === 'error' ? ' error' : ''}`;
  setTimeout(() => { el.className = 'toast'; }, 3500);
}
