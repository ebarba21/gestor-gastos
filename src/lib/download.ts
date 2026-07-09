// Disparo de descargas de ficheros locales desde el navegador. Es la capa que toca el DOM
// (crear un Blob, una URL de objeto y un enlace temporal), aislada aqui para que los
// servicios de exportacion/backup permanezcan puros y testeables. No hay ninguna llamada
// de red: el fichero se genera y se guarda en el propio dispositivo (invariantes 2 y 3 de
// CLAUDE.md).

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const JSON_MIME = 'application/json';

// Descarga un Blob con el nombre indicado. Crea un enlace temporal, lo activa y libera la
// URL de objeto para no filtrar memoria.
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Se libera en el siguiente tick para no cortar la descarga en algunos navegadores.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

// Descarga bytes de un XLSX ya generado (lib/csvXlsx.writeXlsx).
export function downloadXlsx(bytes: Uint8Array, fileName: string): void {
  // Copia a un ArrayBuffer propio para evitar depender del buffer subyacente del view.
  const buffer = bytes.slice().buffer;
  downloadBlob(new Blob([buffer], { type: XLSX_MIME }), fileName);
}

// Descarga un texto JSON (backup del perfil).
export function downloadJson(text: string, fileName: string): void {
  downloadBlob(new Blob([text], { type: JSON_MIME }), fileName);
}

// Nombre de fichero con marca de fecha (YYYYMMDD) para exportaciones y backups. El `slug`
// se limpia a caracteres seguros de sistema de ficheros.
export function timestampedFileName(base: string, extension: string, date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const slug = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  const safe = slug.length > 0 ? slug : 'export';
  return `${safe}-${y}${m}${d}.${extension}`;
}
