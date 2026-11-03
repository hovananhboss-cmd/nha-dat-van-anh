// Vẽ chữ, thẻ thông tin, ghim tiện ích lên lớp canvas phủ trên bản đồ
export const FONT = '"Be Vietnam Pro", "Segoe UI", Roboto, Arial, sans-serif';

export const ease = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  back: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const seg = (p, a, b) => clamp((p - a) / (b - a)); // tiến độ con trong [a,b]

export function font(ctx, size, weight = 600) {
  ctx.font = `${weight} ${Math.round(size)}px ${FONT}`;
}

export function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function wrap(ctx, text, maxW, maxLines = 3) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width <= maxW || !cur) cur = test;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    let last = keep[maxLines - 1];
    while (ctx.measureText(last + '…').width > maxW && last.length > 1) last = last.slice(0, -1);
    keep[maxLines - 1] = last + '…';
    return keep;
  }
  return lines;
}

export function shadow(ctx, blur, color = 'rgba(0,0,0,.35)', oy = 0) {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = oy;
}
export function noShadow(ctx) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

// Ghim vị trí lô đất (giọt nước + ngôi nhà) với vòng sóng lan toả
export function plotMarker(ctx, x, y, u, t, color, label = 'VỊ TRÍ') {
  // sóng
  for (let k = 0; k < 2; k++) {
    const ph = ((t * 0.8 + k * 0.5) % 1);
    ctx.beginPath();
    ctx.arc(x, y, (14 + ph * 70) * u, 0, Math.PI * 2);
    ctx.strokeStyle = hexA(color, (1 - ph) * 0.8);
    ctx.lineWidth = 4 * u;
    ctx.stroke();
  }
  const h = 78 * u, r = 30 * u;
  const cy = y - h + r;
  shadow(ctx, 14 * u, 'rgba(0,0,0,.45)', 6 * u);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x - r * 0.6, y - h * 0.35, x - r, cy + r * 0.5, x - r, cy);
  ctx.arc(x, cy, r, Math.PI, 0);
  ctx.bezierCurveTo(x + r, cy + r * 0.5, x + r * 0.6, y - h * 0.35, x, y);
  ctx.fillStyle = color;
  ctx.fill();
  noShadow(ctx);
  ctx.lineWidth = 4 * u;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  font(ctx, 30 * u);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🏠', x, cy + 1 * u);
  if (label) {
    font(ctx, 20 * u, 800);
    const w = ctx.measureText(label).width + 22 * u;
    const ly = cy - r - 30 * u;
    shadow(ctx, 8 * u);
    rrect(ctx, x - w / 2, ly - 16 * u, w, 32 * u, 16 * u);
    ctx.fillStyle = '#fff';
    ctx.fill();
    noShadow(ctx);
    ctx.fillStyle = color;
    ctx.fillText(label, x, ly + 1 * u);
  }
}

export function poiPin(ctx, x, y, u, cat, scale = 1) {
  if (scale <= 0.01) return;
  const r = 36 * u * scale;
  // quầng sáng theo màu loại tiện ích
  const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.1);
  g.addColorStop(0, hexA(cat.color, 0.55));
  g.addColorStop(1, hexA(cat.color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.1, 0, Math.PI * 2);
  ctx.fill();
  shadow(ctx, 14 * u, 'rgba(0,0,0,.45)', 5 * u);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  noShadow(ctx);
  ctx.beginPath();
  ctx.arc(x, y, r - 5 * u * scale, 0, Math.PI * 2);
  ctx.fillStyle = cat.color;
  ctx.fill();
  font(ctx, 34 * u * scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(cat.icon, x, y + 2 * u * scale);
}

// Đốm sáng chạy ở đầu đường dẫn
export function comet(ctx, x, y, u, color, t = 0) {
  const pulse = 1 + 0.15 * Math.sin(t * 12);
  const R = 52 * u * pulse;
  const g = ctx.createRadialGradient(x, y, 0, x, y, R);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, hexA(color, 0.95));
  g.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fill();
}

// Thẻ tên tiện ích: trả về hộp đã vẽ để tránh chồng lấn
export const CARD = { title: 31, sub: 26, lh: 38, subH: 36, pad: 20, gap: 54, tag: 19, tagH: 30 };

// tag: dòng nhỏ phía trên tên cho biết loại tiện ích (VD "🧺 CHỢ") – đọc lướt vẫn hiểu
export function measureCard(ctx, u, title, sub, maxW, tag = '') {
  font(ctx, CARD.title * u, 700);
  const lines = wrap(ctx, title, maxW, 2);
  let w = Math.max(...lines.map((l) => ctx.measureText(l).width));
  if (sub) { font(ctx, CARD.sub * u, 700); w = Math.max(w, ctx.measureText(sub).width); }
  if (tag) { font(ctx, CARD.tag * u, 800); w = Math.max(w, ctx.measureText(tag).width); }
  const pad = CARD.pad * u;
  const h = (tag ? CARD.tagH * u : 0) + lines.length * CARD.lh * u + (sub ? CARD.subH * u : 0) + pad * 1.3;
  return { lines, w: w + pad * 2 + 8 * u, h };
}

