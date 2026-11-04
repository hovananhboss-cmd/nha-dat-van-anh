import {
  parseLatLng, isShortGoogleLink, parseCornerRows, vn2000ToWgs84, autoMeridian, parseLon0, fmtMeridian, MERIDIANS,
  isSelfIntersecting, sortAroundCentroid, edgeLengths, PROVINCES, polygonArea, fmtArea, fmtDist, circlePolygon, centroid, haversine, bboxOf, nearestOnLine,
} from './geo.js';
import { LANDMARKS, INFRA_LIST, infraNearest } from './regional.js';
import { CATS, fetchSurroundings, fetchRoute, fetchIsochrones, geocode, unshortenMapsLink } from './data.js';
import { Stage, MAP_STYLES, styleFor } from './stage.js';
import { buildTimeline } from './scenes.js';
import { exportVideo, mixAudio, canExport } from './exporter.js';
import { generateScript, TONES } from './script.js';
import { musicLoop } from './sound.js';

const $ = (id) => document.getElementById(id);
const STAGE_SIZES = { '9:16': [540, 960], '16:9': [960, 540], '1:1': [720, 720] };
const OUT = {
  '9:16': { 1080: [1080, 1920], 720: [720, 1280] },
  '16:9': { 1080: [1920, 1080], 720: [1280, 720] },
  '1:1': { 1080: [1080, 1080], 720: [720, 720] },
};
const MAX_POI = 10;
const STORE = 'va-studio-v1';
const FIELDS = ['f_tag', 'f_price', 'f_title', 'f_address', 'f_area', 'f_size', 'f_rooms', 'f_direction', 'f_legal', 'f_extra', 'f_agent', 'f_phone',
  'o_aspect', 'o_style', 'o_mode', 'o_orbit', 'o_block', 'o_clean', 'o_pace', 'o_theme', 'o_preset', 'o_dims', 'o_subs', 'selRadius', 'chkIso', 'selIsoMode', 'inSpeed', 'selTone', 'inScript', 'musicVol', 'o_bgm', 'o_sfx', 'selRes', 'selProvince', 'inLon0', 'inCorners'];

const state = {
  center: null,
  plot: [],
  pois: [],
  custom: [],
  selected: [],
  roads: [],
  roadSel: [], roadMinor: [],
  lmSel: LANDMARKS.filter((l) => l.def).map((l) => l.id),
  lmCustom: [],
  infraSel: INFRA_LIST.map((x) => x.id),
  iso: null,
  isoKey: '',
  media: [],
  voice: null, voiceName: '',
  music: null, musicName: '',
};

let editor, centerMarker, editMode = 'center';
let poiMarkers = [];
let stage, timeline = null, mixed = null, dirty = true;
let playing = false, playT = 0, lastTs = 0;
let audioCtx = null, audioSrc = null;
let exportAbort = null;

// ---------- tiện ích UI ----------
function toast(msg, err = false, ms = 3800) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = 'toast'), ms);
}
const status = (s) => ($('status').textContent = s || '');
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const val = (id) => { const el = $(id); return el.type === 'checkbox' ? el.checked : el.value; };
const markDirty = () => { dirty = true; };
const allPois = () => state.pois.concat(state.custom);
const getPoi = (id) => allPois().find((p) => p.id === id);
const origin = () => (state.plot.length >= 3 ? centroid(state.plot) : state.center);

function info() {
  const o = {};
  for (const k of ['tag', 'price', 'title', 'address', 'area', 'size', 'rooms', 'direction', 'legal', 'extra', 'agent', 'phone']) o[k] = val('f_' + k).trim();
  return o;
}

// ---------- lưu / khôi phục ----------
function snapshot() {
  const f = {};
  for (const id of FIELDS) f[id] = val(id);
  return {
    v: 2,
    center: state.center, plot: state.plot, pois: state.pois.slice(0, 500).map(stripRoute), custom: state.custom.map(stripRoute),
    selected: state.selected, roads: state.roads.map(({ connector, ...r }) => r), roadSel: state.roadSel, roadMinor: state.roadMinor, plotAreaExact: state.plotAreaExact || 0, plotEdgesExact: state.plotEdgesExact || null,
    lmSel: state.lmSel, lmCustom: state.lmCustom.map(stripRoute), infraSel: state.infraSel, fields: f,
  };
}
function stripRoute(p) { const { route, routeFrom, ...rest } = p; return rest; }
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(snapshot())); } catch (_) {}
  prefetchRoutes();
}

// Tính sẵn đường đi trong lúc người dùng chọn -> bấm "Dựng & xem trước" không phải chờ OSRM
function prefetchRoutes() {
  clearTimeout(prefetchRoutes._t);
  prefetchRoutes._t = setTimeout(() => {
    if (!state.center || val('o_mode') !== 'flyover') return;
    const o = origin();
    for (const p of state.selected.map(getPoi).filter(Boolean)) fetchRoute(o, p.lngLat);
    for (const l of allLandmarks().filter((x) => state.lmSel.includes(x.id) && haversine(o, x.lngLat) <= LM_MAX_KM * 1000)) fetchRoute(o, l.lngLat);
  }, 1500);
}
function restore(data) {
  if (!data) return;
  Object.assign(state, {
    center: data.center || null, plot: data.plot || [], pois: data.pois || [], custom: data.custom || [],
    selected: data.selected || [], roads: data.roads || [], roadSel: data.roadSel || [], roadMinor: data.roadMinor || [], plotAreaExact: data.plotAreaExact || 0, plotEdgesExact: data.plotEdgesExact || null,
    lmSel: data.lmSel || state.lmSel, lmCustom: data.lmCustom || [], infraSel: data.infraSel || state.infraSel,
  });
  const fields = { ...(data.fields || {}) };
  if ((data.v || 1) < 2) { fields.o_style = 'satellite'; fields.o_orbit = '360'; } // mặc định mới: vệ tinh + tên đường, bay 1 vòng
  for (const [id, v] of Object.entries(fields)) {
    const el = $(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  }
}

// ---------- bản đồ chỉnh sửa ----------
function initEditor() {
  editor = new maplibregl.Map({
    container: 'editorMap',
    style: styleFor('liberty'),
    center: state.center || [106.7009, 10.7769],
    zoom: state.center ? 16 : 11,
    attributionControl: { compact: true },
  });
  editor.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  editor.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'top-right');
  editor.on('style.load', addEditorLayers);
  editor.on('click', onEditorClick);
  const el = document.createElement('div');
  el.className = 'va-center-pin';
  el.textContent = '📍';
  centerMarker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' });
  centerMarker.on('dragend', () => { const ll = centerMarker.getLngLat(); setCenter([ll.lng, ll.lat], false); });
  if (state.center) centerMarker.setLngLat(state.center).addTo(editor);
}

