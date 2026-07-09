// Genera los iconos PNG de la PWA a partir del mismo diseno que public/icon.svg,
// sin dependencias externas (coste 0): el PNG se construye a mano con node:zlib.
// Uso: node scripts/generate-icons.mjs
// Salida: public/icon-192.png, public/icon-512.png, public/icon-maskable-512.png
// y public/apple-touch-icon.png (180x180).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Paleta (identica a icon.svg y al theme_color del manifest).
const BG = [0x0f, 0x17, 0x2a]; // slate-950
const BODY = [0x22, 0xc5, 0x5e]; // green-500
const BAND = [0x16, 0xa3, 0x4a]; // green-600
const DOT = BG;

// --- Primitivas de dibujo en el espacio 512x512 del SVG original ---

function insideRoundedRect(x, y, rx, ry, w, h, r) {
  if (x < rx || x > rx + w || y < ry || y > ry + h) return false;
  const cx = Math.max(rx + r, Math.min(x, rx + w - r));
  const cy = Math.max(ry + r, Math.min(y, ry + h - r));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

// Color de un punto (coordenadas en el lienzo 512): fondo, cartera, banda y cierre.
function colorAt(x, y) {
  if (insideCircle(x, y, 336, 292, 26)) {
    // El cierre solo existe dentro del cuerpo de la cartera.
    if (insideRoundedRect(x, y, 112, 168, 288, 200, 28)) return DOT;
  }
  if (insideRoundedRect(x, y, 112, 168, 288, 52, 26)) return BAND;
  if (insideRoundedRect(x, y, 112, 168, 288, 200, 28)) return BODY;
  return BG;
}

// Renderiza el icono a un buffer RGBA con supersampling 3x3 para suavizar bordes.
function renderRgba(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = 512 / size;
  const SS = 3;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * scale;
          const y = (py + (sy + 0.5) / SS) * scale;
          const c = colorAt(x, y);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const i = (py * size + px) * 4;
      pixels[i] = Math.round(r / (SS * SS));
      pixels[i + 1] = Math.round(g / (SS * SS));
      pixels[i + 2] = Math.round(b / (SS * SS));
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

// --- Codificacion PNG minima (IHDR + IDAT + IEND, RGBA 8 bits, sin filtros) ---

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profundidad de bit
  ihdr[9] = 6; // tipo de color: RGBA
  // compresion 0, filtro 0, sin entrelazado
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filtro None por scanline
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeIcon(fileName, size) {
  const png = encodePng(size, renderRgba(size));
  writeFileSync(join(OUT_DIR, fileName), png);
  console.log(`${fileName} (${size}x${size}, ${png.length} bytes)`);
}

mkdirSync(OUT_DIR, { recursive: true });
// El diseno ocupa la zona central (~56%), dentro de la zona segura del 80% que exige
// purpose maskable, asi que el mismo render con fondo a sangre sirve para ambos usos.
writeIcon('icon-192.png', 192);
writeIcon('icon-512.png', 512);
writeIcon('icon-maskable-512.png', 512);
writeIcon('apple-touch-icon.png', 180);
