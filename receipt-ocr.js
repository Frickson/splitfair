// SplitFair receipt OCR: performed locally in the visitor's browser (no OCR API).
// Tesseract.js is fetched on demand; input photos are not uploaded to Supabase.
const OCR_MODULE = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js';
const MAX_IMAGE_SIZE = 15 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1800;

const amountPattern = /(?:^|[^\d])((?:\d{1,3}(?:[,\s]\d{3})+|\d{1,8})\.\d{2}|(?:\d{1,3}(?:[.\s]\d{3})+|\d{1,8}),\d{2})(?!\d)/g;

function parseMoney(raw) {
  const compact = raw.replace(/\s/g, '');
  const decimal = compact.lastIndexOf('.') > compact.lastIndexOf(',')
    ? compact.replace(/,/g, '')
    : compact.includes(',')
      ? compact.replace(/\./g, '').replace(',', '.')
      : compact;
  const n = Number(decimal);
  return Number.isFinite(n) && n > 0 && n <= 1_000_000_000 ? n : null;
}
function amountsOnLine(line) {
  const matches = [...line.matchAll(amountPattern)].map(m => parseMoney(m[1]));
  return matches.filter(n => n !== null);
}
function scoreLine(line) {
  const s = line.toUpperCase();
  if (/\b(SUB\s*TOTAL|SUBTOTAL|CHANGE|DISCOUNT|SAVINGS?|CASH\s+(?:TENDERED|RECEIVED|GIVEN)|ROUND(?:ING)?|REFUND|TAX\s+TOTAL|GST\s+AMOUNT)\b/.test(s)) return -200;
  if (/\b(GRAND\s+TOTAL|TOTAL\s+(?:AMOUNT|DUE|PAYABLE)|AMOUNT\s+(?:DUE|PAYABLE)|NETT?\s+(?:TOTAL|AMOUNT)|BALANCE\s+DUE)\b/.test(s)) return 120;
  if (/\bTOTAL\b/.test(s)) return 95;
  if (/\bNETT?\b/.test(s)) return 65;
  if (/\b(?:GST|VAT|SST|TAX|SERVICE\s+CHARGE|TIP|CASH|VISA|MASTERCARD|CARD|QTY|QUANTITY)\b/.test(s)) return -60;
  return 0;
}

export function parseReceiptText(text) {
  const lines = String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  let date = '';
  const dateMatch = lines.slice(0, 40).join(' ').match(/\b(?:20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2}|\d{1,2}[\/.-]\d{1,2}[\/.-](?:20)?\d{2})\b/);
  if (dateMatch) date = dateMatch[0];

  const merchant = lines.slice(0, 8).find(line =>
    line.length >= 3 && line.length <= 72 &&
    /[a-zA-Z]{3}/.test(line) &&
    !/\b(?:RECEIPT|INVOICE|DATE|TIME|TEL|PHONE|ADDRESS|TAX|GST|SST|REG\s*NO|TERMINAL|CARD|ORDER|WELCOME|THANK YOU|THANKS|CASHIER|CUSTOMER|TOTAL)\b/i.test(line) &&
    !/^\s*(?:\d|https?:\/\/|www\.)/i.test(line)
  ) || '';

  const candidates = [];
  lines.forEach((line, index) => {
    const score = scoreLine(line);
    if (score < 0) return;
    const own = amountsOnLine(line);
    for (const amount of own) candidates.push({amount,score:score + index / Math.max(1,lines.length),line:index,reason:score >= 65?'labeled':'unlabeled'});
    if (score >= 65 && own.length === 0 && index + 1 < lines.length) {
      const next = amountsOnLine(lines[index + 1]);
      if (scoreLine(lines[index + 1]) > -1) {
        for (const amount of next) candidates.push({amount,score:score - 12 + index/Math.max(1,lines.length),line:index+1,reason:'labeled'});
      }
    }
  });
  candidates.sort((a,b)=> b.score-a.score || b.line-a.line);
  const best = candidates[0] || null;
  // An unlabelled amount is only a suggestion; a user must check it manually.
  return {merchant, date, total:best?.amount ?? null, confidence:best?.reason ?? 'none', text:lines.join('\n')};
}

async function normalizeImage(file) {
  if (!file || !file.type.startsWith('image/')) throw Error('Choose a receipt photo, not a PDF or document.');
  if (file.size > MAX_IMAGE_SIZE || file.size === 0) throw Error('Choose a receipt image smaller than 15 MB.');
  const url = URL.createObjectURL(file);
  try {
    const photo = new Image();
    await new Promise((resolve, reject) => {
      photo.onload = resolve;
      photo.onerror = () => reject(Error('Could not open this image. Try JPEG or PNG instead.'));
      photo.src = url;
    });
    const w = photo.naturalWidth, h = photo.naturalHeight;
    if (!w || !h) throw Error('Image is empty or not supported by this browser.');
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(w,h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(w*scale));
    canvas.height = Math.max(1,Math.round(h*scale));
    const ctx = canvas.getContext('2d',{alpha:false});
    if (!ctx) throw Error('Canvas processing is unavailable.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(photo,0,0,canvas.width,canvas.height);
    return await new Promise((resolve,reject)=>{
      canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Could not prepare the receipt image.')),'image/jpeg',0.88);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function scanReceipt(file, onProgress = () => {}) {
  onProgress('Preparing receipt image…');
  const image = await normalizeImage(file);
  onProgress('Loading free OCR engine (the first scan downloads language data)…');
  const {createWorker} = await import(OCR_MODULE);
  const worker = await createWorker('eng', 1, {
    logger: message => {
      if (message.status === 'recognizing text') onProgress('Reading receipt… '+Math.round((message.progress || 0)*100)+'%');
      else if (message.status) onProgress('OCR: '+message.status+'…');
    }
  });
  try {
    onProgress('Reading receipt…');
    const result = await worker.recognize(image);
    return parseReceiptText(result.data.text);
  } finally {
    await worker.terminate();
  }
}
