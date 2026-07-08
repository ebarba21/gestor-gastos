// Wrappers de lectura de ficheros para la importacion (CSV y XLSX). Todo el parseo ocurre
// en el navegador; ningun byte del fichero sale del dispositivo (invariantes 2 y 3 de
// CLAUDE.md: no hay fetch ni subida). El CSV se parsea con un lexer propio para tener
// control total sobre el delimitador y los separadores decimales de la banca espanola
// (donde el ';' es habitual porque la ',' es el separador decimal). El XLSX se lee con
// SheetJS (unica dependencia permitida para hojas de calculo).
import type { SourceFormat } from '../db/schema';

// Valor de una celda tal cual se lee del fichero. El CSV produce siempre strings; el XLSX
// puede producir numeros (importes ya numericos), fechas (celdas de fecha) o strings.
export type CellValue = string | number | boolean | Date | null;

// Matriz de celdas: filas x columnas. Puede ser irregular (filas de distinta longitud);
// el servicio la normaliza a un numero de columnas fijo.
export type CellMatrix = CellValue[][];

export interface ParsedWorkbook {
  fileName: string;
  sourceFormat: SourceFormat;
  rows: CellMatrix;
}

const BOM = '﻿';
const CSV_DELIMITERS = [';', ',', '\t'] as const;

// Detecta el delimitador mas probable contando ocurrencias fuera de comillas en la
// primera linea no vacia. Empata a favor de ';' (mas comun en exportaciones ES), luego ','.
export function detectDelimiter(text: string): string {
  const firstLine = firstNonEmptyLine(text);
  let best: string = CSV_DELIMITERS[0];
  let bestCount = -1;
  for (const delim of CSV_DELIMITERS) {
    const count = countOutsideQuotes(firstLine, delim);
    if (count > bestCount) {
      best = delim;
      bestCount = count;
    }
  }
  return best;
}

function firstNonEmptyLine(text: string): string {
  const clean = text.startsWith(BOM) ? text.slice(1) : text;
  for (const line of clean.split(/\r?\n/)) {
    if (line.trim().length > 0) return line;
  }
  return '';
}

function countOutsideQuotes(line: string, delim: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && c === delim) {
      count += 1;
    }
  }
  return count;
}

// Parsea texto CSV a una matriz de strings. Lexer estilo RFC 4180: soporta campos
// entrecomillados, comillas escapadas (""), y saltos de linea CR/LF/CRLF. Si no se pasa
// delimitador, se detecta. Descarta filas totalmente vacias (paridad con blankrows:false).
export function parseCsv(text: string, delimiter?: string): string[][] {
  const raw = text.startsWith(BOM) ? text.slice(1) : text;
  const delim = delimiter ?? detectDelimiter(raw);
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    pushField();
    // Solo se conservan filas con al menos una celda no vacia.
    if (row.some((cell) => cell.length > 0)) rows.push(row);
    row = [];
  };

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuotes) {
      if (c === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      pushField();
    } else if (c === '\r') {
      // Ignorado: el salto de linea real lo marca '\n' (soporta CRLF y LF).
    } else if (c === '\n') {
      pushRow();
    } else {
      field += c;
    }
  }
  // Ultima fila si el fichero no termina en salto de linea.
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

// Lee un XLSX (o XLS) desde un ArrayBuffer y devuelve la primera hoja como matriz de
// celdas. cellDates:true convierte las celdas de fecha en objetos Date; raw:true conserva
// numeros e importes sin formatear (el parseo a centimos es responsabilidad del servicio).
// SheetJS se carga bajo demanda (import dinamico): asi el grueso de la libreria no entra en
// el bundle inicial y la importacion de CSV (caso mas comun en banca ES) no lo necesita.
export async function parseXlsx(data: ArrayBuffer): Promise<CellMatrix> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(new Uint8Array(data), { type: 'array', cellDates: true });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return [];
  const ws = wb.Sheets[firstSheet];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<CellValue[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  return rows;
}

// Deriva el formato de origen a partir del nombre del fichero.
export function formatFromFileName(fileName: string): SourceFormat {
  return /\.xlsx?$/i.test(fileName) ? 'xlsx' : 'csv';
}

// Lee un File (input del usuario) en el navegador. CSV se lee como texto (control total de
// separadores); XLSX como binario via SheetJS. No hay ninguna llamada de red.
export async function readImportFile(file: File): Promise<ParsedWorkbook> {
  const sourceFormat = formatFromFileName(file.name);
  if (sourceFormat === 'csv') {
    const text = await file.text();
    return { fileName: file.name, sourceFormat, rows: parseCsv(text) };
  }
  const buffer = await file.arrayBuffer();
  return { fileName: file.name, sourceFormat, rows: await parseXlsx(buffer) };
}
