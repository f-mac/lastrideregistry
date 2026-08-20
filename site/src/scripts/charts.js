// The pattern: four charts, hand-rolled SVG. Single hue per chart —
// amber for magnitude, red reserved for hit-and-run. Hover tooltips on all.
const grid = document.getElementById('charts');
if (grid) init();

const AMBER = '#e8a13c';
const RED = '#e0503c';
const BONE = '#ece7dd';
const INK2 = '#9aa0a8';
const NS = 'http://www.w3.org/2000/svg';
const tooltip = document.getElementById('tooltip');

function showTip(html, x, y) {
  tooltip.innerHTML = html;
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
  tooltip.style.opacity = 1;
}
function hideTip() { tooltip.style.opacity = 0; }

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function card(title, sub) {
  const c = document.createElement('div');
  c.className = 'chart-card';
  c.innerHTML = `<h3>${title}</h3><p class="chart-sub">${sub}</p>`;
  grid.appendChild(c);
  return c;
}

function tableView(card, headers, rows) {
  const d = document.createElement('details');
  d.innerHTML =
    `<summary>view as table</summary><table><tr>${headers
      .map((h) => `<th>${h}</th>`) .join('')}</tr>` +
    rows.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('') +
    '</table>';
  card.appendChild(d);
}

async function init() {
  const agg = await fetch('/data/aggregates.json').then((r) => r.json());
  const years = Object.keys(agg.years).map(Number).sort();
  const deaths = years.map((y) => agg.years[y].deaths);
  const hrShare = years.map((y) => agg.years[y].hit_run / agg.years[y].deaths);

  lineChart({
    el: card('Deaths per year', 'US cyclists killed in motor-vehicle crashes'),
    years, values: deaths, color: AMBER, fmt: (v) => v.toLocaleString(),
    yTicks: [600, 800, 1000, 1200],
    note: null,
  });

  lineChart({
    el: card('The share who fled', 'Hit-and-run crashes as % of cyclist deaths'),
    years, values: hrShare, color: RED, fmt: (v) => (v * 100).toFixed(1) + '%',
    yTicks: [0.14, 0.18, 0.22], pct: true,
  });

  barChart({
    el: card('What struck them', 'Striking vehicle, where attributable, 2010–2024'),
    data: Object.entries(agg.striking_vehicle),
    color: AMBER,
  });

  histChart({
    el: card('Who they were', 'Victim age at death, 2010–2024'),
    data: agg.age_hist,
    color: AMBER,
  });
}

// ---- line chart -----------------------------------------------------------
function lineChart({ el, years, values, color, fmt, yTicks, pct }) {
  const W = 440, H = 240, m = { t: 18, r: 52, b: 26, l: 40 };
  const x = (i) => m.l + (i / (years.length - 1)) * (W - m.l - m.r);
  const lo = Math.min(...values) * 0.92, hi = Math.max(...values) * 1.05;
  const y = (v) => H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  yTicks.forEach((t) => {
    svg.appendChild(svgEl('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: 'grid-line' }));
    const lbl = svgEl('text', { x: m.l - 6, y: y(t) + 3, 'text-anchor': 'end', class: 'axis-label' });
    lbl.textContent = pct ? Math.round(t * 100) + '%' : t.toLocaleString();
    svg.appendChild(lbl);
  });
  [0, Math.floor(years.length / 2), years.length - 1].forEach((i) => {
    const lbl = svgEl('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'axis-label' });
    lbl.textContent = years[i];
    svg.appendChild(lbl);
  });

  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
  svg.appendChild(svgEl('path', { d: `${d}L${x(values.length - 1)},${H - m.b}L${x(0)},${H - m.b}Z`,
    fill: color, opacity: 0.07 }));
  svg.appendChild(svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  // endpoint direct label + marker
  const li = values.length - 1;
  svg.appendChild(svgEl('circle', { cx: x(li), cy: y(values[li]), r: 3.5, fill: color,
    stroke: '#12151b', 'stroke-width': 2 }));
  const end = svgEl('text', { x: x(li) + 8, y: y(values[li]) + 4, class: 'direct-label', fill: BONE });
  end.textContent = fmt(values[li]);
  svg.appendChild(end);

  // hover crosshair
  const ch = svgEl('line', { y1: m.t, y2: H - m.b, stroke: INK2, 'stroke-width': 1,
    'stroke-dasharray': '2,3', opacity: 0 });
  const dot = svgEl('circle', { r: 4, fill: color, stroke: '#12151b', 'stroke-width': 2, opacity: 0 });
  svg.appendChild(ch); svg.appendChild(dot);
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(years.length - 1,
      Math.round(((px - m.l) / (W - m.l - m.r)) * (years.length - 1))));
    ch.setAttribute('x1', x(i)); ch.setAttribute('x2', x(i)); ch.setAttribute('opacity', 0.5);
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(values[i])); dot.setAttribute('opacity', 1);
    showTip(`<span class="tt-dim">${years[i]}</span><br/>${fmt(values[i])}`, e.clientX, e.clientY);
  });
  svg.addEventListener('pointerleave', () => {
    ch.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); hideTip();
  });

  el.appendChild(svg);
  tableView(el, ['year', 'value'], years.map((yr, i) => [yr, fmt(values[i])]));
}

