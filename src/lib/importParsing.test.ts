import { describe, it, expect } from 'vitest';
import {
  parseAmountToCents,
  parseDebitCreditToCents,
  parseDateToIso,
  detectColumnMapping,
  detectDecimalSeparator,
  detectDateFormat,
  isBlankCell,
  type AmountFormat,
} from './importParsing';
import { ValidationError } from './validation';

const ES: AmountFormat = { decimalSeparator: ',', thousandSeparator: '.' };
const US: AmountFormat = { decimalSeparator: '.', thousandSeparator: ',' };
const PLAIN: AmountFormat = { decimalSeparator: ',', thousandSeparator: '' };

describe('parseAmountToCents (formato espanol)', () => {
  it('coma decimal y punto de miles', () => {
    expect(parseAmountToCents('1.234,56', ES)).toBe(123456);
    expect(parseAmountToCents('12,34', ES)).toBe(1234);
    expect(parseAmountToCents('0,05', ES)).toBe(5);
    expect(parseAmountToCents('1.000.000,00', ES)).toBe(100000000);
  });

  it('respeta el signo negativo en cualquier posicion', () => {
    expect(parseAmountToCents('-12,34', ES)).toBe(-1234);
    expect(parseAmountToCents('12,34-', ES)).toBe(-1234);
  });

  it('interpreta los parentesis contables como negativo', () => {
    expect(parseAmountToCents('(1.234,56)', ES)).toBe(-123456);
  });

  it('ignora simbolos de moneda y espacios', () => {
    expect(parseAmountToCents('1.234,56 €', ES)).toBe(123456);
    expect(parseAmountToCents(' EUR 12,34 ', ES)).toBe(1234);
    expect(parseAmountToCents('12 345,00', ES)).toBe(1234500);
  });

  it('formato anglosajon: punto decimal, coma de miles', () => {
    expect(parseAmountToCents('1,234.56', US)).toBe(123456);
    expect(parseAmountToCents('-99.99', US)).toBe(-9999);
  });

  it('sin separador de miles declarado, colapsa separadores intermedios', () => {
    expect(parseAmountToCents('1.234,56', PLAIN)).toBe(123456);
  });

  it('celda numerica de XLSX ya viene en euros', () => {
    expect(parseAmountToCents(12.34, ES)).toBe(1234);
    expect(parseAmountToCents(-1000, ES)).toBe(-100000);
    expect(parseAmountToCents(0, ES)).toBe(0);
  });

  it('redondea al centimo sin usar floats para persistir', () => {
    expect(parseAmountToCents('0,1', ES)).toBe(10);
    expect(parseAmountToCents(19.99, ES)).toBe(1999);
  });

  it('reconoce el signo menos Unicode (U+2212)', () => {
    expect(parseAmountToCents('−12,34', ES)).toBe(-1234);
  });

  it('rechaza importes con mas de dos decimales (no redondea en silencio)', () => {
    // Detecta un separador decimal mal configurado en vez de dar un importe erroneo.
    expect(() => parseAmountToCents('12,345', ES)).toThrow(ValidationError);
    expect(() => parseAmountToCents('1,234.56', ES)).toThrow(ValidationError);
    expect(() => parseAmountToCents(12.345, ES)).toThrow(ValidationError);
    // Un decimal con cero final sigue siendo valido (12,340 = 12,34).
    expect(parseAmountToCents('12,340', ES)).toBe(1234);
  });

  it('lanza ValidationError con valores no numericos o vacios', () => {
    expect(() => parseAmountToCents('', ES)).toThrow(ValidationError);
    expect(() => parseAmountToCents(null, ES)).toThrow(ValidationError);
    expect(() => parseAmountToCents('abc', ES)).toThrow(ValidationError);
    expect(() => parseAmountToCents(new Date(), ES)).toThrow(ValidationError);
  });
});

describe('parseDebitCreditToCents', () => {
  it('cargo produce importe negativo', () => {
    expect(parseDebitCreditToCents('50,00', '', ES)).toBe(-5000);
    expect(parseDebitCreditToCents('50,00', null, ES)).toBe(-5000);
  });

  it('abono produce importe positivo', () => {
    expect(parseDebitCreditToCents('', '1.200,00', ES)).toBe(120000);
    expect(parseDebitCreditToCents(null, '1.200,00', ES)).toBe(120000);
  });

  it('cero en la columna vacia no cuenta como importe', () => {
    expect(parseDebitCreditToCents('0,00', '75,50', ES)).toBe(7550);
    expect(parseDebitCreditToCents('30,00', '0,00', ES)).toBe(-3000);
  });

  it('lanza si hay importe en cargo y abono a la vez', () => {
    expect(() => parseDebitCreditToCents('10,00', '20,00', ES)).toThrow(ValidationError);
  });

  it('lanza si no hay importe en ninguna', () => {
    expect(() => parseDebitCreditToCents('', '', ES)).toThrow(ValidationError);
    expect(() => parseDebitCreditToCents('0,00', '0,00', ES)).toThrow(ValidationError);
  });
});

