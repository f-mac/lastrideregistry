// The curated "Recent" layer: hand-verified cases too new for FARS.
// Data contract and publishing rules: /EDITORIAL.md in the repository.
const wrap = document.getElementById('recent-cases');
if (wrap) init();

const STATUS_LINE = {
  unknown: ['Driver status: unknown', ''],
  none_reported: ['No charges reported', ''],
  cited: ['Driver cited', 'amber'],
  charged: ['Driver charged', 'amber'],
  convicted: ['Driver convicted', 'amber'],
  acquitted: ['Driver acquitted', ''],
  sentenced: ['Driver sentenced', 'amber'],
};

function fmtDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const MONTHS = ['January','February','March','April','May','June','July',
    'August','September','October','November','December'];
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

async function init() {
  const { cases } = await fetch('/data/cases.json').then((r) => r.json());
  for (const c of cases) {
    const card = document.createElement('article');
    card.className = 'case-card';
    const names = c.victims.map((v) =>
      v.age != null ? `${v.name}, ${v.age}` : v.name).join(' · ');
    const [statusText, statusTone] = STATUS_LINE[c.driver_status] ?? STATUS_LINE.unknown;
    const flags = [];
    if (c.hit_and_run) flags.push('<span class="case-flag">driver fled the scene</span>');
    if (!c.details_confirmed) flags.push('<span class="case-unconfirmed">details still being confirmed</span>');
    card.innerHTML = `
      <p class="case-when">${fmtDate(c.date)} · ${c.location.city}, ${c.location.state}</p>
      <h3 class="case-names">${names}</h3>
      <p class="case-summary">${c.summary}</p>
      ${flags.length ? `<p class="case-flags">${flags.join(' ')}</p>` : ''}
      <p class="case-status ${statusTone}">${statusText}${c.charges ? ` — ${c.charges}` : ''}
        <span class="case-asof">as of ${fmtDate(c.driver_status_asof)}</span></p>
      <p class="case-sources">${c.sources.map((s) =>
        `<a href="${s.url}" rel="noopener">${s.outlet}</a>`).join(' · ')}</p>
    `;
    wrap.appendChild(card);
  }
}
