// Sxarf AI Admin — motion, toasts, command palette, exports
(() => {
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const appOn = () => !$('#app-view').classList.contains('hidden');

// ---- toasts (replaces alert popups)
const host = Object.assign(document.createElement('div'), { className: 'toasts' });
document.body.append(host);
function toast(msg, type) {
  type = type || (/error|could not|failed|denied|no account|several|required|invalid|enter /i.test(msg) ? 'err' : 'ok');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `<span class="toast-ico">${type === 'err' ? '!' : '✓'}</span><span></span><i class="toast-bar"></i>`;
  t.children[1].textContent = String(msg);
  host.append(t);
  const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300); };
  t.onclick = kill; setTimeout(kill, 3600);
}
window.alert = toast; window.toast = toast;

// ---- count-up stats, skeleton loaders
function countUp(el) {
  if (el._busy) return;
  const to = parseInt(el.textContent.replace(/\D/g, ''), 10);
  if (isNaN(to) || el._v === to) return;
  const from = el._v || 0; el._v = to;
  if (reduce) return;
  const t0 = performance.now(), d = 900; el._busy = 1;
  (function f(t) {
    const p = Math.min((t - t0) / d, 1), e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * e).toLocaleString();
    if (p < 1) requestAnimationFrame(f); else el._busy = 0;
  })(t0);
}
new MutationObserver(ms => {
  for (const m of ms) {
    const n = m.target.nodeType === 3 ? m.target.parentElement : m.target;
    if (!n) continue;
    const sv = n.closest && n.closest('.stat-value'); if (sv) countUp(sv);
    $$('td[colspan]', n).forEach(td => {
      if (/^Loading/.test(td.textContent.trim()) && !td.querySelector('.sk'))
        td.innerHTML = '<span class="sk" style="width:70%"></span><span class="sk" style="width:45%"></span><span class="sk" style="width:60%"></span>';
    });
  }
}).observe(document.body, { subtree: true, childList: true, characterData: true });

// ---- spotlight + ripple
document.addEventListener('mousemove', e => {
  const c = e.target.closest && e.target.closest('.stat-card,.card'); if (!c) return;
  const r = c.getBoundingClientRect(); c.style.setProperty('--mx', e.clientX - r.left + 'px'); c.style.setProperty('--my', e.clientY - r.top + 'px');
});
document.addEventListener('click', e => {
  const b = e.target.closest('.btn'); if (!b || reduce) return;
  const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height), i = document.createElement('span');
  i.className = 'ripple'; i.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
  b.append(i); setTimeout(() => i.remove(), 600);
});

// ---- copy IDs, export CSV, copy codes
const copy = async (txt, msg) => { try { await navigator.clipboard.writeText(txt); toast(msg || 'Copied to clipboard'); } catch { toast('Copy failed'); } };
document.addEventListener('click', e => { const s = e.target.closest('#accounts-table-body small'); if (s) copy(s.textContent.trim(), 'User ID copied'); });

