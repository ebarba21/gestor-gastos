// Variacion con flecha y texto: el signo nunca depende solo del color.
import { formatCents } from '../../lib/money';

function signed(cents: number): string {
  return `${cents > 0 ? '+' : ''}${formatCents(cents)}`;
}

// Delta con flecha y texto: el signo nunca depende solo del color.
export function DeltaText({ cents, suffix }: { cents: number | null; suffix: string }) {
  if (cents === null) return <span className="text-slate-500">Sin histórico {suffix}</span>;
  const cls = cents > 0 ? 'text-emerald-400' : cents < 0 ? 'text-orange-400' : 'text-slate-400';
  const arrow = cents > 0 ? '▲' : cents < 0 ? '▼' : '=';
  return (
    <span className={cls}>
      {arrow} {signed(cents)} <span className="text-slate-500">{suffix}</span>
    </span>
  );
}

