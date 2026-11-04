// Các hàm hình học & toạ độ dùng chung
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function haversine(a, b) {
  // a, b: [lng, lat]
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function destPoint(c, meters, bearingDeg) {
  const br = rad(bearingDeg);
  const d = meters / R;
  const lat1 = rad(c[1]);
  const lng1 = rad(c[0]);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(br) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [deg(lng2), deg(lat2)];
}

export function circlePolygon(c, radius, n = 72) {
  const ring = [];
  for (let i = 0; i <= n; i++) ring.push(destPoint(c, radius, (i / n) * 360));
  return ring;
}

export function bboxOf(coords) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of coords) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [[w, s], [e, n]];
}

export function centroid(poly) {
  if (!poly || !poly.length) return null;
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

// Diện tích đa giác (m²) bằng phép chiếu phẳng cục bộ – đủ chính xác cho 1 lô đất
export function polygonArea(poly) {
  if (!poly || poly.length < 3) return 0;
  const c = centroid(poly);
  const kx = Math.cos(rad(c[1])) * (Math.PI / 180) * R;
  const ky = (Math.PI / 180) * R;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += (p[0] - c[0]) * kx * ((q[1] - c[1]) * ky) - (q[0] - c[0]) * kx * ((p[1] - c[1]) * ky);
  }
  return Math.abs(a / 2);
}

export function edgeLengths(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) out.push(haversine(poly[i], poly[(i + 1) % poly.length]));
  return out;
}

export function lineLength(coords) {
  let L = 0;
  for (let i = 1; i < coords.length; i++) L += haversine(coords[i - 1], coords[i]);
  return L;
}

// Cắt một đường đến tỉ lệ frac (0..1) theo chiều dài
export function sliceLine(coords, frac) {
  if (!coords || coords.length < 2) return coords || [];
  if (frac >= 1) return coords;
  if (frac <= 0) return [coords[0], coords[0]];
  const total = lineLength(coords);
  const target = total * frac;
  let acc = 0;
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const seg = haversine(coords[i - 1], coords[i]);
    if (acc + seg >= target) {
      const k = seg ? (target - acc) / seg : 0;
      out.push([
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * k,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * k,
      ]);
      return out;
    }
    acc += seg;
    out.push(coords[i]);
  }
  return out;
}

export function pointToLineDist(p, coords) {
  let best = Infinity;
  for (const c of coords) best = Math.min(best, haversine(p, c));
  return best;
}

export function nearestOnLine(p, coords) {
  let best = Infinity, bp = coords[0];
  for (const c of coords) {
    const d = haversine(p, c);
    if (d < best) { best = d; bp = c; }
  }
  return bp;
}

