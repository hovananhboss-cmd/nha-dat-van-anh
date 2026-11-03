// Các mẫu bản đồ tự thiết kế cho video BĐS – dựng trên dữ liệu OpenStreetMap miễn phí của OpenFreeMap
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const OMT = { type: 'vector', url: 'https://tiles.openfreemap.org/planet' };
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const NAME = ['coalesce', ['get', 'name:vi'], ['get', 'name'], ['get', 'name:latin']];
const z = (...stops) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops];
const cls = (...c) => ['match', ['get', 'class'], c, true, false];

// Bảng màu từng mẫu
const THEMES = {
  night: {
    bg: '#0b1324', residential: '#0f1a30', park: '#0f2a26', wood: '#10291f', water: '#0a2d4a', waterLine: '#13436b',
    building: '#1b2a46', buildingTop: '#22355a', buildingOpacity: 0.92,
    minor: '#22324f', minorCase: '#0b1324', major: '#f5b942', majorGlow: '#f59e0b', majorCase: '#3a2a0b', secondary: '#4a6394', midCase: '#0b1324', motorway: '#ffcf5c',
    rail: '#2e4066', text: '#e6edf7', textMajor: '#ffe3a3', halo: '#0b1324', place: '#9fb3d1', waterText: '#5f8fbf',
  },
  day: {
    bg: '#f4f1ea', residential: '#efebe2', park: '#cdeac0', wood: '#bfe2b0', water: '#a6d3f2', waterLine: '#8cc4ec',
    building: '#e2ded6', buildingTop: '#ece8e1', buildingOpacity: 0.95,
    minor: '#ffffff', minorCase: '#d9d3c7', major: '#ffd36b', majorGlow: '#ffc94a', majorCase: '#e0a93a', secondary: '#fff6d8', midCase: '#e3cf9a', motorway: '#ffb84d',
    rail: '#c9c3b8', text: '#3b4252', textMajor: '#1f2937', halo: '#ffffff', place: '#6b7280', waterText: '#3b82c4',
  },
};

