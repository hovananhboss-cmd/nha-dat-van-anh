// Kịch bản chuyển động: mỗi cảnh điều khiển camera bản đồ + lớp đồ hoạ phía trên
import { bboxOf, haversine, sliceLine, circlePolygon, destPoint, edgeLengths, fmtDist, polygonArea, fmtArea, lineLength } from './geo.js';
import { CATS as CATS0 } from './data.js';
import {
  ease, clamp, seg, font, rrect, wrap, shadow, noShadow, plotMarker, poiPin, poiCard, pill, hexA, tint,
  drawCover, FONT, comet, measureCard, cardBox,
} from './overlay.js';

const ISO_COLORS = { 5: '#22c55e', 10: '#eab308', 15: '#f97316' };

const NOPAD = { top: 0, bottom: 0, left: 0, right: 0 };

function lerpPad(a = NOPAD, b = NOPAD, p) {
  const o = {};
  for (const k of ['top', 'bottom', 'left', 'right']) o[k] = (a[k] || 0) + ((b[k] || 0) - (a[k] || 0)) * p;
  return o;
}

function lerpCam(a, b, p, arc = 0) {
  const db = ((((b.bearing - a.bearing) % 360) + 540) % 360) - 180;
  // Tâm khung hình đi theo tỉ lệ zoom (giống flyTo): khi zoom mạnh, điểm đích luôn ở trong khung
  const dz = b.zoom - a.zoom;
  let c = p;
  if (Math.abs(dz) > 0.5) {
    const zl = a.zoom + dz * p;
    const w0 = Math.pow(2, -a.zoom), w1 = Math.pow(2, -b.zoom), w = Math.pow(2, -zl);
    c = clamp((w0 - w) / (w0 - w1));
  }
  return {
    center: [a.center[0] + (b.center[0] - a.center[0]) * c, a.center[1] + (b.center[1] - a.center[1]) * c],
    zoom: a.zoom + (b.zoom - a.zoom) * p - arc * Math.sin(Math.PI * p),
    pitch: a.pitch + (b.pitch - a.pitch) * p,
    bearing: a.bearing + db * p,
    pad: lerpPad(a.pad, b.pad, p),
  };
}

function arcFor(a, b, W) {
  const d = haversine(a.center, b.center);
  const z = Math.min(a.zoom, b.zoom);
  const view = (78271.517 * Math.cos((a.center[1] * Math.PI) / 180) / Math.pow(2, z)) * W;
  const r = d / view;
  return r > 0.6 ? clamp(Math.log2(r) + 0.8, 0, 3) : 0;
}

export function poiSub(poi, speedKmh) {
  const r = poi.route;
  if (!r) return `cách ~${fmtDist(poi.dist)}`;
  const mins = Math.max(1, Math.round((r.distance / 1000 / speedKmh) * 60));
  return r.road ? `${fmtDist(r.distance)} · ${mins} phút` : `~${fmtDist(r.distance)} · ~${mins} phút`;
}

