// Lấy dữ liệu miễn phí: ô bản đồ OpenFreeMap (chính) + Photon (phụ) + Nominatim (khu công nghiệp, tìm địa chỉ) – OpenStreetMap; OSRM (đường đi), Valhalla (vùng thời gian)
import { haversine, destPoint } from './geo.js';
import { scanTiles, fixCategory } from './tiles.js';

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
  admin:      { label: 'Hành chính - UBND',     icon: '🏛️', color: '#b91c1c' },
  transport:  { label: 'Bến xe - Ga - Sân bay', icon: '🚉', color: '#0f766e' },
  worship:    { label: 'Chùa - Nhà thờ',        icon: '🛕', color: '#ca8a04' },
  fuel:       { label: 'Cây xăng',              icon: '⛽', color: '#64748b' },
  industrial: { label: 'Khu công nghiệp',       icon: '🏭', color: '#475569' },
  pharmacy:   { label: 'Nhà thuốc',             icon: '💊', color: '#10b981' },
  sports:     { label: 'Thể thao - Gym',        icon: '🏟️', color: '#0ea5e9' },
  entertain:  { label: 'Rạp phim - Giải trí',   icon: '🎬', color: '#d946ef' },
  police:     { label: 'Công an',               icon: '🚓', color: '#1d4ed8' },
  post:       { label: 'Bưu điện',              icon: '📮', color: '#f59e0b' },
  convenience:{ label: 'Cửa hàng tiện lợi',     icon: '🏪', color: '#22c55e' },
  food:       { label: 'Cà phê - Nhà hàng',     icon: '☕', color: '#a16207' },
  hotel:      { label: 'Khách sạn',             icon: '🏨', color: '#7c3aed' },
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
  if (a === 'pharmacy' || s === 'chemist') return 'pharmacy';
  if (['sports_centre', 'fitness_centre', 'stadium', 'swimming_pool'].includes(t.leisure)) return 'sports';
  if (a === 'cinema' || a === 'theatre' || t.leisure === 'water_park') return 'entertain';
  if (a === 'police') return 'police';
  if (a === 'post_office') return 'post';
  if (s === 'convenience') return 'convenience';
  if (a === 'cafe' || a === 'restaurant') return 'food';
  if (t.tourism === 'hotel') return 'hotel';
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return { signal: ctl.signal, done: () => clearTimeout(timer) };
}

function addPoi(list, seen, center, cat, name, lngLat, id) {
  name = (name || '').trim();
  cat = fixCategory(cat, name);
  if (!cat || !name || !lngLat) return;
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
  ['amenity:pharmacy', 'shop:chemist'],
  ['leisure:sports_centre', 'leisure:fitness_centre', 'leisure:stadium', 'leisure:swimming_pool'],
  ['amenity:cinema', 'amenity:theatre', 'leisure:water_park'],
  ['amenity:police'],
  ['amenity:post_office'],
  ['shop:convenience'],
  ['amenity:cafe', 'amenity:restaurant'],
  ['tourism:hotel'],
];

async function photonGroup(center, radius, tags) {
  const qs = tags.map((t) => 'osm_tag=' + encodeURIComponent(t)).join('&');
  const url = `https://photon.komoot.io/reverse?lat=${center[1]}&lon=${center[0]}&radius=${(radius / 1000).toFixed(1)}&limit=50&lang=default&${qs}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = withTimeout(8000);
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

// ---- Khu / cụm công nghiệp: ô bản đồ không có tên vùng đất công nghiệp nên tìm theo tên qua Nominatim ----
async function fromNominatimIndustrial(center, radius) {
  const ne = destPoint(center, radius * 1.42, 45), sw = destPoint(center, radius * 1.42, 225);
  const pois = [], seen = new Set();
  for (const q of ['khu công nghiệp', 'cụm công nghiệp']) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=40&bounded=1&accept-language=vi&viewbox=${sw[0]},${ne[1]},${ne[0]},${sw[1]}&q=${encodeURIComponent(q)}`;
    const t = withTimeout(8000);
    try {
      const res = await fetch(url, { signal: t.signal });
      if (res.ok) {
        for (const e of await res.json()) {
          if (e.category !== 'landuse' || e.type !== 'industrial') continue; // bỏ trạm xe buýt, nhà máy nước thải… cùng tên
          addPoi(pois, seen, center, 'industrial', e.name, [+e.lon, +e.lat], `nominatim/${e.osm_type}${e.osm_id}`);
        }
      }
    } catch (_) {} finally { t.done(); }
    await sleep(1100); // giới hạn 1 yêu cầu/giây của Nominatim
  }
  return pois.filter((p) => p.dist <= radius * 1.05);
}

