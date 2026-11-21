// Tarjeta de primeros pasos en la portada (noviembre 2026). Solo aparece mientras quede algun
// paso pendiente; se puede ocultar (se recuerda en este dispositivo, por perfil).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useActiveProfileId } from '../../hooks/useProfiles';
import { gettingStartedService, type GettingStartedStep } from '../../services/gettingStartedService';

function hiddenKey(profileId: string): string {
  return `gg-getting-started-hidden:${profileId}`;
}

function isHidden(profileId: string): boolean {
  try {
    return localStorage.getItem(hiddenKey(profileId)) === '1';
  } catch {
    return false;
  }
}

export function GettingStartedCard() {
  const profileId = useActiveProfileId();
  const [steps, setSteps] = useState<GettingStartedStep[] | null>(null);
  const [hidden, setHidden] = useState(() => isHidden(profileId));

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    gettingStartedService
      .compute(profileId)
      .then((s) => !cancelled && setSteps(s))
      .catch(() => !cancelled && setSteps(null)); // orientativo: sin datos, no se muestra
    return () => {
      cancelled = true;
    };
  }, [profileId, hidden]);

  if (hidden || steps === null) return null;
  const pending = steps.filter((s) => !s.done);
  if (pending.length === 0) return null;
  const doneCount = steps.length - pending.length;

  return (
    <div className="rounded-xl border border-indigo-800/50 bg-indigo-950/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Primeros pasos</h3>
          <p className="text-xs text-slate-400">
            {doneCount} de {steps.length} hechos. Con esto la app ya te da cifras fiables.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(hiddenKey(profileId), '1');
            } catch {
              // Sin persistencia: se oculta solo en esta sesion.
            }
            setHidden(true);
          }}
          className="shrink-0 rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
        >
          Ocultar
        </button>
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.id} className="flex items-start gap-2.5">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                s.done ? 'bg-emerald-600 text-white' : 'border border-slate-600 text-slate-500'
              }`}
              aria-hidden="true"
            >
              {s.done ? '✓' : ''}
            </span>
            <div className="min-w-0">
              {s.done ? (
                <p className="text-sm text-slate-500 line-through">{s.title}</p>
              ) : (
                <Link to={s.route} className="text-sm font-medium text-indigo-300 hover:underline">
                  {s.title}
                </Link>
              )}
              {!s.done && <p className="text-xs text-slate-500">{s.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