// Vị trí hộp thẻ quanh ghim (dùng chung cho vẽ và chống chồng lấn)
export function cardBox(x, y, u, m, place) {
  let bx = x - m.w / 2, by = y - CARD.gap * u - m.h;
  if (place === 'bottom') by = y + CARD.gap * u;
  if (place === 'left') { bx = x - CARD.gap * u - m.w; by = y - m.h / 2; }
  if (place === 'right') { bx = x + CARD.gap * u; by = y - m.h / 2; }
  const d = CARD.gap * 0.75 * u;
  if (place === 'tr') { bx = x + d; by = y - d - m.h; }
  if (place === 'tl') { bx = x - d - m.w; by = y - d - m.h; }
  if (place === 'br') { bx = x + d; by = y + d; }
  if (place === 'bl') { bx = x - d - m.w; by = y + d; }
  return { x: bx, y: by, w: m.w, h: m.h };
}

export function poiCard(ctx, x, y, u, cat, title, sub, alpha = 1, opts = {}) {
  if (alpha <= 0.01) return null;
  const maxW = opts.maxW || 500 * u;
  const tag = opts.tag ? opts.tag.toLocaleUpperCase('vi') : '';
  const m = measureCard(ctx, u, title, sub, maxW, tag);
  const place = opts.place || 'top';
  let { x: bx, y: by } = cardBox(x, y, u, m, place);
  if (opts.bounds) {
    const b = opts.bounds;
    bx = clamp(bx, b.x0, b.x1 - m.w);
    by = clamp(by, b.y0, b.y1 - m.h);
  }
  ctx.save();
  ctx.globalAlpha *= alpha;
  const pad = CARD.pad * u;
  // viền sáng theo màu tiện ích
  shadow(ctx, 22 * u, hexA(cat.color, 0.55), 0);
  rrect(ctx, bx, by, m.w, m.h, 18 * u);
  ctx.fillStyle = 'rgba(12,18,32,.84)';
  ctx.fill();
  noShadow(ctx);
  ctx.lineWidth = 3 * u;
  ctx.strokeStyle = hexA(cat.color, 0.9);
  ctx.stroke();
  ctx.fillStyle = cat.color;
  rrect(ctx, bx, by, 10 * u, m.h, 5 * u);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const tx = bx + pad + 8 * u;
  let ty = by + pad * 0.65;
  if (tag) {
    font(ctx, CARD.tag * u, 800);
    ctx.fillStyle = tint(cat.color);
    ctx.fillText(tag, tx, ty + 2 * u);
    ty += CARD.tagH * u;
  }
  font(ctx, CARD.title * u, 700);
  ctx.fillStyle = '#ffffff';
  m.lines.forEach((l, i) => ctx.fillText(l, tx, ty + i * CARD.lh * u));
  if (sub) {
    font(ctx, CARD.sub * u, 700);
    ctx.fillStyle = tint(cat.color);
    ctx.fillText(sub, tx, ty + m.lines.length * CARD.lh * u + 4 * u);
  }
  ctx.restore();
  return { x: bx, y: by, w: m.w, h: m.h };
}

export function pill(ctx, x, y, u, text, bg, fg = '#fff', size = 22, align = 'center') {
  font(ctx, size * u, 700);
  const w = ctx.measureText(text).width + 24 * u;
  const h = (size + 16) * u;
  let bx = x - w / 2;
  if (align === 'left') bx = x;
  if (align === 'right') bx = x - w;
  rrect(ctx, bx, y - h / 2, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + w / 2, y + 1 * u);
  return { x: bx, y: y - h / 2, w, h };
}

// pha màu với trắng – màu tiện ích tối (VD xám KCN) vẫn đọc rõ trên nền tối
export function tint(hex, k = 0.45) {
  const n = parseInt(hex.replace('#', ''), 16);
  const m = (c) => Math.round(c + (255 - c) * k);
  return `rgb(${m((n >> 16) & 255)},${m((n >> 8) & 255)},${m(n & 255)})`;
}

export function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function drawCover(ctx, img, W, H, zoom = 1, panX = 0, panY = 0) {
  const iw = img.videoWidth || img.naturalWidth || img.width;
  const ih = img.videoHeight || img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const s = Math.max(W / iw, H / ih) * zoom;
  const w = iw * s, h = ih * s;
  ctx.drawImage(img, (W - w) / 2 + panX * (w - W) / 2, (H - h) / 2 + panY * (h - H) / 2, w, h);
}
