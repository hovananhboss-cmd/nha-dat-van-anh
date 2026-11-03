// Lấy dữ liệu miễn phí: OpenStreetMap (Photon + Overpass + ô bản đồ OpenFreeMap), OSRM (đường đi), Valhalla (vùng thời gian), Nominatim (tìm địa chỉ)
import { haversine, pointToLineDist } from './geo.js';

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export const CATS = {
  kinder:     { label: 'Mầm non',               icon: '🧸', color: '#f472b6' },
  school:     { label: 'Trường học',            icon: '🏫', color: '#2563eb' },
  university: { label: 'Đại học - Cao đẳng',    icon: '🎓', color: '#4f46e5' },
  hospital:   { label: 'Bệnh viện',             icon: '🏥', color: '#dc2626' },
  clinic:     { label: 'Phòng khám',            icon: '🩺', color: '#ef4444' },
  market:     { label: 'Chợ',                   icon: '🧺', color: '#ea580c' },
  supermarket:{ label: 'Siêu thị',              icon: '🛒', color: '#16a34a' },
  mall:       { label: 'Trung tâm thương mại',  icon: '🛍️', color: '#9333ea' },
  bank:       { label: 'Ngân hàng',             icon: '🏦', color: '#0891b2' },
  park:       { label: 'Công viên',             icon: '🌳', color: '#15803d' },
  admin:      { label: 'UBND - Cơ quan',        icon: '🏛️', color: '#b91c1c' },
  transport:  { label: 'Bến xe - Ga - Sân bay', icon: '🚉', color: '#0f766e' },
  worship:    { label: 'Chùa - Nhà thờ',        icon: '🛕', color: '#ca8a04' },
  fuel:       { label: 'Cây xăng',              icon: '⛽', color: '#64748b' },
  industrial: { label: 'Khu công nghiệp',       icon: '🏭', color: '#475569' },
  custom:     { label: 'Điểm khác',             icon: '📍', color: '#e11d48' },
};

export function categorize(t) {
  const a = t.amenity, s = t.shop;
  if (a === 'kindergarten') return 'kinder';
  if (a === 'school') return 'school';
  if (a === 'university' || a === 'college') return 'university';
  if (a === 'hospital') return 'hospital';
  if (a === 'clinic') return 'clinic';
  if (a === 'marketplace') return 'market';
  if (s === 'supermarket') return 'supermarket';
  if (s === 'mall' || s === 'department_store') return 'mall';
  if (a === 'bank') return 'bank';
  if (t.leisure === 'park') return 'park';
  if (a === 'townhall' || t.office === 'government') return 'admin';
  if (a === 'bus_station' || t.railway === 'station' || t.aeroway === 'aerodrome') return 'transport';
  if (a === 'place_of_worship') return 'worship';
  if (a === 'fuel') return 'fuel';
  if (t.landuse === 'industrial') return 'industrial';
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return { signal: ctl.signal, done: () => clearTimeout(timer) };
}

const isIndustrialZone = (name) => /khu công nghiệp|cụm công nghiệp|\bkcn\b|\bccn\b|industrial (park|zone|estate)/i.test(name);

function addPoi(list, seen, center, cat, name, lngLat, id) {
  name = (name || '').trim();
  if (!cat || !name || !lngLat) return;
  if (cat === 'industrial' && !isIndustrialZone(name)) return;
  // Dữ liệu OSM đôi khi gắn nhầm loại (VD: nhà sách gắn là trường học)
  if ((cat === 'school' || cat === 'kinder') && /nhà sách|cửa hàng|văn phòng phẩm|book ?store|\bshop\b/i.test(name)) return;
  const key = cat + '|' + name.toLowerCase().normalize('NFC');
  if (seen.has(key)) return;
  seen.add(key);
  list.push({ id, name, cat, lngLat, dist: haversine(center, lngLat) });
}

