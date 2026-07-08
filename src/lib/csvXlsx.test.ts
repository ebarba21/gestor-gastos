import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  parseCsv,
  parseXlsx,
  detectDelimiter,
  formatFromFileName,
  type CellValue,
} from './csvXlsx';

describe('detectDelimiter', () => {
  it('detecta punto y coma (habitual en banca ES)', () => {
    expect(detectDelimiter('Fecha;Concepto;Importe')).toBe(';');
  });
  it('detecta coma cuando domina', () => {
    expect(detectDelimiter('date,concept,amount')).toBe(',');
  });
  it('detecta tabulador', () => {
    expect(detectDelimiter('Fecha\tConcepto\tImporte')).toBe('\t');
  });
  it('no cuenta delimitadores dentro de comillas', () => {
    expect(detectDelimiter('"Perez, Juan";123;abc')).toBe(';');
  });
});

describe('parseCsv', () => {
  it('parsea filas y columnas con delimitador autodetectado', () => {
    const rows = parseCsv('a;b;c\n1;2;3');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('soporta campos entrecomillados con el delimitador dentro', () => {
    const rows = parseCsv('Concepto;Importe\n"COMPRA; TIENDA";-12,34');
    expect(rows[1]).toEqual(['COMPRA; TIENDA', '-12,34']);
  });

  it('soporta comillas escapadas y saltos de linea dentro de comillas', () => {
    const rows = parseCsv('a;b\n"dice ""hola""";"linea1\nlinea2"');
    expect(rows[1]).toEqual(['dice "hola"', 'linea1\nlinea2']);
  });

  it('ignora el BOM inicial y soporta CRLF', () => {
    const rows = parseCsv('﻿a;b\r\n1;2\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('descarta filas totalmente vacias', () => {
    const rows = parseCsv('a;b\n\n1;2\n;;');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseXlsx', () => {
  it('lee la primera hoja conservando numeros y fechas', async () => {
    const data: CellValue[][] = [
      ['Fecha', 'Concepto', 'Importe'],
      [new Date(2026, 0, 15), 'COMPRA', -12.34],
      [new Date(2026, 0, 16), 'NOMINA', 1500],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data, { cellDates: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    const rows = await parseXlsx(out);
    expect(rows[0]).toEqual(['Fecha', 'Concepto', 'Importe']);
    expect(rows[1]![1]).toBe('COMPRA');
    expect(rows[1]![2]).toBe(-12.34);
    expect(rows[1]![0]).toBeInstanceOf(Date);
    expect(rows[2]![2]).toBe(1500);
  });
});

describe('formatFromFileName', () => {
  it('deriva el formato por la extension', () => {
    expect(formatFromFileName('extracto.csv')).toBe('csv');
    expect(formatFromFileName('Extracto.XLSX')).toBe('xlsx');
    expect(formatFromFileName('libro.xls')).toBe('xlsx');
    expect(formatFromFileName('sinextension')).toBe('csv');
  });
});
