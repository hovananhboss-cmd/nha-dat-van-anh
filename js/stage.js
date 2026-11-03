import { CUSTOM_STYLES, ARTISTIC_THEMES } from './mapstyles.js';
// Bản đồ "sân khấu" dùng để xem trước và xuất video (không tương tác)
const OFM = 'https://tiles.openfreemap.org/styles/';

export const MAP_STYLES = {
  night: { label: '🌙 Đêm sang trọng (khuyên dùng)', custom: 'night', credit: '© OpenStreetMap · OpenFreeMap' },
  day: { label: '☀️ Ngày hiện đại', custom: 'day', credit: '© OpenStreetMap · OpenFreeMap' },
  satellite: { label: '🛰️ Vệ tinh + tên đường', custom: 'satellite', credit: 'Ảnh vệ tinh © Esri, Maxar · © OpenStreetMap' },
  satellite_plain: { label: '🛰️ Vệ tinh (không chữ)', custom: 'satellite_plain', credit: 'Ảnh vệ tinh © Esri, Maxar' },
  liberty: { label: 'Đường phố cổ điển', url: OFM + 'liberty', credit: '© OpenStreetMap · OpenFreeMap' },
  positron: { label: 'Tối giản xám', url: OFM + 'positron', credit: '© OpenStreetMap · OpenFreeMap' },
};
// 32 theme nghệ thuật (bảng màu từ MapToPoster JS, MIT)
for (const [k, t] of Object.entries(ARTISTIC_THEMES)) {
  MAP_STYLES['art_' + k] = { label: '🎨 ' + t.name, custom: 'art_' + k, group: 'art', credit: '© OpenStreetMap · OpenFreeMap' };
}

export function styleFor(id) {
  const s = MAP_STYLES[id] || MAP_STYLES.night;
  return s.custom ? CUSTOM_STYLES[s.custom]() : s.url;
}

const EMPTY = { type: 'FeatureCollection', features: [] };

export class Stage {
  constructor(container) {
    this.container = container;
    this.map = null;
    this.cache = {};
    this.data = { plot: EMPTY, iso: EMPTY, roads: EMPTY, routes: EMPTY, radar: EMPTY };
    this.theme = '#e11d48';
    this.hidePoi = true;
    this.plotHeight = 18; // mét
  }

  init(styleId, center) {
    return new Promise((resolve) => {
      this.styleId = styleId;
      this.map = new maplibregl.Map({
        container: this.container,
        style: styleFor(styleId),
        center: center || [105.85, 21.03],
        zoom: 14,
        interactive: false,
        attributionControl: false,
        preserveDrawingBuffer: true,
        fadeDuration: 0,
        pixelRatio: window.devicePixelRatio || 1,
        maxPitch: 75,
        localIdeographFontFamily: false,
      });
      this.map.on('style.load', () => this._setupLayers());
      this.map.once('load', () => resolve());
      this.map.on('error', (e) => console.warn('map error', e && e.error && e.error.message));
    });
  }

  setStyle(styleId) {
    if (styleId === this.styleId) return Promise.resolve();
    this.styleId = styleId;
    return new Promise((resolve) => {
      this.map.once('style.load', () => setTimeout(resolve, 50));
      this.map.setStyle(styleFor(styleId), { diff: false });
    });
  }