// ---- horizontal bars ------------------------------------------------------
function barChart({ el, data, color }) {
  data.sort((a, b) => b[1] - a[1]);
  const W = 440, rowH = 30, m = { t: 6, r: 60, b: 4, l: 118 };
  const H = m.t + m.b + data.length * rowH;
  const max = Math.max(...data.map((d) => d[1]));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  data.forEach(([label, v], i) => {
    const yy = m.t + i * rowH + 6;
    const w = Math.max(4, ((W - m.l - m.r) * v) / max);
    const name = svgEl('text', { x: m.l - 8, y: yy + 12, 'text-anchor': 'end', class: 'axis-label' });
    name.textContent = label;
    svg.appendChild(name);
    const bar = svgEl('rect', { x: m.l, y: yy, width: w, height: 16, fill: color, rx: 2 });
    svg.appendChild(bar);
    const val = svgEl('text', { x: m.l + w + 8, y: yy + 12, class: 'direct-label', fill: BONE });
    val.textContent = v.toLocaleString();
    svg.appendChild(val);
    bar.addEventListener('pointermove', (e) =>
      showTip(`<span class="tt-dim">${label}</span><br/>${v.toLocaleString()} deaths`, e.clientX, e.clientY));
    bar.addEventListener('pointerleave', hideTip);
  });
  el.appendChild(svg);
  const note = document.createElement('p');
  note.className = 'chart-sub';
  note.style.marginTop = '0.6rem';
  note.textContent = 'SUVs + pickups together now exceed cars. Unattributable multi-vehicle crashes excluded.';
  el.appendChild(note);
  tableView(el, ['vehicle', 'deaths'], data.map(([l, v]) => [l, v.toLocaleString()]));
}

// ---- age histogram --------------------------------------------------------
function histChart({ el, data, color }) {
  const bins = Object.entries(data).map(([b, v]) => [Number(b), v]).sort((a, b) => a[0] - b[0]);
  const W = 440, H = 240, m = { t: 16, r: 10, b: 30, l: 10 };
  const max = Math.max(...bins.map((b) => b[1]));
  const bw = (W - m.l - m.r) / bins.length;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  bins.forEach(([b, v], i) => {
    const h = ((H - m.t - m.b) * v) / max;
    const bar = svgEl('rect', {
      x: m.l + i * bw + 1, y: H - m.b - h, width: bw - 2, height: h, fill: color, rx: 2,
      opacity: v === max ? 1 : 0.75,
    });
    svg.appendChild(bar);
    const lbl = svgEl('text', { x: m.l + i * bw + bw / 2, y: H - 10, 'text-anchor': 'middle', class: 'axis-label' });
    lbl.textContent = b + 's';
    svg.appendChild(lbl);
    if (v === max) {
      const top = svgEl('text', { x: m.l + i * bw + bw / 2, y: H - m.b - h - 8,
        'text-anchor': 'middle', class: 'direct-label', fill: BONE });
      top.textContent = v.toLocaleString();
      svg.appendChild(top);
    }
    bar.addEventListener('pointermove', (e) =>
      showTip(`<span class="tt-dim">age ${b}–${b + 9}</span><br/>${v.toLocaleString()} deaths`, e.clientX, e.clientY));
    bar.addEventListener('pointerleave', hideTip);
  });
  el.appendChild(svg);
  tableView(el, ['age band', 'deaths'], bins.map(([b, v]) => [`${b}–${b + 9}`, v.toLocaleString()]));
}
