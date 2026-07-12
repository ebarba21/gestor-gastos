// Pagina de sincronizacion (ruta /sincronizacion). Estado de sync, conflictos, migracion y
// reconstruccion. La cuenta es opcional: sin sesion, invita a activarla sin bloquear el modo local.
import { SyncPanel } from '../components/sync';

export default function SyncPage(): React.ReactElement {
  return <SyncPanel />;
}
