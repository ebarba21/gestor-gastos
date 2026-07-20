// Insignia discreta de la bandeja de revision para la cabecera (acceso permanente + contador
// discreto, ARCHITECTURE seccion 17). Oculta si no hay tareas abiertas.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useActiveProfileId } from '../../hooks/useProfiles';
import { reviewService } from '../../services/reviewService';

export function ReviewBadge() {
  const profileId = useActiveProfileId();
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    reviewService
      .countsByType(profileId)
      .then((c) => {
        if (!cancelled) setTotal(c.total);
      })
      .catch(() => {
        if (!cancelled) setTotal(0);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  if (total === 0) return null;

  return (
    <Link
      to="/bandeja"
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-700 bg-amber-950/40 px-2 py-1 text-xs text-amber-200 hover:bg-amber-900/50"
      title="Tareas pendientes de revision"
    >
      <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />
      <span>Revision ({total})</span>
    </Link>
  );
}
