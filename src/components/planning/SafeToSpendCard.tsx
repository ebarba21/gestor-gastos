// "Cuanto puedo gastar": la cifra principal de la portada. Disponible hasta el proximo cobro,
// mostrado en RANGO (los recibos variables cambian y una cifra al centimo invita a apurarla),
// con su desglose a un toque y un aviso si los datos no estan al dia.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SafeToSpend } from '../../services/planningService';
import { formatCents } from '../../lib/money';
import { shortDate } from './format';

function euros(cents: number): string {
  // Sin centimos: la cifra es orientativa (rango redondeado a 10 EUR).
  return formatCents(cents).replace(/,00(?=\s|$| )/, '');
}

// Cifra orientativa por dia: euros enteros hacia abajo.
function wholeEuros(cents: number): number {
  return Math.floor(cents / 100) * 100;
}

export function SafeToSpendCard({ safe }: { safe: SafeToSpend }) {
  const [open, setOpen] = useState(false);
  const negative = safe.rangeHighCents <= 0;
  const until =
    safe.nextIncomeSource === 'monthStart'
      ? `hasta fin de mes (${shortDate(safe.nextIncomeDate)})`
      : `hasta tu próximo cobro · ${shortDate(safe.nextIncomeDate)}`;
  const lines: { label: string; cents: number; hint?: string }[] = [
    { label: 'Dinero en tus cuentas', cents: safe.liquidCents, hint: `a ${shortDate(safe.asOf)}` },
    ...(safe.commitmentsCents > 0 ? [{ label: 'Recibos antes del cobro', cents: -safe.commitmentsCents }] : []),
    ...(safe.fundsEarmarkedCents > 0 ? [{ label: 'Apartado en fondos', cents: -safe.fundsEarmarkedCents }] : []),
    ...(safe.goalsPendingCents > 0 ? [{ label: 'Aportación pendiente a objetivos', cents: -safe.goalsPendingCents }] : []),
    ...(safe.extraPayReservedCents > 0 ? [{ label: 'Paga extra apartada', cents: -safe.extraPayReservedCents }] : []),
    ...(safe.bufferCents > 0 ? [{ label: 'Tu colchón mínimo', cents: -safe.bufferCents }] : []),
  ];

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Puedes gastar</p>
      {negative ? (
        <p className="mt-1 text-2xl font-semibold text-amber-300">
          Nada hasta el cobro <span className="text-base font-normal text-slate-300">(faltan {euros(-safe.safeCents)})</span>
        </p>
      ) : (
        <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-100 sm:text-4xl">
          {safe.rangeLowCents > 0 ? `${euros(safe.rangeLowCents)} a ${euros(safe.rangeHighCents)}` : `hasta ${euros(safe.rangeHighCents)}`}
        </p>
      )}
      <p className="mt-1 text-sm text-slate-400">
        {until}
        {!negative && safe.perDayHighCents !== null && (
          <>
            {' · '}
            <span className="text-slate-200">
              unos {safe.perDayLowCents !== null ? `${euros(wholeEuros(safe.perDayLowCents))} a ` : ''}
              {euros(wholeEuros(safe.perDayHighCents))}/día
            </span>
          </>
        )}
      </p>
      {safe.dataAgeDays > 3 && (
        <p className="mt-2 text-xs text-amber-300">
          Con datos hasta el {shortDate(safe.asOf)}.{' '}
          <Link to="/importar" className="underline">
            Importa tus extractos
          </Link>{' '}
          para afinar la cifra.
        </p>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-2 text-xs font-medium text-indigo-400 hover:underline"
      >
        {open ? 'Ocultar el cálculo' : 'Cómo se calcula'}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-slate-800 p-3 text-sm">
          <ul className="space-y-1">
            {lines.map((l) => (
              <li key={l.label} className="flex justify-between gap-3">
                <span className="text-slate-400">
                  {l.label}
                  {l.hint && <span className="text-slate-600"> · {l.hint}</span>}
                </span>
                <span className="tabular-nums text-slate-200">{formatCents(l.cents)}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3 border-t border-slate-800 pt-1 font-medium">
              <span className="text-slate-200">Disponible</span>
              <span className="tabular-nums text-slate-100">{formatCents(safe.safeCents)}</span>
            </li>
          </ul>
          {safe.commitments.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              Recibos: {safe.commitments.map((c) => `${c.name} (${shortDate(c.date)})`).join(', ')}.
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Se muestra en rango porque algunos recibos varían. No es una invitación a gastarlo todo: es lo que
            puedes usar sin tocar tus recibos, fondos ni objetivos.{' '}
            <Link to="/ajustes" className="text-indigo-400 hover:underline">
              Ajusta tu día de cobro y tu colchón
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
