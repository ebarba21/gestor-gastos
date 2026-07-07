// Pagina Dashboard. En la fase 2 solo muestra el estado vacio cuidado de un perfil
// recien creado sin datos; las metricas y graficos llegan en la fase 8.
import { useActiveProfile } from '../hooks/useProfiles';
import { EmptyState } from '../components/common';

export default function DashboardPage() {
  const profile = useActiveProfile();

  return (
    <section>
      <h2 className="text-xl font-semibold text-slate-100">Dashboard</h2>
      <p className="mt-1 text-sm text-slate-400">
        Perfil activo: <span className="text-slate-200">{profile.name}</span>
      </p>

      <div className="mt-6">
        <EmptyState
          icon="📊"
          title="Aun no hay datos que mostrar"
          description="Cuando anadas cuentas, categorias y movimientos a este perfil, aqui veras tus metricas y graficos. Empieza creando tus cuentas o importando un extracto."
        />
      </div>
    </section>
  );
}
