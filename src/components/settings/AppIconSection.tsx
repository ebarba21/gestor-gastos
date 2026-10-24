// Selector del icono de la app. La eleccion se guarda en este dispositivo. Como iOS fija el
// icono al anadir la app a la pantalla de inicio, se explica como reinstalarla con el icono
// nuevo y se avisa de que, en iPhone, quitar la app borra sus datos locales.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  APP_ICONS,
  appIconAssets,
  appIconInstallUrl,
  getStoredAppIcon,
  isRunningStandalone,
  setAppIcon,
} from '../../pwa/appIcon';
import { useToast } from '../../context/ToastContext';

export function AppIconSection() {
  const { showToast } = useToast();
  const [current, setCurrent] = useState<string>(() => getStoredAppIcon());
  const [changed, setChanged] = useState(false);
  const standalone = isRunningStandalone();
  const installUrl = appIconInstallUrl(current);

  function choose(id: string) {
    if (id === current) return;
    if (setAppIcon(id)) {
      setCurrent(id);
      setChanged(true);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(installUrl);
      showToast('Enlace copiado. Pegalo en Safari.', 'success');
    } catch {
      showToast('No se pudo copiar. Manten pulsado el enlace para copiarlo.', 'error');
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Icono de la app
      </h3>
      <p className="mt-2 text-sm text-slate-400">
        Elige el icono que quieres ver en la pantalla de inicio. Se guarda en este dispositivo.
      </p>

      <div className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-7" role="radiogroup" aria-label="Icono de la app">
        {APP_ICONS.map((opt) => {
          const selected = opt.id === current;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => choose(opt.id)}
              className="flex flex-col items-center gap-1.5"
            >
              <img
                src={appIconAssets(opt.id).touch}
                alt=""
                width={56}
                height={56}
                className={[
                  'h-14 w-14 rounded-[14px] ring-2 ring-offset-2 ring-offset-slate-900 transition',
                  selected ? 'ring-indigo-400' : 'ring-transparent',
                ].join(' ')}
              />
              <span className={['text-[11px] leading-tight', selected ? 'text-slate-100' : 'text-slate-500'].join(' ')}>
                {opt.name}
              </span>
            </button>
          );
        })}
      </div>

      {(changed || standalone) && (
        <div className="mt-5 rounded-xl border border-slate-700 bg-slate-950/40 p-4">
          <p className="text-sm font-medium text-slate-200">
            Para ver el icono nuevo en el iPhone hay que volver a anadir la app:
          </p>
          <div className="mt-3 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-sm text-amber-200">
            En iPhone, al quitar la app de la pantalla de inicio se borran sus datos de este
            dispositivo. Antes, comprueba que tu{' '}
            <Link to="/cuenta" className="font-medium underline">
              cuenta
            </Link>{' '}
            esta sincronizada o descarga un backup en{' '}
            <Link to="/exportar" className="font-medium underline">
              Exportar
            </Link>
            .
          </div>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-300">
            <li>Copia el enlace de instalacion de abajo.</li>
            <li>Manten pulsada la app en la pantalla de inicio y elige Eliminar app.</li>
            <li>
              Abre Safari, pega el enlace y pulsa Compartir, luego Anadir a pantalla de inicio.
            </li>
            <li>Abre la app nueva e inicia sesion en tu cuenta (o restaura el backup).</li>
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void copyLink()}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Copiar enlace de instalacion
            </button>
            <code className="min-w-0 break-all text-xs text-slate-500">{installUrl}</code>
          </div>
          {!standalone && (
            <p className="mt-3 text-xs text-slate-500">
              Si ahora mismo estas en Safari, ya puedes anadir la app a la pantalla de inicio
              directamente: usara este icono.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
