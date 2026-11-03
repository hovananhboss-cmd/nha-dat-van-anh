// Tạo kịch bản lời đọc theo mẫu (không cần AI, không tốn phí)
import { CATS } from './data.js';
import { fmtDist } from './geo.js';
import { poiSub } from './scenes.js';

export const TONES = {
  pro: 'Chuyên nghiệp',
  sale: 'Chốt sale (khẩn trương)',
  friendly: 'Thân thiện, gần gũi',
  fun: 'Vui vẻ, hài hước',
};

function poiPhrase(p, speed) {
  const sub = p.route ? poiSub(p, speed).replace(' · ', ', khoảng ') : 'cách khoảng ' + fmtDist(p.dist);
  return `${p.name} (${sub})`.replace(/(\d),(\d)/g, '$1 phẩy $2');
}

export function generateScript({ info, pois, roads, tone = 'pro', speedKmh = 30, hasIso }) {
  const title = info.title || 'bất động sản này';
  const addr = info.address ? ` tại ${info.address}` : '';
  const price = info.price ? info.price : '';
  const area = info.area ? info.area.replace('m²', 'mét vuông').replace('m2', 'mét vuông') : '';
  const road = roads && roads[0] ? roads[0].name : '';
  const near = (pois || []).slice(0, 6);
  const list = near.map((p) => poiPhrase(p, speedKmh));
  const cats = [...new Set(near.map((p) => CATS[p.cat].label.toLowerCase()))].slice(0, 4).join(', ');
  const L = [];
  if (tone === 'sale') {
    L.push(`Cơ hội hiếm! ${title}${addr}.`);
    if (area || price) L.push(`${area ? 'Diện tích ' + area : ''}${area && price ? ', ' : ''}${price ? 'giá chỉ ' + price : ''}.`);
    if (road) L.push(`Vị trí ngay ${road}, giao thông cực kỳ thuận tiện.`);
    if (list.length) L.push(`Xung quanh đầy đủ tiện ích: ${list.join('; ')}.`);
    if (hasIso) L.push(`Chỉ năm đến mười lăm phút di chuyển là tới trung tâm khu vực.`);
    if (info.legal) L.push(`Pháp lý ${info.legal}, sang tên ngay.`);
    L.push(`Số lượng có hạn, liên hệ ngay ${info.agent || 'em'}${info.phone ? ' số ' + spellPhone(info.phone) : ''} để xem nhà hôm nay!`);
  } else if (tone === 'friendly') {
    L.push(`Xin chào cả nhà! Hôm nay ${info.agent || 'mình'} gửi đến mọi người ${title}${addr}.`);
    if (area) L.push(`Diện tích ${area}${info.size ? ', kích thước ' + info.size : ''}.`);
    if (road) L.push(`Nhà nằm ngay ${road}, đi lại rất tiện.`);
    if (list.length) L.push(`Quanh đây có ${list.join('; ')}.`);
    if (cats) L.push(`Nói chung là ${cats} đều gần, cuộc sống rất thoải mái.`);
    if (price) L.push(`Giá ${price}${info.legal ? ', pháp lý ' + info.legal : ''}.`);
    L.push(`Ai quan tâm thì nhắn ${info.agent || 'mình'}${info.phone ? ' qua số ' + spellPhone(info.phone) : ''} nhé!`);
  } else if (tone === 'fun') {
    L.push(`Đi đâu cũng gần, về nhà là sướng! Đó chính là ${title}${addr}.`);
    if (list.length) L.push(`Con đi học? ${near.find((p) => /school|kinder/.test(p.cat)) ? 'Trường ngay gần.' : 'Chuyện nhỏ.'} Đi chợ, siêu thị? Vài phút là tới. Cụ thể: ${list.join('; ')}.`);
    if (road) L.push(`Mặt tiền ${road}, khỏi lo lạc đường.`);
    if (area || price) L.push(`${area ? 'Diện tích ' + area : ''}${area && price ? ', ' : ''}${price ? 'giá ' + price + ', nghe là muốn chốt' : ''}.`);
    L.push(`Gọi ngay ${info.agent || ''}${info.phone ? ' ' + spellPhone(info.phone) : ''}, kẻo người khác nhanh tay hơn!`);
  } else {
    L.push(`Giới thiệu ${title}${addr}.`);
    if (area) L.push(`Diện tích ${area}${info.size ? ', kích thước ' + info.size : ''}${info.direction ? ', hướng ' + info.direction : ''}.`);
    if (road) L.push(`Vị trí tiếp giáp ${road}, kết nối giao thông thuận lợi.`);
    if (list.length) L.push(`Các tiện ích lân cận gồm: ${list.join('; ')}.`);
    if (hasIso) L.push(`Từ vị trí này, bán kính mười lăm phút di chuyển bao phủ toàn bộ các tiện ích thiết yếu.`);
    if (info.legal) L.push(`Pháp lý: ${info.legal}.`);
    if (price) L.push(`Giá bán ${price}.`);
    L.push(`Quý khách quan tâm vui lòng liên hệ ${info.agent || ''}${info.phone ? ', số điện thoại ' + spellPhone(info.phone) : ''}.`);
  }
  return L.filter((s) => s && s !== '.').join('\n');
}

function spellPhone(p) {
  return String(p).replace(/[^\d]/g, '').replace(/(\d{4})(\d{3})(\d+)/, '$1 $2 $3');
}