function baseLayers(T, { buildings = true } = {}) {
  const L = [];
  L.push({ id: 'bg', type: 'background', paint: { 'background-color': T.bg } });
  L.push({ id: 'residential', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: cls('residential', 'suburb', 'neighbourhood'), paint: { 'fill-color': T.residential } });
  L.push({ id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('wood', 'grass', 'farmland'), paint: { 'fill-color': T.wood, 'fill-opacity': 0.7 } });
  L.push({ id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': T.park } });
  L.push({ id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': T.water } });
  L.push({ id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': T.waterLine, 'line-width': z(10, 0.5, 16, 3) } });
  if (buildings) {
    L.push({ id: 'building-flat', type: 'fill', source: 'omt', 'source-layer': 'building', maxzoom: 14.5, paint: { 'fill-color': T.building } });
    L.push({
      id: 'building-3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, T.building, 60, T.buildingTop],
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': T.buildingOpacity,
      },
    });
  }
  // Đường: viền + lõi theo cấp đường
  const minor = cls('minor', 'service', 'street', 'residential', 'living_street', 'unclassified');
  const mid = cls('tertiary', 'secondary');
  const top = cls('primary', 'trunk', 'motorway');
  L.push({ id: 'road-minor-case', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: minor, minzoom: 13, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': T.minorCase, 'line-width': z(13, 1.5, 16, 7, 19, 26) } });
  L.push({ id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: minor, minzoom: 13, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': T.minor, 'line-width': z(13, 0.8, 16, 5, 19, 22) } });
  L.push({ id: 'road-mid-case', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: mid, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': T.midCase, 'line-width': z(10, 1, 15, 6, 19, 30) } });
  L.push({ id: 'road-mid', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: mid, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': T.secondary, 'line-width': z(10, 0.5, 15, 4.5, 19, 26) } });
  L.push({ id: 'road-major-glow', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: top, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': T.majorGlow, 'line-width': z(9, 3, 15, 16, 19, 56), 'line-blur': z(9, 3, 15, 9, 19, 28), 'line-opacity': 0.35 } });
  L.push({ id: 'road-major-case', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: top, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': T.majorCase, 'line-width': z(9, 1.5, 15, 8.5, 19, 36) } });
  L.push({ id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: top, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': T.major, 'line-width': z(9, 1, 15, 6.5, 19, 32) } });
  L.push({ id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: cls('rail', 'transit'), paint: { 'line-color': T.rail, 'line-width': 1.5, 'line-dasharray': [3, 2] } });
  return L;
}

function labelLayers(T, { roadSize = 1 } = {}) {
  return [
    { id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name', layout: { 'text-field': NAME, 'text-font': ['Noto Sans Italic'], 'text-size': 13 }, paint: { 'text-color': T.waterText, 'text-halo-color': T.halo, 'text-halo-width': 1.2 } },
    {
      id: 'road-name-minor', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 15.5,
      filter: ['!', cls('primary', 'trunk', 'motorway', 'secondary', 'tertiary')],
      layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': z(15, 10, 19, 14 * roadSize), 'text-max-angle': 30 },
      paint: { 'text-color': T.text, 'text-halo-color': T.halo, 'text-halo-width': 1.4, 'text-opacity': 0.85 },
    },
    {
      id: 'road-name-major', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 12,
      filter: cls('primary', 'trunk', 'motorway', 'secondary', 'tertiary'),
      layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': ['Noto Sans Bold'], 'text-size': z(12, 10, 16, 14 * roadSize, 19, 19 * roadSize), 'text-max-angle': 30, 'symbol-spacing': 320 },
      paint: { 'text-color': T.textMajor, 'text-halo-color': T.halo, 'text-halo-width': 1.8 },
    },
    {
      // Chỉ hiện tên phường/quận/thành phố – bỏ "KHU PHỐ", "TỔ" gây rối mắt
      id: 'place', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: cls('city', 'town', 'suburb'), maxzoom: 15.5,
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Bold'], 'text-size': z(10, 12, 15, 16), 'text-transform': 'uppercase', 'text-letter-spacing': 0.08 },
      paint: { 'text-color': T.place, 'text-halo-color': T.halo, 'text-halo-width': 1.5 },
    },
  ];
}

function vectorStyle(kind) {
  const T = THEMES[kind];
  return { version: 8, glyphs: GLYPHS, sources: { omt: OMT }, layers: [...baseLayers(T), ...labelLayers(T)] };
}

// Vệ tinh + đường/tên đường dạng vector rõ nét
function satelliteStyle(withLabels) {
  const style = {
    version: 8,
    glyphs: GLYPHS,
    sources: { sat: { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 18 }, omt: OMT },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#1e293b' } },
      { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-saturation': 0.1, 'raster-contrast': 0.08 } },
    ],
  };
  if (withLabels) {
    const major = cls('primary', 'trunk', 'motorway', 'secondary', 'tertiary');
    style.layers.push(
      { id: 'road-major-line', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: cls('primary', 'trunk', 'motorway'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffd166', 'line-width': z(10, 1, 15, 3, 19, 8), 'line-opacity': 0.55 } },
      { id: 'road-name-major', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', filter: major, layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': ['Noto Sans Bold'], 'text-size': z(12, 11, 16, 15, 19, 20), 'symbol-spacing': 320 }, paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,.85)', 'text-halo-width': 2 } },
      { id: 'road-name-minor', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 16, filter: ['!', major], layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': z(16, 11, 19, 15) }, paint: { 'text-color': '#f1f5f9', 'text-halo-color': 'rgba(0,0,0,.8)', 'text-halo-width': 1.6 } },
      { id: 'place', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: cls('city', 'town', 'suburb'), maxzoom: 15.5, layout: { 'text-field': NAME, 'text-font': ['Noto Sans Bold'], 'text-size': z(10, 12, 15, 16), 'text-transform': 'uppercase' }, paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,.8)', 'text-halo-width': 1.8 } },
    );
  }
  return style;
}

export const CUSTOM_STYLES = {
  night: () => vectorStyle('night'),
  day: () => vectorStyle('day'),
  satellite: () => satelliteStyle(true),
  satellite_plain: () => satelliteStyle(false),
};
