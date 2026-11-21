// Boton de ojo para ocultar o mostrar los importes (modo privado). Accesible desde la cabecera
// en cualquier seccion.
import { usePrivacy } from '../../context/PrivacyContext';

export function PrivacyToggle({ className = '' }: { className?: string }) {
  const { hidden, toggle } = usePrivacy();
  const label = hidden ? 'Mostrar importes' : 'Ocultar importes';
  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={hidden}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 ${
        hidden ? 'border-indigo-500/60 text-indigo-300' : ''
      } ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {hidden ? (
          <>
            <path d="M3 3l18 18" />
            <path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.3 6.3C4.3 7.6 2.8 9.6 2 12c1 2.5 5 7 10 7 1.8 0 3.4-.6 4.8-1.4" />
            <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          </>
        ) : (
          <>
            <path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </>
        )}
      </svg>
    </button>
  );
}