function addEditorLayers() {
  const m = editor;
  m.addSource('e-plot', { type: 'geojson', data: plotFC() });
  m.addSource('e-corners', { type: 'geojson', data: cornersFC() });
  m.addSource('e-radius', { type: 'geojson', data: radiusFC() });
  m.addSource('e-preview', { type: 'geojson', data: { type: 'FeatureCollection', features: cornerResult ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...cornerResult, cornerResult[0]]] } }] : [] } });
  m.addLayer({ id: 'e-radius', type: 'line', source: 'e-radius', paint: { 'line-color': '#e11d48', 'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.7 } });
  m.addLayer({ id: 'e-plot-fill', type: 'fill', source: 'e-plot', paint: { 'fill-color': '#e11d48', 'fill-opacity': 0.3 } });
  m.addLayer({ id: 'e-plot-line', type: 'line', source: 'e-plot', paint: { 'line-color': '#e11d48', 'line-width': 2.5 } });
  m.addLayer({ id: 'e-preview-fill', type: 'fill', source: 'e-preview', paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.25 } });
  m.addLayer({ id: 'e-preview-line', type: 'line', source: 'e-preview', paint: { 'line-color': '#d97706', 'line-width': 3, 'line-dasharray': [2, 1.5] } });
  m.addLayer({ id: 'e-corners', type: 'circle', source: 'e-corners', paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#e11d48', 'circle-stroke-width': 2 } });
}

function plotFC() {
  const p = state.plot;
  if (p.length < 2) return { type: 'FeatureCollection', features: [] };
  const geom = p.length >= 3 ? { type: 'Polygon', coordinates: [[...p, p[0]]] } : { type: 'LineString', coordinates: p };
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: geom }] };
}
function cornersFC() {
  return { type: 'FeatureCollection', features: state.plot.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } })) };
}
function radiusFC() {
  if (!state.center) return { type: 'FeatureCollection', features: [] };
  const r = +val('selRadius');
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: circlePolygon(state.center, r) } }] };
}
function refreshEditor() {
  if (!editor || !editor.getSource('e-plot')) return;
  editor.getSource('e-plot').setData(plotFC());
  editor.getSource('e-corners').setData(cornersFC());
  editor.getSource('e-radius').setData(radiusFC());
  const a = state.plot.length >= 3 ? polygonArea(state.plot) : 0;
  $('plotArea').textContent = a ? `Diện tích đo: ${fmtArea(a)} · ${state.plot.length} góc` : state.plot.length ? `${state.plot.length} góc` : '';
  refreshPoiMarkers();
}

function refreshPoiMarkers() {
  poiMarkers.forEach((m) => m.remove());
  poiMarkers = state.selected.map(getPoi).filter(Boolean).map((p) => {
    const el = document.createElement('div');
    el.className = 'va-poi-pin';
    el.style.background = CATS[p.cat].color;
    el.textContent = CATS[p.cat].icon;
    el.title = p.name;
    return new maplibregl.Marker({ element: el }).setLngLat(p.lngLat).addTo(editor);
  });
}

function onEditorClick(e) {
  const ll = [e.lngLat.lng, e.lngLat.lat];
  if (editMode === 'center') setCenter(ll, false);
  else if (editMode === 'plot') {
    state.plot.push(ll);
    if (!state.center) setCenter(ll, false);
    afterPlotChange();
  } else if (editMode === 'poi') {
    const name = prompt('Tên tiện ích (VD: Trường THCS Lê Lợi):');
    if (!name) return;
    const keys = Object.keys(CATS);
    const menu = keys.map((k, i) => `${i + 1}. ${CATS[k].label}`).join('\n');
    const pick = prompt('Chọn loại (nhập số):\n' + menu, String(keys.length));
    const cat = keys[(parseInt(pick, 10) || keys.length) - 1] || 'custom';
    const p = { id: 'custom/' + Date.now(), name: name.trim(), cat, lngLat: ll, dist: state.center ? haversine(state.center, ll) : 0, custom: true };
    state.custom.push(p);
    if (state.selected.length < MAX_POI) state.selected.push(p.id);
    renderPoiList();
    refreshEditor();
    markDirty(); save();
  }
}

function afterPlotChange() {
  state.plotAreaExact = 0;
  state.plotEdgesExact = null;
  for (const p of allPois()) p.route = null;
  refreshEditor();
  markDirty(); save();
}

// Hiện lại vị trí app đang dùng (toạ độ kiểu Google Maps + link) để đối chiếu; dán lại ô này vẫn ra đúng điểm
function showCenter(ll) {
  const ts = `${ll[1].toFixed(7)}, ${ll[0].toFixed(7)}`;
  $('inLink').value = `${ts} · https://www.google.com/maps?q=${ts.replace(' ', '')}`;
}

function setCenter(ll, fly = true) {
  state.center = ll;
  showCenter(ll);
  centerMarker.setLngLat(ll).addTo(editor);
  if (fly) editor.flyTo({ center: ll, zoom: 17.5 });
  for (const p of allPois()) { p.dist = haversine(ll, p.lngLat); p.route = null; }
  state.iso = null;
  refreshEditor();
  renderPoiList();
  renderRegional();
  markDirty(); save();
}

function setEditMode(m) {
  editMode = m;
  for (const b of $('editMode').querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === m);
  $('modeHint').textContent = {
    center: 'Chạm lên bản đồ (hoặc kéo ghim 📍) để đặt vị trí chính xác.',
    plot: 'Chạm lần lượt vào từng góc của lô đất (theo chiều kim đồng hồ). Nên chuyển sang “Vệ tinh” và phóng to để vẽ chuẩn.',
    poi: 'Chạm vào vị trí tiện ích còn thiếu để thêm (trường, chợ, KCN…).',
  }[m];
  editor.getCanvas().style.cursor = m === 'center' ? '' : 'crosshair';
}

// ---------- tiện ích ----------
// Bộ màu đồng bộ: mono = mọi tiện ích dùng màu chủ đạo (phân biệt bằng biểu tượng)
const PRESETS = { gold: { theme: '#d4af37', mono: true }, modern: { theme: '#2563eb', mono: true }, neon: { theme: '#22d3ee', mono: false } };
const PRIORITY = ['school', 'hospital', 'market', 'admin', 'industrial', 'supermarket', 'mall', 'park', 'university', 'kinder', 'transport', 'pharmacy', 'bank', 'sports', 'entertain', 'clinic', 'worship', 'fuel', 'post', 'police', 'convenience', 'hotel', 'food'];

function autoPick() {
  const picked = [];
  const byCat = {};
  for (const p of state.pois) if (!byCat[p.cat]) byCat[p.cat] = p;
  for (const c of PRIORITY) {
    if (picked.length >= 8) break;
    if (byCat[c]) picked.push(byCat[c].id);
  }
  state.selected = state.custom.map((p) => p.id).concat(picked).slice(0, MAX_POI);
  state.roadSel = state.roads.slice(0, 1).map((r) => r.name);
  renderPoiList(); renderRoads(); refreshEditor(); markDirty(); save();
}