  _setupLayers() {
    const m = this.map;
    this.cache = {};
    if (this.hidePoi) {
      for (const l of m.getStyle().layers) {
        if (/^poi|_poi|poi_/.test(l.id) || l.id === 'aerodrome_label') m.setLayoutProperty(l.id, 'visibility', 'none');
      }
    }
    for (const k of Object.keys(this.data)) m.addSource('va-' + k, { type: 'geojson', data: this.data[k] });
    const th = this.theme;
    const isoColors = { 5: '#22c55e', 10: '#eab308', 15: '#f97316' };
    for (const mins of [15, 10, 5]) {
      m.addLayer({ id: 'va-iso-' + mins, type: 'fill', source: 'va-iso', filter: ['==', ['get', 'minutes'], mins],
        paint: { 'fill-color': isoColors[mins], 'fill-opacity': 0 } });
      m.addLayer({ id: 'va-iso-line-' + mins, type: 'line', source: 'va-iso', filter: ['==', ['get', 'minutes'], mins],
        paint: { 'line-color': isoColors[mins], 'line-width': 2.5, 'line-opacity': 0 } });
    }
    m.addLayer({ id: 'va-roads-glow', type: 'line', source: 'va-roads', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#facc15', 'line-width': 16, 'line-blur': 8, 'line-opacity': 0 } });
    m.addLayer({ id: 'va-roads', type: 'line', source: 'va-roads', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#facc15', 'line-width': 6, 'line-opacity': 0 } });
    m.addLayer({ id: 'va-radar-fill', type: 'fill', source: 'va-radar', paint: { 'fill-color': th, 'fill-opacity': 0.12 } });
    m.addLayer({ id: 'va-radar-line', type: 'line', source: 'va-radar', paint: { 'line-color': th, 'line-width': 3, 'line-opacity': 0.9 } });
    m.addLayer({ id: 'va-route-casing', type: 'line', source: 'va-routes', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': ['case', ['get', 'active'], 11, 7], 'line-opacity': ['case', ['get', 'active'], 1, 0.7] } });
    m.addLayer({ id: 'va-route', type: 'line', source: 'va-routes', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'active'], 6.5, 3.5], 'line-opacity': ['case', ['get', 'active'], 1, 0.7] } });
    m.addLayer({ id: 'va-plot-halo', type: 'line', source: 'va-plot', paint: { 'line-color': th, 'line-width': 40, 'line-blur': 30, 'line-opacity': 0 } });
    m.addLayer({ id: 'va-plot-fill', type: 'fill', source: 'va-plot', paint: { 'fill-color': th, 'fill-opacity': 0.35 } });
    m.addLayer({ id: 'va-plot-glow', type: 'line', source: 'va-plot', paint: { 'line-color': th, 'line-width': 12, 'line-blur': 6, 'line-opacity': 0.6 } });
    m.addLayer({ id: 'va-plot-line', type: 'line', source: 'va-plot', paint: { 'line-color': '#ffffff', 'line-width': 3.5 } });
    // Khối 3D phát sáng đánh dấu lô đất (nổi lên giữa các toà nhà khi flycam)
    m.addLayer({ id: 'va-plot-3d', type: 'fill-extrusion', source: 'va-plot',
      paint: { 'fill-extrusion-color': th, 'fill-extrusion-height': 0, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.55 } });
  }

  setTheme(color) {
    this.theme = color;
    const m = this.map;
    if (!m || !m.getLayer('va-plot-fill')) return;
    m.setPaintProperty('va-plot-fill', 'fill-color', color);
    m.setPaintProperty('va-plot-glow', 'line-color', color);
    m.setPaintProperty('va-plot-halo', 'line-color', color);
    m.setPaintProperty('va-radar-fill', 'fill-color', color);
    m.setPaintProperty('va-radar-line', 'line-color', color);
    m.setPaintProperty('va-plot-3d', 'fill-extrusion-color', color);
  }

  setData(key, fc) {
    this.data[key] = fc || EMPTY;
    const s = this.map && this.map.getSource('va-' + key);
    if (s) s.setData(this.data[key]);
  }

  paint(layer, prop, value) {
    const k = layer + '|' + prop;
    const v = typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;
    if (this.cache[k] === v) return;
    this.cache[k] = v;
    if (this.map.getLayer(layer)) this.map.setPaintProperty(layer, prop, v);
  }

  apply(ms) {
    // ms: trạng thái lớp bản đồ cho khung hình hiện tại
    const pf = ms.plot ?? 1;
    this.paint('va-plot-glow', 'line-opacity', 0.25 + 0.6 * pf);
    // Hào quang phát sáng quanh lô đất
    const g = ms.glow ?? 0.35;
    this.paint('va-plot-halo', 'line-opacity', 0.25 + 0.6 * g);
    this.paint('va-plot-halo', 'line-width', 22 + 30 * g);
    this.paint('va-plot-glow', 'line-width', 8 + 10 * g);
    this.paint('va-plot-fill', 'fill-opacity', 0.25 + 0.3 * Math.max(pf, g));
    const h3 = (ms.plot3d ?? 1) * this.plotHeight;
    this.paint('va-plot-3d', 'fill-extrusion-height', Math.round(h3 * 10) / 10);
    for (const mins of [5, 10, 15]) {
      const o = (ms.iso && ms.iso[mins]) || 0;
      this.paint('va-iso-' + mins, 'fill-opacity', o * 0.28);
      this.paint('va-iso-line-' + mins, 'line-opacity', o);
    }
    this.paint('va-roads', 'line-opacity', ms.roads || 0);
    this.paint('va-roads-glow', 'line-opacity', (ms.roads || 0) * 0.6);
    if (ms.routesKey !== this.cache.routesKey) {
      this.cache.routesKey = ms.routesKey;
      this.setData('routes', ms.routes || EMPTY);
    }
    if (ms.radarKey !== this.cache.radarKey) {
      this.cache.radarKey = ms.radarKey;
      this.setData('radar', ms.radar || EMPTY);
    }
  }

  // Chờ bản đồ vẽ xong toàn bộ ô bản đồ (dùng khi xuất video từng khung)
  settle(timeout = 15000) {
    const m = this.map;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      const timer = setTimeout(finish, timeout);
      m.once('idle', finish);
      m.triggerRepaint();
    });
  }
}