function toCSV(table) {
  const rows = $$('tr', table).filter(r => !$('[colspan]', r)).map(r => $$('th,td', r).map(c => '"' + c.innerText.replace(/\s+/g, ' ').trim().replace(/"/g, '""') + '"').join(','));
  return rows.join('\n');
}
$$('.table-container').forEach(tc => {
  const bar = document.createElement('div'); bar.className = 'table-actions';
  const b = Object.assign(document.createElement('button'), { className: 'btn btn-secondary btn-sm', textContent: 'Export CSV' });
  b.onclick = () => {
    const csv = toCSV($('table', tc));
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `sxarf-${tc.closest('section').id.replace('tab-', '')}-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click(); toast('CSV exported');
  };
  bar.append(b); tc.before(bar);
});
const out = $('#gc-generated-output');
if (out) {
  const b = Object.assign(document.createElement('button'), { className: 'btn btn-secondary btn-sm', textContent: 'Copy codes', style: 'margin-top:12px' });
  b.onclick = () => out.value ? copy(out.value, 'Codes copied') : toast('Nothing to copy yet', 'err');
  out.after(b);
  $('#gc-generate-btn').addEventListener('click', () => { const before = out.value; setTimeout(() => { if (out.value && out.value !== before) burst(); }, 1200); });
}
function burst() {
  if (reduce) return;
  for (let i = 0; i < 36; i++) {
    const p = document.createElement('i'); p.className = 'conf';
    p.style.cssText = `left:50%;top:40%;--x:${(Math.random() - .5) * 600}px;--y:${Math.random() * 420 - 120}px;--r:${Math.random() * 720}deg;opacity:${.4 + Math.random() * .6};border-radius:${Math.random() > .5 ? '50%' : '2px'}`;
    document.body.append(p); setTimeout(() => p.remove(), 1400);
  }
}

// ---- live overview (auto-refresh + timestamp)
const hdr = $('#tab-overview .content-header');
hdr.insertAdjacentHTML('beforeend', '<div class="live"><i></i>Live · updated <span id="live-ts">just now</span><button class="btn btn-secondary btn-sm" id="ov-refresh" style="margin-left:8px">Refresh</button></div>');
let stamp = Date.now();
const orig = window.loadOverviewStats;
if (orig) window.loadOverviewStats = async (...a) => { await orig(...a); stamp = Date.now(); };
$('#ov-refresh').onclick = async () => { await window.loadOverviewStats(); toast('Overview refreshed'); };
setInterval(() => {
  const s = Math.round((Date.now() - stamp) / 1000); $('#live-ts').textContent = s < 5 ? 'just now' : s < 60 ? s + 's ago' : Math.round(s / 60) + 'm ago';
  if (appOn() && $('#tab-overview').classList.contains('active') && s >= 30) window.loadOverviewStats();
}, 5000);

// ---- command palette (Ctrl/Cmd+K or "/")
const isMac = /Mac/.test(navigator.platform);
function palette() {
  if ($('.pal-back') || !appOn()) return;
  const items = $$('.nav-item').map(a => ({ l: 'Go to ' + $('span', a).textContent, k: '↵', f: () => a.click() }));
  items.push({ l: 'Refresh current page', k: 'R', f: () => { const t = $('.nav-item.active').dataset.tab; window.loadTabData(t); toast('Refreshed'); } },
    { l: 'Search accounts', k: '↵', f: () => { $('[data-tab=accounts]').click(); setTimeout(() => $('#account-search-input').focus(), 80); } },
    { l: 'Sign out', k: '⏻', f: () => $('#logout-btn').click() });
  const back = document.createElement('div'); back.className = 'pal-back';
  back.innerHTML = '<div class="pal"><input placeholder="Type a command…" autofocus><ul></ul></div>';
  document.body.append(back);
  const inp = $('input', back), ul = $('ul', back); let sel = 0, list = items;
  const draw = () => { ul.innerHTML = ''; list.forEach((it, i) => { const li = document.createElement('li'); li.className = i === sel ? 'sel' : ''; li.innerHTML = `<span></span><kbd>${it.k}</kbd>`; li.firstChild.textContent = it.l; li.onclick = () => run(it); li.onmousemove = () => { sel = i; $$('li', ul).forEach((x, j) => x.classList.toggle('sel', j === i)); }; ul.append(li); }); };
  const close = () => back.remove(), run = it => { close(); it.f(); };
  inp.oninput = () => { const q = inp.value.toLowerCase(); list = items.filter(i => i.l.toLowerCase().includes(q)); sel = 0; draw(); };
  inp.onkeydown = e => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { sel = (sel + 1) % list.length; draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = (sel - 1 + list.length) % list.length; draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && list[sel]) run(list[sel]);
  };
  back.onclick = e => { if (e.target === back) close(); };
  draw(); inp.focus();
}
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette(); }
  else if (e.key === '/' && !typing) { e.preventDefault(); palette(); }
});
document.body.insertAdjacentHTML('beforeend', `<div class="hint-bar"><span class="kbd">${isMac ? '⌘' : 'Ctrl'} K</span> command palette</div>`);
})();