function renderPoiList() {
  const box = $('poiList');
  const q = $('poiFilter').value.trim().toLowerCase();
  const cf = $('poiCatFilter').value;
  $('poiCount').textContent = state.selected.length;
  const list = allPois().filter((p) => (!q || p.name.toLowerCase().includes(q)) && (!cf || p.cat === cf));
  if (!list.length) {
    box.innerHTML = `<p class="empty">${allPois().length ? 'Không có kết quả phù hợp.' : 'Chưa có dữ liệu – bấm “Quét tiện ích”.'}</p>`;
    return;
  }
  const groups = {};
  for (const p of list) (groups[p.cat] = groups[p.cat] || []).push(p);
  const frag = document.createDocumentFragment();
  for (const cat of Object.keys(CATS)) {
    const g = groups[cat];
    if (!g) continue;
    g.sort((a, b) => a.dist - b.dist);
    const head = document.createElement('div');
    head.className = 'cat';
    head.textContent = `${CATS[cat].icon} ${CATS[cat].label} (${g.length})`;
    frag.appendChild(head);
    const show = q || cf ? g : g.filter((p, i) => i < 8 || state.selected.includes(p.id));
    for (const p of show) {
      const on = state.selected.includes(p.id);
      const row = document.createElement('div');
      row.className = 'poi-item' + (on ? ' on' : '');
      row.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''}><span></span><span class="d">${fmtDist(p.dist)}</span>`;
      row.children[1].textContent = p.name + (p.custom ? ' (tự thêm)' : '');
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('x')) return;
        togglePoi(p.id);
      });
      if (p.custom) {
        const x = document.createElement('button');
        x.className = 'x';
        x.textContent = '✕';
        x.title = 'Xoá điểm tự thêm';
        x.onclick = () => {
          state.custom = state.custom.filter((c) => c.id !== p.id);
          state.selected = state.selected.filter((id) => id !== p.id);
          renderPoiList(); refreshEditor(); markDirty(); save();
        };
        row.appendChild(x);
      }
      frag.appendChild(row);
    }
  }
  box.innerHTML = '';
  box.appendChild(frag);
}

function togglePoi(id) {
  const i = state.selected.indexOf(id);
  if (i >= 0) state.selected.splice(i, 1);
  else {
    if (state.selected.length >= MAX_POI) return toast(`Chỉ chọn tối đa ${MAX_POI} tiện ích để video gọn và dễ xem.`);
    state.selected.push(id);
  }
  renderPoiList(); refreshEditor(); markDirty(); save();
}

const LM_MAX_KM = 80, INFRA_MAX_KM = 40;
const LM_COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#facc15', '#34d399', '#fb923c'];
const INFRA_COLORS = ['#f97316', '#ef4444', '#e879f9'];
const allLandmarks = () => LANDMARKS.concat(state.lmCustom);

function renderRegional() {
  const o = state.center ? origin() : null;
  const box = $('lmList');
  box.innerHTML = '';
  for (const l of allLandmarks()) {
    const d = o ? haversine(o, l.lngLat) : 0;
    const far = o && d > LM_MAX_KM * 1000;
    const on = state.lmSel.includes(l.id);
    const b = document.createElement('button');
    b.className = on && !far ? 'on' : '';
    b.disabled = far;
    b.textContent = `${on ? '✓' : '+'} ${l.icon} ${l.name}${o ? ' · ' + fmtDist(d) : ''}${l.custom ? ' ✕' : ''}`;
    b.title = l.custom ? 'Điểm tự thêm – bấm để xoá' : '';
    b.onclick = () => {
      const i = state.lmSel.indexOf(l.id);
      if (i >= 0) {
        state.lmSel.splice(i, 1);
        if (l.custom) state.lmCustom = state.lmCustom.filter((x) => x.id !== l.id); // bỏ chọn điểm tự thêm = xoá
      } else {
        if (state.lmSel.length >= 6) return toast('Chọn tối đa 6 điểm mốc để video gọn.');
        state.lmSel.push(l.id);
      }
      renderRegional(); markDirty(); save();
    };
    box.appendChild(b);
  }
  const ib = $('infraList');
  ib.innerHTML = '';
  for (const f of INFRA_LIST) {
    const nr = o ? infraNearest(f.id, o) : null;
    const far = nr && nr.dist > INFRA_MAX_KM * 1000;
    const on = state.infraSel.includes(f.id);
    const b = document.createElement('button');
    b.className = on && !far ? 'on' : '';
    b.disabled = far;
    b.textContent = `${on ? '✓' : '+'} 🚧 ${f.name}${nr ? ' · cách ' + fmtDist(nr.dist) : ''}`;
    b.onclick = () => {
      const i = state.infraSel.indexOf(f.id);
      if (i >= 0) state.infraSel.splice(i, 1); else state.infraSel.push(f.id);
      renderRegional(); markDirty(); save();
    };
    ib.appendChild(b);
  }
}

function renderRoads() {
  const box = $('roadList');
  if (!state.roads.length) { box.innerHTML = '<p class="empty">—</p>'; return; }
  box.innerHTML = '';
  for (const r of state.roads) {
    const b = document.createElement('button');
    const on = state.roadSel.includes(r.name), minor = state.roadMinor.includes(r.name);
    b.className = on ? 'on' : minor ? 'minor' : '';
    b.textContent = `${on ? '⭐' : minor ? '➖' : '☆'} ${r.name} · ${fmtDist(r.dist)}`;
    // bấm lần lượt: chưa chọn → chính → phụ → bỏ chọn (nhóm nào đủ 3 thì bỏ qua nhóm đó)
    b.onclick = () => {
      const drop = (arr) => arr.splice(arr.indexOf(r.name), 1);
      if (on) { drop(state.roadSel); if (state.roadMinor.length < 3) state.roadMinor.push(r.name); }
      else if (minor) drop(state.roadMinor);
      else if (state.roadSel.length < 3) state.roadSel.push(r.name);
      else if (state.roadMinor.length < 3) state.roadMinor.push(r.name);
      else return toast('Đã chọn đủ 3 đường chính và 3 đường phụ. Bỏ bớt một đường trước.');
      renderRoads(); markDirty(); save();
    };
    box.appendChild(b);
  }
}

async function scan() {
  if (!state.center) return toast('Hãy xác định vị trí ở bước 1 trước.', true);
  const btn = $('btnScan');
  btn.disabled = true;
  btn.textContent = '⏳ Đang quét… (tối đa ~30 giây)';
  try {
    const radius = +val('selRadius');
    const res = await fetchSurroundings(origin(), radius, Math.min(2000, Math.max(1000, radius / 2)), (m) => (btn.textContent = '⏳ ' + m));
    const keep = new Set(state.selected);
    state.pois = res.pois.slice(0, 600);
    state.roads = res.roads;
    state.selected = state.selected.filter((id) => getPoi(id));
    state.roadSel = state.roadSel.filter((n) => state.roads.some((r) => r.name === n));
    state.roadMinor = state.roadMinor.filter((n) => state.roads.some((r) => r.name === n));
    if (!keep.size || !state.selected.length) autoPick();
    renderPoiList(); renderRoads(); refreshEditor();
    if (!res.pois.length) toast('Không tìm thấy tiện ích nào trong bán kính này. Thử tăng bán kính, hoặc thêm bằng tay (➕ Thêm tiện ích).', true, 7000);
    else toast(`Tìm thấy ${res.pois.length} tiện ích và ${res.roads.length} tuyến đường trong ${res.seconds.toFixed(1).replace('.', ',')} giây (nguồn: ${res.sources.join(' + ')}). Đã gợi ý sẵn – bạn chỉnh lại tuỳ ý.`, false, 6000);
    markDirty(); save();
  } catch (e) {
    toast(e.message || String(e), true, 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Quét tiện ích';
  }
}

// ---------- ảnh / video ----------
async function addMedia(files) {
  for (const f of files) {
    const isVideo = f.type.startsWith('video');
    const count = state.media.filter((m) => m.type === (isVideo ? 'video' : 'image')).length;
    if (isVideo ? count >= 3 : count >= 6) { toast(isVideo ? 'Tối đa 3 video.' : 'Tối đa 6 ảnh.'); continue; }
    const url = URL.createObjectURL(f);
    if (isVideo) {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url; v.crossOrigin = 'anonymous';
      await new Promise((r) => { v.onloadeddata = r; v.onerror = r; setTimeout(r, 8000); });
      state.media.push({ type: 'video', el: v, url, duration: v.duration || 4, name: f.name });
    } else {
      const img = new Image();
      img.src = url;
      try { await img.decode(); } catch (_) { continue; }
      state.media.push({ type: 'image', el: img, url, name: f.name });
    }
  }
  renderMedia(); markDirty();
}
function renderMedia() {
  const box = $('mediaList');
  box.innerHTML = '';
  state.media.forEach((m, i) => {
    const d = document.createElement('div');
    d.className = 'm';
    const el = m.type === 'video' ? document.createElement('video') : document.createElement('img');
    el.src = m.url;
    if (m.type === 'video') { el.muted = true; }
    d.appendChild(el);
    const x = document.createElement('button');
    x.textContent = '✕';
    x.onclick = () => { state.media.splice(i, 1); renderMedia(); markDirty(); };
    d.appendChild(x);
    const ord = document.createElement('div');
    ord.className = 'ord';
    for (const [lbl, dir] of [['◀', -1], ['▶', 1]]) {
      const b = document.createElement('button');
      b.textContent = lbl;
      b.onclick = () => {
        const j = i + dir;
        if (j < 0 || j >= state.media.length) return;
        [state.media[i], state.media[j]] = [state.media[j], state.media[i]];
        renderMedia(); markDirty();
      };
      ord.appendChild(b);
    }
    d.appendChild(ord);
    box.appendChild(d);
  });
}

// ---------- âm thanh ----------
function actx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
async function decodeFile(file) {
  const buf = await file.arrayBuffer();
  return await actx().decodeAudioData(buf);
}
function renderAudioInfo() {
  $('voiceInfo').textContent = state.voice ? `🎙️ ${state.voiceName} · ${state.voice.duration.toFixed(1)}s` : '';
  $('btnClearVoice').hidden = !state.voice;
  $('musicInfo').textContent = state.music ? `🎵 ${state.musicName}` : '';
  $('btnClearMusic').hidden = !state.music;
}
let recorder = null;
async function toggleRecord() {
  const btn = $('btnRecord');
  if (recorder) { recorder.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder = null;
      btn.textContent = '🎙️ Thu âm';
      btn.classList.remove('primary');
      try {
        const blob = new Blob(chunks, { type: chunks[0] && chunks[0].type });
        state.voice = await actx().decodeAudioData(await blob.arrayBuffer());
        state.voiceName = 'Bản thu âm';
        renderAudioInfo(); markDirty();
        toast('Đã lưu bản thu âm. Bấm “Dựng & xem trước” để nghe thử.');
      } catch (e) { toast('Không đọc được bản thu: ' + e.message, true); }
    };
    recorder.start();
    btn.textContent = '⏹ Dừng thu';
    btn.classList.add('primary');
    toast('Đang thu âm… đọc kịch bản phía trên rồi bấm “Dừng thu”.');
  } catch (e) {
    toast('Không mở được micro: ' + e.message, true);
  }
}

// ---------- sân khấu / xem trước ----------
function stageSize() { return STAGE_SIZES[val('o_aspect')] || STAGE_SIZES['9:16']; }

function fitPreview() {
  const [cw, ch] = stageSize();
  const wrap = $('stageWrap');
  const ww = wrap.clientWidth;
  const maxH = window.innerWidth < 900 ? window.innerHeight * 0.58 : window.innerHeight - 190;
  const s = Math.min(ww / cw, maxH / ch);
  const sc = $('stageScale');
  sc.style.width = cw + 'px';
  sc.style.height = ch + 'px';
  sc.style.position = 'absolute';
  sc.style.left = (ww - cw * s) / 2 + 'px';
  sc.style.top = '0';
  sc.style.transform = `scale(${s})`;
  wrap.style.height = ch * s + 'px';
  const ov = $('overlay');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  ov.width = Math.round(cw * s * dpr);
  ov.height = Math.round(ch * s * dpr);
  if (stage && stage.map) {
    stage.map.resize();
    stage.map.setPixelRatio(Math.max(1, dpr * s));
  }
  if (timeline) renderPreview(playT);
}

async function ensureBuilt() {
  if (!dirty && timeline) return;
  if (!state.center) throw new Error('Chưa có vị trí. Hãy làm bước 1.');
  stopPreview();
  const o = origin();
  const sel = state.selected.map(getPoi).filter(Boolean).sort((a, b) => a.dist - b.dist);
  const mode = val('o_mode');
  if (mode === 'flyover') {
    const key = o.join(',');
    for (let i = 0; i < sel.length; i++) {
      const p = sel[i];
      if (!p.route || p.routeFrom !== key) {
        status(`Đang tính đường đi ${i + 1}/${sel.length}: ${p.name}…`);
        p.route = await fetchRoute(o, p.lngLat);
        p.routeFrom = key;
      }
    }
  }
  // Đường nối từ lô đất tới điểm gần nhất của các đường chính đã chọn
  const roadsSel = state.roads.filter((r) => state.roadSel.includes(r.name));
  for (const r of roadsSel) {
    let best = null, bd = Infinity;
    for (const l of r.lines) { const q = nearestOnLine(o, l); const d = haversine(o, q); if (d < bd) { bd = d; best = q; } }
    if (!best) continue;
    const key = o.join(',') + '>' + best.join(',');
    if (!r.connector || r.connector.key !== key) {
      status(`Đang tính đường nối tới ${r.name}…`);
      const rt = bd < 25 ? { coords: [o, best], distance: bd, road: true } : await fetchRoute(o, best);
      r.connector = { ...rt, point: best, key };
    }
  }
  // Điểm mốc kết nối vùng
  const landmarks = [];
  for (const l of allLandmarks().filter((x) => state.lmSel.includes(x.id))) {
    if (haversine(o, l.lngLat) > LM_MAX_KM * 1000) continue;
    const key = o.join(',');
    if (!l.route || l.routeFrom !== key) {
      status(`Đang tính đường tới ${l.name}…`);
      l.route = await fetchRoute(o, l.lngLat);
      l.routeFrom = key;
    }
    landmarks.push({ ...l, color: LM_COLORS[landmarks.length % LM_COLORS.length] });
  }
  // Hạ tầng đang thi công
  const infra = [];
  for (const f of INFRA_LIST.filter((x) => state.infraSel.includes(x.id))) {
    const nr = infraNearest(f.id, o);
    if (nr.dist > INFRA_MAX_KM * 1000) continue;
    infra.push({ ...f, nearest: nr, color: INFRA_COLORS[infra.length % INFRA_COLORS.length] });
  }
  let iso = null;
  if (val('chkIso')) {
    const key = o.join(',') + val('selIsoMode');
    if (state.isoKey !== key || !state.iso) {
      status('Đang tính vùng thời gian di chuyển…');
      try {
        state.iso = await fetchIsochrones(o, [5, 10, 15], val('selIsoMode'));
        state.isoKey = key;
      } catch (e) {
        toast(e.message, true);
        state.iso = null;
      }
    }
    iso = state.iso;
  }
  status('Đang dựng video…');
  const styleId = val('o_style');
  await stage.setStyle(styleId);
  stage.setTheme(val('o_theme'));
  stage.plotHeight = val('o_block') ? 18 : 0;
  const plot = state.plot.length >= 3 ? state.plot : null;
  stage.setData('plot', plot ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...plot, plot[0]]] } }] } : null);
  stage.setData('iso', iso ? { type: 'FeatureCollection', features: iso.map((f) => ({ type: 'Feature', properties: { minutes: f.minutes }, geometry: f.geometry })) } : null);
  const lineFC = (rs) => ({ type: 'FeatureCollection', features: rs.flatMap((r) => r.lines.map((l) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: l } }))) });
  stage.setData('roads', lineFC(roadsSel));
  stage.setData('roads2', lineFC(state.roads.filter((r) => state.roadMinor.includes(r.name))));
  stage.setData('routes', null);
  stage.cache = {};
  if (!document.fonts.check('700 20px "Be Vietnam Pro"')) {
    try { await Promise.all([600, 700, 800].map((w) => document.fonts.load(`${w} 20px "Be Vietnam Pro"`, 'Tiếng Việt'))); } catch (_) {}
  }
  const isoLabel = { motor_scooter: 'xe máy', auto: 'ô tô', bicycle: 'xe đạp', pedestrian: 'đi bộ' }[val('selIsoMode')];
  timeline = buildTimeline({
    stage,
    center: o,
    plot,
    pois: sel,
    roads: roadsSel,
    landmarks,
    infra,
    iso,
    info: info(),
    media: state.media,
    script: val('inScript'),
    voiceDuration: state.voice ? state.voice.duration : 0,
    credit: MAP_STYLES[styleId].credit + ' · Đường đi: OSRM',
    haze: MAP_STYLES[styleId].haze,
    plotArea: state.plotAreaExact || 0,
    plotEdges: state.plotEdgesExact || null,
    opts: {
      theme: val('o_theme'), mono: !!PRESETS[val('o_preset')]?.mono, pace: +val('o_pace'), mode, speedKmh: +val('inSpeed') || 30,
      showDims: val('o_dims'), subtitles: val('o_subs'), radius: +val('selRadius'), isoLabel, voiceDelay: 0.5, orbit: +val('o_orbit'), clean: val('o_clean'),
    },
  });
  mixed = await mixAudio({
    voice: state.voice, music: state.music, duration: timeline.duration, voiceDelay: 0.5, musicVolume: +val('musicVol'),
    bgm: val('o_bgm'), sfx: val('o_sfx') ? timeline.scenes : null,
  });
  dirty = false;
  playT = 0;
  status(`Video dài ${fmtTime(timeline.duration)} · ${sel.length} tiện ích · ${state.media.length} ảnh/video`);
}

let lastPrep = 0;
function renderPreview(t) {
  if (!timeline) return;
  timeline.applyMap(t);
  const now = performance.now();
  if (!playing || now - lastPrep > 120) { lastPrep = now; timeline.prepare(t); }
  const ov = $('overlay');
  const ctx = ov.getContext('2d');
  ctx.clearRect(0, 0, ov.width, ov.height);
  timeline.drawOverlay(ctx, ov.width, ov.height, t);
  $('scrub').value = Math.round((t / timeline.duration) * 1000);
  $('timeText').textContent = `${fmtTime(t)} / ${fmtTime(timeline.duration)}`;
}

function loop(ts) {
  if (!playing) return;
  playT += (ts - lastTs) / 1000;
  lastTs = ts;
  if (playT >= timeline.duration) { playT = timeline.duration; renderPreview(playT); stopPreview(); return; }
  renderPreview(playT);
  requestAnimationFrame(loop);
}

function startPreview() {
  if (!timeline) return;
  if (playT >= timeline.duration - 0.05) playT = 0;
  playing = true;
  $('btnPlay').textContent = '⏸';
  if (mixed) {
    const c = actx();
    c.resume();
    audioSrc = c.createBufferSource();
    audioSrc.buffer = mixed;
    audioSrc.connect(c.destination);
    audioSrc.start(0, playT);
  }
  lastTs = performance.now();
  requestAnimationFrame(loop);
}
function stopPreview() {
  playing = false;
  $('btnPlay').textContent = '▶';
  if (audioSrc) { try { audioSrc.stop(); } catch (_) {} audioSrc = null; }
}

async function buildAndPlay() {
  const b = $('btnBuild');
  b.disabled = true;
  try {
    dirty = true;
    await ensureBuilt();
    startPreview();
  } catch (e) {
    toast(e.message || String(e), true);
    status('');
  } finally { b.disabled = false; }
}

// ---------- xuất ----------
async function withExportSize(fn) {
  const [cw] = stageSize();
  const [W, H] = OUT[val('o_aspect')][val('selRes')];
  stage.map.setPixelRatio(W / cw);
  try { return await fn(W, H); } finally { fitPreview(); }
}

async function doExport() {
  if (!canExport()) return toast('Trình duyệt này chưa hỗ trợ xuất video. Hãy dùng Chrome, Edge hoặc Safari (iOS 16.4+) bản mới.', true, 7000);
  const btn = $('btnExport');
  btn.disabled = true;
  $('downloadBox').innerHTML = '';
  let wake = null;
  try {
    await ensureBuilt();
    stopPreview();
    try { wake = await navigator.wakeLock?.request('screen'); } catch (_) {}
    $('exportBox').hidden = false;
    exportAbort = new AbortController();
    const res = await withExportSize((W, H) => exportVideo({
      timeline, stage, width: W, height: H, fps: 30, audio: mixed, signal: exportAbort.signal,
      onProgress: (p, eta) => {
        $('exportBar').style.width = (p * 100).toFixed(1) + '%';
        $('exportText').textContent = `Đang xuất ${(p * 100).toFixed(0)}% · còn khoảng ${fmtTime(eta)}`;
      },
    }));
    const url = URL.createObjectURL(res.blob);
    const name = slug(val('f_title') || 'video-vi-tri') + '.mp4';
    $('downloadBox').innerHTML = `<a href="${url}" download="${name}">⬇️ Tải video (${(res.blob.size / 1048576).toFixed(1)} MB)</a><video src="${url}" controls playsinline></video>`;
    if (res.codec !== 'avc') toast('Trình duyệt không có H.264 nên video dùng VP9 – nếu không mở được trên iPhone, hãy xuất lại bằng Chrome trên máy tính.', false, 8000);
    else toast('Xuất video xong! Bấm “Tải video”.');
  } catch (e) {
    toast(e.message || String(e), true, 7000);
  } finally {
    btn.disabled = false;
    $('exportBox').hidden = true;
    exportAbort = null;
    if (wake) try { wake.release(); } catch (_) {}
    renderPreview(playT);
  }
}

async function doCover() {
  try {
    await ensureBuilt();
    stopPreview();
    const plotScene = timeline.scenes.find((s) => s.name === 'plot') || timeline.scenes[0];
    const t = plotScene.start + plotScene.dur * 0.6;
    const blob = await withExportSize(async (W, H) => {
      timeline.applyMap(t);
      await stage.settle();
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.drawImage(stage.map.getCanvas(), 0, 0, W, H);
      timeline.drawOverlay(ctx, W, H, t);
      return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = slug(val('f_title') || 'anh-bia') + '.jpg';
    a.click();
    renderPreview(playT);
  } catch (e) { toast(e.message || String(e), true); }
}

function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'video';
}

// ---------- toạ độ sổ đỏ VN-2000 ----------
let cornerResult = null;
let cornerArea = 0;
let cornerLens = null;

function resetCornerPreview() {
  cornerResult = null;
  $('btnCorners').disabled = true;
  $('cornerPreview').innerHTML = '';
  setPreviewPlot(null);
}

function setPreviewPlot(points) {
  const src = editor && editor.getSource('e-preview');
  if (!src) return;
  src.setData(points ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...points, points[0]]] } }] } : { type: 'FeatureCollection', features: [] });
}

function readCorners() {
  resetCornerPreview();
  const box = $('cornerPreview');
  const { vn, gps } = parseCornerRows($('inCorners').value);
  let points, note = '', sysLabel;
  if (vn.length >= 3) {
    sysLabel = 'VN-2000';
    const sel = $('selProvince').value;
    if (sel === 'auto') {
      if (!state.center) {
        box.innerHTML = '<p class="warn">Chưa biết vị trí căn nhà để tự dò. Hãy định vị ở trên trước (dán link / tìm địa chỉ / chạm bản đồ), hoặc chọn tỉnh ghi trên sổ.</p>';
        return;
      }
      const best = autoMeridian(vn, state.center);
      points = best.points;
      const ok = best.dist < 2000;
      note = `<p class="${ok ? 'ok' : 'warn'}">Tự chọn kinh tuyến trục <b>${fmtMeridian(best.lon0)}</b> · lô đất cách ghim vị trí ${fmtDist(best.dist)}${ok ? '' : ' – khá xa! Kiểm tra lại ghim vị trí, số liệu, hoặc chọn đúng tỉnh trên sổ.'}</p>`;
    } else {
      const lon0 = sel === 'manual' ? parseLon0($('inLon0').value) : parseFloat(sel);
      if (!isFinite(lon0) || lon0 < 100 || lon0 > 112) {
        box.innerHTML = '<p class="warn">Kinh tuyến trục chưa hợp lệ. VD: 105°45\' hoặc 105.75</p>';
        return;
      }
      if (!MERIDIANS.includes(lon0) && sel === 'manual') note += `<p class="hint">Lưu ý: ${fmtMeridian(lon0)} không nằm trong danh sách kinh tuyến trục các tỉnh – kiểm tra lại.</p>`;
      points = vn.map((r) => vn2000ToWgs84(r.X, r.Y, lon0));
      if (state.center) {
        const d = haversine(centroid(points), state.center);
        note += `<p class="${d < 2000 ? 'ok' : 'warn'}">KTT ${fmtMeridian(lon0)} · lô đất cách ghim vị trí ${fmtDist(d)}${d < 2000 ? '' : ' – khá xa, kiểm tra lại tỉnh / kinh tuyến trục.'}</p>`;
      }
    }
  } else if (gps.length >= 3) {
    sysLabel = 'GPS (WGS84)';
    points = gps;
  } else {
    box.innerHTML = `<p class="warn">Cần ít nhất 3 điểm góc (đọc được ${vn.length || gps.length}). Mỗi dòng: số thứ tự (nếu có), X, Y.</p>`;
    return;
  }
  let srcRows = vn.length >= 3 ? vn : null;
  if (isSelfIntersecting(points)) {
    const sorted = sortAroundCentroid(points);
    const idx = sorted.map((p) => points.indexOf(p));
    points = sorted;
    if (srcRows) srcRows = idx.map((i) => srcRows[i]);
    note += '<p class="warn">Thứ tự các điểm làm ranh bị xoắn – đã tự sắp xếp lại theo vòng quanh lô.</p>';
  }
  // VN-2000 là hệ phẳng: tính cạnh & diện tích trực tiếp từ X,Y để khớp số trên sổ
  let lens, area;
  if (srcRows) {
    lens = srcRows.map((r, i) => { const q = srcRows[(i + 1) % srcRows.length]; return Math.hypot(q.X - r.X, q.Y - r.Y); });
    area = Math.abs(srcRows.reduce((a, r, i) => { const q = srcRows[(i + 1) % srcRows.length]; return a + r.X * q.Y - q.X * r.Y; }, 0)) / 2;
  } else {
    lens = edgeLengths(points);
    area = polygonArea(points);
  }
  const rows = (srcRows || points).map((r, i) => {
    const a = srcRows ? `${fmtNum(r.X)}</td><td>${fmtNum(r.Y)}` : `${points[i][1].toFixed(6)}</td><td>${points[i][0].toFixed(6)}`;
    return `<tr><td>${i + 1}</td><td>${a}</td><td>${(Math.round(lens[i] * 100) / 100).toLocaleString('vi-VN')} m</td></tr>`;
  }).join('');
  box.innerHTML = `${note}
    <p><b>${points.length} điểm · ${sysLabel}</b> · Diện tích: <b>${fmtArea(area)}</b> <span class="hint">(so với diện tích trên sổ)</span></p>
    <table><thead><tr><th>#</th><th>${srcRows ? 'X' : 'Vĩ độ'}</th><th>${srcRows ? 'Y' : 'Kinh độ'}</th><th>Cạnh tới điểm sau</th></tr></thead><tbody>${rows}</tbody></table>`;
  cornerResult = points;
  cornerArea = srcRows ? area : 0;
  cornerLens = srcRows ? lens : null;
  $('btnCorners').disabled = false;
  setPreviewPlot(points);
  const b = bboxOf(points);
  editor.fitBounds(b, { padding: 70, maxZoom: 19.5, duration: 600 });
}

function fmtNum(n) {
  return n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 3, useGrouping: false });
}