// ---- Nguồn 1 (chính): Photon – tìm điểm gần nhất theo từng loại, nhanh & ổn định ----
const PHOTON_GROUPS = [
  ['amenity:kindergarten', 'amenity:school'],
  ['amenity:university', 'amenity:college'],
  ['amenity:hospital'],
  ['amenity:clinic'],
  ['amenity:marketplace'],
  ['shop:supermarket'],
  ['shop:mall', 'shop:department_store'],
  ['amenity:bank'],
  ['leisure:park'],
  ['amenity:townhall', 'office:government'],
  ['amenity:bus_station', 'railway:station', 'aeroway:aerodrome'],
  ['amenity:place_of_worship'],
  ['amenity:fuel'],
  ['landuse:industrial'],
];

async function photonGroup(center, radius, tags) {
  const qs = tags.map((t) => 'osm_tag=' + encodeURIComponent(t)).join('&');
  const url = `https://photon.komoot.io/reverse?lat=${center[1]}&lon=${center[0]}&radius=${(radius / 1000).toFixed(1)}&limit=30&lang=default&${qs}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = withTimeout(15000);
    try {
      const res = await fetch(url, { signal: t.signal });
      t.done();
      if (res.status === 429) { await sleep(1500); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return (await res.json()).features || [];
    } catch (e) {
      t.done();
      if (attempt) throw e;
      await sleep(800);
    }
  }
  return [];
}

async function fromPhoton(center, radius) {
  const pois = [], seen = new Set();
  let ok = 0;
  const queue = PHOTON_GROUPS.slice();
  const worker = async () => {
    while (queue.length) {
      const tags = queue.shift();
      try {
        const feats = await photonGroup(center, radius, tags);
        ok++;
        for (const f of feats) {
          const p = f.properties || {};
          const cat = categorize({ [p.osm_key]: p.osm_value });
          addPoi(pois, seen, center, cat, p.name, f.geometry && f.geometry.coordinates, `photon/${p.osm_type}${p.osm_id}`);
        }
      } catch (_) {}
    }
  };
  // Photon chịu được ~14 truy vấn song song (đo thực tế ~3 giây cho cả 14 nhóm)
  await Promise.all(Array.from({ length: 7 }, worker));
  if (!ok) throw new Error('Photon không phản hồi');
  return pois.filter((p) => p.dist <= radius * 1.05);
}

// ---- Nguồn 2 (bổ sung, nếu kịp): Overpass – thường quá tải nên chỉ chờ tối đa 25 giây ----
async function overpass(query, totalMs = 25000) {
  const deadline = Date.now() + totalMs;
  let lastErr;
  for (const url of OVERPASS) {
    const left = deadline - Date.now();
    if (left < 2000) break;
    const t = withTimeout(left);
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: t.signal,
      });
      t.done();
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      t.done();
      lastErr = e;
    }
  }
  throw new Error('Overpass bận: ' + (lastErr && lastErr.message));
}

async function fromOverpass(center, radius, roadRadius) {
  const [lng, lat] = center;
  const A = `(around:${radius},${lat},${lng})`;
  const q = `[out:json][timeout:20];
(
 nwr${A}[amenity~"^(kindergarten|school|university|college|hospital|clinic|marketplace|bank|townhall|bus_station|place_of_worship|fuel)$"][name];
 nwr${A}[shop~"^(supermarket|mall|department_store)$"][name];
 nwr${A}[leisure=park][name];
 nwr${A}[railway=station][name];
 nwr${A}[aeroway=aerodrome][name];
 nwr${A}[landuse=industrial][name];
 nwr${A}[office=government][name];
);
out center tags qt;
way(around:${roadRadius},${lat},${lng})[highway~"^(motorway|trunk|primary|secondary|tertiary)$"][name];
out geom tags qt;`;
  const json = await overpass(q);
  const pois = [], seen = new Set();
  const roadsByName = new Map();
  for (const el of json.elements || []) {
    const t = el.tags || {};
    if (el.type === 'way' && el.geometry && t.highway) {
      addRoad(roadsByName, center, t['name:vi'] || t.name, t.highway, el.geometry.map((g) => [g.lon, g.lat]));
      continue;
    }
    const p = el.type === 'node' ? [el.lon, el.lat] : el.center ? [el.center.lon, el.center.lat] : null;
    addPoi(pois, seen, center, categorize(t), t['name:vi'] || t.name, p, `${el.type}/${el.id}`);
  }
  return { pois, roads: roadsByName };
}

function addRoad(map, center, name, kind, coords) {
  if (!name || !coords || coords.length < 2) return;
  const r = map.get(name) || { name, kind, lines: [], dist: Infinity };
  r.lines.push(coords);
  r.dist = Math.min(r.dist, pointToLineDist(center, coords));
  map.set(name, r);
}

// ---- Đường chính: đọc thẳng từ ô bản đồ nền OpenFreeMap (luôn có, không phụ thuộc Overpass) ----
async function roadsFromTiles(center, roadRadius) {
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;left:-10000px;top:0;width:700px;height:700px;visibility:hidden;';
  document.body.appendChild(div);
  const z = roadRadius > 1200 ? 14 : 14.5;
  // Style tối giản: chỉ tải lớp tên đường, không tải icon/font -> nhanh hơn nhiều
  const style = {
    version: 8,
    sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    layers: [{ id: 'names', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation_name', paint: { 'line-opacity': 0 } }],
  };
  const map = new maplibregl.Map({ container: div, style, center, zoom: z, interactive: false, attributionControl: false });
  try {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 20000);
      map.once('idle', () => { clearTimeout(timer); resolve(); });
    });
    const roads = new Map();
    const feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation_name' });
    for (const f of feats) {
      const cls = f.properties.class;
      if (!/^(motorway|trunk|primary|secondary|tertiary)$/.test(cls)) continue;
      const name = f.properties['name:vi'] || f.properties.name || f.properties['name:latin'];
      const g = f.geometry;
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const l of lines) addRoad(roads, center, name, cls, l);
    }
    return roads;
  } finally {
    map.remove();
    div.remove();
  }
}

export async function fetchSurroundings(center, radius = 5000, roadRadius = 1500, onStatus = () => {}) {
  onStatus('Đang tìm tiện ích…');
  const settle = (pr) => pr.then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }));
  const opP = settle(fromOverpass(center, radius, roadRadius));
  const [ph, tiles] = await Promise.all([settle(fromPhoton(center, radius)), settle(roadsFromTiles(center, roadRadius))]);
  // Overpass hay quá tải: nếu Photon đã có kết quả thì gần như không chờ Overpass nữa
  const op = ph.status === 'fulfilled'
    ? await Promise.race([opP, sleep(800).then(() => ({ status: 'rejected', reason: new Error('Overpass chậm') }))])
    : await opP;
  if (ph.status === 'rejected' && op.status === 'rejected') {
    throw new Error('Máy chủ dữ liệu tiện ích đang bận, vui lòng thử lại sau ít phút. Bạn vẫn có thể thêm tiện ích bằng tay (➕ Thêm tiện ích).');
  }
  // Gộp 2 nguồn, bỏ trùng theo tên + loại hoặc 2 điểm cùng loại cách nhau < 60 m
  const pois = [];
  const seen = new Set();
  const all = [...(op.status === 'fulfilled' ? op.value.pois : []), ...(ph.status === 'fulfilled' ? ph.value : [])];
  for (const p of all) {
    const key = p.cat + '|' + p.name.toLowerCase().normalize('NFC');
    if (seen.has(key)) continue;
    if (pois.some((q) => q.cat === p.cat && haversine(q.lngLat, p.lngLat) < 60 && q.name.toLowerCase().includes(p.name.toLowerCase().slice(0, 8)))) continue;
    seen.add(key);
    pois.push(p);
  }
  pois.sort((a, b) => a.dist - b.dist);
  const roadMap = op.status === 'fulfilled' && op.value.roads.size ? op.value.roads : tiles.status === 'fulfilled' ? tiles.value : new Map();
  const roads = [...roadMap.values()].filter((r) => r.dist <= roadRadius).sort((a, b) => a.dist - b.dist).slice(0, 12);
  const sources = [ph.status === 'fulfilled' && 'Photon', op.status === 'fulfilled' && 'Overpass'].filter(Boolean);
  return { pois, roads, sources };
}

const routeCache = new Map();
let lastRouteAt = 0;

export async function fetchRoute(a, b) {
  const key = `${a[0].toFixed(6)},${a[1].toFixed(6)};${b[0].toFixed(6)},${b[1].toFixed(6)}`;
  if (routeCache.has(key)) return routeCache.get(key);
  const wait = 1100 - (Date.now() - lastRouteAt); // tôn trọng giới hạn 1 yêu cầu/giây của máy chủ demo
  if (wait > 0) await sleep(wait);
  lastRouteAt = Date.now();
  let result = null;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${key}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (res.ok) {
      const j = await res.json();
      const r = j.routes && j.routes[0];
      if (r) result = { coords: r.geometry.coordinates, distance: r.distance, duration: r.duration, road: true };
    }
  } catch (_) {}
  if (!result) {
    const d = haversine(a, b);
    result = { coords: [a, b], distance: d * 1.3, duration: null, road: false };
  }
  routeCache.set(key, result);
  return result;
}

export async function fetchIsochrones(center, minutes = [5, 10, 15], costing = 'motor_scooter') {
  const body = {
    locations: [{ lat: center[1], lon: center[0] }],
    costing,
    contours: minutes.map((m) => ({ time: m })),
    polygons: true,
    denoise: 0.6,
    generalize: 30,
  };
  const res = await fetch('https://valhalla1.openstreetmap.de/isochrone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Không lấy được vùng thời gian di chuyển (HTTP ' + res.status + ')');
  const j = await res.json();
  return (j.features || []).map((f) => ({ minutes: f.properties.contour, geometry: f.geometry }));
}

// Giải link rút gọn Google Maps (maps.app.goo.gl) qua các proxy CORS miễn phí.
// Trình duyệt không đọc được chuyển hướng sang domain khác, nên phải nhờ máy trung gian.
const UNSHORTEN_PROXIES = [
  { url: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, json: (j) => [j.status && j.status.url, j.contents] },
  { url: (u) => `https://everyorigin.jwvbremen.nl/api/get?url=${encodeURIComponent(u)}`, json: (j) => [j.status && j.status.url, j.html || j.contents] },
  { url: (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}` },
  { url: (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}` },
  { url: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
];

export function extractCoordsText(text) {
  // Trả về đoạn văn bản chứa toạ độ trong trang Google Maps (meta ảnh tĩnh, link @lat,lng, !3d!4d…)
  if (!text) return '';
  const t = String(text)
    .replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\u003d/g, '=')
    .replace(/%21/gi, '!').replace(/%40/g, '@').replace(/%2C/gi, ',');
  const pats = [
    /!3d-?\d+\.\d+!4d-?\d+\.\d+/,
    /@-?\d+\.\d+,-?\d+\.\d+/,
    /(?:center|markers|ll|q)=(?:[^&"']*?%7C)?-?\d+\.\d+(?:%2C|,)\s*-?\d+\.\d+/i,
  ];
  for (const re of pats) {
    const m = t.match(re);
    if (m) return m[0].replace(/^markers=/i, 'q=').replace(/%7C/gi, '').replace(/%2C/gi, ',');
  }
  return '';
}

export async function unshortenMapsLink(shortUrl, parse) {
  const errors = [];
  for (const p of UNSHORTEN_PROXIES) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 12000);
      const res = await fetch(p.url(shortUrl), { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      let candidates;
      if (p.json) candidates = p.json(await res.json());
      else candidates = [res.url, await res.text()];
      for (const c of candidates) {
        if (!c) continue;
        // URL ngắn: đọc trực tiếp. Trang HTML dài: chỉ đọc đoạn có dấu hiệu toạ độ để tránh bắt nhầm số.
        if (c.length < 3000) {
          const direct = parse(c);
          if (direct) return direct;
        }
        const frag = extractCoordsText(c);
        const ll = frag && parse(frag);
        if (ll) return ll;
      }
      errors.push('không thấy toạ độ');
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }
  return null;
}

export async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=vn&accept-language=vi&q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Tìm địa chỉ thất bại');
  const j = await res.json();
  return j.map((r) => ({ name: r.display_name, lngLat: [parseFloat(r.lon), parseFloat(r.lat)] }));
}
