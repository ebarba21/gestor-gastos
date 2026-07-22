// Fila del listado de movimientos (presentacion pura). Usada dentro de VirtualList con
// altura fija. Muestra seleccion, fecha, concepto con distintivos, categoria, cuenta,
// importe con color por signo y un boton de acciones. Sin logica de negocio.
import type { Transaction } from '../../db/schema';
import { formatCents } from '../../lib/money';

export const ROW_HEIGHT = 60;

const TYPE_LABEL: Record<Transaction['type'], string> = {
  expense: 'Gasto',
  income: 'Ingreso',
  transfer: 'Transferencia',
};

function Badge({ children, className }: { children: string; className: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${className}`}>
      {children}
    </span>
  );
}

interface TransactionRowProps {
  tx: Transaction;
  selected: boolean;
  onToggleSelect: (id: string, ev: React.MouseEvent) => void;
  onEdit: (tx: Transaction) => void;
  onActions: (tx: Transaction) => void;
  accountNames: Map<string, string>;
  categoryNames: Map<string, string>;
  merchantNames: Map<string, string>;
  locale: string;
  currency: string;
}

export function TransactionRow({
  tx,
  selected,
  onToggleSelect,
  onEdit,
  onActions,
  accountNames,
  categoryNames,
  merchantNames,
  locale,
  currency,
}: TransactionRowProps) {
  const amountClass =
    tx.amountCents < 0 ? 'text-red-400' : tx.amountCents > 0 ? 'text-emerald-400' : 'text-slate-300';
  const categoryLabel = tx.categoryId ? (categoryNames.get(tx.categoryId) ?? '—') : 'Sin categoría';
  const subLabel = tx.subcategoryId ? categoryNames.get(tx.subcategoryId) : undefined;
  const accountLabel = accountNames.get(tx.accountId) ?? '—';
  const merchantLabel = tx.merchantId ? merchantNames.get(tx.merchantId) : undefined;

  return (
    <div
      className={[
        'flex h-full items-center gap-3 border-b border-slate-800 px-3 text-sm',
        selected ? 'bg-indigo-950/40' : 'hover:bg-slate-800/40',
        tx.parentId !== null ? 'pl-8' : '',
      ].join(' ')}
    >
      <input
        type="checkbox"
        checked={selected}
        onClick={(e) => onToggleSelect(tx.id, e)}
        onChange={() => {}}
        aria-label={`Seleccionar ${tx.concept}`}
        className="h-4 w-4 shrink-0"
      />

      {/* En pantallas estrechas la fecha pasa a la línea secundaria del concepto. */}
      <span className="hidden w-24 shrink-0 tabular-nums text-slate-400 sm:block">{tx.date}</span>

      <button
        type="button"
        onClick={() => onEdit(tx)}
        className="flex min-w-0 flex-1 flex-col items-start text-left"
      >
        <span className="flex items-center gap-1.5 truncate text-slate-100">
          <span className="truncate">{tx.concept}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className="truncate text-xs text-slate-500">
            <span className="tabular-nums sm:hidden">{tx.date} · </span>
            {categoryLabel}
            {subLabel ? ` › ${subLabel}` : ''} · {accountLabel}
            {merchantLabel ? ` · ${merchantLabel}` : ''}
          </span>
          {tx.excludedFromStats && <Badge className="bg-slate-700 text-slate-300">Excluido</Badge>}
          {tx.isSplitParent && <Badge className="bg-violet-900/50 text-violet-300">Split</Badge>}
          {tx.transferGroupId !== null && (
            <Badge className="bg-sky-900/50 text-sky-300">Transfer</Badge>
          )}
          {tx.refundOfId !== null && (
            <Badge className="bg-amber-900/50 text-amber-300">Reembolso</Badge>
          )}
        </span>
      </button>

      <span className="hidden w-24 shrink-0 text-xs text-slate-500 sm:block">
        {TYPE_LABEL[tx.type]}
      </span>

      <span className={`w-24 shrink-0 text-right font-medium tabular-nums sm:w-28 ${amountClass}`}>
        {formatCents(tx.amountCents, locale, currency)}
      </span>

      <button
        type="button"
        onClick={() => onActions(tx)}
        aria-label="Acciones del movimiento"
        className="shrink-0 rounded px-2 py-1 text-slate-400 hover:bg-slate-700 hover:text-slate-100"
      >
        ⋯
      </button>
    </div>
  );
}
