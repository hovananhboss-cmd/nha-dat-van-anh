// Bản đồ "sân khấu" dùng để xem trước và xuất video (không tương tác)
const OFM = 'https://tiles.openfreemap.org/styles/';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';

export const MAP_STYLES = {
  liberty: { label: 'Đường phố (sáng)', url: OFM + 'liberty', credit: '© OpenStreetMap · OpenFreeMap' },
  bright: { label: 'Đường phố (rực rỡ)', url: OFM + 'bright', credit: '© OpenStreetMap · OpenFreeMap' },
  positron: { label: 'Tối giản', url: OFM + 'positron', credit: '© OpenStreetMap · OpenFreeMap' },
  satellite: { label: 'Vệ tinh + tên đường', url: null, credit: 'Ảnh vệ tinh © Esri, Maxar · © OpenStreetMap' },
  satellite_plain: { label: 'Vệ tinh (không chữ)', url: null, credit: 'Ảnh vệ tinh © Esri, Maxar' },
};

function rasterStyle(withLabels) {
  const src = (path, maxzoom = 18) => ({
    type: 'raster',
    tiles: [ESRI + path + '/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    maxzoom,
  });
  const style = {
    version: 8,
    glyphs: GLYPHS,
    sources: { sat: src('World_Imagery', 18) },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#1e293b' } },
      { id: 'sat', type: 'raster', source: 'sat' },
    ],
  };
  if (withLabels) {
    style.sources.trans = src('Reference/World_Transportation', 18);
    style.sources.places = src('Reference/World_Boundaries_and_Places', 18);
    style.layers.push({ id: 'trans', type: 'raster', source: 'trans', paint: { 'raster-opacity': 0.9 } });
    style.layers.push({ id: 'places', type: 'raster', source: 'places' });
  }
  return style;
}

export function styleFor(id) {
  if (id === 'satellite') return rasterStyle(true);
  if (id === 'satellite_plain') return rasterStyle(false);
  return (MAP_STYLES[id] || MAP_STYLES.liberty).url;
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
    m.addLayer({ id: 'va-plot-fill', type: 'fill', source: 'va-plot', paint: { 'fill-color': th, 'fill-opacity': 0.35 } });
    m.addLayer({ id: 'va-plot-glow', type: 'line', source: 'va-plot', paint: { 'line-color': th, 'line-width': 12, 'line-blur': 6, 'line-opacity': 0.6 } });
    m.addLayer({ id: 'va-plot-line', type: 'line', source: 'va-plot', paint: { 'line-color': '#ffffff', 'line-width': 3.5 } });
  }

  setTheme(color) {
    this.theme = color;
    const m = this.map;
    if (!m || !m.getLayer('va-plot-fill')) return;
    m.setPaintProperty('va-plot-fill', 'fill-color', color);
    m.setPaintProperty('va-plot-glow', 'line-color', color);
    m.setPaintProperty('va-radar-fill', 'fill-color', color);
    m.setPaintProperty('va-radar-line', 'line-color', color);
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
    this.paint('va-plot-fill', 'fill-opacity', 0.18 + 0.32 * pf);
    this.paint('va-plot-glow', 'line-opacity', 0.25 + 0.6 * pf);
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
