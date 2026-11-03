// Xuất MP4 ngay trên thiết bị bằng WebCodecs + mp4-muxer
import { musicLoop, synthSfx } from './sound.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pickVideoCodec(w, h, fps, bitrate) {
  const cands = [
    ['avc1.640033', 'avc'], ['avc1.640032', 'avc'], ['avc1.640028', 'avc'], ['avc1.4d0033', 'avc'],
    ['avc1.4d0028', 'avc'], ['avc1.42e033', 'avc'], ['avc1.42e028', 'avc'],
    ['vp09.00.40.08', 'vp9'], ['vp09.00.10.08', 'vp9'],
  ];
  for (const [codec, kind] of cands) {
    const cfg = { codec, width: w, height: h, bitrate, framerate: fps };
    if (kind === 'avc') cfg.avc = { format: 'avc' };
    try {
      const r = await VideoEncoder.isConfigSupported(cfg);
      if (r.supported) return { cfg, kind };
    } catch (_) {}
  }
  return null;
}

async function pickAudioCodec(sampleRate, channels) {
  for (const [codec, kind] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const cfg = { codec, sampleRate, numberOfChannels: channels, bitrate: 160000 };
    try {
      const r = await AudioEncoder.isConfigSupported(cfg);
      if (r.supported) return { cfg, kind };
    } catch (_) {}
  }
  return null;
}

export function canExport() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

// Trộn giọng đọc + nhạc nền thành 1 AudioBuffer dài đúng thời lượng video
export async function mixAudio({ voice, music, duration, voiceDelay = 0.5, musicVolume = 0.35, voiceVolume = 1, bgm = false, sfx = null }) {
  if (!voice && !music && !bgm && !sfx) return null;
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sr), sr);
  if (!music && bgm) {
    // nhạc tự tạo: cùng đường âm lượng / nhỏ lại khi có giọng đọc như nhạc tải lên
    const g = ctx.createGain();
    const base = (voice ? musicVolume * 0.55 : musicVolume) * 2.5;
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(base, 0.8);
    g.gain.setValueAtTime(base, Math.max(0.9, duration - 1.8));
    g.gain.linearRampToValueAtTime(0, duration);
    g.connect(ctx.destination);
    const src = ctx.createBufferSource();
    src.buffer = await musicLoop(sr);
    src.loop = true;
    src.connect(g);
    src.start(0);
  }
  if (sfx) {
    const g = ctx.createGain();
    g.gain.value = voice ? 0.6 : 0.9;
    g.connect(ctx.destination);
    synthSfx(ctx, g, sfx);
  }
  if (music) {
    const src = ctx.createBufferSource();
    src.buffer = music;
    src.loop = true;
    const g = ctx.createGain();
    const base = voice ? musicVolume * 0.55 : musicVolume;
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(base, 0.8);
    g.gain.setValueAtTime(base, Math.max(0.9, duration - 1.8));
    g.gain.linearRampToValueAtTime(0, duration);
    src.connect(g).connect(ctx.destination);
    src.start(0);
  }
  if (voice) {
    const src = ctx.createBufferSource();
    src.buffer = voice;
    const g = ctx.createGain();
    g.gain.value = voiceVolume;
    src.connect(g).connect(ctx.destination);
    src.start(voiceDelay);
  }
  return await ctx.startRendering();
}

export async function exportVideo({ timeline, stage, width, height, fps = 30, audio, onProgress, signal }) {
  const Mux = window.Mp4Muxer;
  const bitrate = Math.round(width * height * fps * 0.16);
  const vc = await pickVideoCodec(width, height, fps, bitrate);
  if (!vc) throw new Error('Trình duyệt không hỗ trợ mã hoá video. Hãy dùng Chrome / Edge / Safari mới nhất.');
  let ac = null;
  if (audio) ac = await pickAudioCodec(audio.sampleRate, audio.numberOfChannels);

  const target = new Mux.ArrayBufferTarget();
  const muxer = new Mux.Muxer({
    target,
    video: { codec: vc.kind, width, height, frameRate: fps },
    audio: ac ? { codec: ac.kind, numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let encErr = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (encErr = e) });
  venc.configure(vc.cfg);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const mapCanvas = stage.map.getCanvas();
  const N = Math.ceil(timeline.duration * fps);
  const t0 = performance.now();

  for (let i = 0; i < N; i++) {
    if (signal && signal.aborted) throw new Error('Đã huỷ');
    if (encErr) throw encErr;
    const t = i / fps;
    timeline.applyMap(t);
    await stage.settle();
    await timeline.prepare(t);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(mapCanvas, 0, 0, width, height);
    timeline.drawOverlay(ctx, width, height, t);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (venc.encodeQueueSize > 4) await sleep(5);
    if (onProgress && (i % 3 === 0 || i === N - 1)) {
      const el = (performance.now() - t0) / 1000;
      onProgress((i + 1) / N, el / (i + 1) * (N - i - 1));
    }
  }
  await venc.flush();
  venc.close();

  if (ac && audio) {
    let aerr = null;
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (aerr = e) });
    aenc.configure(ac.cfg);
    const ch = audio.numberOfChannels, sr = audio.sampleRate;
    const total = Math.min(audio.length, Math.ceil(timeline.duration * sr));
    const block = 4096;
    for (let off = 0; off < total; off += block) {
      const n = Math.min(block, total - off);
      const data = new Float32Array(n * ch);
      for (let c = 0; c < ch; c++) data.set(audio.getChannelData(c).subarray(off, off + n), c * n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round((off / sr) * 1e6), data });
      aenc.encode(ad);
      ad.close();
      if (aenc.encodeQueueSize > 20) await sleep(2);
    }
    await aenc.flush();
    aenc.close();
    if (aerr) throw aerr;
  }

  muxer.finalize();
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), codec: vc.kind, audioCodec: ac && ac.kind };
}
