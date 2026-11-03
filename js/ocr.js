// Đọc bảng toạ độ từ ảnh chụp sơ đồ thửa – chạy ngay trên máy (Tesseract.js), ảnh không gửi đi đâu
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Không tải được bộ đọc ảnh, kiểm tra mạng.'));
    document.head.appendChild(s);
  });
}

// Phóng to, chuyển xám, tăng tương phản để OCR đọc số chính xác hơn
async function preprocess(file) {
  const bmp = await createImageBitmap(file);
  const target = 2400;
  const k = Math.min(3, target / Math.max(bmp.width, bmp.height)) || 1;
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  // Ngưỡng tự động theo độ sáng trung bình
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const mean = sum / (d.length / 4);
  const th = mean * 0.78;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = g < th ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Chuẩn hoá văn bản OCR thành các dòng "STT  X  Y"
export function rowsFromOcrText(text) {
  const out = [];
  for (let line of String(text || '').split(/\n+/)) {
    line = line.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/[;:]/g, ',');
    // tách các cụm số; gộp "1180081 47" (OCR làm mất dấu phẩy) thành 1180081,47
    const toks = line.match(/\d[\d.,]*/g) || [];
    const merged = [];
    for (let i = 0; i < toks.length; i++) {
      let t = toks[i];
      const digits = t.replace(/[.,]/g, '');
      if (/^\d{6,7}$/.test(t) && toks[i + 1] && /^\d{1,3}$/.test(toks[i + 1])) { t = t + ',' + toks[i + 1]; i++; }
      else if (/^\d{8,10}$/.test(t)) {
        // OCR bỏ dấu phẩy: 118008147 -> 1180081,47 ; 59137213 -> 591372,13
        const intLen = t.startsWith('1') || t.startsWith('2') ? 7 : 6;
        if (digits.length > intLen) t = t.slice(0, intLen) + ',' + t.slice(intLen);
      }
      merged.push(t);
    }
    const big = merged.filter((t) => parseFloat(t.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) > 100000);
    if (big.length >= 2) {
      const stt = merged[0] && parseFloat(merged[0]) < 1000 ? merged[0] : String(out.length + 1);
      out.push(`${stt}\t${big[0]}\t${big[1]}`);
    }
  }
  return out;
}

export async function ocrCoordinates(file, onStatus = () => {}) {
  onStatus('Đang tải bộ đọc ảnh (lần đầu ~3 MB)…');
  await loadScript(TESSERACT);
  onStatus('Đang xử lý ảnh…');
  const canvas = await preprocess(file);
  const worker = await window.Tesseract.createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') onStatus(`Đang đọc số… ${Math.round(m.progress * 100)}%`);
    },
  });
  try {
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789.,- ',
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
    });
    const { data } = await worker.recognize(canvas);
    return { rows: rowsFromOcrText(data.text), raw: data.text };
  } finally {
    await worker.terminate();
  }
}
