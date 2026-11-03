// Kịch bản chuyển động: mỗi cảnh điều khiển camera bản đồ + lớp đồ hoạ phía trên
import { bboxOf, haversine, sliceLine, circlePolygon, edgeLengths, fmtDist, polygonArea, fmtArea, nearestOnLine } from './geo.js';
import { CATS } from './data.js';
import {
  ease, clamp, seg, font, rrect, wrap, shadow, noShadow, plotMarker, poiPin, poiCard, pill, hexA,
  drawCover, boxesOverlap, FONT,
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
  return {
    center: [a.center[0] + (b.center[0] - a.center[0]) * p, a.center[1] + (b.center[1] - a.center[1]) * p],
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
        fitPad: { top: chh * 0.2, bottom: chh * (portrait ? 0.3 : 0.22), left: cw * 0.12, right: cw * 0.12 },
        info: { x: 0.06, y: portrait ? 0.5 : 0.53, w: 0.88 },
        subY: portrait ? 0.8 : 0.9,
        safe: { x0: 0.04, y0: 0.11, x1: 0.96, y1: portrait ? 0.74 : 0.84 },
      };

  map.jumpTo({ padding: NOPAD }); // cameraForBounds cần padding = 0
  const fit = (coords, pad, maxZoom = 18.4) => {
    const b = bboxOf(coords);
    if (b[0][0] === b[1][0] && b[0][1] === b[1][1]) return { center: b[0], zoom: Math.min(17, maxZoom) };
    const c = map.cameraForBounds(b, { padding: pad, maxZoom });
    if (!c) return { center: center, zoom: 15 };
    const cc = c.center.toArray ? c.center.toArray() : [c.center.lng, c.center.lat];
    return { center: cc, zoom: c.zoom };
  };

  // Camera flycam xoay quanh đúng tâm lô đất: dùng padding để đặt tâm lên vùng trống của khung hình
  const plotC = plot ? centroidOf(plot) : center;
  const plotCoords = plot || [center];
  const pc = fit(plotCoords, L.plotPad, plot ? 19 : 17.3);
  const plotPad = { top: L.plotPad.top, bottom: L.plotPad.bottom, left: L.plotPad.left, right: L.plotPad.right };
  const zPlot = plot ? Math.min(pc.zoom - 0.5, 18.4) : 17.2;
  const camPlot = { center: plotC, zoom: zPlot, pitch: 60, bearing: -25, pad: plotPad };
  const camStart = { center: plotC, zoom: Math.max(10, zPlot - 5.5), pitch: 0, bearing: -100, pad: plotPad };

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

  // Camera nhìn thẳng xuống lô đất (zoom sát để thấy rõ ranh và diện tích)
  const hasLot = !!(plot || areaText);
  const fz = plot ? fit(plot, { top: chh * 0.3, bottom: chh * 0.3, left: cw * 0.25, right: cw * 0.25 }, 20) : { zoom: zPlot + 1 };
  const camTop = { center: plotC, zoom: Math.min(fz.zoom, 20), pitch: 0, bearing: camPlot.bearing, pad: NOPAD };

  // 1. Mở đầu – lao thẳng từ trên cao xuống lô đất
  add({
    name: 'intro', dur: 3.6, to: hasLot ? camTop : camPlot,
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
      name: 'zoomlot', dur: 2.8, to: { ...camTop, zoom: camTop.zoom + 0.15 },
      cam(p) { return lerpCam(this.from, this.to, ease.inOut(p)); },
      ms(p, lt) { return { plot: 1, glow: 0.65 + 0.35 * Math.sin(lt * 5), plot3d: 0, roads: 0 }; },
      draw(ctx, p, lt, E) {
        if (!plot) drawPlotMarker(ctx, E, lt, 1, null);
        drawAreaLabel(ctx, E, ease.back(seg(p, 0.05, 0.3)), true);
      },
    });
  }

  // 2. Flycam bay vòng quanh vị trí + thông tin
  const orbit = S.opts.orbit ?? 360;
  const orbitDur = orbit >= 360 ? 9 : orbit >= 180 ? 6.8 : orbit >= 90 ? 5.4 : 4.8;
  const camOrbit = { ...camPlot, bearing: camPlot.bearing + (orbit || 38) };
  const cardAt = orbit >= 180 ? 0.3 : 0.08; // để người xem thấy flycam trước khi hiện thẻ thông tin
  add({
    name: 'plot', dur: orbitDur + (roadsSel.length ? 0.8 : 0), to: camOrbit,
    cam(p) {
      const k = orbit >= 180 ? (1 - Math.cos(Math.PI * p)) / 2 : ease.inOut(p); // xoay đều, mượt hai đầu
      const orb = {
        center: plotC,
        zoom: zPlot + 0.45 * Math.sin(Math.PI * p),
        pitch: 60 + 4 * Math.sin(Math.PI * p),
        bearing: camPlot.bearing + (orbit || 38) * k,
        pad: plotPad,
      };
      // 25% đầu: nghiêng dần camera từ khung nhìn thẳng sang quỹ đạo flycam
      const b = ease.inOut(seg(p, 0, 0.25));
      if (b >= 1) return orb;
      const c = lerpCam(this.from, orb, b);
      c.bearing = this.from.bearing + (orb.bearing - this.from.bearing) * b;
      return c;
    },
    ms(p, lt) { return { plot: 0.6 + 0.4 * Math.sin(lt * 4), glow: 0.6 + 0.4 * Math.sin(lt * 4), plot3d: ease.inOut(seg(p, 0, 0.25)), roads: roadsSel.length ? ease.out(seg(p, cardAt + 0.1, cardAt + 0.3)) : 0 }; },
    draw(ctx, p, lt, E) {
      if (roadsSel.length) drawRoadLabels(ctx, E, ease.out(seg(p, cardAt + 0.15, cardAt + 0.3)));
      if (plot && S.opts.showDims) drawDims(ctx, E, ease.out(seg(p, 0.1, 0.25)));
      if (!plot) drawPlotMarker(ctx, E, lt, 1, clean ? null : 'VỊ TRÍ');
      drawAreaLabel(ctx, E, 1, false);
      if (!clean) drawInfoCard(ctx, E, ease.out(seg(p, cardAt, cardAt + 0.15)), p > 0.94 ? 1 - seg(p, 0.94, 1) : 1);
    },
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
      const fp = fit(coords.concat([center, poi.lngLat]), L.fitPad, 17.6);
      const to = { ...fp, zoom: fp.zoom - 0.15, pitch: 38, bearing: i % 2 ? 8 : -8 };
      const color = CATS[poi.cat].color;
      const prev = doneRoutes.slice();
      add({
        name: 'poi', dur: 3.3, to,
        cam(p) { return lerpCam(this.from, this.to, ease.inOut(seg(p, 0, 0.42)), arcFor(this.from, this.to, cw) * 0.5); },
        ms(p) {
          const f = ease.inOut(seg(p, 0.2, 0.72));
          const q = Math.round(f * 300);
          const features = prev.map((r) => lineF(r.coords, r.color, false));
          if (f > 0) features.push(lineF(sliceLine(coords, f), color, true));
          return { plot: 1, roads: 0.5, routes: { type: 'FeatureCollection', features }, routesKey: `p${i}-${q}` };
        },
        draw(ctx, p, lt, E) {
          drawPlotMarker(ctx, E, lt, 1, null);
          for (const d of prev) { const [x, y] = E.project(d.poi.lngLat); poiPin(ctx, x, y, E.u, CATS[d.poi.cat], 0.7); }
          const pop = ease.back(seg(p, 0.66, 0.8));
          const [x, y] = E.project(poi.lngLat);
          poiPin(ctx, x, y, E.u, CATS[poi.cat], pop);
          poiCard(ctx, x, y, E.u, CATS[poi.cat], poi.name, poiSub(poi, speed), ease.out(seg(p, 0.7, 0.84)), { bounds: E.safe, place: y < E.H * 0.3 ? 'bottom' : 'top' });
          drawHeader(ctx, E, `${CATS[poi.cat].icon} ${CATS[poi.cat].label.toUpperCase()}`, `${i + 1}/${pois.length}`, 1, true);
        },
      });
      doneRoutes.push({ coords, color, poi });
    });
  }

  // 5. Toàn cảnh
  if (pois.length) {
    const all = pois.map((x) => x.lngLat).concat([center]);
    const fo = fit(all, L.fitPad, 17);
    const to = { ...fo, zoom: fo.zoom - 0.1, pitch: 32, bearing: cam.bearing || 0 };
    const to2 = { ...to, bearing: to.bearing + 14 };
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
        drawPoiLabels(ctx, E, pois.map((x, i) => ({ poi: x, a: ease.out(seg(p, 0.35 + i * 0.03, 0.5 + i * 0.03)) })), true, false);
        drawHeader(ctx, E, 'KẾT NỐI THUẬN TIỆN', `${pois.length} tiện ích quanh khu vực`, ease.out(seg(p, 0.05, 0.25)));
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
  const camEnd = { ...camPlot, zoom: camPlot.zoom - 1.3, pitch: 45, bearing: cam.bearing + 70, pad: NOPAD };
  add({
    name: 'outro', dur: 4.6, to: camEnd,
    cam(p) { return lerpCam(this.from, this.to, ease.inOut(p), arcFor(this.from, this.to, cw) * 0.4); },
    ms(p, lt) { return { plot: 1, glow: 0.6 + 0.4 * Math.sin(lt * 4), roads: 0.4, routesKey: 'all' }; },
    draw(ctx, p, lt, E) {
      drawPlotMarker(ctx, E, lt, 1, null);
      if (clean) drawAreaLabel(ctx, E, 1, false);
      else drawOutro(ctx, E, ease.out(seg(p, 0.1, 0.35)));
    },
  });

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
    if (plot && !big) {
      // đặt phía trên lô đất
      const ys = plot.map((q) => E.project(q)[1]);
      y = Math.min(...ys) - 46 * u;
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

  function drawDims(ctx, E, a) {
    if (a <= 0 || plot.length > 8) return;
    const lens = edgeLengths(plot);
    // Lô đất quá nhỏ trên màn hình thì không ghi kích thước (tránh chồng lên ghim)
    const pts = plot.map((q) => E.project(q));
    const span = Math.max(Math.max(...pts.map((q) => q[0])) - Math.min(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1])) - Math.min(...pts.map((q) => q[1])));
    if (span < 200 * E.u) return;
    ctx.save();
    ctx.globalAlpha = a;
    plot.forEach((p, i) => {
      const q = plot[(i + 1) % plot.length];
      const [x1, y1] = E.project(p), [x2, y2] = E.project(q);
      if (Math.hypot(x2 - x1, y2 - y1) < 110 * E.u) return;
      const txt = (Math.round(lens[i] * 10) / 10).toString().replace('.', ',') + ' m';
      pill(ctx, (x1 + x2) / 2, (y1 + y2) / 2, E.u, txt, 'rgba(15,23,42,.85)', '#fff', 20);
    });
    ctx.restore();
  }

  function drawRoadLabels(ctx, E, a) {
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    roadsSel.forEach((r) => {
      let best = null, bd = Infinity;
      for (const line of r.lines) {
        const p = nearestOnLine(center, line);
        const d = haversine(center, p);
        if (d < bd) { bd = d; best = p; }
      }
      if (!best) return;
      const [x, y] = E.project(best);
      const cx = clamp(x, E.W * 0.15, E.W * 0.85), cy = clamp(y, E.H * 0.12, E.H * 0.7);
      pill(ctx, cx, cy, E.u, '🛣️ ' + r.name, '#facc15', '#111827', 22);
    });
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
    const placed = [];
    const [px, py] = E.project(plot ? centroidOf(plot) : center);
    placed.push({ x: px - 40 * E.u, y: py - 130 * E.u, w: 80 * E.u, h: 140 * E.u });
    const positions = items.map((it) => ({ ...it, xy: E.project(it.poi.lngLat) }));
    for (const it of positions) poiPin(ctx, it.xy[0], it.xy[1], E.u, CATS[it.poi.cat], ease.back(Math.min(1, it.a)));
    for (const it of positions) {
      if (it.a <= 0.01) continue;
      const [x, y] = it.xy;
      const sub = withSub ? `cách ${fmtDist(it.poi.dist)}` : compact ? (it.poi.route ? fmtDist(it.poi.route.distance) : fmtDist(it.poi.dist)) : '';
      let ok = null;
      for (const place of ['top', 'bottom', 'right', 'left']) {
        const box = tryCard(ctx, E, x, y, it.poi, sub, place);
        if (!box) continue;
        if (placed.every((b) => !boxesOverlap(b, box, 6 * E.u))) { ok = place; placed.push(box); break; }
      }
      if (ok) poiCard(ctx, x, y, E.u * (compact ? 0.82 : 0.9), CATS[it.poi.cat], it.poi.name, sub, it.a, { place: ok, maxW: 300 * E.u, bounds: E.safe });
    }
  }

  function tryCard(ctx, E, x, y, poi, sub, place) {
    // đo hộp mà không vẽ
    const u = E.u * 0.86;
    font(ctx, 26 * u, 700);
    const lines = wrap(ctx, poi.name, 300 * E.u, 2);
    let w = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (sub) { font(ctx, 22 * u, 600); w = Math.max(w, ctx.measureText(sub).width); }
    w += 32 * u;
    const h = lines.length * 32 * u + (sub ? 30 * u : 0) + 22 * u;
    let bx = x - w / 2, by = y - 44 * u - h;
    if (place === 'bottom') by = y + 44 * u;
    if (place === 'left') { bx = x - 40 * u - w; by = y - h / 2; }
    if (place === 'right') { bx = x + 40 * u; by = y - h / 2; }
    const s = E.safe;
    if (bx < s.x0 || by < s.y0 || bx + w > s.x1 || by + h > s.y1) return null;
    return { x: bx, y: by, w, h };
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
      ctx.save();
      s.draw(ctx, p, lt, E);
      ctx.restore();
      ctx.save();
      drawGlobal(ctx, E, t, s);
      ctx.restore();
    },
  };
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
