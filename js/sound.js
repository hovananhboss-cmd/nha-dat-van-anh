// Nhạc nền + hiệu ứng âm thanh (SFX) tự tổng hợp bằng Web Audio – không cần file, không lo bản quyền.
// Mọi âm thanh xếp theo thời gian tuyệt đối trong OfflineAudioContext -> xem trước và xuất giống nhau.

const BPM = 96, BEAT = 60 / BPM;
const midi = (n) => 440 * 2 ** ((n - 69) / 12);
// vi – IV – I – V (Am – F – C – G), mỗi hợp âm 2 ô nhịp
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];

let noiseBuf = null;
function noise(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function tone(ctx, dest, { f, t, d, type = 'sine', g = 0.1, a = 0.01, f2 }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  const v = ctx.createGain();
  v.gain.setValueAtTime(0, t);
  v.gain.linearRampToValueAtTime(g, t + a);
  v.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(v).connect(dest);
  o.start(t);
  o.stop(t + d + 0.05);
}

function noiseHit(ctx, dest, { t, d, g, filter = 'bandpass', f0, f1, fm, q = 1.2, peak = 0.4 }) {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx);
  s.loop = true;
  const bq = ctx.createBiquadFilter();
  bq.type = filter;
  bq.Q.value = q;
  bq.frequency.setValueAtTime(f0, t);
  if (fm) { bq.frequency.exponentialRampToValueAtTime(fm, t + d * peak); bq.frequency.exponentialRampToValueAtTime(f1, t + d); }
  else bq.frequency.exponentialRampToValueAtTime(f1, t + d);
  const v = ctx.createGain();
  v.gain.setValueAtTime(0.0001, t);
  v.gain.exponentialRampToValueAtTime(g, t + d * peak);
  v.gain.exponentialRampToValueAtTime(0.0001, t + d);
  s.connect(bq).connect(v).connect(dest);
  s.start(t, Math.random() * 0.5);
  s.stop(t + d + 0.05);
}

// Nhạc nền nhẹ nhàng kiểu "corporate": pad + bass + arpeggio + trống, lặp đủ thời lượng
// loop = true: đoạn lặp liền mạch (arpeggio + trống ngay từ đầu)
export function synthMusic(ctx, dest, duration, loop = false) {
  const pad = ctx.createBiquadFilter();
  pad.type = 'lowpass';
  pad.frequency.value = 1400;
  pad.connect(dest);
  const bar = BEAT * 4;
  for (let t0 = 0, i = 0; t0 < duration; t0 += bar * 2, i++) {
    const ch = CHORDS[i % CHORDS.length];
    const len = Math.min(bar * 2, duration - t0) + 0.6;
    for (const n of ch) for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midi(n);
      o.detune.value = det;
      const v = ctx.createGain();
      v.gain.setValueAtTime(0, t0);
      v.gain.linearRampToValueAtTime(0.018, t0 + 0.6);
      v.gain.setValueAtTime(0.018, t0 + len - 0.7);
      v.gain.linearRampToValueAtTime(0, t0 + len);
      o.connect(v).connect(pad);
      o.start(t0);
      o.stop(t0 + len + 0.05);
    }
    for (let b = 0; b < 8; b += 2) {
      const t = t0 + b * BEAT;
      if (t < duration) tone(ctx, dest, { f: midi(ch[0] - 24), t, d: BEAT * 1.9, type: 'triangle', g: 0.16, a: 0.02 });
    }
    // arpeggio móc 1/8 sau 2 ô nhịp đầu
    if (loop || t0 >= bar * 2) {
      const seq = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 12];
      for (let k = 0; k < 16; k++) {
        const t = t0 + k * BEAT / 2;
        if (t < duration) tone(ctx, dest, { f: midi(seq[k % 4]), t, d: 0.32, type: 'triangle', g: 0.05, a: 0.005 });
      }
    }
  }
  // trống: kick mỗi phách, hi-hat nhịp nghịch – vào từ ô nhịp thứ 5
  for (let t = loop ? 0 : bar * 4; t < duration - (loop ? 0.01 : 0.3); t += BEAT) {
    tone(ctx, dest, { f: 130, f2: 42, t, d: 0.32, g: 0.32, a: 0.003 });
    noiseHit(ctx, dest, { t: t + BEAT / 2, d: 0.07, g: 0.035, filter: 'highpass', f0: 7000, f1: 9000, peak: 0.1 });
  }
}

// Tổng hợp 1 đoạn 8 ô nhịp (~20 giây) một lần rồi phát lặp – tổng hợp cả bài mỗi lần dựng mất ~25 giây cho video 2 phút
const LOOP = BEAT * 4 * 8;
let loopP = null;
export function musicLoop(sr = 48000) {
  if (!loopP) {
    const ctx = new OfflineAudioContext(2, Math.ceil((LOOP + 1.2) * sr), sr);
    synthMusic(ctx, ctx.destination, LOOP, true);
    loopP = ctx.startRendering().then((buf) => {
      // cộng phần âm vang sau điểm cuối vào đầu đoạn -> chỗ nối không bị hụt tiếng
      const n = Math.round(LOOP * sr), out = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: sr });
      for (let c = 0; c < 2; c++) {
        const s = buf.getChannelData(c), d = out.getChannelData(c);
        d.set(s.subarray(0, n));
        for (let i = n; i < s.length; i++) d[i - n] += s[i];
      }
      return out;
    });
    loopP.catch(() => (loopP = null));
  }
  return loopP;
}

const whoosh = (ctx, dest, t, g = 0.22) => noiseHit(ctx, dest, { t: Math.max(0, t - 0.35), d: 0.9, g, f0: 250, fm: 2600, f1: 500, peak: 0.45 });
const impact = (ctx, dest, t) => {
  tone(ctx, dest, { f: 95, f2: 38, t, d: 1.1, g: 0.5, a: 0.004 });
  noiseHit(ctx, dest, { t, d: 0.5, g: 0.12, filter: 'lowpass', f0: 1800, f1: 200, peak: 0.05 });
};
const ping = (ctx, dest, t) => {
  tone(ctx, dest, { f: 1320, t, d: 0.55, g: 0.09, a: 0.003 });
  tone(ctx, dest, { f: 1980, t, d: 0.3, g: 0.03, a: 0.003 });
};
const ding = (ctx, dest, t) => {
  tone(ctx, dest, { f: 1568, t, d: 0.9, g: 0.07, a: 0.004 });
  tone(ctx, dest, { f: 2349, t: t + 0.07, d: 1.0, g: 0.05, a: 0.004 });
};

// SFX theo cảnh: vút khi chuyển cảnh, "bùm" khi chạm lô đất, "ting" khi hiện thẻ tiện ích / điểm mốc
export function synthSfx(ctx, dest, scenes) {
  for (const s of scenes) {
    if (s.name === 'intro') { noiseHit(ctx, dest, { t: 0.2, d: s.dur * 0.95, g: 0.2, f0: 3500, f1: 250, peak: 0.6 }); continue; }
    if (s.name === 'zoomlot') { impact(ctx, dest, s.start); ding(ctx, dest, s.start + s.dur * 0.15); continue; }
    whoosh(ctx, dest, s.start);
    for (const q of s.pings || []) ping(ctx, dest, s.start + s.dur * q); // radar quét trúng tiện ích
    // thẻ tên hiện ở khoảng 74% cảnh dẫn đường (xem chaseCamFn trong scenes.js)
    if (s.name === 'poi' || s.name === 'region') ding(ctx, dest, s.start + s.dur * 0.74);
    if (s.name === 'outro') impact(ctx, dest, s.start + 0.3);
  }
}