// ---- Đọc toạ độ từ link Google Maps / văn bản ----
function valid(lat, lng) {
  return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function parseLatLng(text) {
  if (!text) return null;
  let t = text.trim();
  try { t = decodeURIComponent(t); } catch (_) {}
  const first = (pats) => {
    for (const re of pats) {
      const m = t.match(re);
      if (m && valid(parseFloat(m[1]), parseFloat(m[2]))) return [parseFloat(m[2]), parseFloat(m[1])];
    }
    return null;
  };
  // Toạ độ ghim trước; "@lat,lng" chỉ là tâm khung bản đồ (lệch ghim vài trăm m khi Google mở bảng bên trái) nên để cuối
  const pin = first([
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|center|destination|daddr|sll)=(?:loc:)?\s*(-?\d+\.\d+)\s*,\s*\+?\s*(-?\d+\.\d+)/,
    /\/(?:place|search)\/(-?\d+\.\d+)\s*,\s*\+?\s*(-?\d+\.\d+)/,
  ]);
  if (pin) return pin;
  // Dạng độ-phút-giây: 10°46'36.8"N 106°42'03.2"E (trong link dấu cách thành "+")
  const dms = t.match(
    /(\d+)\s*°\s*(\d+)\s*['′]\s*([\d.]+)\s*["″]?\s*([NS])[\s,+]*(\d+)\s*°\s*(\d+)\s*['′]\s*([\d.]+)\s*["″]?\s*([EW])/i
  );
  if (dms) {
    let lat = +dms[1] + dms[2] / 60 + dms[3] / 3600;
    let lng = +dms[5] + dms[6] / 60 + dms[7] / 3600;
    if (/S/i.test(dms[4])) lat = -lat;
    if (/W/i.test(dms[8])) lng = -lng;
    if (valid(lat, lng)) return [lng, lat];
  }
  return first([
    /(-?\d{1,2}\.\d{3,})\s*[,;\s]\s*\+?\s*(-?\d{2,3}\.\d{3,})/,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
  ]);
}

export function isShortGoogleLink(text) {
  return /(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)/i.test(text || '');
}

// ---- VN-2000 → WGS84 ----
// Kinh tuyến trục theo Thông tư 973/2001/TT-TCĐC (múi 3°, k = 0.9999)
export const PROVINCES = [
  ['Hà Nội', 105], ['TP. Hồ Chí Minh', 105.75], ['Hải Phòng', 105.75], ['Đà Nẵng', 107.75], ['Cần Thơ', 105],
  ['An Giang', 104.75], ['Bà Rịa - Vũng Tàu', 107.75], ['Bắc Giang', 107], ['Bắc Kạn', 106.5], ['Bạc Liêu', 105],
  ['Bắc Ninh', 105.5], ['Bến Tre', 105.75], ['Bình Định', 108.25], ['Bình Dương', 105.75], ['Bình Phước', 106.25],
  ['Bình Thuận', 108.5], ['Cà Mau', 104.5], ['Cao Bằng', 105.75], ['Đắk Lắk', 108.5], ['Đắk Nông', 108.5],
  ['Điện Biên', 103], ['Đồng Nai', 107.75], ['Đồng Tháp', 105], ['Gia Lai', 108.5], ['Hà Giang', 105.5],
  ['Hà Nam', 105], ['Hà Tĩnh', 105.5], ['Hải Dương', 105.5], ['Hậu Giang', 105], ['Hòa Bình', 106],
  ['Hưng Yên', 105.5], ['Khánh Hòa', 108.25], ['Kiên Giang', 104.5], ['Kon Tum', 107.5], ['Lai Châu', 103],
  ['Lâm Đồng', 107.75], ['Lạng Sơn', 107.25], ['Lào Cai', 104.75], ['Long An', 105.75], ['Nam Định', 105.5],
  ['Nghệ An', 104.75], ['Ninh Bình', 105], ['Ninh Thuận', 108.25], ['Phú Thọ', 104.75], ['Phú Yên', 108.5],
  ['Quảng Bình', 106], ['Quảng Nam', 107.75], ['Quảng Ngãi', 108], ['Quảng Ninh', 107.75], ['Quảng Trị', 106.25],
  ['Sóc Trăng', 105.5], ['Sơn La', 104], ['Tây Ninh', 105.5], ['Thái Bình', 105.5], ['Thái Nguyên', 106.5],
  ['Thanh Hóa', 105], ['Thừa Thiên Huế', 107], ['Tiền Giang', 105.75], ['Trà Vinh', 105.5], ['Tuyên Quang', 106],
  ['Vĩnh Long', 105.5], ['Vĩnh Phúc', 105], ['Yên Bái', 104.75],
];

export function vn2000ToWgs84(x, y, lon0) {
  // x: toạ độ Bắc (X trên sổ, ~1.000.000–2.600.000), y: toạ độ Đông (Y trên sổ, ~400.000–700.000)
  const p = window.proj4;
  if (!p) throw new Error('Chưa tải thư viện proj4');
  const def =
    `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 ` +
    `+towgs84=-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278 +units=m +no_defs`;
  return p(def, 'WGS84', [y, x]); // [lng, lat]
}

// Các kinh tuyến trục khác nhau đang dùng ở Việt Nam
export const MERIDIANS = [...new Set(PROVINCES.map((p) => p[1]))].sort((a, b) => a - b);

export function fmtMeridian(lon0) {
  const d = Math.floor(lon0 + 1e-9);
  const m = Math.round((lon0 - d) * 60);
  return `${d}°${String(m).padStart(2, '0')}'`;
}

// Đọc kinh tuyến trục người dùng gõ: "105°45'", "105 45", "105.75", "105,75", "KTT 105°45′"
export function parseLon0(text) {
  const t = String(text || '').trim();
  let m = t.match(/(\d{3})\s*[°º˚o]?\s*(\d{1,2})\s*['′’]?/);
  if (m && (t.includes('°') || /\d{3}\s+\d{1,2}\b/.test(t) || /['′’]/.test(t))) return +m[1] + +m[2] / 60;
  m = t.match(/(\d{3}(?:[.,]\d+)?)/);
  if (m) return parseFloat(m[1].replace(',', '.'));
  return NaN;
}

// Tách các số trong một dòng, hiểu cả kiểu Việt Nam "1.180.081,47" và "1180081,47"
export function extractNumbers(line) {
  let s = ' ' + line + ' ';
  // bỏ dấu chấm phân cách hàng nghìn: 1.180.081,47 -> 1180081,47
  s = s.replace(/(\d{1,3})((?:\.\d{3}){2,})(?=[,\s]|$)/g, (_, a, b) => a + b.replace(/\./g, ''));
  s = s.replace(/(\d{3})\.(\d{3}),(\d+)/g, '$1$2,$3');
  const out = [];
  for (const tok of s.match(/-?\d+(?:[.,]\d+)?/g) || []) out.push(parseFloat(tok.replace(',', '.')));
  return out;
}

// Phân tích bảng toạ độ. Trả về danh sách điểm VN-2000 (X,Y) hoặc GPS (lng,lat)
export function parseCornerRows(text) {
  const vn = [], gps = [];
  for (const raw of (text || '').split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const nums = extractNumbers(line);
    const big = nums.filter((n) => Math.abs(n) > 100000);
    if (big.length >= 2) {
      // Lấy 2 số lớn đầu tiên trên dòng (cột X, Y). Số lớn hơn là X (hướng Bắc).
      const [a, b] = big.slice(0, 2);
      vn.push({ X: Math.max(a, b), Y: Math.min(a, b) });
    } else {
      const ll = parseLatLng(line);
      if (ll) gps.push(ll);
    }
  }
  // Bỏ điểm cuối nếu trùng điểm đầu (bảng sổ hay lặp lại điểm 1 để khép kín)
  const dedupe = (arr, eq) => (arr.length > 3 && eq(arr[0], arr[arr.length - 1]) ? arr.slice(0, -1) : arr);
  return {
    vn: dedupe(vn, (p, q) => Math.abs(p.X - q.X) < 0.01 && Math.abs(p.Y - q.Y) < 0.01),
    gps: dedupe(gps, (p, q) => Math.abs(p[0] - q[0]) < 1e-8 && Math.abs(p[1] - q[1]) < 1e-8),
  };
}

// Thử mọi kinh tuyến trục, chọn cái cho kết quả gần vị trí căn nhà nhất
export function autoMeridian(rows, ref) {
  let best = null;
  for (const lon0 of MERIDIANS) {
    const pts = rows.map((r) => vn2000ToWgs84(r.X, r.Y, lon0));
    const d = haversine(centroid(pts), ref);
    if (!best || d < best.dist) best = { lon0, dist: d, points: pts };
  }
  return best;
}

function segIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

export function isSelfIntersecting(poly) {
  const n = poly.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

// Sắp xếp lại các góc theo vòng quanh tâm (dùng khi thứ tự điểm làm ranh bị xoắn)
export function sortAroundCentroid(poly) {
  const c = centroid(poly);
  return poly.slice().sort((p, q) => Math.atan2(p[1] - c[1], p[0] - c[0]) - Math.atan2(q[1] - c[1], q[0] - c[0]));
}

export function fmtDist(m) {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',')} km`;
}

export function fmtArea(m2) {
  return `${(Math.round(m2 * 10) / 10).toLocaleString('vi-VN')} m²`;
}
