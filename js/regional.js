// Điểm mốc lớn cho cảnh "Kết nối vùng" và hạ tầng đang thi công
import { INFRA } from './infra-data.js';
import { haversine, nearestOnLine } from './geo.js';

// Toạ độ lấy từ OpenStreetMap (Nominatim), 11/2026
export const LANDMARKS = [
  // Thứ tự trong danh sách = thứ tự bay trong cảnh Kết nối vùng (không chọn sẵn)
  { id: 'tdm_center', name: 'Trung tâm Thủ Dầu Một', short: 'TT Thủ Dầu Một', icon: '🏙️', lngLat: [106.65131, 10.97734] },
  { id: 'hcm_center', name: 'Trung tâm TP.HCM', short: 'Trung tâm TP.HCM', icon: '🏙️', lngLat: [106.69803, 10.77253] },
  { id: 'tsn', name: 'Sân bay Tân Sơn Nhất', short: 'Sân bay Tân Sơn Nhất', icon: '✈️', lngLat: [106.66480, 10.81310] },
  { id: 'long_thanh', name: 'Sân bay Long Thành', short: 'Sân bay Long Thành', icon: '✈️', lngLat: [107.05352, 10.77599] },
  { id: 'cat_lai', name: 'Cảng Cát Lái', short: 'Cảng Cát Lái', icon: '⚓', lngLat: [106.79547, 10.76679] },
  { id: 'ga_sg', name: 'Ga Sài Gòn', short: 'Ga Sài Gòn', icon: '🚆', lngLat: [106.67524, 10.78320] },
  { id: 'bx_mien_dong', name: 'Bến xe Miền Đông mới', short: 'BX Miền Đông mới', icon: '🚌', lngLat: [106.81498, 10.87856] },
  { id: 'bx_mien_tay', name: 'Bến xe Miền Tây', short: 'BX Miền Tây', icon: '🚌', lngLat: [106.61852, 10.74105] },
  { id: 'shtp', name: 'Khu công nghệ cao TP.HCM', short: 'Khu Công nghệ cao', icon: '🏭', lngLat: [106.80848, 10.83800] },
  { id: 'becamex', name: 'Becamex Tower (Bình Dương)', short: 'Becamex Tower', icon: '🏢', lngLat: [106.67041, 10.97611] },
  { id: 'bien_hoa', name: 'Trung tâm Biên Hòa', short: 'TT Biên Hòa', icon: '🏙️', lngLat: [106.81438, 10.94641] },
  { id: 'nga_tu_bp', name: 'Ngã tư Bình Phước', short: 'Ngã tư Bình Phước', icon: '🚦', lngLat: [106.72478, 10.86385] },
];

export const INFRA_LIST = Object.entries(INFRA).map(([id, v]) => ({ id, name: v.name, segments: v.segments }));

// Khoảng cách gần nhất từ lô đất tới tuyến + điểm gần nhất
export function infraNearest(id, origin) {
  const inf = INFRA[id];
  let best = { dist: Infinity, point: null };
  for (const [, line] of inf.segments) {
    const p = nearestOnLine(origin, line);
    const d = haversine(origin, p);
    if (d < best.dist) best = { dist: d, point: p };
  }
  return best;
}
