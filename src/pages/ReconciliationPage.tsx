// Pagina Conciliacion: saldo de extracto vs calculado, diferencia e historial (ver
// specs/FINANCIAL_ALGORITHMS.md seccion 6). La logica vive en reconciliationService y en la
// seccion.
import { ReconciliationSection } from '../components/reconciliation';

export default function ReconciliationPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <ReconciliationSection />
    </div>
  );
}
