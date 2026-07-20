// Insignia de estado de sincronizacion para la cabecera. Muestra de un vistazo si hay cambios
// pendientes, un conflicto o un error. En modo local puro (sin cuenta) no se muestra.
import { Link } from 'react-router-dom';
import { useSyncOptional, type SyncStatusUi } from '../../sync/SyncContext';

const LABELS: Record<SyncStatusUi, string> = {
  disabled: 'Local',
  offline: 'Sin conexion',
  syncing: 'Sincronizando',
  conflict: 'Conflicto',
  error: 'Error',
  pending: 'Pendiente',
  synced: 'Sincronizado',
};

const DOT: Record<SyncStatusUi, string> = {
  disabled: 'bg-slate-500',
  offline: 'bg-slate-400',
  syncing: 'bg-sky-400 animate-pulse',
  conflict: 'bg-amber-400',
  error: 'bg-rose-500',
  pending: 'bg-sky-400',
  synced: 'bg-emerald-500',
};

export function SyncBadge(): React.ReactElement | null {
  const sync = useSyncOptional();
  // Sin proveedor (montajes parciales) o sin cuenta activa: no se muestra la insignia.
  if (!sync || !sync.enabled) return null;

  const extra =
    sync.conflictCount > 0
      ? ` (${sync.conflictCount})`
      : sync.pendingCount > 0
        ? ` (${sync.pendingCount})`
        : '';

  return (
    <Link
      to="/sincronizacion"
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
      title="Estado de sincronizacion"
    >
      <span className={`h-2 w-2 rounded-full ${DOT[sync.status]}`} aria-hidden />
      <span>
        {LABELS[sync.status]}
        {extra}
      </span>
    </Link>
  );
}
