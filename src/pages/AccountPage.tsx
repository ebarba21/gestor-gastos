// Pagina de cuenta (/cuenta). La cuenta con sincronizacion privada es OPCIONAL: esta pagina
// invita a activarla pero la app funciona en modo local sin ella. Toda la logica de estados
// vive en AccountPanel. Ver ARCHITECTURE seccion 4.
import { AccountPanel } from '../components/auth';

export default function AccountPage() {
  return (
    <section className="max-w-2xl">
      <h2 className="text-xl font-semibold text-slate-100">Cuenta y sincronización</h2>
      <p className="mt-1 text-sm text-slate-400">
        Opcional. Con una cuenta puedes sincronizar una copia privada de tus datos entre
        dispositivos. Sin cuenta, la app sigue funcionando por completo en este dispositivo.
      </p>
      <div className="mt-6">
        <AccountPanel />
      </div>
    </section>
  );
}
