// Đọc tiện ích & tên đường trực tiếp từ ô bản đồ vector OpenFreeMap (cùng máy chủ vẽ bản đồ nền,
// nên luôn truy cập được khi bản đồ hiện lên). Không cần WebGL, không phụ thuộc Overpass/Photon.
import { haversine, destPoint, pointToLineDist } from './geo.js';

const VT_URL = 'https://cdn.jsdelivr.net/npm/@mapbox/vector-tile@2.0.3/+esm';
const PBF_URL = 'https://cdn.jsdelivr.net/npm/pbf@4.0.1/+esm';
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const Z = 14; // mức chi tiết cao nhất của OpenFreeMap – chứa đủ mọi tiện ích

let libsP = null;
function libs() {
  if (!libsP) {
    libsP = Promise.all([import(VT_URL), import(PBF_URL)]).then(([vt, pbf]) => ({ VectorTile: vt.VectorTile, Pbf: pbf.default || pbf.Pbf }));
    libsP.catch(() => (libsP = null));
  }
  return libsP;
}

let tileTpl = null;
async function template() {
  if (!tileTpl) {
    const j = await (await fetch(TILEJSON)).json();
    tileTpl = j.tiles[0];
  }
  return tileTpl;
}

const lng2x = (lng) => Math.floor(((lng + 180) / 360) * 2 ** Z);
const lat2y = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z);
};

// subclass (giá trị OSM gốc) -> loại tiện ích của app
const SUB = {
  kindergarten: 'kinder', school: 'school', university: 'university', college: 'university',
  hospital: 'hospital', clinic: 'clinic', doctors: 'clinic',
  marketplace: 'market', supermarket: 'supermarket', mall: 'mall', department_store: 'mall',
  bank: 'bank', park: 'park', townhall: 'admin', bus_station: 'transport',
  place_of_worship: 'worship', fuel: 'fuel',
  pharmacy: 'pharmacy', chemist: 'pharmacy',
  sports_centre: 'sports', fitness_centre: 'sports', stadium: 'sports', swimming_pool: 'sports',
  cinema: 'entertain', theatre: 'entertain', water_park: 'entertain',
  police: 'police', post_office: 'post', convenience: 'convenience',
  cafe: 'food', restaurant: 'food', hotel: 'hotel',
};

// Sửa các nhãn OSM hay bị gắn nhầm ở Việt Nam. Trả về null để bỏ điểm.
export function fixCategory(cat, name) {
  if (!cat || !name) return null;
  const n = name.toLowerCase();
  if ((cat === 'mall' || cat === 'supermarket') && /^chợ(\s|$)/.test(n)) return 'market';
  if ((cat === 'school' || cat === 'kinder') && /nhà sách|cửa hàng|văn phòng phẩm|book ?store|\bshop\b/.test(n)) return null;
  if (cat === 'school' && /mầm non|mẫu giáo|nhà trẻ/.test(n)) return 'kinder';
  if (cat === 'transport' && !/bến xe|nhà ga|^ga\b|sân bay|metro|station|terminal|cảng/.test(n)) return null;
  if (cat === 'industrial' && !/khu công nghiệp|cụm công nghiệp|\bkcn\b|\bccn\b|industrial (park|zone|estate)/.test(n)) return null;
  return cat;
}

function poiCat(props) {
  if (props.class === 'railway' && /station|halt/.test(props.subclass || '')) return 'transport';
  return SUB[props.subclass] || null;
}

async function fetchTile(tpl, x, y, signal) {
  const url = tpl.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal });
      if (res.status === 204 || res.status === 404) return null; // ô trống (biển, rừng…)
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.arrayBuffer();
    } catch (e) {
      if (attempt || (signal && signal.aborted)) throw e;
    }
  }
  return null;
}

export async function scanTiles(center, radius, roadRadius, onProgress = () => {}) {
  const [{ VectorTile, Pbf }, tpl] = await Promise.all([libs(), template()]);
  const r = Math.max(radius, roadRadius);
  const n = destPoint(center, r, 0), s = destPoint(center, r, 180), e = destPoint(center, r, 90), w = destPoint(center, r, 270);
  const x0 = lng2x(w[0]), x1 = lng2x(e[0]), y0 = lat2y(n[1]), y1 = lat2y(s[1]);
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);
  // ô gần tâm trước để có kết quả sớm
  const cx = lng2x(center[0]), cy = lat2y(center[1]);
  jobs.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));

  const pois = [], seen = new Set();
  const roads = new Map();
  let done = 0, failed = 0;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);

  const handle = (buf, x, y) => {
    const tile = new VectorTile(new Pbf(buf));
    const pl = tile.layers.poi;
    if (pl) {
      for (let i = 0; i < pl.length; i++) {
        const f = pl.feature(i);
        const name = (f.properties['name:vi'] || f.properties.name || '').trim();
        const cat = fixCategory(poiCat(f.properties), name);
        if (!cat || !name) continue;
        const g = f.toGeoJSON(x, y, Z).geometry;
        const p = g.type === 'Point' ? g.coordinates : g.coordinates[0];
        const d = haversine(center, p);
        if (d > radius) continue;
        const key = cat + '|' + name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        pois.push({ id: `tile/${cat}/${name}`, name, cat, lngLat: p, dist: d });
      }
    }
    const tl = tile.layers.transportation_name;
    if (tl) {
      for (let i = 0; i < tl.length; i++) {
        const f = tl.feature(i);
        const cls = f.properties.class;
        if (!/^(motorway|trunk|primary|secondary|tertiary)$/.test(cls)) continue;
        const name = f.properties['name:vi'] || f.properties.name || f.properties['name:latin'];
        if (!name) continue;
        const g = f.toGeoJSON(x, y, Z).geometry;
        const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
        for (const l of lines) {
          if (l.length < 2) continue;
          const rr = roads.get(name) || { name, kind: cls, lines: [], dist: Infinity };
          rr.lines.push(l);
          rr.dist = Math.min(rr.dist, pointToLineDist(center, l));
          roads.set(name, rr);
        }
      }
    }
  };

  const queue = jobs.slice();
  const worker = async () => {
    while (queue.length) {
      const [x, y] = queue.shift();
      try {
        const buf = await fetchTile(tpl, x, y, ctl.signal);
        if (buf) handle(buf, x, y);
      } catch (_) {
        failed++;
      }
      done++;
      onProgress(done, jobs.length, pois.length);
    }
  };
  try {
    await Promise.all(Array.from({ length: 6 }, worker));
  } finally {
    clearTimeout(timer);
  }
  if (failed === jobs.length) throw new Error('Không tải được ô bản đồ');
  return {
    pois,
    roads: [...roads.values()].filter((rr) => rr.dist <= roadRadius),
    stats: { tiles: jobs.length, failed },
  };
}
