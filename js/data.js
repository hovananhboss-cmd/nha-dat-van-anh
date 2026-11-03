// Lấy dữ liệu miễn phí: OpenStreetMap (Overpass), OSRM (đường đi), Valhalla (vùng thời gian), Nominatim (tìm địa chỉ)
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

async function overpass(query) {
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 40000);
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: ctl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error('Không kết nối được máy chủ OpenStreetMap: ' + (lastErr && lastErr.message));
}

export async function fetchSurroundings(center, radius = 5000, roadRadius = 1500) {
  const [lng, lat] = center;
  const A = `(around:${radius},${lat},${lng})`;
  const q = `[out:json][timeout:45];
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
  const pois = [];
  const seen = new Set();
  const roadsByName = new Map();
  for (const el of json.elements || []) {
    const t = el.tags || {};
    if (el.type === 'way' && el.geometry && t.highway) {
      const coords = el.geometry.map((g) => [g.lon, g.lat]);
      const name = t['name:vi'] || t.name;
      const r = roadsByName.get(name) || { name, kind: t.highway, lines: [], dist: Infinity };
      r.lines.push(coords);
      r.dist = Math.min(r.dist, pointToLineDist(center, coords));
      roadsByName.set(name, r);
      continue;
    }
    const cat = categorize(t);
    if (!cat) continue;
    const p = el.type === 'node' ? [el.lon, el.lat] : el.center ? [el.center.lon, el.center.lat] : null;
    if (!p) continue;
    const name = (t['name:vi'] || t.name || '').trim();
    if (!name) continue;
    const key = cat + '|' + name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    pois.push({ id: `${el.type}/${el.id}`, name, cat, lngLat: p, dist: haversine(center, p) });
  }
  pois.sort((a, b) => a.dist - b.dist);
  const roads = [...roadsByName.values()].sort((a, b) => a.dist - b.dist).slice(0, 12);
  return { pois, roads };
}

const routeCache = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

export async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=vn&accept-language=vi&q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Tìm địa chỉ thất bại');
  const j = await res.json();
  return j.map((r) => ({ name: r.display_name, lngLat: [parseFloat(r.lon), parseFloat(r.lat)] }));
}