function splitSentences(text, maxLen = 80) {
  const out = [];
  const parts = String(text || '')
    .split(/\s*\n\s*|(?<=[.!?…])\s+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (const s of parts) {
    if (s.length <= maxLen) { out.push(s); continue; }
    // Câu dài: tách tiếp theo dấu ; : , rồi gộp lại thành các đoạn ngắn
    const bits = s.split(/(?<=[;:,])\s+/);
    let cur = '';
    for (const b of bits) {
      if (cur && (cur + ' ' + b).length > maxLen) { out.push(cur); cur = b; }
      else cur = cur ? cur + ' ' + b : b;
    }
    while (cur.length > maxLen * 1.4) {
      const cut = cur.lastIndexOf(' ', maxLen);
      out.push(cur.slice(0, cut > 0 ? cut : maxLen));
      cur = cur.slice(cut > 0 ? cut + 1 : maxLen);
    }
    if (cur) out.push(cur);
  }
  return out;
}

export function buildTimeline(S) {
  const map = S.stage.map;
  const cw = map.getContainer().clientWidth;
  const chh = map.getContainer().clientHeight;
  const portrait = chh > cw * 1.2;
  const landscape = cw > chh * 1.2;
  const theme = S.opts.theme;
  const haze = S.haze || '#cfe0f2'; // màu sương chân trời theo mẫu bản đồ
  const CATS = S.opts.mono ? Object.fromEntries(Object.entries(CATS0).map(([k, v]) => [k, { ...v, color: theme }])) : CATS0;
  const pace = S.opts.pace || 1;
  const center = S.center;
  const plot = S.plot && S.plot.length >= 3 ? S.plot : null;
  const pois = S.pois;
  const speed = S.opts.speedKmh || 30;

  // Bố cục theo khung hình
  const L = landscape
    ? {
        plotPad: { top: chh * 0.22, bottom: chh * 0.22, left: cw * 0.1, right: cw * 0.52 },
        fitPad: { top: chh * 0.2, bottom: chh * 0.14, left: cw * 0.08, right: cw * 0.08 },
        info: { x: 0.53, y: 0.2, w: 0.42 },
        subY: 0.9,
        safe: { x0: 0.03, y0: 0.12, x1: 0.97, y1: 0.84 },
      }
    : {
        plotPad: { top: chh * 0.2, bottom: chh * (portrait ? 0.56 : 0.5), left: cw * 0.18, right: cw * 0.18 },
        fitPad: { top: chh * 0.2, bottom: chh * (portrait ? 0.45 : 0.34), left: cw * 0.12, right: cw * 0.12 }, // chừa chỗ thanh thông tin
        info: { x: 0.06, y: portrait ? 0.5 : 0.53, w: 0.88 },
        subY: portrait ? 0.8 : 0.9,
        safe: { x0: 0.04, y0: 0.11, x1: portrait ? 0.86 : 0.96, y1: portrait ? 0.74 : 0.84 }, // khung dọc: chừa nút TikTok/Reels bên phải
      };

  map.jumpTo({ padding: NOPAD }); // cameraForBounds cần padding = 0
  const fit = (coords, pad, maxZoom = 18.4, bearing = 0) => {
    const b = bboxOf(coords);
    if (b[0][0] === b[1][0] && b[0][1] === b[1][1]) return { center: b[0], zoom: Math.min(17, maxZoom) };
    const c = map.cameraForBounds(b, { padding: pad, maxZoom, bearing });
    if (!c) return { center: center, zoom: 15 };
    const cc = c.center.toArray ? c.center.toArray() : [c.center.lng, c.center.lat];
    return { center: cc, zoom: c.zoom };
  };

  // Camera flycam xoay quanh đúng tâm lô đất: dùng padding để đặt tâm lên vùng trống của khung hình
  const plotC = plot ? centroidOf(plot) : center;
  const plotCoords = plot || [center];
  const pc = fit(plotCoords, L.plotPad, plot ? 19 : 17.3);
  // Flycam: lô đất nằm chính giữa màn hình (chừa chỗ cho thẻ thông tin khi tắt Video sạch)
  const plotPad = S.opts.clean ? { ...NOPAD } : { top: 0, bottom: chh * (landscape ? 0 : 0.26), left: 0, right: landscape ? cw * 0.45 : 0 };
  const zPlot = plot ? Math.min(pc.zoom - 1.0, 17.9) : 16.7;
  const camPlot = { center: plotC, zoom: zPlot, pitch: 55, bearing: 0, pad: plotPad };
  const camStart = { center: plotC, zoom: Math.max(10, zPlot - 5.5), pitch: 0, bearing: 0, pad: plotPad };

  // ===== Flycam dẫn đường: camera bám theo đầu đường đang vẽ =====
  const pointAt = (coords, f) => { const part = sliceLine(coords, f); return part[part.length - 1]; };
  function chase(coords) {
    const len = Math.max(1, lineLength(coords));
    const lat = coords[0][1];
    const viewM = clamp(len * 0.5, 320, 26000);
    const zc = Math.log2((78271.517 * Math.cos((lat * Math.PI) / 180) * cw) / viewM);
    // Giữ hướng Bắc cố định (kiểu Vị Trí Studio): camera chỉ lia theo đầu đường, không xoay
    return { len, zc, cam: (f) => ({ center: pointAt(coords, f), zoom: zc, pitch: 45, bearing: 0, pad: NOPAD }) };
  }
  // Ghép 3 pha: tiếp cận → bám theo đầu đường → lùi ra toàn cảnh đường vừa vẽ
  function chaseCamFn(ch, a0, a1) {
    return function (p) {
      if (p < a0) return lerpCam(this.from, ch.cam(0), ease.inOut(p / a0), arcFor(this.from, ch.cam(0), cw) * 0.4);
      if (p < a1) return ch.cam(ease.inOut((p - a0) / (a1 - a0)));
      return lerpCam(ch.cam(1), this.to, ease.inOut((p - a1) / (1 - a1)));
    };
  }

  const scenes = [];
  let cam = camStart;
  const add = (sc) => {
    sc.dur *= pace;
    sc.from = sc.from || cam;
    if (sc.to) cam = sc.to;
    scenes.push(sc);
  };

  const roadsSel = S.roads || [];
  const info = S.info || {};
  const clean = !!S.opts.clean; // video sạch: không tiêu đề, giá, liên hệ, phụ đề
  const areaM2 = S.plotArea || (plot ? polygonArea(plot) : 0);
  const areaText = areaM2 ? fmtArea(areaM2) : (info.area || '');
  // Chiều dài các cạnh: ưu tiên số tính từ X,Y sổ đỏ (khớp số trên sổ)
  const lens = plot ? (S.plotEdges && S.plotEdges.length === plot.length ? S.plotEdges : edgeLengths(plot)) : [];
  const fmtM = (m) => (Math.round(m * 100) / 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' m';

  // Camera nhìn thẳng xuống lô đất (zoom sát để thấy rõ ranh và diện tích)
  const hasLot = !!(plot || areaText);
  // Lề vừa đủ cho nhãn cạnh và nhãn diện tích phía trên -> lô đất to, rõ số
  const fz = plot ? fit(plot, { top: chh * 0.24, bottom: chh * 0.16, left: cw * 0.16, right: cw * 0.16 }, 20.5) : { zoom: zPlot + 1 };
  // trần 20.5: zoom sâu hơn ảnh vệ tinh vỡ hạt
  const camTop = { center: plotC, zoom: Math.min(fz.zoom, 20.5), pitch: 0, bearing: camPlot.bearing, pad: NOPAD };

  // 1. Mở đầu – lao thẳng từ trên cao xuống lô đất
  add({
    name: 'intro', dur: 2.8, to: hasLot ? camTop : camPlot,
    cam(p) { return lerpCam(this.from, this.to, ease.inOut(seg(p, 0, 0.95))); },
    ms(p, lt) { return { plot: seg(p, 0.5, 1), glow: seg(p, 0.5, 1), plot3d: hasLot ? 0 : ease.out(seg(p, 0.55, 1)), roads: 0 }; },
    draw(ctx, p, lt, E) {
      if (!plot) drawPlotMarker(ctx, E, lt, seg(p, 0.5, 0.8), clean ? null : 'VỊ TRÍ');
      if (!clean) drawTitle(ctx, E, ease.out(seg(p, 0.1, 0.4)));
    },
  });

  // 1b. Giữ khung nhìn thẳng xuống: lô đất phát sáng + hiện diện tích lớn
  if (hasLot) {
    add({
      name: 'zoomlot', dur: plot ? 3.6 : 2.2, to: { ...camTop, zoom: camTop.zoom + 0.15 },
      cam(p) { return lerpCam(this.from, this.to, ease.inOut(p)); },
      ms(p, lt) { return { plot: 1, glow: 0.65 + 0.35 * Math.sin(lt * 5), plot3d: 0, roads: 0 }; },
      draw(ctx, p, lt, E) {
        if (!plot) drawPlotMarker(ctx, E, lt, 1, null);
        drawLotGlow(ctx, E, lt, ease.out(seg(p, 0, 0.12)));
        // Chỉ hiện chiều dài từng cạnh + diện tích (đã bỏ thẻ THÔNG TIN BẤT ĐỘNG SẢN)
        if (plot) drawDims(ctx, E, ease.out(seg(p, 0.06, 0.18)), true);
        drawAreaLabel(ctx, E, ease.back(seg(p, 0.12, 0.32)), true);
      },
    });
  }

  // 2. Flycam bay vòng quanh vị trí + thông tin
  const orbit = [0, 90, 180, 360].includes(+S.opts.orbit) ? +S.opts.orbit : 360;
  // 360°: 0 → 360 (kết thúc đúng hướng Bắc). 90°/180°: lia đối xứng quanh hướng Bắc để cảnh sau chỉ cần xoay về một nửa góc
  const orbitB0 = orbit >= 360 ? 0 : -orbit / 2;
  const orbitDur = orbit >= 360 ? 9 : orbit >= 180 ? 6.8 : orbit >= 90 ? 5.4 : 4.8;
  const camOrbit = { ...camPlot, bearing: camPlot.bearing + orbitB0 + orbit };
  const cardAt = orbit >= 180 ? 0.3 : 0.08; // để người xem thấy flycam trước khi hiện thẻ thông tin
  add({
    name: 'plot', dur: orbitDur + (roadsSel.length ? 0.8 : 0), to: camOrbit,
    cam(p) {
      const k = orbit >= 180 ? (1 - Math.cos(Math.PI * p)) / 2 : ease.inOut(p); // xoay đều, mượt hai đầu
      const orb = {
        center: plotC,
        zoom: zPlot + 0.45 * Math.sin(Math.PI * p),
        pitch: 60 + 4 * Math.sin(Math.PI * p),
        bearing: camPlot.bearing + orbitB0 + orbit * k,
        pad: plotPad,
      };
      // 25% đầu: nghiêng dần camera từ khung nhìn thẳng sang quỹ đạo flycam
      const b = ease.inOut(seg(p, 0, 0.25));
      if (b >= 1) return orb;
      const c = lerpCam(this.from, orb, b);
      c.bearing = this.from.bearing + (orb.bearing - this.from.bearing) * b;
      return c;
    },
    ms(p, lt) { return { plot: 0.6 + 0.4 * Math.sin(lt * 4), glow: 0.6 + 0.4 * Math.sin(lt * 4), plot3d: ease.inOut(seg(p, 0, 0.25)), roads: ease.out(seg(p, cardAt + 0.1, cardAt + 0.3)) }; },
    draw(ctx, p, lt, E) {
      drawLotGlow(ctx, E, lt, 1);
      if (plot && S.opts.showDims) drawDims(ctx, E, ease.out(seg(p, 0.1, 0.25)));
      if (!plot) drawPlotMarker(ctx, E, lt, 1, clean ? null : 'VỊ TRÍ');
      drawAreaLabel(ctx, E, 1, false);
      if (!clean) drawInfoCard(ctx, E, ease.out(seg(p, cardAt, cardAt + 0.15)), p > 0.94 ? 1 - seg(p, 0.94, 1) : 1);
    },
  });

  // 2b. Đường chính gần nhất: đường dẫn sáng từ lô đất tới điểm gần nhất trên tuyến
  const ROAD_CAT = { color: '#facc15', icon: '🛣️' };
  roadsSel.forEach((rd, i) => {
    const cn = rd.connector;
    if (!cn) return;
    const coords = cn.coords.length >= 2 ? cn.coords : [center, cn.point];
    const ctxPts = rd.lines.flat().filter((q) => haversine(q, cn.point) < 450);
    const ch = chase(coords);
    const fr = fit(coords.concat(ctxPts, [center]), L.fitPad, 18.2);
    const to = { ...fr, zoom: fr.zoom - 0.1, pitch: 40, bearing: 0, pad: NOPAD };
    const sub = cn.distance < 25 ? 'Ngay mặt tiền đường' : routeSub(cn.distance, cn.road);
    add({
      name: 'road', dur: 4, to,
      cam: chaseCamFn(ch, 0.18, 0.66),
      ms(p) {
        const f = ease.inOut(seg(p, 0.18, 0.66));
        return {
          plot: 1, glow: 0.5, roads: 0.45 + 0.55 * ease.out(seg(p, 0.55, 0.8)),
          routes: { type: 'FeatureCollection', features: f > 0 ? [lineF(sliceLine(coords, f), ROAD_CAT.color, true)] : [] },
          routesKey: `road${i}-${Math.round(f * 240)}`,
        };
      },
      draw(ctx, p, lt, E) {
        drawPlotMarker(ctx, E, lt, 1, null);
        const f = ease.inOut(seg(p, 0.18, 0.66));
        if (f > 0 && f < 1) drawComet(ctx, E, coords, f, ROAD_CAT.color, lt);
        const [x, y] = E.project(cn.point);
        poiPin(ctx, x, y, E.u, ROAD_CAT, ease.back(seg(p, 0.66, 0.8)));
        poiCard(ctx, x, y, E.u, ROAD_CAT, rd.name, sub, ease.out(seg(p, 0.7, 0.84)), { bounds: E.safe, place: y < E.H * 0.3 ? 'bottom' : 'top', tag: '🛣️ Đường chính' });
        drawHeader(ctx, E, '🛣️ ĐƯỜNG CHÍNH GẦN NHẤT', '', 1, true);
      },
    });
  });

  // 3. Vùng thời gian di chuyển
  if (S.iso && S.iso.length) {
    const all = [];
    for (const f of S.iso) flattenCoords(f.geometry.coordinates, all);
    const fi = fit(all, L.fitPad, 16);
    add({
      name: 'iso', dur: 4.6, to: { ...fi, pitch: 0, bearing: 0 },
      cam(p) { return lerpCam(this.from, this.to, ease.inOut(seg(p, 0, 0.45)), arcFor(this.from, this.to, cw) * 0.3); },
      ms(p) {
        return { plot: 1, roads: 0.5, iso: { 5: ease.out(seg(p, 0.3, 0.45)), 10: ease.out(seg(p, 0.48, 0.63)), 15: ease.out(seg(p, 0.66, 0.81)) } };
      },
      draw(ctx, p, lt, E) {
        drawPlotMarker(ctx, E, lt, 1, null);
        drawIsoLegend(ctx, E, p);
      },
    });
  }

  // 4. Tiện ích xung quanh
  const doneRoutes = [];
  // 4a. Radar quét theo bán kính chọn tiện ích: tia quét đi qua tiện ích nào thì tiện ích đó hiện lên
  if (pois.length && S.opts.mode !== 'radar') {
    const scanR = S.opts.radius || Math.max(...pois.map((x) => x.dist)) * 1.08;
    const fs = fit(circlePolygon(plotC, scanR, 24), L.fitPad, 17);
    const wide = { ...fs, pitch: 30, bearing: 0, pad: NOPAD };
    // quét xong thì sà xuống gần lô đất -> cảnh tiện ích đầu không phải zoom gắt
    const to = { center: plotC, zoom: Math.min(fs.zoom + 3.4, 17), pitch: 40, bearing: 0, pad: NOPAD };
    const kx = Math.cos((plotC[1] * Math.PI) / 180);
    const bs = pois.map((x) => ((Math.atan2((x.lngLat[0] - plotC[0]) * kx, x.lngLat[1] - plotC[1]) * 180) / Math.PI + 360) % 360);
    const headAt = (p) => 450 * seg(p, 0.18, 0.74); // 1 vòng + 1/4 vòng
    add({
      name: 'scan', dur: 6.6, to,
      pings: bs.map((b) => 0.18 + (b / 450) * 0.56), // thời điểm (tỉ lệ cảnh) tia quét đi qua từng tiện ích – cho SFX
      cam(p) {
        if (p < 0.76) return lerpCam(this.from, wide, ease.inOut(seg(p, 0, 0.2)), arcFor(this.from, wide, cw) * 0.3);
        return lerpCam(wide, to, ease.inOut(seg(p, 0.76, 1)));
      },
      ms() { return { plot: 1, glow: 0.7, plot3d: 0, roads: 0.3 }; },
      draw(ctx, p, lt, E) {
        const head = headAt(p), out = 1 - seg(p, 0.76, 0.88);
        drawRadar(ctx, E, lt, ease.out(seg(p, 0.12, 0.24)) * out, scanR, head);
        drawPlotMarker(ctx, E, lt, 1, null);
        drawLabeled(ctx, E, pois.map((x, i) => ({ lngLat: x.lngLat, title: x.name, sub: fmtDist(x.dist), cat: CATS[x.cat], a: ease.out(clamp((head - bs[i]) / 30)) * out })), 0.78);
        drawHeader(ctx, E, '📡 TIỆN ÍCH XUNG QUANH', `${pois.length} tiện ích trong bán kính ${fmtDist(scanR)}`, ease.out(seg(p, 0.05, 0.2)));
      },
    });
  }
  if (pois.length && S.opts.mode === 'radar') {
    const all = pois.map((x) => x.lngLat).concat([center]);
    const fr = fit(all, L.fitPad, 17);
    const maxD = Math.max(...pois.map((x) => x.dist)) * 1.08;
    add({
      name: 'radar', dur: 3 + pois.length * 0.45, to: { ...fr, pitch: 15, bearing: 0 },
      cam(p) { return lerpCam(this.from, this.to, ease.inOut(seg(p, 0, 0.3)), arcFor(this.from, this.to, cw) * 0.4); },
      ms(p) {
        const r = maxD * ease.inOut(seg(p, 0.25, 0.85));
        const q = Math.round(r / 5);
        return {
          plot: 1, roads: 0.5,
          radar: r > 1 ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePolygon(center, r)] } }] } : null,
          radarKey: 'r' + q,
        };
      },
      draw(ctx, p, lt, E) {
        const r = maxD * ease.inOut(seg(p, 0.25, 0.85));
        drawPlotMarker(ctx, E, lt, 1, null);
        const shown = pois.filter((x) => x.dist <= r);
        drawPoiLabels(ctx, E, shown.map((x) => ({ poi: x, a: 1 })), false, true);
        drawHeader(ctx, E, 'TIỆN ÍCH XUNG QUANH', `${pois.length} tiện ích trong bán kính ${fmtDist(maxD)}`, ease.out(seg(p, 0.05, 0.25)));
      },
    });
  } else {
    pois.forEach((poi, i) => {
      const coords = poi.route ? poi.route.coords : [center, poi.lngLat];
      const ch = chase(coords);
      const fp = fit(coords.concat([center, poi.lngLat]), L.fitPad, 17.6);
      const to = { ...fp, zoom: fp.zoom - 0.15, pitch: 40, bearing: 0, pad: NOPAD };
      const color = CATS[poi.cat].color;
      const prev = doneRoutes.slice();
      add({
        name: 'poi', dur: 3.4 + clamp(ch.len / 700, 0.4, 2.2), to,
        cam: chaseCamFn(ch, 0.14, 0.72),
        ms(p) {
          const f = ease.inOut(seg(p, 0.14, 0.72));
          const q = Math.round(f * 300);
          const features = prev.map((r) => lineF(r.coords, r.color, false));
          if (f > 0) features.push(lineF(sliceLine(coords, f), color, true));
          return { plot: 1, roads: 0.5, routes: { type: 'FeatureCollection', features }, routesKey: `p${i}-${q}` };
        },
        draw(ctx, p, lt, E) {
          drawPlotMarker(ctx, E, lt, 1, null);
          for (const d of prev) { const [x, y] = E.project(d.poi.lngLat); poiPin(ctx, x, y, E.u, CATS[d.poi.cat], 0.6); }
          const fr = ease.inOut(seg(p, 0.14, 0.72));
          if (fr > 0 && fr < 1) drawComet(ctx, E, coords, fr, color, lt);
          const pop = ease.back(seg(p, 0.7, 0.82));
          const [x, y] = E.project(poi.lngLat);
          poiPin(ctx, x, y, E.u, CATS[poi.cat], pop);
          drawPoiBar(ctx, E, poi, i, pois.length, ease.out(seg(p, 0.03, 0.14)) * (1 - seg(p, 0.95, 1)), fr);
        },
      });
      doneRoutes.push({ coords, color, poi });
    });
  }

  // 5. Toàn cảnh
  if (pois.length) {
    const all = pois.map((x) => x.lngLat).concat([center]);
    // chừa chỗ cho bảng chú giải: dưới (khung dọc/vuông) hoặc bên phải (khung ngang)
    const legFrac = ((84 + 50 * Math.min(pois.length, 10)) / 1080) * (Math.min(cw, chh) / chh);
    const ovPad = landscape ? { ...L.fitPad, right: cw * 0.42 } : { ...L.fitPad, bottom: chh * (1 - L.safe.y1 + legFrac) + 24 };
    const fo = fit(all, ovPad, 17);
    const to = { ...fo, zoom: fo.zoom - 0.1, pitch: 32, bearing: 0 };
    const to2 = { ...to, zoom: to.zoom + 0.15 };
    const routesFC = { type: 'FeatureCollection', features: doneRoutes.map((r) => lineF(r.coords, r.color, false)) };
    add({
      name: 'overview', dur: 4.6, to: to2,
      cam(p) {
        if (p < 0.4) return lerpCam(this.from, to, ease.inOut(p / 0.4), arcFor(this.from, to, cw) * 0.3);
        return lerpCam(to, to2, (p - 0.4) / 0.6);
      },
      ms() { return { plot: 1, roads: 0.5, routes: routesFC, routesKey: 'all' }; },
      draw(ctx, p, lt, E) {
        drawPlotMarker(ctx, E, lt, 1, clean ? null : 'VỊ TRÍ');
        pois.forEach((x, i) => {
          const a = ease.out(seg(p, 0.3 + i * 0.04, 0.45 + i * 0.04));
          const [px, py] = E.project(x.lngLat);
          poiPin(ctx, px, py, E.u * 0.8, CATS[x.cat], ease.back(a));
          numBadge(ctx, px + 26 * E.u, py - 26 * E.u, E.u, i + 1, CATS[x.cat].color, a);
        });
        drawLegend(ctx, E, p);
        drawHeader(ctx, E, 'KẾT NỐI THUẬN TIỆN', `${pois.length} tiện ích quanh khu vực`, ease.out(seg(p, 0.05, 0.25)));
      },
    });
  }

  // 5b. Kết nối vùng: vẽ lần lượt từng điểm mốc, camera bay theo, rồi cảnh tổng
  const lms = (S.landmarks || []).map((l) => (S.opts.mono ? { ...l, color: theme } : l));
  if (lms.length) {
    const lcoords = lms.map((l) => (l.route ? l.route.coords : [center, l.lngLat]));
    const lmItem = (l, a) => ({ lngLat: l.lngLat, title: l.short || l.name, sub: landmarkSub(l), cat: { color: l.color, icon: l.icon }, a });
    lms.forEach((l, i) => {
      const coords = lcoords[i];
      const ch = chase(coords);
      const fr = fit(coords.concat([center]), L.fitPad, 16);
      const to = { ...fr, zoom: fr.zoom - 0.1, pitch: 35, bearing: 0, pad: NOPAD };
      add({
        name: 'region', dur: 3.6 + clamp(ch.len / 12000, 0.6, 2.4), to,
        cam: chaseCamFn(ch, 0.24, 0.72),
        ms(p) {
          const f = ease.inOut(seg(p, 0.24, 0.72));
          const features = lms.slice(0, i).map((x, k) => lineF(lcoords[k], x.color, false));
          if (f > 0) features.push(lineF(sliceLine(coords, f), l.color, true));
          return { plot: 1, glow: 0.7, roads: 0.3, routes: { type: 'FeatureCollection', features }, routesKey: `lm${i}-${Math.round(f * 300)}` };
        },
        draw(ctx, p, lt, E) {
          drawPlotMarker(ctx, E, lt, 1, null);
          const f = ease.inOut(seg(p, 0.24, 0.72));
          if (f > 0 && f < 1) drawComet(ctx, E, coords, f, l.color, lt);
          drawLabeled(ctx, E, [lmItem(l, ease.out(seg(p, 0.74, 0.88)))], 1);
          drawHeader(ctx, E, '🌏 KẾT NỐI VÙNG', `${i + 1}/${lms.length}`, 1, true);
        },
      });
    });
    // Cảnh tổng: tất cả điểm mốc
    const all = [center];
    lms.forEach((l, i) => { all.push(l.lngLat); all.push(...lcoords[i].filter((_, k) => k % 8 === 0)); });
    const fa = fit(all, L.fitPad, 15);
    const to = { ...fa, zoom: fa.zoom - 0.15, pitch: 30, bearing: 0, pad: NOPAD };
    const to2 = { ...to, zoom: to.zoom + 0.12 };
    const allRoutes = { type: 'FeatureCollection', features: lms.map((l, i) => lineF(lcoords[i], l.color, false)) };
    add({
      name: 'region-all', dur: 3.6, to: to2,
      cam(p) {
        if (p < 0.35) return lerpCam(this.from, to, ease.inOut(p / 0.35), arcFor(this.from, to, cw) * 0.3);
        return lerpCam(to, to2, (p - 0.35) / 0.65);
      },
      ms() { return { plot: 1, glow: 0.7, roads: 0.3, routes: allRoutes, routesKey: 'lm-all' }; },
      draw(ctx, p, lt, E) {
        drawPlotMarker(ctx, E, lt, 1, null);
        drawLabeled(ctx, E, lms.map((l, i) => lmItem(l, ease.out(seg(p, 0.25 + i * 0.05, 0.4 + i * 0.05)))), 0.92);
        drawHeader(ctx, E, '🌏 KẾT NỐI VÙNG', `${lms.length} điểm mốc quan trọng`, ease.out(seg(p, 0.05, 0.2)));
      },
    });
  }

  // 5c. Hạ tầng giao thông đang thi công gần nhà
  const infra = S.infra || [];
  if (infra.length) {
    const all = [center];
    infra.forEach((f) => { f.segments.forEach(([, l]) => all.push(l[0], l[l.length - 1])); all.push(f.nearest.point); });
    const fi = fit(all, L.fitPad, 14);
    const to = { ...fi, zoom: fi.zoom - 0.1, pitch: 22, bearing: 0 };
    const n = infra.length;
    const kOf = (p, i) => ease.inOut(seg(p, 0.14 + i * (0.5 / n), 0.14 + i * (0.5 / n) + 0.32));
    const lOf = (p, i) => ease.out(seg(p, 0.7 + i * 0.04, 0.84 + i * 0.04));
    add({
      name: 'infra', dur: 3.4 + n * 1.5, to,
      cam(p) { return lerpCam(this.from, this.to, ease.inOut(seg(p, 0, 0.2)), arcFor(this.from, this.to, cw) * 0.6); },
      ms(p) {
        const features = [];
        let key = 'inf';
        infra.forEach((f, i) => {
          const k = kOf(p, i);
          key += ',' + Math.round(k * 80);
          for (const [o, l] of f.segments) if (o <= k) features.push({ type: 'Feature', properties: { color: f.color, kind: 'line' }, geometry: { type: 'LineString', coordinates: l } });
          const lk = lOf(p, i);
          if (lk > 0) {
            const q = f.nearest.point;
            const end = [center[0] + (q[0] - center[0]) * lk, center[1] + (q[1] - center[1]) * lk];
            features.push({ type: 'Feature', properties: { color: f.color, kind: 'link' }, geometry: { type: 'LineString', coordinates: [center, end] } });
            key += 'l' + Math.round(lk * 40);
          }
        });
        return { plot: 1, glow: 0.8, roads: 0, infra: { type: 'FeatureCollection', features }, infraKey: key };
      },
      draw(ctx, p, lt, E) {
        drawPlotMarker(ctx, E, lt, 1, null);
        drawLabeled(ctx, E, infra.map((f, i) => ({
          lngLat: f.nearest.point, title: '🚧 ' + f.name, sub: `cách ~${fmtDist(f.nearest.dist)}`, cat: { color: f.color, icon: '🚧' },
          a: ease.out(seg(lOf(p, i), 0.85, 1)),
        })), 0.9);
        drawHeader(ctx, E, '🚧 HẠ TẦNG ĐANG THI CÔNG', 'gần khu vực', ease.out(seg(p, 0.04, 0.2)));
      },
    });
  }

  // 6. Hình ảnh / video thực tế
  const media = S.media || [];
  const holdCam = cam;
  media.forEach((m, i) => {
    const prevM = i > 0 ? media[i - 1] : null;
    const dur = m.type === 'video' ? Math.min(m.duration || 4, 6) / pace : 2.7;
    add({
      name: 'media', dur, to: holdCam, media: m,
      cam(p) { return holdCam; },
      ms() { return { plot: 1, roads: 0.5, routesKey: 'all' }; },
      async prepare(lt) {
        if (m.type === 'video') await seekVideo(m.el, Math.min(lt, (m.duration || 0) - 0.05));
      },
      draw(ctx, p, lt, E) {
        const fadeIn = ease.out(seg(lt, 0, 0.35 * pace));
        if (prevM && fadeIn < 1) drawMedia(ctx, E, prevM, 1, 1);
        ctx.save();
        ctx.globalAlpha = fadeIn;
        drawMedia(ctx, E, m, p, i % 2 ? -1 : 1);
        ctx.restore();
        const g = ctx.createLinearGradient(0, E.H * 0.55, 0, E.H);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,.65)');
        ctx.fillStyle = g;
        ctx.globalAlpha = fadeIn;
        ctx.fillRect(0, E.H * 0.55, E.W, E.H * 0.45);
        ctx.globalAlpha = 1;
        if (!clean) pill(ctx, E.W * 0.06, E.H * 0.13, E.u, m.type === 'video' ? '🎬 VIDEO THỰC TẾ' : '📷 HÌNH ẢNH THỰC TẾ', hexA(theme, 0.95), '#fff', 22, 'left');
        if (info.price && !clean) {
          font(ctx, 46 * E.u, 800);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          shadow(ctx, 10 * E.u, 'rgba(0,0,0,.7)');
          ctx.fillStyle = '#fff';
          ctx.fillText(info.price, E.W * 0.06, E.H * (portrait ? 0.72 : 0.82));
          noShadow(ctx);
        }
      },
    });
  });

  // 7. Kết – liên hệ
  const camEnd = { ...camPlot, zoom: camPlot.zoom - 1.3, pitch: 45, bearing: 0, pad: NOPAD };
  add({
    name: 'outro', dur: 4.6, to: camEnd,
    cam(p) { return lerpCam(this.from, this.to, ease.inOut(p), arcFor(this.from, this.to, cw) * 0.4); },
    ms(p, lt) { return { plot: 1, glow: 0.6 + 0.4 * Math.sin(lt * 4), roads: 0.4, routesKey: 'all' }; },
    draw(ctx, p, lt, E) {
      drawPlotMarker(ctx, E, lt, 1, null);
      if (clean) { drawLotGlow(ctx, E, lt, 1); drawAreaLabel(ctx, E, 1, false); }
      else drawOutro(ctx, E, ease.out(seg(p, 0.1, 0.35)));
    },
  });

  // Tiêu đề chương ở cảnh đầu mỗi phần
  const CHAPTERS = { road: 'Đường chính', scan: 'Tiện ích xung quanh', radar: 'Tiện ích xung quanh', iso: 'Thời gian di chuyển', region: 'Kết nối vùng', infra: 'Hạ tầng giao thông' };
  for (const [n, title] of Object.entries(CHAPTERS)) { const sc = scenes.find((x) => x.name === n); if (sc) sc.chapter = title; }

  // Thời lượng & thời điểm bắt đầu
  let total = 0;
  for (const s of scenes) { s.start = total; total += s.dur; }

  // Kéo giãn theo độ dài giọng đọc nếu cần
  const voiceEnd = S.voiceDuration ? S.voiceDuration + (S.opts.voiceDelay || 0.5) + 0.8 : 0;
  if (voiceEnd > total) {
    const k = voiceEnd / total;
    total = 0;
    for (const s of scenes) { s.dur *= k; s.start = total; total += s.dur; }
  }

  // Phụ đề
  const subs = [];
  if (S.opts.subtitles && S.script) {
    const sentences = splitSentences(S.script);
    const t0 = S.voiceDuration ? S.opts.voiceDelay || 0.5 : 0.4;
    const t1 = S.voiceDuration ? t0 + S.voiceDuration : total - 0.3;
    const chars = sentences.reduce((a, s) => a + s.length + 8, 0);
    let t = t0;
    for (const s of sentences) {
      const d = ((s.length + 8) / chars) * (t1 - t0);
      subs.push({ text: s, start: t, end: t + d });
      t += d;
    }
  }

  // ===== hàm vẽ dùng chung =====
  function drawPlotMarker(ctx, E, lt, a, label = 'VỊ TRÍ') {
    if (a <= 0) return;
    const [x, y] = E.project(plot ? centroidOf(plot) : center);
    ctx.save();
    ctx.globalAlpha = a;
    plotMarker(ctx, x, y, E.u, lt, theme, label);
    ctx.restore();
  }

  // Nhãn diện tích nổi trên lô đất (phát sáng theo màu chủ đạo)
  function drawAreaLabel(ctx, E, a, big) {
    if (a <= 0.01 || !areaText) return;
    const u = E.u;
    const [x, y0] = E.project(plot ? centroidOf(plot) : center);
    let y = y0;
    if (plot) {
      // đặt phía trên lô đất (nhãn lớn đẩy cao hơn để không đè nhãn cạnh trên)
      const ys = plot.map((q) => E.project(q)[1]);
      y = Math.min(...ys) - (big ? 120 : 46) * u;
    }
    ctx.save();
    ctx.globalAlpha = Math.min(1, a);
    ctx.translate(x, y);
    ctx.scale(a, a);
    const size = big ? 58 : 34;
    font(ctx, size * u, 800);
    const w = ctx.measureText(areaText).width + 44 * u;
    const h = (size + 26) * u;
    shadow(ctx, 30 * u, hexA(theme, 0.9));
    rrect(ctx, -w / 2, -h / 2, w, h, h / 2);
    ctx.fillStyle = hexA(theme, 0.92);
    ctx.fill();
    noShadow(ctx);
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(areaText, 0, 2 * u);
    ctx.restore();
  }

  function drawTitle(ctx, E, a) {
    if (a <= 0) return;
    const u = E.u;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(0, (1 - a) * -30 * u);
    const x = E.W * 0.06, w = E.W * 0.88;
    let y = E.H * 0.1;
    const tag = (info.tag || 'BÁN').toUpperCase();
    pill(ctx, x, y + 22 * u, u, tag, theme, '#fff', 24, 'left');
    y += 60 * u;
    font(ctx, (landscape ? 56 : 54) * u, 800);
    const lines = wrap(ctx, info.title || 'Bất động sản', landscape ? w * 0.6 : w, 3);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    shadow(ctx, 14 * u, 'rgba(0,0,0,.65)', 2 * u);
    ctx.fillStyle = '#fff';
    ctx.lineJoin = 'round';
    lines.forEach((l, i) => {
      ctx.lineWidth = 8 * u;
      ctx.strokeStyle = 'rgba(15,23,42,.85)';
      ctx.strokeText(l, x, y + i * 66 * u);
      ctx.fillText(l, x, y + i * 66 * u);
    });
    noShadow(ctx);
    y += lines.length * 66 * u + 10 * u;
    if (info.address) {
      font(ctx, 26 * u, 600);
      const al = wrap(ctx, '📍 ' + info.address, landscape ? w * 0.6 : w, 2);
      al.forEach((l, i) => {
        ctx.lineWidth = 6 * u;
        ctx.strokeStyle = 'rgba(15,23,42,.85)';
        ctx.strokeText(l, x, y + i * 36 * u);
        ctx.fillStyle = '#fff';
        ctx.fillText(l, x, y + i * 36 * u);
      });
    }
    ctx.restore();
  }

  function infoRows() {
    const rows = [];
    const area = info.area || (plot ? fmtArea(polygonArea(plot)) + ' (đo trên bản đồ)' : '');
    if (info.price) rows.push(['💰', 'Giá', info.price]);
    if (area) rows.push(['📐', 'Diện tích', area]);
    if (info.size) rows.push(['↔️', 'Kích thước', info.size]);
    if (info.rooms) rows.push(['🛏️', 'Kết cấu', info.rooms]);
    if (info.direction) rows.push(['🧭', 'Hướng', info.direction]);
    if (info.legal) rows.push(['📜', 'Pháp lý', info.legal]);
    for (const line of String(info.extra || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3)) rows.push(['✅', '', line]);
    return rows.slice(0, 7);
  }

  function drawInfoCard(ctx, E, a, out = 1) {
    const rows = infoRows();
    if (!rows.length || a <= 0) return;
    const u = E.u;
    const x = E.W * L.info.x, w = E.W * L.info.w;
    let y = E.H * L.info.y;
    const rh = 58 * u;
    const h = rows.length * rh + 40 * u;
    ctx.save();
    ctx.globalAlpha = a * out;
    ctx.translate((1 - a) * 60 * u, 0);
    shadow(ctx, 24 * u, 'rgba(0,0,0,.35)', 8 * u);
    rrect(ctx, x, y, w, h, 24 * u);
    ctx.fillStyle = 'rgba(255,255,255,.96)';
    ctx.fill();
    noShadow(ctx);
    ctx.fillStyle = theme;
    rrect(ctx, x, y, w, 10 * u, 5 * u);
    ctx.fill();
    y += 26 * u;
    rows.forEach((r, i) => {
      const ra = ease.out(seg(a * rows.length * 1.0 - i * 0.6, 0, 1));
      ctx.globalAlpha = a * out * Math.max(ra, a >= 1 ? 1 : 0);
      const cy = y + i * rh + rh / 2;
      font(ctx, 28 * u, 600);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0f172a';
      ctx.fillText(r[0], x + 24 * u, cy);
      let tx = x + 74 * u;
      if (r[1]) {
        font(ctx, 24 * u, 600);
        ctx.fillStyle = '#64748b';
        ctx.fillText(r[1] + ':', tx, cy);
        tx += ctx.measureText(r[1] + ':').width + 12 * u;
      }
      font(ctx, r[1] === 'Giá' ? 32 * u : 27 * u, r[1] === 'Giá' ? 800 : 700);
      ctx.fillStyle = r[1] === 'Giá' ? theme : '#0f172a';
      const maxW = x + w - 24 * u - tx;
      const t = wrap(ctx, r[2], maxW, 1)[0] || '';
      ctx.fillText(t, tx, cy);
    });
    ctx.restore();
  }

  function drawDims(ctx, E, a, big = false) {
    if (a <= 0 || plot.length > 8) return;
    const pts = plot.map((q) => E.project(q));
    const span = Math.max(Math.max(...pts.map((q) => q[0])) - Math.min(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1])) - Math.min(...pts.map((q) => q[1])));
    if (span < 160 * E.u) return; // lô đất quá nhỏ trên màn hình
    const [cx, cy] = [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length];
    ctx.save();
    ctx.globalAlpha = a;
    pts.forEach((p1, i) => {
      const p2 = pts[(i + 1) % pts.length];
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (len < 70 * E.u) return;
      // đặt nhãn phía ngoài cạnh
      let mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
      const ox = mx - cx, oy = my - cy, ol = Math.hypot(ox, oy) || 1;
      const off = (big ? 34 : 24) * E.u;
      mx += (ox / ol) * off; my += (oy / ol) * off;
      shadow(ctx, 14 * E.u, hexA(theme, 0.8));
      pill(ctx, mx, my, E.u, fmtM(lens[i]), 'rgba(15,23,42,.92)', '#ffffff', big ? 34 : 21);
      noShadow(ctx);
    });
    ctx.restore();
  }


  // Radar quanh vị trí: vòng mốc + sóng lan + tia quét, nằm trên mặt đất (nghiêng theo camera)
  function drawRadar(ctx, E, lt, a, radarR, head) {
    if (a <= 0.01) return;
    const u = E.u;
    const ring = (r, n = 64) => circlePolygon(plotC, r, n).map((q) => E.project(q));
    const poly = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); };
    const [cx, cy] = E.project(plotC);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.lineJoin = 'round';
    // nền mờ + vòng mốc
    poly(ring(radarR));
    ctx.fillStyle = hexA(theme, 0.12);
    ctx.fill();
    for (const k of [1 / 3, 2 / 3, 1]) {
      poly(ring(radarR * k));
      ctx.strokeStyle = hexA(theme, k === 1 ? 0.85 : 0.4);
      ctx.lineWidth = (k === 1 ? 2.4 : 1.4) * u;
      ctx.stroke();
    }
    // tia quét: quạt 70° mờ dần về phía sau
    const SL = 14, SPAN = 70;
    for (let i = 0; i < SL; i++) {
      const b0 = head - SPAN * (i + 1) / SL, b1 = head - SPAN * i / SL;
      const pts = [[cx, cy]];
      for (let s = 0; s <= 3; s++) pts.push(E.project(destPoint(plotC, radarR, b0 + (b1 - b0) * s / 3)));
      poly(pts);
      ctx.closePath();
      ctx.fillStyle = hexA(theme, 0.5 * (1 - i / SL) ** 1.6);
      ctx.fill();
    }
    shadow(ctx, 14 * u, hexA(theme, 1));
    const tip = E.project(destPoint(plotC, radarR, head));
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tip[0], tip[1]);
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 2.4 * u;
    ctx.stroke();
    // sóng lan ra
    for (let k = 0; k < 2; k++) {
      const ph = (lt * 0.45 + k * 0.5) % 1;
      poly(ring(radarR * (0.15 + 0.85 * ph)));
      ctx.strokeStyle = hexA(theme, 0.9 * (1 - ph));
      ctx.lineWidth = (3 - 1.8 * ph) * u;
      ctx.stroke();
    }
    noShadow(ctx);
    // nhãn khoảng cách trên từng vòng (phía Đông)
    for (const k of [1 / 3, 2 / 3, 1]) {
      const [x, y] = E.project(destPoint(plotC, radarR * k, 90));
      pill(ctx, x, y, u, fmtDist(radarR * k), hexA(theme, 0.92), '#fff', 18);
    }
    ctx.restore();
  }

  function numBadge(ctx, x, y, u, n, color, a) {
    if (a <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.beginPath(); ctx.arc(x, y, 17 * u, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 3 * u; ctx.strokeStyle = color; ctx.stroke();
    font(ctx, 19 * u, 800);
    ctx.fillStyle = '#0f172a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x, y + 1 * u);
    ctx.restore();
  }

  // Bảng chú giải cảnh toàn cảnh: số thứ tự (khớp 1/8 ở cảnh dẫn đường) · tên · khoảng cách
  function drawLegend(ctx, E, p) {
    const a = ease.out(seg(p, 0.2, 0.4));
    if (a <= 0.01) return;
    const u = E.u, list = pois.slice(0, 10), rh = 50 * u, head = 64 * u;
    const h = head + list.length * rh + 20 * u;
    const x = landscape ? E.W * 0.6 : E.safe.x0, w = landscape ? E.W * 0.36 : E.safe.x1 - E.safe.x0;
    const y = (landscape ? E.safe.y0 + 70 * u : E.safe.y1 - h) + (1 - a) * 40 * u;
    ctx.save();
    ctx.globalAlpha = a;
    shadow(ctx, 26 * u, 'rgba(0,0,0,.5)');
    rrect(ctx, x, y, w, h, 26 * u);
    ctx.fillStyle = 'rgba(12,18,32,.86)';
    ctx.fill();
    noShadow(ctx);
    ctx.lineWidth = 2 * u; ctx.strokeStyle = hexA(theme, 0.8); ctx.stroke();
    font(ctx, 22 * u, 800);
    ctx.fillStyle = tint(theme, 0.35); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`📍 ${pois.length} TIỆN ÍCH GẦN NHẤT`, x + 26 * u, y + 36 * u);
    list.forEach((x0, i) => {
      const ra = ease.out(seg(p, 0.28 + i * 0.04, 0.42 + i * 0.04));
      if (ra <= 0) return;
      ctx.globalAlpha = a * ra;
      const cy = y + head + i * rh + rh / 2, cat = CATS[x0.cat];
      ctx.beginPath(); ctx.arc(x + 44 * u, cy, 17 * u, 0, Math.PI * 2);
      ctx.fillStyle = cat.color; ctx.fill();
      font(ctx, 19 * u, 800);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), x + 44 * u, cy + 1 * u);
      const r = x0.route, d = r ? r.distance : x0.dist;
      const dt = r ? `${fmtDist(d)} · ${Math.max(1, Math.round((d / 1000 / speed) * 60))}′` : `~${fmtDist(d)}`;
      font(ctx, 24 * u, 800);
      ctx.textAlign = 'right'; ctx.fillStyle = tint(cat.color);
      ctx.fillText(dt, x + w - 24 * u, cy);
      const dw = ctx.measureText(dt).width;
      font(ctx, 25 * u, 600);
      ctx.textAlign = 'left'; ctx.fillStyle = '#f1f5f9';
      ctx.fillText(`${cat.icon} ${wrap(ctx, x0.name, w - 120 * u - dw - 40 * u, 1)[0] || ''}`, x + 74 * u, cy);
    });
    ctx.restore();
  }

  // (8) Tiêu đề chương: chữ giãn cách lướt vào giữa khung trong 1,8 giây đầu cảnh – hiện cả khi Video sạch
  function drawChapter(ctx, E, title, tt) {
    const k = tt / 1.8;
    if (k <= 0 || k >= 1) return;
    const u = E.u, inn = ease.out(seg(k, 0, 0.28)), out = ease.in(seg(k, 0.72, 1));
    const a = inn * (1 - out), y = E.H * 0.42;
    ctx.save();
    ctx.globalAlpha = a;
    const band = ctx.createLinearGradient(0, 0, E.W, 0);
    band.addColorStop(0, 'rgba(0,0,0,0)'); band.addColorStop(0.5, 'rgba(0,0,0,.55)'); band.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, y - 80 * u, E.W, 160 * u);
    const lw = E.W * 0.32 * inn * (1 - out * 0.5);
    ctx.fillStyle = theme;
    ctx.fillRect(E.W / 2 - lw / 2, y + 46 * u, lw, 5 * u);
    font(ctx, (landscape ? 60 : 58) * u, 800);
    ctx.letterSpacing = `${Math.round(10 * u * (1.6 - 0.6 * inn))}px`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    shadow(ctx, 18 * u, hexA(theme, 0.9));
    ctx.fillStyle = '#fff';
    ctx.fillText(title.toLocaleUpperCase('vi'), E.W / 2, y - 6 * u + (1 - inn) * 24 * u - out * 24 * u);
    ctx.restore();
  }

  // Thanh thông tin cố định cạnh dưới (lower third) cho cảnh dẫn đường: loại · tên · khoảng cách đếm theo đường đang vẽ
  function drawPoiBar(ctx, E, poi, i, n, a, f) {
    if (a <= 0.01) return;
    const u = E.u, cat = CATS[poi.cat], col = tint(cat.color);
    const x = E.safe.x0, w = landscape ? E.W * 0.42 : Math.min(E.safe.x1 - x, E.W * 0.84); // chừa cạnh phải cho nút TikTok/Reels
    const h = 176 * u, y = E.safe.y1 - h + (1 - a) * 40 * u;
    ctx.save();
    ctx.globalAlpha = a;
    shadow(ctx, 26 * u, hexA(cat.color, 0.5));
    rrect(ctx, x, y, w, h, 28 * u);
    ctx.fillStyle = 'rgba(12,18,32,.86)';
    ctx.fill();
    noShadow(ctx);
    ctx.lineWidth = 2.5 * u;
    ctx.strokeStyle = hexA(cat.color, 0.9);
    ctx.stroke();
    // biểu tượng loại
    const cx = x + 66 * u, cy = y + h / 2;
    ctx.beginPath(); ctx.arc(cx, cy, 44 * u, 0, Math.PI * 2);
    ctx.fillStyle = cat.color; ctx.fill();
    ctx.lineWidth = 4 * u; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();
    font(ctx, 42 * u);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(cat.icon, cx, cy + 2 * u);
    const tx = x + 130 * u, tw = x + w - 28 * u - tx;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    font(ctx, 22 * u, 800);
    ctx.fillStyle = col;
    ctx.fillText(cat.label.toLocaleUpperCase('vi'), tx, y + 46 * u);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(226,232,240,.75)';
    ctx.fillText(`${i + 1}/${n}`, x + w - 28 * u, y + 46 * u);
    ctx.textAlign = 'left';
    font(ctx, 34 * u, 800);
    ctx.fillStyle = '#fff';
    ctx.fillText(wrap(ctx, poi.name, tw, 1)[0] || '', tx, y + 94 * u);
    // khoảng cách + số phút đếm tăng theo tiến độ vẽ đường
    const r = poi.route, pre = r && !r.road ? '~' : '';
    const dist = (r ? r.distance : poi.dist) * f;
    font(ctx, 36 * u, 800);
    ctx.fillStyle = col;
    const dt = pre + fmtDist(dist);
    ctx.fillText(dt, tx, y + 146 * u);
    if (r) {
      const mins = Math.max(1, Math.round((r.distance / 1000 / speed) * 60 * f));
      const dw = ctx.measureText(dt).width;
      font(ctx, 28 * u, 700);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(` · ${pre}${mins} phút`, tx + dw, y + 146 * u);
    }
    ctx.restore();
  }

  // Lô đất phát sáng (vẽ trên lớp đồ hoạ để luôn nổi bật, kể cả khi có nhà 3D)
  function drawLotGlow(ctx, E, lt, a) {
    if (!plot || a <= 0) return;
    const u = E.u;
    const pts = plot.map((q) => E.project(q));
    const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length, cy = pts.reduce((s, q) => s + q[1], 0) / pts.length;
    const path = (k = 1) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => { const X = cx + (x - cx) * k, Y = cy + (y - cy) * k; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.closePath();
    };
    const pulse = 0.5 + 0.5 * Math.sin(lt * 4);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.lineJoin = 'round';
    // nền lô đất sáng nhẹ
    path();
    ctx.fillStyle = hexA(theme, 0.22 + 0.12 * pulse);
    ctx.fill();
    // hào quang nhiều lớp
    for (const [lw, al, bl] of [[26, 0.16, 46], [12, 0.4, 26], [5, 0.95, 12]]) {
      shadow(ctx, bl * u, hexA(theme, 0.95));
      path();
      ctx.strokeStyle = hexA(theme, al + 0.1 * pulse);
      ctx.lineWidth = lw * u;
      ctx.stroke();
    }
    noShadow(ctx);
    // viền trắng sắc nét
    path();
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    ctx.lineWidth = 2.6 * u;
    ctx.stroke();
    // sóng sáng lan ra ngoài
    for (let k = 0; k < 2; k++) {
      const ph = (lt * 0.6 + k * 0.5) % 1;
      path(1 + ph * 0.9);
      ctx.strokeStyle = hexA(theme, (1 - ph) * 0.75);
      ctx.lineWidth = (3.5 - 2 * ph) * u;
      ctx.stroke();
    }
    // chấm sáng ở các góc
    for (const [x, y] of pts) {
      shadow(ctx, 16 * u, hexA(theme, 1));
      ctx.beginPath();
      ctx.arc(x, y, (6 + 2 * pulse) * u, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
    noShadow(ctx);
    ctx.restore();
  }

  function drawIsoLegend(ctx, E, p) {
    const u = E.u;
    drawHeader(ctx, E, 'THỜI GIAN DI CHUYỂN', `bằng ${S.opts.isoLabel || 'xe máy'} từ vị trí`, ease.out(seg(p, 0.05, 0.25)));
    const items = [[5, 0.3], [10, 0.48], [15, 0.66]];
    let x = E.W * 0.06;
    const y = E.H * (portrait ? 0.7 : 0.86);
    for (const [m, s] of items) {
      const a = ease.out(seg(p, s, s + 0.12));
      if (a <= 0) continue;
      ctx.save();
      ctx.globalAlpha = a;
      shadow(ctx, 10 * u);
      const b = pill(ctx, x, y, u, `${m} phút`, ISO_COLORS[m], '#fff', 28, 'left');
      noShadow(ctx);
      ctx.restore();
      x += b.w + 14 * u;
    }
  }

  function drawHeader(ctx, E, title, sub, a = 1, compact = false) {
    if (a <= 0 || clean) return; // video sạch: không tiêu đề chữ
    const u = E.u;
    ctx.save();
    ctx.globalAlpha = a;
    const x = E.W * 0.06;
    const y = E.H * 0.11;
    font(ctx, (compact ? 30 : 38) * u, 800);
    const tw = ctx.measureText(title).width;
    font(ctx, 22 * u, 600);
    const sw = sub ? ctx.measureText(sub).width : 0;
    const w = Math.max(tw, sw) + 44 * u;
    const h = (compact ? 50 : 62) * u + (sub ? 32 * u : 0);
    shadow(ctx, 16 * u, 'rgba(0,0,0,.35)', 4 * u);
    rrect(ctx, x, y - 10 * u, w, h, 18 * u);
    ctx.fillStyle = hexA('#0f172a', 0.86);
    ctx.fill();
    noShadow(ctx);
    ctx.fillStyle = theme;
    rrect(ctx, x, y - 10 * u, 10 * u, h, 5 * u);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    font(ctx, (compact ? 30 : 38) * u, 800);
    ctx.fillStyle = '#fff';
    ctx.fillText(title, x + 24 * u, y + 2 * u);
    if (sub) {
      font(ctx, 22 * u, 600);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(sub, x + 24 * u, y + (compact ? 42 : 52) * u);
    }
    ctx.restore();
  }

  function drawPoiLabels(ctx, E, items, compact, withSub) {
    drawLabeled(ctx, E, items.map((it) => ({
      lngLat: it.poi.lngLat, title: it.poi.name, cat: CATS[it.poi.cat], a: it.a,
      sub: withSub ? `cách ${fmtDist(it.poi.dist)}` : compact ? (it.poi.route ? fmtDist(it.poi.route.distance) : fmtDist(it.poi.dist)) : '',
    })), compact ? 0.8 : 0.88);
  }

  // Vẽ ghim + thẻ tên, tự chọn vị trí thẻ để không chồng lên nhau / ra ngoài khung
  function drawLabeled(ctx, E, items, scale = 0.9) {
    const uu = E.u * scale;
    const placed = [];
    const [px, py] = E.project(plot ? centroidOf(plot) : center);
    placed.push({ x: px - 50 * E.u, y: py - 150 * E.u, w: 100 * E.u, h: 170 * E.u });
    const positions = items.map((it) => ({ ...it, xy: E.project(it.lngLat) }));
    for (const it of positions) if (it.a > 0.01) poiPin(ctx, it.xy[0], it.xy[1], uu, it.cat, ease.back(Math.min(1, it.a)));
    // thẻ không được che ghim của tiện ích khác
    for (const it of positions) if (it.a > 0.01) placed.push({ x: it.xy[0] - 40 * uu, y: it.xy[1] - 40 * uu, w: 80 * uu, h: 80 * uu });
    for (const it of positions) {
      if (it.a <= 0.01) continue;
      const [x, y] = it.xy;
      const tag = it.tag ? it.tag.toLocaleUpperCase('vi') : '';
      const m = measureCard(ctx, uu, it.title, it.sub, 360 * E.u, tag);
      let ok = null, best = null, bestCost = Infinity;
      for (const place of ['top', 'bottom', 'right', 'left', 'tr', 'tl', 'br', 'bl']) {
        const box = cardBox(x, y, uu, m, place);
        const sf = E.safe;
        if (box.x < sf.x0 || box.y < sf.y0 || box.x + box.w > sf.x1 || box.y + box.h > sf.y1) continue;
        const cost = placed.reduce((acc, b) => acc + overlapArea(b, box), 0);
        if (cost === 0) { ok = place; placed.push(box); break; }
        if (cost < bestCost) { bestCost = cost; best = [place, box]; }
      }
      // Không có chỗ trống hoàn toàn: chọn vị trí bị che ít nhất (nếu che < 12% thẻ), còn lại chỉ hiện ghim
      if (!ok && best && bestCost < 0.12 * best[1].w * best[1].h) { ok = best[0]; placed.push(best[1]); }
      if (ok) poiCard(ctx, x, y, uu, it.cat, it.title, it.sub, it.a, { place: ok, maxW: 360 * E.u, tag: it.tag });
    }
  }

  function drawComet(ctx, E, coords, f, color, lt) {
    const part = sliceLine(coords, f);
    const [x, y] = E.project(part[part.length - 1]);
    comet(ctx, x, y, E.u, color, lt);
  }

  function routeSub(dist, onRoad) {
    const mins = Math.max(1, Math.round((dist / 1000 / speed) * 60));
    return `${onRoad ? '' : '~'}${fmtDist(dist)} · ${fmtMins(mins)}`;
  }

  function landmarkSub(l) {
    const r = l.route;
    if (!r) return `~${fmtDist(haversine(center, l.lngLat) * 1.3)}`;
    // đường dài: dùng thời gian ô tô của OSRM + 30% kẹt xe; quãng ngắn: theo tốc độ đã chọn
    const mins = r.road && r.duration && r.distance > 8000 ? Math.round((r.duration * 1.3) / 60) : Math.round((r.distance / 1000 / speed) * 60);
    return `${r.road ? '' : '~'}${fmtDist(r.distance)} · ${fmtMins(Math.max(1, mins))}`;
  }

  function drawMedia(ctx, E, m, p, dir) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, E.W, E.H);
    if (m.type === 'video') drawCover(ctx, m.el, E.W, E.H, 1, 0, 0);
    else drawCover(ctx, m.el, E.W, E.H, 1.02 + 0.1 * p, dir * (p - 0.5) * 0.8, 0);
  }

  function drawOutro(ctx, E, a) {
    if (a <= 0) return;
    const u = E.u;
    ctx.save();
    ctx.globalAlpha = a;
    const g = ctx.createLinearGradient(0, 0, 0, E.H);
    g.addColorStop(0, 'rgba(15,23,42,.55)');
    g.addColorStop(0.5, 'rgba(15,23,42,.8)');
    g.addColorStop(1, 'rgba(15,23,42,.92)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, E.W, E.H);
    const cx = E.W / 2;
    let y = E.H * (portrait ? 0.3 : 0.2);
    pill(ctx, cx, y, u, 'LIÊN HỆ XEM NHÀ', theme, '#fff', 28);
    y += 90 * u;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    if (info.agent) {
      font(ctx, 40 * u, 700);
      ctx.fillStyle = '#fff';
      ctx.fillText(info.agent, cx, y);
      y += 60 * u;
    }
    if (info.phone) {
      font(ctx, 84 * u, 800);
      ctx.fillStyle = '#facc15';
      ctx.fillText(info.phone, cx, y);
      y += 110 * u;
      font(ctx, 30 * u, 600);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText('📞 Gọi điện  ·  💬 Zalo', cx, y);
      y += 70 * u;
    }
    if (info.price) {
      font(ctx, 34 * u, 700);
      ctx.fillStyle = '#fff';
      ctx.fillText('Giá: ' + info.price, cx, y);
      y += 56 * u;
    }
    if (info.title) {
      font(ctx, 26 * u, 500);
      ctx.fillStyle = '#cbd5e1';
      const lines = wrap(ctx, info.title, E.W * 0.8, 2);
      lines.forEach((l, i) => ctx.fillText(l, cx, y + i * 36 * u));
    }
    ctx.restore();
  }

  function drawGlobal(ctx, E, t, scene) {
    const u = E.u;
    // Thẻ môi giới góc trên
    if (!clean && scene.name !== 'outro' && (info.agent || info.phone)) {
      ctx.save();
      ctx.globalAlpha = 0.95;
      const txt = [info.agent, info.phone].filter(Boolean).join(' · ');
      shadow(ctx, 8 * u);
      pill(ctx, E.W * 0.06, E.H * 0.055, u, txt, 'rgba(255,255,255,.95)', '#0f172a', 20, 'left');
      noShadow(ctx);
      ctx.restore();
    }
    // Phụ đề
    const sub = subs.find((s) => t >= s.start && t < s.end);
    if (sub && !clean && scene.name !== 'outro') {
      font(ctx, 34 * u, 700);
      const lines = wrap(ctx, sub.text, E.W * 0.86, 3);
      const lh = 46 * u;
      const y0 = E.H * L.subY - (lines.length * lh) / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      lines.forEach((l, i) => {
        ctx.lineWidth = 9 * u;
        ctx.strokeStyle = 'rgba(0,0,0,.85)';
        ctx.strokeText(l, E.W / 2, y0 + i * lh);
        ctx.fillStyle = '#fff';
        ctx.fillText(l, E.W / 2, y0 + i * lh);
      });
    }
    // Ghi công bản đồ (bắt buộc theo giấy phép)
    font(ctx, 15 * u, 500);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.strokeText(S.credit, E.W - 10 * u, E.H - 8 * u);
    ctx.fillText(S.credit, E.W - 10 * u, E.H - 8 * u);
  }

  function locate(t) {
    t = clamp(t, 0, total - 1e-6);
    let s = scenes[scenes.length - 1];
    for (const sc of scenes) if (t >= sc.start && t < sc.start + sc.dur) { s = sc; break; }
    const lt = t - s.start;
    return { s, lt, p: clamp(lt / s.dur) };
  }

  return {
    duration: total,
    scenes,
    subs,
    // Đặt camera và lớp bản đồ cho thời điểm t
    applyMap(t) {
      const { s, p, lt } = locate(t);
      const c = s.cam(p);
      map.jumpTo({ center: c.center, zoom: c.zoom, pitch: c.pitch, bearing: c.bearing, padding: c.pad || NOPAD });
      const ms = s.ms(p, lt) || {};
      if (!('routesKey' in ms)) { ms.routesKey = 'none'; ms.routes = null; }
      if (ms.routesKey === 'all') ms.routes = { type: 'FeatureCollection', features: doneRoutes.map((r) => lineF(r.coords, r.color, false)) };
      if (!('radarKey' in ms)) { ms.radarKey = 'none'; ms.radar = null; }
      if (!('infraKey' in ms)) { ms.infraKey = 'none'; ms.infra = null; }
      // tên đường chỉ hiện khi camera giữ hướng Bắc: mờ đi lúc flycam bắt đầu xoay, hiện lại 1 giây sau khi bay xong
      const orb = scenes.find((x) => x.name === 'plot');
      if (orb) {
        const end = orb.start + orb.dur;
        ms.labels = s === orb ? 1 - seg(p, 0, 0.12) : t >= end ? clamp(t - end) : 1;
      }
      S.stage.apply(ms);
    },
    async prepare(t) {
      const { s, lt } = locate(t);
      if (s.prepare) await s.prepare(lt);
    },
    // Vẽ lớp đồ hoạ (W,H: kích thước pixel của canvas đích)
    drawOverlay(ctx, W, H, t) {
      const { s, p, lt } = locate(t);
      const sx = W / cw, sy = H / chh;
      const E = {
        W, H, u: Math.min(W, H) / 1080, t,
        safe: { x0: L.safe.x0 * W, y0: L.safe.y0 * H, x1: L.safe.x1 * W, y1: L.safe.y1 * H },
        project: (ll) => { const pt = map.project(ll); return [pt.x * sx, pt.y * sy]; },
      };
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.hypot(W, H) / 2);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,.45)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
      // sương chân trời: camera càng nghiêng, mép trên càng mờ như không khí xa (theo pitch khung hiện tại)
      const hz = clamp((map.getPitch() - 25) / 35);
      if (hz > 0) {
        const hg = ctx.createLinearGradient(0, 0, 0, H * 0.42);
        hg.addColorStop(0, hexA(haze, 0.62 * hz));
        hg.addColorStop(0.45, hexA(haze, 0.22 * hz));
        hg.addColorStop(1, hexA(haze, 0));
        ctx.fillStyle = hg;
        ctx.fillRect(0, 0, W, H * 0.42);
      }
      ctx.save();
      s.draw(ctx, p, lt, E);
      ctx.restore();
      if (s.chapter) { ctx.save(); drawChapter(ctx, E, s.chapter, t - s.start); ctx.restore(); }
      ctx.save();
      drawGlobal(ctx, E, t, s);
      ctx.restore();
    },
  };
}

function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function fmtMins(m) {
  if (m < 60) return `${m} phút`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} giờ ${r} phút` : `${h} giờ`;
}

function lineF(coords, color, active) {
  return { type: 'Feature', properties: { color, active }, geometry: { type: 'LineString', coordinates: coords } };
}

function centroidOf(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

function flattenCoords(c, out) {
  if (typeof c[0] === 'number') out.push(c);
  else for (const x of c) flattenCoords(x, out);
}

function seekVideo(v, t) {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return resolve();
    const done = () => { v.removeEventListener('seeked', done); resolve(); };
    v.addEventListener('seeked', done);
    v.currentTime = Math.max(0, t);
    setTimeout(done, 2000);
  });
}
