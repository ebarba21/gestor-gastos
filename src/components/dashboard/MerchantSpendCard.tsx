// Ranking de gasto por comercio del periodo. Solo presentacion: recibe la lista ya calculada
// por statsService (computeMerchantSpend) y el mapa de nombres de comercio.
import type { MerchantSpend } from '../../services/statsService';
import { formatCents } from '../../lib/money';

interface MerchantSpendCardProps {
  merchantSpend: MerchantSpend[];
  merchantNames: Map<string, string>;
}

export function MerchantSpendCard({ merchantSpend, merchantNames }: MerchantSpendCardProps) {
  if (merchantSpend.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-slate-500">
        Sin gasto asociado a comercios en este periodo. Asocia movimientos a comercios desde la
        seccion Comercios.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-800">
      {merchantSpend.map((m) => (
        <li key={m.merchantId} className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm text-slate-200">
              {merchantNames.get(m.merchantId) ?? '(comercio)'}
            </p>
            <p className="text-xs text-slate-500">{m.occurrences} movimiento(s)</p>
          </div>
          <span className="shrink-0 text-sm font-medium tabular-nums text-slate-300">
            {formatCents(m.totalCents)}
          </span>
        </li>
      ))}
    </ul>
  );
}