function applyCorners() {
  if (!cornerResult) return;
  const points = cornerResult;
  const exact = cornerArea;
  const exactLens = cornerLens;
  state.plot = points;
  const c = centroid(points);
  if (!state.center || haversine(state.center, c) > 30) setCenter(c, false);
  resetCornerPreview();
  afterPlotChange();
  state.plotAreaExact = exact; // diện tích tính từ X,Y của sổ (khớp số trên sổ)
  state.plotEdgesExact = exactLens;
  save();
  editor.fitBounds(bboxOf(points), { padding: 70, maxZoom: 19.5 });
  toast(`Đã vẽ ranh lô đất ${points.length} góc · ${fmtArea(polygonArea(points))}. Chuyển sang “Vệ tinh” để kiểm tra; lệch thì dùng nút “Dịch ranh”.`, false, 7000);
}

// ---------- khởi tạo ----------
function fillSelects() {
  const ps = $('selProvince');
  ps.add(new Option('Tự dò theo vị trí căn nhà (khuyên dùng)', 'auto'));
  ps.add(new Option('Tự gõ kinh tuyến trục…', 'manual'));
  const og = document.createElement('optgroup');
  og.label = 'Theo tỉnh ghi trên sổ (tỉnh cũ)';
  for (const [name, lon] of PROVINCES) og.appendChild(new Option(`${name} – KTT ${fmtMeridian(lon)}`, String(lon)));
  ps.appendChild(og);
  ps.value = 'auto';
  const og1 = document.createElement('optgroup'); og1.label = 'Mẫu chính';
  const og2 = document.createElement('optgroup'); og2.label = 'Theme nghệ thuật (32 mẫu)';
  for (const [k, s] of Object.entries(MAP_STYLES)) (s.group === 'art' ? og2 : og1).appendChild(new Option(s.label, k));
  $('o_style').append(og1, og2);
  for (const [k, l] of Object.entries(TONES)) $('selTone').add(new Option(l, k));
  for (const [k, c] of Object.entries(CATS)) $('poiCatFilter').add(new Option(`${c.icon} ${c.label}`, k));
}

