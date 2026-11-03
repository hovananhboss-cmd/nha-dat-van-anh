import { parseLatLng, isShortGoogleLink, parseCorners, PROVINCES, polygonArea, fmtArea, fmtDist, circlePolygon, centroid, haversine } from './geo.js';
import { CATS, fetchSurroundings, fetchRoute, fetchIsochrones, geocode } from './data.js';
import { Stage, MAP_STYLES, styleFor } from './stage.js';
import { buildTimeline, poiSub } from './scenes.js';
import { exportVideo, mixAudio, canExport } from './exporter.js';
import { generateScript, TONES } from './script.js';

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
  'o_aspect', 'o_style', 'o_mode', 'o_pace', 'o_theme', 'o_dims', 'o_subs', 'selRadius', 'chkIso', 'selIsoMode', 'inSpeed', 'selTone', 'inScript', 'musicVol', 'selRes', 'selProvince', 'inLon0'];

const state = {
  center: null,
  plot: [],
  pois: [],
  custom: [],
  selected: [],
  roads: [],
  roadSel: [],
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
    v: 1,
    center: state.center, plot: state.plot, pois: state.pois.slice(0, 500).map(stripRoute), custom: state.custom.map(stripRoute),
    selected: state.selected, roads: state.roads, roadSel: state.roadSel, fields: f,
  };
}
function stripRoute(p) { const { route, routeFrom, ...rest } = p; return rest; }
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(snapshot())); } catch (_) {}
}
function restore(data) {
  if (!data) return;
  Object.assign(state, {
    center: data.center || null, plot: data.plot || [], pois: data.pois || [], custom: data.custom || [],
    selected: data.selected || [], roads: data.roads || [], roadSel: data.roadSel || [],
  });
  for (const [id, v] of Object.entries(data.fields || {})) {
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
  m.addLayer({ id: 'e-radius', type: 'line', source: 'e-radius', paint: { 'line-color': '#e11d48', 'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.7 } });
  m.addLayer({ id: 'e-plot-fill', type: 'fill', source: 'e-plot', paint: { 'fill-color': '#e11d48', 'fill-opacity': 0.3 } });
  m.addLayer({ id: 'e-plot-line', type: 'line', source: 'e-plot', paint: { 'line-color': '#e11d48', 'line-width': 2.5 } });
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
  for (const p of allPois()) p.route = null;
  refreshEditor();
  markDirty(); save();
}

function setCenter(ll, fly = true) {
  state.center = ll;
  centerMarker.setLngLat(ll).addTo(editor);
  if (fly) editor.flyTo({ center: ll, zoom: 17.5 });
  for (const p of allPois()) { p.dist = haversine(ll, p.lngLat); p.route = null; }
  state.iso = null;
  refreshEditor();
  renderPoiList();
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
const PRIORITY = ['school', 'hospital', 'market', 'supermarket', 'mall', 'park', 'university', 'kinder', 'admin', 'transport', 'bank', 'clinic', 'industrial', 'worship', 'fuel'];

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

function renderRoads() {
  const box = $('roadList');
  if (!state.roads.length) { box.innerHTML = '<p class="empty">—</p>'; return; }
  box.innerHTML = '';
  for (const r of state.roads) {
    const b = document.createElement('button');
    const on = state.roadSel.includes(r.name);
    b.className = on ? 'on' : '';
    b.textContent = `${on ? '⭐' : '☆'} ${r.name} · ${fmtDist(r.dist)}`;
    b.onclick = () => {
      const i = state.roadSel.indexOf(r.name);
      if (i >= 0) state.roadSel.splice(i, 1);
      else { if (state.roadSel.length >= 2) state.roadSel.shift(); state.roadSel.push(r.name); }
      renderRoads(); markDirty(); save();
    };
    box.appendChild(b);
  }
}

async function scan() {
  if (!state.center) return toast('Hãy xác định vị trí ở bước 1 trước.', true);
  const btn = $('btnScan');
  btn.disabled = true;
  btn.textContent = '⏳ Đang quét…';
  try {
    const res = await fetchSurroundings(origin(), +val('selRadius'));
    const keep = new Set(state.selected);
    state.pois = res.pois.slice(0, 600);
    state.roads = res.roads;
    state.selected = state.selected.filter((id) => getPoi(id));
    state.roadSel = state.roadSel.filter((n) => state.roads.some((r) => r.name === n));
    if (!keep.size || !state.selected.length) autoPick();
    renderPoiList(); renderRoads(); refreshEditor();
    toast(`Tìm thấy ${res.pois.length} tiện ích và ${res.roads.length} tuyến đường. Đã gợi ý sẵn – bạn chỉnh lại tuỳ ý.`);
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
  const plot = state.plot.length >= 3 ? state.plot : null;
  stage.setData('plot', plot ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...plot, plot[0]]] } }] } : null);
  stage.setData('iso', iso ? { type: 'FeatureCollection', features: iso.map((f) => ({ type: 'Feature', properties: { minutes: f.minutes }, geometry: f.geometry })) } : null);
  const roadsSel = state.roads.filter((r) => state.roadSel.includes(r.name));
  stage.setData('roads', { type: 'FeatureCollection', features: roadsSel.flatMap((r) => r.lines.map((l) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: l } }))) });
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
    iso,
    info: info(),
    media: state.media,
    script: val('inScript'),
    voiceDuration: state.voice ? state.voice.duration : 0,
    credit: MAP_STYLES[styleId].credit,
    opts: {
      theme: val('o_theme'), pace: +val('o_pace'), mode, speedKmh: +val('inSpeed') || 30,
      showDims: val('o_dims'), subtitles: val('o_subs'), isoLabel, voiceDelay: 0.5,
    },
  });
  mixed = await mixAudio({ voice: state.voice, music: state.music, duration: timeline.duration, voiceDelay: 0.5, musicVolume: +val('musicVol') });
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