describe('parseDateToIso', () => {
  it('dd/MM/yyyy y variantes de un digito', () => {
    expect(parseDateToIso('15/01/2026', 'dd/MM/yyyy')).toBe('2026-01-15');
    expect(parseDateToIso('5/1/2026', 'dd/MM/yyyy')).toBe('2026-01-05');
  });

  it('anio de dos digitos se interpreta como 20xx', () => {
    expect(parseDateToIso('15/01/26', 'dd/MM/yy')).toBe('2026-01-15');
  });

  it('formato ISO y otros separadores', () => {
    expect(parseDateToIso('2026-01-15', 'yyyy-MM-dd')).toBe('2026-01-15');
    expect(parseDateToIso('15.01.2026', 'dd.MM.yyyy')).toBe('2026-01-15');
    expect(parseDateToIso('2026/01/15', 'yyyy/MM/dd')).toBe('2026-01-15');
  });

  it('tolera texto extra como la hora', () => {
    expect(parseDateToIso('15/01/2026 12:30', 'dd/MM/yyyy')).toBe('2026-01-15');
  });

  it('objeto Date de XLSX', () => {
    expect(parseDateToIso(new Date(2026, 0, 15), 'dd/MM/yyyy')).toBe('2026-01-15');
  });

  it('numero de serie de Excel', () => {
    // 46037 = 2026-01-15 en el calendario de Excel.
    expect(parseDateToIso(46037, 'dd/MM/yyyy')).toBe('2026-01-15');
  });

  it('lanza con fechas de calendario invalidas o irreconocibles', () => {
    expect(() => parseDateToIso('31/02/2026', 'dd/MM/yyyy')).toThrow(ValidationError);
    expect(() => parseDateToIso('no es fecha', 'dd/MM/yyyy')).toThrow(ValidationError);
    expect(() => parseDateToIso('', 'dd/MM/yyyy')).toThrow(ValidationError);
  });
});

describe('detectColumnMapping', () => {
  it('detecta importe con signo (estrategia signed)', () => {
    const { columnMap, amountStrategy } = detectColumnMapping([
      'Fecha',
      'Concepto',
      'Importe',
      'Cuenta',
    ]);
    expect(amountStrategy).toBe('signed');
    expect(columnMap.date).toBe(0);
    expect(columnMap.concept).toBe(1);
    expect(columnMap.amount).toBe(2);
    expect(columnMap.account).toBe(3);
    expect(columnMap.debit).toBeNull();
  });

  it('detecta cargo/abono (estrategia debitCredit)', () => {
    const { columnMap, amountStrategy } = detectColumnMapping([
      'Fecha valor',
      'Descripcion',
      'Cargo',
      'Abono',
    ]);
    expect(amountStrategy).toBe('debitCredit');
    expect(columnMap.date).toBe(0);
    expect(columnMap.concept).toBe(1);
    expect(columnMap.debit).toBe(2);
    expect(columnMap.credit).toBe(3);
    expect(columnMap.amount).toBeNull();
  });

  it('no reutiliza una misma columna para dos campos', () => {
    const { columnMap } = detectColumnMapping(['Fecha', 'Concepto', 'Importe']);
    const indices = [columnMap.date, columnMap.concept, columnMap.amount];
    expect(new Set(indices).size).toBe(3);
  });

  it('es robusto ante acentos y mayusculas', () => {
    const { columnMap } = detectColumnMapping(['FECHA', 'Descripción', 'Débito', 'Crédito']);
    expect(columnMap.date).toBe(0);
    expect(columnMap.concept).toBe(1);
    expect(columnMap.debit).toBe(2);
    expect(columnMap.credit).toBe(3);
  });
});

describe('detectDecimalSeparator / detectDateFormat', () => {
  it('detecta decimal por punto en formato anglosajon', () => {
    expect(detectDecimalSeparator(['1,234.56', '99.99'])).toBe('.');
  });

  it('por defecto asume decimal coma (convencion ES)', () => {
    expect(detectDecimalSeparator(['1.234,56'])).toBe(',');
    expect(detectDecimalSeparator([])).toBe(',');
  });

  it('detecta formato de fecha por muestra', () => {
    expect(detectDateFormat(['2026-01-15'])).toBe('yyyy-MM-dd');
    expect(detectDateFormat(['15/01/2026'])).toBe('dd/MM/yyyy');
    expect(detectDateFormat(['15.01.2026'])).toBe('dd.MM.yyyy');
    expect(detectDateFormat([])).toBe('dd/MM/yyyy');
  });
});

describe('isBlankCell', () => {
  it('null y strings en blanco son vacios; el cero no', () => {
    expect(isBlankCell(null)).toBe(true);
    expect(isBlankCell('   ')).toBe(true);
    expect(isBlankCell('')).toBe(true);
    expect(isBlankCell(0)).toBe(false);
    expect(isBlankCell('x')).toBe(false);
  });
});