function bind() {
  $('btnLocate').onclick = async () => {
    const raw = $('inLink').value;
    // Lấy riêng đường link nếu người dùng dán cả đoạn chia sẻ ("Tên địa điểm https://maps.app.goo.gl/...")
    const urlMatch = raw.match(/https?:\/\/\S+/);
    const t = urlMatch ? urlMatch[0] : raw;
    const ll = parseLatLng(raw);
    if (ll) { setCenter(ll); toast('Đã định vị. Kéo ghim 📍 để chỉnh chính xác nếu cần.'); return; }
    if (isShortGoogleLink(t)) {
      const btn = $('btnLocate');
      btn.disabled = true;
      btn.textContent = '⏳ Đang đọc…';
      try {
        const r = await unshortenMapsLink(t.replace(/[)\].,;]+$/, ''), parseLatLng);
        if (r) {
          setCenter(r);
          toast('Đã đọc link rút gọn và định vị. Kéo ghim 📍 để chỉnh chính xác nếu cần.');
        } else {
          toast('Chưa đọc được link rút gọn này. Cách chắc chắn nhất: trong Google Maps, nhấn giữ đúng vị trí để thả ghim đỏ → dãy số toạ độ hiện ở ô tìm kiếm → chạm để sao chép → dán vào đây.', true, 12000);
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Định vị';
      }
      return;
    }
    toast('Không tìm thấy toạ độ trong nội dung đã dán.', true);
  };
  $('btnSearch').onclick = async () => {
    const q = $('inSearch').value.trim();
    if (!q) return;
    const box = $('searchResults');
    box.innerHTML = '<p class="hint">Đang tìm…</p>';
    try {
      const rs = await geocode(q);
      box.innerHTML = rs.length ? '' : '<p class="hint">Không thấy kết quả. Thử ghi ngắn gọn hơn.</p>';
      for (const r of rs) {
        const b = document.createElement('button');
        b.textContent = r.name;
        b.onclick = () => { setCenter(r.lngLat); box.innerHTML = ''; if (!$('f_address').value) $('f_address').value = r.name.split(',').slice(0, 3).join(','); save(); };
        box.appendChild(b);
      }
    } catch (e) { box.innerHTML = `<p class="hint">${e.message}</p>`; }
  };
  $('inSearch').addEventListener('keydown', (e) => e.key === 'Enter' && $('btnSearch').click());
  $('inLink').addEventListener('keydown', (e) => e.key === 'Enter' && $('btnLocate').click());
  for (const b of $('editMode').querySelectorAll('button')) b.onclick = () => setEditMode(b.dataset.mode);
  for (const b of $('editStyle').querySelectorAll('button')) b.onclick = () => {
    for (const x of $('editStyle').querySelectorAll('button')) x.classList.toggle('on', x === b);
    editor.setStyle(styleFor(b.dataset.style), { diff: false });
  };
  $('btnUndoCorner').onclick = () => { state.plot.pop(); afterPlotChange(); };
  $('btnClearPlot').onclick = () => { state.plot = []; afterPlotChange(); };
  for (const b of document.querySelectorAll('[data-nudge]')) b.onclick = () => {
    const [dx, dy] = b.dataset.nudge.split(',').map(Number);
    if (!state.plot.length) return;
    const lat = state.plot[0][1];
    const mx = 1 / (111320 * Math.cos((lat * Math.PI) / 180)), my = 1 / 110574;
    state.plot = state.plot.map(([x, y]) => [x + dx * mx, y + dy * my]);
    const keep = state.plotAreaExact, keepL = state.plotEdgesExact; // dịch ranh không đổi diện tích & cạnh
    afterPlotChange();
    state.plotAreaExact = keep;
    state.plotEdgesExact = keepL;
    save();
  };
  $('selProvince').onchange = () => { $('inLon0').hidden = $('selProvince').value !== 'manual'; resetCornerPreview(); save(); };
  $('inLon0').oninput = resetCornerPreview;
  $('inCorners').addEventListener('input', resetCornerPreview);
  $('btnReadCorners').onclick = readCorners;
  $('btnCorners').onclick = applyCorners;
  $('btnScan').onclick = scan;
  $('btnLmAdd').onclick = async () => {
    const q = $('lmSearch').value.trim();
    if (!q) return;
    const box = $('lmResults');
    box.innerHTML = '<p class="hint">Đang tìm…</p>';
    try {
      const rs = await geocode(q);
      box.innerHTML = rs.length ? '' : '<p class="hint">Không thấy kết quả.</p>';
      for (const r of rs) {
        const b = document.createElement('button');
        b.textContent = r.name;
        b.onclick = () => {
          const name = r.name.split(',')[0].trim();
          const l = { id: 'lm/' + Date.now(), name, short: name, icon: '📍', lngLat: r.lngLat, custom: true };
          state.lmCustom.push(l);
          if (state.lmSel.length < 6) state.lmSel.push(l.id);
          box.innerHTML = '';
          $('lmSearch').value = '';
          renderRegional(); markDirty(); save();
        };
        box.appendChild(b);
      }
    } catch (e) { box.innerHTML = `<p class="hint">${e.message}</p>`; }
  };
  $('lmSearch').addEventListener('keydown', (e) => e.key === 'Enter' && $('btnLmAdd').click());
  $('btnAutoPick').onclick = () => (state.pois.length ? autoPick() : toast('Hãy bấm “Quét tiện ích” trước.'));
  $('poiFilter').oninput = renderPoiList;
  $('poiCatFilter').onchange = renderPoiList;
  $('selRadius').onchange = () => { refreshEditor(); save(); };
  $('fileMedia').onchange = async (e) => { await addMedia([...e.target.files]); e.target.value = ''; };
  $('fileVoice').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { state.voice = await decodeFile(f); state.voiceName = f.name; renderAudioInfo(); markDirty(); } catch (err) { toast('Không đọc được file âm thanh này.', true); }
    e.target.value = '';
  };
  $('fileMusic').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { state.music = await decodeFile(f); state.musicName = f.name; renderAudioInfo(); markDirty(); } catch (err) { toast('Không đọc được file nhạc này.', true); }
    e.target.value = '';
  };
  $('btnClearVoice').onclick = () => { state.voice = null; renderAudioInfo(); markDirty(); };
  $('btnClearMusic').onclick = () => { state.music = null; renderAudioInfo(); markDirty(); };
  $('btnRecord').onclick = toggleRecord;
  $('btnGenScript').onclick = () => {
    const sel = state.selected.map(getPoi).filter(Boolean).sort((a, b) => a.dist - b.dist);
    $('inScript').value = generateScript({
      info: info(), pois: sel, roads: state.roads.filter((r) => state.roadSel.includes(r.name)),
      tone: val('selTone'), speedKmh: +val('inSpeed') || 30, hasIso: val('chkIso'),
    });
    markDirty(); save();
  };
  $('btnCopyScript').onclick = async () => {
    try { await navigator.clipboard.writeText($('inScript').value); toast('Đã copy kịch bản.'); } catch (_) { $('inScript').select(); }
  };
  $('btnBuild').onclick = buildAndPlay;
  $('btnPlay').onclick = async () => {
    if (playing) return stopPreview();
    if (dirty || !timeline) return buildAndPlay();
    startPreview();
  };
  $('scrub').oninput = () => {
    if (!timeline) return;
    stopPreview();
    playT = ($('scrub').value / 1000) * timeline.duration;
    renderPreview(playT);
  };
  $('btnExport').onclick = doExport;
  $('btnCancel').onclick = () => exportAbort && exportAbort.abort();
  $('btnCover').onclick = doCover;
  $('o_aspect').onchange = () => { fitPreview(); markDirty(); save(); };
  $('o_theme').oninput = () => document.documentElement.style.setProperty('--accent', $('o_theme').value);
  $('o_preset').addEventListener('change', () => {
    const pr = PRESETS[val('o_preset')];
    if (!pr) return;
    $('o_theme').value = pr.theme;
    $('o_theme').dispatchEvent(new Event('input'));
    $('o_theme').dispatchEvent(new Event('change'));
  });
  for (const id of FIELDS) {
    const el = $(id);
    el.addEventListener('change', () => { markDirty(); save(); });
    if (el.tagName === 'TEXTAREA' || el.type === 'text' || !el.type) el.addEventListener('input', () => { markDirty(); clearTimeout(bind._s); bind._s = setTimeout(save, 600); });
  }
  $('btnSaveProject').onclick = () => {
    const blob = new Blob([JSON.stringify(snapshot(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = slug(val('f_title') || 'du-an') + '.json';
    a.click();
    toast('Đã lưu file dự án (không gồm ảnh, video, âm thanh).');
  };
  $('fileProject').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      restore(JSON.parse(await f.text()));
      afterRestore();
      toast('Đã mở dự án.');
    } catch (err) { toast('File dự án không hợp lệ.', true); }
    e.target.value = '';
  };
  $('btnReset').onclick = () => {
    if (!confirm('Xoá toàn bộ để làm video mới?')) return;
    try { localStorage.removeItem(STORE); } catch (_) {}
    location.reload();
  };
  window.addEventListener('resize', () => { clearTimeout(bind._r); bind._r = setTimeout(fitPreview, 150); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && exportAbort) toast('Đang xuất video – hãy quay lại tab này, nếu không quá trình sẽ rất chậm.', true, 8000);
  });
}

