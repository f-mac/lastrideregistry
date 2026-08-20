// The registry map: every geocoded death as a white bike glyph.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const el = document.getElementById('registry-map');
if (el) init();

const MONTHS = ['January','February','March','April','May','June','July',
  'August','September','October','November','December'];

function dateFromDoy(year, doy) {
  const d = new Date(Date.UTC(year, 0, doy));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${year}`;
}

// white bike glyph drawn once onto a canvas -> map icon
function bikeIcon(size = 44) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const u = size / 24;
  x.strokeStyle = '#ece7dd';
  x.lineWidth = 1.7 * u;
  x.lineCap = 'round';
  x.lineJoin = 'round';
  // wheels
  x.beginPath(); x.arc(6.5 * u, 16 * u, 4.2 * u, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.arc(17.5 * u, 16 * u, 4.2 * u, 0, Math.PI * 2); x.stroke();
  // frame, seat, handlebars
  const p = new Path2D();
  const M = (a, b) => p.moveTo(a * u, b * u);
  const L = (a, b) => p.lineTo(a * u, b * u);
  M(6.5, 16); L(10.5, 8.5); L(15.5, 8.5); L(17.5, 16);
  M(10.5, 8.5); L(12.5, 16); L(6.5, 16);
  M(9.2, 7); L(11.8, 7); L(10.5, 8.5);
  M(15.5, 8.5); L(14.7, 6.2); L(16.6, 5.6);
  x.stroke(p);
  return x.getImageData(0, 0, size, size);
}

async function init() {
  const raw = await fetch('/data/points.json').then((r) => r.json());
  const { states, vehicles } = raw;

  const features = raw.rows.map((r, i) => ({
    type: 'Feature',
    id: i,
    geometry: { type: 'Point', coordinates: [r[0], r[1]] },
    properties: {
      year: r[2], doy: r[3], hitRun: r[4], dark: r[5], age: r[6],
      sex: r[7], st: r[8], veh: r[9],
    },
  }));

  const map = new maplibregl.Map({
    container: el,
    style: {
      version: 8,
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: {
        carto: {
          type: 'raster',
          tiles: [
            'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
            'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
            'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
          ],
          tileSize: 256,
          attribution:
            '© <a href="https://carto.com/attributions">CARTO</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0b0d10' } },
        { id: 'carto', type: 'raster', source: 'carto',
          paint: { 'raster-opacity': 0.85, 'raster-saturation': -0.4 } },
      ],
    },
    center: [-96.5, 38.6],
    zoom: 3.4,
    minZoom: 3,
    maxZoom: 17,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.scrollZoom.disable();
  map.on('click', () => map.scrollZoom.enable());
  map.getCanvas().addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) map.scrollZoom.enable();
  });

  map.on('load', () => {
    map.addImage('bike', bikeIcon(), { pixelRatio: 2 });

    map.addSource('deaths', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
      cluster: true,
      clusterRadius: 34,
      clusterMaxZoom: 8,
    });

    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'deaths',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#ece7dd',
        'circle-opacity': 0.14,
        'circle-stroke-color': '#ece7dd',
        'circle-stroke-opacity': 0.55,
        'circle-stroke-width': 1,
        'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'],
          2, 8, 50, 16, 300, 26, 1200, 38],
      },
    });
    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'deaths',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-size': 11,
        'text-font': ['Noto Sans Regular'],
      },
      paint: { 'text-color': '#ece7dd' },
    });
    map.addLayer({
      id: 'death-glyphs',
      type: 'symbol',
      source: 'deaths',
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': 'bike',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.42, 10, 0.6, 14, 0.85],
        'icon-allow-overlap': true,
      },
      paint: {
        'icon-opacity': 0.92,
      },
    });

    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '280px' });

    map.on('click', 'death-glyphs', (e) => {
      const f = e.features[0];
      const p = f.properties;
      const bits = [];
      const who = [
        p.age >= 0 ? `${p.age}-year-old` : 'Age unknown',
        p.sex === 1 ? 'man' : p.sex === 2 ? 'woman' : 'person',
      ].join(' ');
      bits.push(`<div class="popup-date">${dateFromDoy(p.year, p.doy)}</div>`);
      bits.push(`${who} · ${states[p.st]}`);
      if (p.veh >= 0) bits.push(`Struck by: ${vehicles[p.veh]}`);
      if (p.dark) bits.push('After dark');
      if (p.hitRun) bits.push('<span class="popup-flag">Driver fled the scene</span>');
      bits.push('<div class="popup-outcome">Driver outcome: not in the federal record.<br/>We are tracing outcomes case by case.</div>');
      popup.setLngLat(f.geometry.coordinates).setHTML(bits.join('<br/>')).addTo(map);
    });
    map.on('click', 'clusters', async (e) => {
      const f = e.features[0];
      const zoom = await map.getSource('deaths').getClusterExpansionZoom(f.properties.cluster_id);
      map.easeTo({ center: f.geometry.coordinates, zoom });
    });
    map.on('mouseenter', 'death-glyphs', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'death-glyphs', () => (map.getCanvas().style.cursor = ''));
    map.on('mouseenter', 'clusters', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'clusters', () => (map.getCanvas().style.cursor = ''));

    // ---- filters (clusters require setData, not setFilter) ---------------
    const yearMin = document.getElementById('year-min');
    const yearMax = document.getElementById('year-max');
    const readout = document.getElementById('year-readout');
    const fHitRun = document.getElementById('f-hitrun');
    const fDark = document.getElementById('f-dark');
    const countEl = document.getElementById('map-count');

    function apply() {
      let lo = +yearMin.value, hi = +yearMax.value;
      if (lo > hi) [lo, hi] = [hi, lo];
      readout.textContent = `${lo}–${hi}`;
      const subset = features.filter((f) => {
        const p = f.properties;
        if (p.year < lo || p.year > hi) return false;
        if (fHitRun.checked && !p.hitRun) return false;
        if (fDark.checked && !p.dark) return false;
        return true;
      });
      map.getSource('deaths').setData({ type: 'FeatureCollection', features: subset });
      countEl.textContent = `${subset.length.toLocaleString()} shown`;
    }
    [yearMin, yearMax, fHitRun, fDark].forEach((i) => i.addEventListener('input', apply));
    apply();
  });
}
