// Desglose de Gastos/Ingresos con el orden congelado mientras el panel esta abierto.
// Al abrirlo se guarda el orden de los movimientos; cada recalculo posterior (p. ej. tras
// editar un movimiento desde el panel) se muestra en ese mismo orden, con los datos nuevos.
// El orden se conserva tambien mientras el panel se oculta para mostrar la ficha del
// movimiento, y se descarta al cerrar el panel o cambiar de desglose.
import { useEffect, useMemo, useState } from 'react';
import {
  applyFrozenDrillDownOrder,
  type DrillDown,
  type DrillDownKind,
} from '../services/statsService';

interface FrozenOrder {
  kind: DrillDownKind;
  ids: string[];
}

export function useFrozenDrillDown(
  kind: DrillDownKind | null,
  drillDowns: Record<DrillDownKind, DrillDown> | null,
): DrillDown | null {
  const [frozen, setFrozen] = useState<FrozenOrder | null>(null);

  useEffect(() => {
    if (kind === null) {
      setFrozen(null);
      return;
    }
    // Ya congelado para este desglose, o aun sin datos que congelar (se hara al llegar).
    if (frozen?.kind === kind || drillDowns === null) return;
    setFrozen({ kind, ids: drillDowns[kind].items.map((it) => it.id) });
  }, [kind, drillDowns, frozen]);

  return useMemo(() => {
    if (kind === null || drillDowns === null) return null;
    const live = drillDowns[kind];
    return frozen?.kind === kind ? applyFrozenDrillDownOrder(live, frozen.ids) : live;
  }, [kind, drillDowns, frozen]);
}
