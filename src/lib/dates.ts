// Utilidades de fecha contable (YYYY-MM-DD) y calculo de rangos de periodo.
// Las fechas contables son strings 'YYYY-MM-DD' sin hora ni zona horaria (DATA_MODEL
// seccion 1): ordenables lexicograficamente. Todo el calculo de periodos se hace sobre
// componentes numericos (ano, mes, dia) para evitar desfases de zona horaria; nunca se
// construye un Date a partir del string salvo para obtener "hoy" del reloj local.
import { requireAccountingDate } from './validation';

// Rango de fechas contables inclusivo por ambos extremos.
export interface DateRange {
  from: string; // YYYY-MM-DD, incluido
  to: string; // YYYY-MM-DD, incluido
}

interface Ymd {
  y: number;
  m: number; // 1..12
  d: number; // 1..31
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// Componentes de un YYYY-MM-DD ya validado.
export function parseISO(iso: string): Ymd {
  requireAccountingDate(iso);
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}

export function toISO(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
}

// Numero de dias del mes (m en 1..12). Contempla anos bisiestos.
export function daysInMonth(y: number, m: number): number {
  // Day 0 del mes siguiente en UTC = ultimo dia del mes actual. UTC evita desfases.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Fecha de hoy (reloj local del dispositivo) como YYYY-MM-DD. Unico punto que lee el reloj.
export function todayISO(): string {
  const now = new Date();
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// Trimestre (1..4) que contiene el mes m (1..12).
export function quarterOfMonth(m: number): 1 | 2 | 3 | 4 {
  return (Math.floor((m - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

// Rango del mes que contiene la fecha de referencia.
export function monthRange(refISO: string): DateRange {
  const { y, m } = parseISO(refISO);
  return { from: toISO(y, m, 1), to: toISO(y, m, daysInMonth(y, m)) };
}

// Rango del trimestre que contiene la fecha de referencia (3 meses naturales).
export function quarterRange(refISO: string): DateRange {
  const { y, m } = parseISO(refISO);
  const startMonth = (quarterOfMonth(m) - 1) * 3 + 1; // 1, 4, 7 o 10
  const endMonth = startMonth + 2;
  return { from: toISO(y, startMonth, 1), to: toISO(y, endMonth, daysInMonth(y, endMonth)) };
}

// Rango del ano natural que contiene la fecha de referencia.
export function yearRange(refISO: string): DateRange {
  const { y } = parseISO(refISO);
  return { from: toISO(y, 1, 1), to: toISO(y, 12, 31) };
}

// Rango personalizado. Ambos extremos obligatorios, validos y from <= to.
export function customRange(from: string, to: string): DateRange {
  requireAccountingDate(from);
  requireAccountingDate(to);
  if (from > to) {
    throw new Error(`Rango personalizado invalido: la fecha inicial (${from}) es posterior a la final (${to}).`);
  }
  return { from, to };
}

// Pertenencia de una fecha contable a un rango (comparacion lexicografica, ambos extremos
// incluidos). Requiere que date sea YYYY-MM-DD (mismo formato ordenable).
export function isWithinRange(dateISO: string, range: DateRange): boolean {
  return dateISO >= range.from && dateISO <= range.to;
}

// Desplaza la fecha de referencia un numero de meses (positivo o negativo), conservando el
// dia dentro de lo posible (lo ajusta al ultimo dia del mes destino si no existe, p. ej.
// 31 de enero + 1 mes -> 28/29 de febrero). Devuelve YYYY-MM-DD. Util para navegar periodos.
export function shiftMonths(refISO: string, delta: number): string {
  const { y, m, d } = parseISO(refISO);
  const zeroBased = (m - 1) + delta;
  const ny = y + Math.floor(zeroBased / 12);
  const nm = ((zeroBased % 12) + 12) % 12 + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return toISO(ny, nm, nd);
}

// Desplaza la fecha de referencia un numero de dias (positivo o negativo). Devuelve
// YYYY-MM-DD. Util para acotar ventanas temporales de candidatos (deteccion de duplicados,
// fase 5).
export function shiftDays(refISO: string, delta: number): string {
  const { y, m, d } = parseISO(refISO);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// Desplaza la referencia un numero de anos, ajustando 29 de febrero a 28 en anos no bisiestos.
export function shiftYears(refISO: string, delta: number): string {
  const { y, m, d } = parseISO(refISO);
  const ny = y + delta;
  const nd = Math.min(d, daysInMonth(ny, m));
  return toISO(ny, m, nd);
}
