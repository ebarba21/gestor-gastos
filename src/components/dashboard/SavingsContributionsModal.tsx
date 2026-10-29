// Desglose de los graficos de ahorro e inversion: lista los movimientos que componen la
// barra (un mes) o el punto del acumulado (desde el inicio de la ventana hasta ese mes) que
// se ha pulsado. Solo presentacion: los importes y totales salen de statsService y cuadran
// con el grafico. Al cerrarlo, el dashboard pasa a ese mes (lo decide DashboardSection).
import type { SavingsContributionSelection } from '../../services/statsService';
import { formatCents } from '../../lib/money';
import { Modal } from '../common';

interface SavingsContributionsModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  selection: SavingsContributionSelection | null;
  categoryNames: Map<string, string>;
  accountNames: Map<string, string>;
  onSelectMovement: (id: string) => void;
  // Aviso de lo que pasa al cerrar (p. ej. que el dashboard se filtra por ese mes). Opcional.
  closeHint?: string | null;
}

export function SavingsContributionsModal({
  open,
  onClose,
  title,
  subtitle,
  selection,
  categoryNames,
  accountNames,
  onSelectMovement,
  closeHint = null,
}: SavingsContributionsModalProps) {
  const items = selection?.items ?? [];

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="border-b border-slate-800 pb-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs text-slate-500">
            {subtitle} · {items.length} movimiento(s)
          </p>
          <p className="text-lg font-semibold tabular-nums text-slate-100">
            {formatCents(selection?.totalCents ?? 0)}
          </p>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Ahorro{' '}
          <span className="font-medium tabular-nums text-emerald-400">
            {formatCents(selection?.savingsCents ?? 0)}
          </span>
          {' · '}Inversión{' '}
          <span className="font-medium tabular-nums text-sky-400">
            {formatCents(selection?.investmentCents ?? 0)}
          </span>
        </p>
      </div>

      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Sin aportaciones en este periodo.</p>
      ) : (
        <ul className="divide-y divide-slate-800">
          {items.map((it) => {
            const withdrawal = it.contributionCents < 0;
            const isSavings = it.bucket === 'savings';
            return (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => onSelectMovement(it.id)}
                  className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded px-2 py-2 text-left transition-colors hover:bg-slate-800/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-200">{it.concept}</p>
                    <p className="truncate text-xs text-slate-500">
                      {it.categoryId ? categoryNames.get(it.categoryId) ?? 'Desconocida' : 'Sin categoria'}
                      {' · '}
                      {accountNames.get(it.accountId) ?? 'Cuenta'}
                      {' · '}
                      {it.date}
                    </p>
                    <span
                      className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        isSavings ? 'bg-emerald-900/40 text-emerald-300' : 'bg-sky-900/40 text-sky-300'
                      }`}
                    >
                      {isSavings ? 'Ahorro' : 'Inversión'}
                      {withdrawal && ' · Retirada'}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 text-sm font-medium tabular-nums ${
                      withdrawal ? 'text-red-300' : isSavings ? 'text-emerald-300' : 'text-sky-300'
                    }`}
                  >
                    {formatCents(it.contributionCents)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-slate-500">Pulsa un movimiento para ver y editar sus detalles.</p>
      {closeHint && <p className="mt-3 text-[11px] text-indigo-300/80">{closeHint}</p>}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Cerrar
        </button>
      </div>
    </Modal>
  );
}
