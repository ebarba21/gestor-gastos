// "Lo que ha cambiado": alertas accionables ya calculadas por insightsService. Cada una dice
// que pasa y por que, con cifras, y lleva a donde resolverla (bandeja, movimiento o filtro de
// categoria). La gravedad se indica con icono y texto, nunca solo con color.
import { useNavigate } from 'react-router-dom';
import type { InsightAlert, InsightSeverity } from '../../services/insightsService';

export type AlertFeedback = 'useful' | 'notUseful' | 'snooze';

interface AlertsCardProps {
  alerts: InsightAlert[];
  onSelectCategory?: (categoryId: string | null) => void;
  onSelectMovement?: (id: string) => void;
  limit?: number;
  // Opinion sobre un aviso: util, no util (se oculta 30 dias) o posponer (7 dias).
  onFeedback?: (alertId: string, kind: AlertFeedback) => void;
  // Avisos ya marcados como utiles (para no volver a ofrecer el boton).
  usefulIds?: ReadonlySet<string>;
}

const STYLES: Record<InsightSeverity, { icon: string; label: string; box: string }> = {
  critical: { icon: '!', label: 'Importante', box: 'border-orange-500/40 bg-orange-500/10' },
  action: { icon: '→', label: 'Por revisar', box: 'border-slate-700 bg-slate-900' },
  info: { icon: 'i', label: 'Para tu información', box: 'border-slate-800 bg-slate-900' },
};

export function AlertsCard({
  alerts,
  onSelectCategory,
  onSelectMovement,
  limit = 5,
  onFeedback,
  usefulIds,
}: AlertsCardProps) {
  const navigate = useNavigate();
  if (alerts.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">Nada fuera de lo normal este mes.</p>;
  }
  return (
    <ul className="space-y-2">
      {alerts.slice(0, limit).map((a) => {
        const s = STYLES[a.severity];
        const action = a.route
          ? () => navigate(a.route!)
          : a.transactionId && onSelectMovement
            ? () => onSelectMovement(a.transactionId!)
            : a.categoryId !== undefined && onSelectCategory
              ? () => onSelectCategory(a.categoryId!)
              : undefined;
        const body = (
          <>
            <span
              aria-hidden
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-600 text-[11px] font-bold text-slate-300"
            >
              {s.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="sr-only">{s.label}: </span>
              <span className="block text-sm text-slate-100">{a.title}</span>
              <span className="block text-xs text-slate-400">{a.detail}</span>
            </span>
            {action && (
              <span aria-hidden className="self-center text-slate-500">
                ›
              </span>
            )}
          </>
        );
        return (
          <li key={a.id}>
            {action ? (
              <button
                type="button"
                onClick={action}
                className={`flex w-full gap-3 rounded-lg border px-3 py-2 text-left hover:border-slate-500 ${s.box}`}
              >
                {body}
              </button>
            ) : (
              <div className={`flex gap-3 rounded-lg border px-3 py-2 ${s.box}`}>{body}</div>
            )}
            {onFeedback && (
              <div className="mt-1 flex justify-end gap-3 px-1 text-[11px] text-slate-500">
                {usefulIds?.has(a.id) ? (
                  <span>Marcado como útil</span>
                ) : (
                  <button type="button" onClick={() => onFeedback(a.id, 'useful')} className="hover:text-slate-300">
                    Útil
                  </button>
                )}
                <button type="button" onClick={() => onFeedback(a.id, 'notUseful')} className="hover:text-slate-300">
                  No útil
                </button>
                <button type="button" onClick={() => onFeedback(a.id, 'snooze')} className="hover:text-slate-300">
                  {a.severity === 'critical' ? 'Recordar mañana' : 'Posponer 7 días'}
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
