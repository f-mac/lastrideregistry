// Landing experience: every death since 2010 replayed as a ride — a line that
// draws at riding speed and stops where the person was killed.
// Coordinate space: us-atlas pre-projected Albers (975x610), points projected
// with the matching d3.geoAlbersUsa parameters.
import { geoAlbersUsa } from 'd3-geo';
import { feature } from 'topojson-client';
import atlas from 'us-atlas/states-albers-10m.json';

const canvas = document.getElementById('ride-canvas');
if (canvas) init();

const AMBER = '#e8a13c';
const BONE = '#ece7dd';
const RED = '#e0503c';
const W = 975;
const H = 610;

async function init() {
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const states = feature(atlas, atlas.objects.states);
  const project = geoAlbersUsa().scale(1300).translate([487.5, 305]);

  const raw = await fetch('/data/points.json').then((r) => r.json());
  // rows: [lon, lat, year, doy, hit_run, dark, age]
  const pts = raw.rows
    .map((r, i) => {
      const xy = project([r[0], r[1]]);
      if (!xy) return null;
      // deterministic pseudo-random approach bearing per point
      const h = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      const ang = (h - Math.floor(h)) * Math.PI * 2;
      return {
        x: xy[0], y: xy[1], year: r[2], doy: r[3], hitRun: r[4] === 1,
        ax: Math.cos(ang), ay: Math.sin(ang),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.year - b.year || a.doy - b.doy);
  const denom = Math.max(1, pts.length - 1);
  pts.forEach((p, i) => (p.t = i / denom));

  const first = pts[0]; // 2010-01-02, Worcester County MD
  const yearStarts = {};
  pts.forEach((p) => { if (!(p.year in yearStarts)) yearStarts[p.year] = p.t; });

  let dpr = 1, vw = 0, vh = 0, fit = { s: 1, tx: 0, ty: 0 };
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    vw = innerWidth;
    vh = innerHeight;
    canvas.width = vw * dpr;
    canvas.height = vh * dpr;
    const mobile = vw < 640;
    // on phones the scene card is a bottom sheet, so the map lives in the
    // top ~55% of the viewport instead of centered
    const s = mobile
      ? Math.min((vw * 0.94) / W, (vh * 0.5) / H)
      : Math.min((vw * 0.92) / W, (vh * 0.82) / H);
    const ty = mobile ? vh * 0.06 : (vh - H * s) / 2 + vh * 0.02;
    fit = { s, tx: (vw - W * s) / 2, ty };
    dirty = true;
  }

  // minimal GeoJSON->canvas path for pre-projected coordinates
  function pathFrom(c) {
    return function draw(g) {
      const poly = (rings) =>
        rings.forEach((ring) => {
          ring.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
          c.closePath();
        });
      if (g.type === 'Polygon') poly(g.coordinates);
      else if (g.type === 'MultiPolygon') g.coordinates.forEach(poly);
    };
  }

  // ---- scroll phases -----------------------------------------------------
  const exp = document.getElementById('experience');
  const hud = document.getElementById('hud');
  const hudYear = hud.querySelector('.hud-year');
  const hudCount = hud.querySelector('.hud-count');
  const scenes = {};
  document.querySelectorAll('.scene').forEach((el) => (scenes[el.dataset.scene] = el));

  // progress through the whole experience block, 0..1
  function marks() {
    const top = exp.offsetTop, total = exp.offsetHeight - vh;
    const at = (el, frac = 0.5) =>
      Math.min(1, Math.max(0, (el.offsetTop + el.offsetHeight * frac - top - vh * 0.5) / total));
    return {
      one: at(scenes.one),
      replayIn: at(scenes.replay, 0.06),
      replayOut: at(scenes.replay, 0.97),
      toll: at(scenes.toll),
      fled: at(scenes.fled),
      end: 1,
    };
  }
  let M = null;

  let scrollP = 0, dirty = true;
  const cue = document.querySelector('#hero .scroll-cue');
  function onScroll() {
    const total = exp.offsetHeight - vh;
    scrollP = Math.min(1, Math.max(0, (scrollY - exp.offsetTop) / total));
    if (cue) {
      // the keyframe animation owns opacity, so it must be disabled to fade
      if (scrollY > 40) { cue.style.animation = 'none'; cue.style.opacity = '0'; }
      else { cue.style.animation = ''; cue.style.opacity = ''; }
    }
    dirty = true;
  }

  const ease = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  const smooth = (x) => x * x * (3 - 2 * x);

  let pulseT = 0;
  function render(now) {
    requestAnimationFrame(render);
    if (!M) M = marks();
    const needsPulse = scrollP > M.toll;
    if (!dirty && !needsPulse) return;
    dirty = false;
    pulseT = now / 1000;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);

    const p = scrollP;
    // timeline position within the replay
    const replayP = reduced ? 1 : smooth(ease(M.replayIn, M.replayOut, p));
    const cutoff = p < M.one * 0.55 ? -1 : replayP;

    // camera: zoomed on the first death until scene one ends, then out to the
    // nation. Log-lerp the zoom and anchor the first point's SCREEN position
    // (center -> its national position) so it never drifts off-frame.
    const zoomOut = reduced ? 1 : smooth(ease(M.one * 0.75, M.replayIn, p));
    const Z0 = 7;
    const z = Math.pow(Z0, 1 - zoomOut);
    // where the first point sits at national zoom (z=1)
    const natX = fit.tx + first.x * fit.s;
    const natY = fit.ty + first.y * fit.s;
    // its screen position now: start centered slightly above the card
    const pX = vw / 2 + (natX - vw / 2) * zoomOut;
    const pY = vh * 0.42 + (natY - vh * 0.42) * zoomOut;
    const cx = first.x - (pX - vw / 2) / (fit.s * z);
    const cy = first.y - (pY - vh / 2) / (fit.s * z);

    ctx.save();
    ctx.translate(vw / 2, vh / 2);
    ctx.scale(fit.s * z, fit.s * z);
    ctx.translate(-cx, -cy);

    // state outlines (skip pre-render when zoomed; draw live for crispness)
    ctx.strokeStyle = '#20242d';
    ctx.lineWidth = 0.8 / (fit.s * z);
    ctx.globalAlpha = 0.55 + 0.45 * zoomOut;
    ctx.beginPath();
    const path = pathFrom(ctx);
    states.features.forEach((f) => path(f.geometry));
    ctx.stroke();
    ctx.globalAlpha = 1;

    // red burns in for the drivers scene, then recedes at the handoff so the
    // bone field returns with red as the honest minority
    const fledIn = smooth(ease(M.toll + (M.fled - M.toll) * 0.25, M.fled, p));
    const fledOut = smooth(ease(M.fled + 0.03, M.fled + (1 - M.fled) * 0.72, p));
    const fledMix = fledIn * (1 - 0.88 * fledOut);
    const px = 1 / (fit.s * z); // one screen pixel in map units
    const dotR = 1.1;

    // ---- the dead: everything before the cutoff --------------------------
    if (cutoff >= 0) {
      const n = Math.floor(cutoff * pts.length);
      ctx.fillStyle = BONE;
      ctx.globalAlpha = fledMix > 0 ? 0.38 - 0.22 * fledMix : 0.38;
      for (let i = 0; i < n; i++) {
        const pt = pts[i];
        if (fledMix > 0 && pt.hitRun) continue;
        ctx.fillRect(pt.x - dotR / 2, pt.y - dotR / 2, dotR, dotR);
      }
      // hit-and-run points burn red in the fled scene
      if (fledMix > 0) {
        const pulse = 0.55 + 0.45 * Math.sin(pulseT * 2.2);
        ctx.fillStyle = RED;
        for (let i = 0; i < n; i++) {
          const pt = pts[i];
          if (!pt.hitRun) continue;
          ctx.globalAlpha = fledMix * (0.5 + 0.5 * pulse);
          const r = dotR * 1.6;
          ctx.fillRect(pt.x - r / 2, pt.y - r / 2, r, r);
        }
      }
      ctx.globalAlpha = 1;

      // ---- the living: rides still in motion near the cutoff -------------
      if (!reduced && cutoff > 0 && cutoff < 1) {
        const win = 0.0045; // trailing window of "still riding" lights
        const lo = Math.max(0, Math.floor((cutoff - win) * pts.length));
        ctx.strokeStyle = AMBER;
        ctx.lineCap = 'round';
        for (let i = lo; i < n; i++) {
          const pt = pts[i];
          const life = (cutoff - pt.t) / win; // 0 fresh -> 1 arriving
          const len = 14 * (1 - life);
          if (len < 0.5) continue;
          ctx.globalAlpha = 0.9 * (1 - life * 0.55);
          ctx.lineWidth = Math.max(1.4 * px, 0.5);
          ctx.beginPath();
          ctx.moveTo(pt.x - pt.ax * len, pt.y - pt.ay * len);
          ctx.lineTo(pt.x, pt.y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }

    // ---- scene one: the first ride --------------------------------------
    const oneP = reduced ? 1 : smooth(ease(M.one * 0.12, M.one * 0.8, p));
    if (oneP > 0 && p < M.replayIn) {
      const total = 26;
      const drawn = total * Math.min(oneP / 0.8, 1);
      const sx = first.x - first.ax * total;
      const sy = first.y - first.ay * total;
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 2.2 * px;
      ctx.lineCap = 'round';
      ctx.shadowColor = AMBER;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + first.ax * drawn, sy + first.ay * drawn);
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (oneP > 0.82) {
        // the line goes out; a soft bone point remains
        const fade = ease(0.82, 1, oneP);
        ctx.fillStyle = BONE;
        ctx.globalAlpha = fade;
        ctx.shadowColor = BONE;
        ctx.shadowBlur = 14;
        const r = 2.6 * px + 1;
        ctx.beginPath();
        ctx.arc(first.x, first.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();

    // ---- HUD -------------------------------------------------------------
    const inReplay = p > M.replayIn && p < M.end - 0.02;
    hud.classList.toggle('on', inReplay);
    if (inReplay) {
      const TOTAL = 13050; // all deaths incl. the ~0.5% FARS couldn't geocode
      const n = Math.floor(Math.min(replayP, 1) * pts.length);
      const yr = pts[Math.max(0, n - 1)]?.year ?? 2010;
      hudYear.textContent = replayP >= 1 ? '2010–2024' : String(yr);
      hudCount.textContent = (replayP >= 1 ? TOTAL : n).toLocaleString();
    }
  }

  addEventListener('resize', () => { M = null; resize(); onScroll(); }, { passive: true });
  addEventListener('scroll', onScroll, { passive: true });
  resize();
  onScroll();
  requestAnimationFrame(render);
}
