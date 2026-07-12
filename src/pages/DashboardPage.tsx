// Pagina Dashboard: monta la seccion. La logica de calculo vive en statsService
// (reutilizando las primitivas compartidas) y la UI en components/dashboard.
import { DashboardSection } from '../components/dashboard';

export default function DashboardPage() {
  return <DashboardSection />;
}