// ---------- khởi tạo ----------
function fillSelects() {
  const ps = $('selProvince');
  for (const [name, lon] of PROVINCES) ps.add(new Option(`${name} (${String(lon).replace('.', ',')}°)`, String(lon)));
  ps.value = '105.75';
  $('inLon0').value = '105.75';
  for (const [k, s] of Object.entries(MAP_STYLES)) $('o_style').add(new Option(s.label, k));
  for (const [k, l] of Object.entries(TONES)) $('selTone').add(new Option(l, k));
  for (const [k, c] of Object.entries(CATS)) $('poiCatFilter').add(new Option(`${c.icon} ${c.label}`, k));
}

function bind() {
  $('btnLocate').onclick = () => {
    const t = $('inLink').value;
    const ll = parseLatLng(t);
    if (ll) { setCenter(ll); toast('Đã định vị. Kéo ghim 📍 để chỉnh chính xác nếu cần.'); return; }
    if (isShortGoogleLink(t)) toast('Link rút gọn không đọc được toạ độ. Hãy mở link trên trình duyệt, đợi bản đồ hiện rồi copy lại địa chỉ đầy đủ trên thanh địa chỉ (có dạng .../@10.77,106.70...).', true, 9000);
    else toast('Không tìm thấy toạ độ trong nội dung đã dán.', true);
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
    afterPlotChange();
  };
  $('selProvince').onchange = () => { $('inLon0').value = $('selProvince').value; save(); };
  $('btnCorners').onclick = () => {
    try {
      const { points, mode } = parseCorners($('inCorners').value, +$('inLon0').value);
      if (points.length < 3) return toast('Cần ít nhất 3 góc hợp lệ.', true);
      state.plot = points;
      setCenter(centroid(points), false);
      editor.fitBounds([[Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))], [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))]], { padding: 80, maxZoom: 19 });
      afterPlotChange();
      toast(`Đã vẽ ranh ${points.length} góc (${mode === 'vn2000' ? 'VN-2000' : 'GPS'}) · ${fmtArea(polygonArea(points))}. So với diện tích trên sổ để kiểm tra.`, false, 6000);
    } catch (e) { toast(e.message, true); }
  };
  $('btnScan').onclick = scan;
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
  if (state.center) {
    centerMarker.setLngLat(state.center).addTo(editor);
    editor.jumpTo({ center: state.center, zoom: 16.5 });
  }
  document.documentElement.style.setProperty('--accent', val('o_theme'));
  refreshEditor(); renderPoiList(); renderRoads(); fitPreview(); markDirty();
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
}

main();