export async function fetchSurroundings(center, radius = 5000, roadRadius = 1500, onStatus = () => {}) {
  const t0 = performance.now();
  const settle = (pr) => pr.then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }));
  onStatus('Đang đọc bản đồ…');
  // Nguồn chính: ô bản đồ OpenFreeMap. Nguồn phụ: Photon (giới hạn 10 giây).
  const tilesP = settle(scanTiles(center, radius, roadRadius, (d, n, k) => onStatus(`Đang đọc bản đồ ${d}/${n} · ${k} tiện ích`)));
  const photonP = settle(Promise.race([fromPhoton(center, radius), sleep(10000).then(() => { throw new Error('Photon quá 10 giây'); })]));
  const kcnP = fromNominatimIndustrial(center, radius); // không bao giờ lỗi, tối đa ~19 giây
  const tiles = await tilesP;
  // Đã có dữ liệu từ ô bản đồ thì chỉ chờ Photon thêm tối đa 2 giây
  const ph = tiles.status === 'fulfilled'
    ? await Promise.race([photonP, sleep(2000).then(() => ({ status: 'rejected', reason: new Error('Photon chậm') }))])
    : await photonP;
  if (tiles.status === 'rejected' && ph.status === 'rejected') {
    throw new Error(`Không lấy được dữ liệu tiện ích (bản đồ: ${tiles.reason && tiles.reason.message}; Photon: ${ph.reason && ph.reason.message}). Kiểm tra mạng rồi thử lại, hoặc thêm tiện ích bằng tay (➕ Thêm tiện ích).`);
  }
  // Gộp, bỏ trùng theo tên + loại hoặc 2 điểm cùng loại rất gần nhau
  const pois = [];
  const seen = new Set();
  const kcn = await kcnP;
  const all = [...(tiles.status === 'fulfilled' ? tiles.value.pois : []), ...(ph.status === 'fulfilled' ? ph.value : []), ...kcn];
  for (const p of all) {
    const key = p.cat + '|' + p.name.toLowerCase().normalize('NFC');
    if (seen.has(key)) continue;
    if (pois.some((q) => q.cat === p.cat && haversine(q.lngLat, p.lngLat) < 60 && q.name.toLowerCase().includes(p.name.toLowerCase().slice(0, 8)))) continue;
    seen.add(key);
    pois.push(p);
  }
  pois.sort((a, b) => a.dist - b.dist);
  const roads = (tiles.status === 'fulfilled' ? tiles.value.roads : []).sort((a, b) => a.dist - b.dist).slice(0, 12);
  const sources = [tiles.status === 'fulfilled' && 'bản đồ OpenFreeMap', ph.status === 'fulfilled' && 'Photon'].filter(Boolean);
  return { pois, roads, sources, seconds: (performance.now() - t0) / 1000 };
}

const routeCache = new Map();
let lastRouteAt = 0;

let routeQueue = Promise.resolve();
// Nhớ cả yêu cầu đang chạy (tính sẵn ngầm + lúc dựng không gọi trùng); xếp hàng để giữ 1 yêu cầu/giây
export function fetchRoute(a, b) {
  const key = `${a[0].toFixed(6)},${a[1].toFixed(6)};${b[0].toFixed(6)},${b[1].toFixed(6)}`;
  if (!routeCache.has(key)) {
    const p = routeQueue.then(() => osrmRoute(a, b, key));
    routeQueue = p.catch(() => {});
    routeCache.set(key, p);
  }
  return routeCache.get(key);
}

async function osrmRoute(a, b, key) {
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
    routeCache.delete(key); // lỗi mạng: lần dựng sau thử lại
  }
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
