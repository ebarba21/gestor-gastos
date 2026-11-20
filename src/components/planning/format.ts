// Formatos de fecha cortos para las tarjetas de planificacion (sin zonas horarias).
import { parseISO } from '../../lib/dates';

export function shortDate(iso: string): string {
  const { y, m, d } = parseISO(iso);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function weekdayDate(iso: string): string {
  const { y, m, d } = parseISO(iso);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