function afterRestore() {
  if (!$('o_style').value) $('o_style').value = 'satellite';
  if (!$('o_orbit').value) $('o_orbit').value = '360';
  if (!$('selProvince').value) $('selProvince').value = 'auto';
  $('inLon0').hidden = $('selProvince').value !== 'manual';
  if (state.center) {
    centerMarker.setLngLat(state.center).addTo(editor);
    editor.jumpTo({ center: state.center, zoom: 16.5 });
    showCenter(state.center);
  }
  document.documentElement.style.setProperty('--accent', val('o_theme'));
  refreshEditor(); renderPoiList(); renderRoads(); renderRegional(); fitPreview(); markDirty();
}

async function main() {
  fillSelects();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (_) {}
  restore(saved);
  initEditor();
  bind();
  stage = new Stage($('stageMap'));
  fitPreview();
  await stage.init(val('o_style'), state.center || [106.7009, 10.7769]);
  fitPreview();
  editor.once('load', () => afterRestore());
  if (editor.loaded()) afterRestore();
  renderAudioInfo();
  if (!canExport()) status('⚠️ Trình duyệt này không xuất được video – hãy mở bằng Chrome/Edge/Safari mới.');
  window.__va = { state, get timeline() { return timeline; }, stage, ensureBuilt, renderPreview, setCenter, doExport };
  setTimeout(() => musicLoop().catch(() => {}), 1500); // tổng hợp sẵn nhạc nền trong lúc người dùng nhập liệu
}

main();
